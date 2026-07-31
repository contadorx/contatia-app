import "server-only";
import { chaveCnpj } from "@/lib/cnpjFormato";

// ============================================================
// RESOLVER EMPRESAS EM LOTE (encontrar ou criar), para a importação
//
// O QUE ISTO SUBSTITUI, e por quê:
//
// O `ensureAccount` antigo era chamado UMA VEZ POR NOME DE EMPRESA do arquivo, e cada
// chamada fazia `select id, name, cnpj from accounts where tenant_id = ...` sem limite.
// Dois defeitos sérios saíam daí:
//
//   1) O PostgREST corta em 1.000 linhas. Com 78 mil empresas, só as 1.000 primeiras
//      eram vistas — qualquer empresa fora dessa fatia jamais era encontrada e uma
//      DUPLICADA nascia no lugar. É a causa do "importei contatos e ele não assumiu
//      corretamente a empresa".
//   2) Um arquivo com 2.000 empresas distintas fazia 2.000 consultas de até 1.000
//      linhas. Lento a ponto de estourar o tempo da função no meio da importação.
//
// Aqui a lógica é invertida: junta TODAS as chaves do arquivo primeiro, procura em
// poucas consultas (fatiadas por causa do tamanho da URL) e cria de uma vez só o que
// faltou. Passa de O(nomes) consultas para O(nomes/150).
//
// A busca usa as colunas `name_key` e `cnpj_key` (migration 0103), preenchidas por
// gatilho no banco com a MESMA regra do JS — as duas foram conferidas lado a lado sobre
// 5.014 nomes, com zero divergência. Sem elas não dá para procurar no banco: a
// normalização mora no JS e o Postgres não a conhece.
//
// Se a 0103 ainda não tiver sido aplicada, cai num caminho reduzido (nome exato + CNPJ)
// em vez de quebrar — o app é publicado antes da migration ser rodada à mão.
// ============================================================

const FATIA = 150;   // ~150 valores por URL: acima disso o PostgREST recusa (8 KB)
const LOTE_INSERT = 200;

export type PedidoEmpresa = { nome?: string | null; cnpj?: string | null };

export type ResultadoEmpresas = {
  // chave de busca (ver chaveDe) → id da empresa
  porChave: Map<string, string>;
  encontradas: number;
  criadas: number;
  aviso?: string;
};

// CNPJ pode ter LETRAS desde julho/2026 (12 posições alfanuméricas + 2 DV numéricos).
// Antes esta função era `replace(/\D/g,"")`, que apagava as letras e fazia o CNPJ novo
// virar um valor curto e inválido — a empresa perdia a chave forte de dedup.
export { chaveCnpj } from "@/lib/cnpjFormato";

// Espelho EXATO de normalizeCompany() e de public.empresa_chave() (0103).
// Se um dia mudar aqui, tem que mudar nos outros dois — senão a importação passa a
// criar duplicadas em silêncio.
export function chaveNome(raw: string | null | undefined): string {
  const s = (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,/\\\-&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const UNAMBIG = new Set(["ltda", "eireli", "epp", "mei", "me"]);
  const AMBIG = new Set(["sa", "ss", "ei"]);
  const toks = s.split(" ").filter(Boolean);
  let mudou = true;
  while (mudou && toks.length > 0) {
    mudou = false;
    const ult = toks[toks.length - 1];
    if (UNAMBIG.has(ult) && toks.length >= 2) { toks.pop(); mudou = true; }
    else if (AMBIG.has(ult) && toks.length >= 3) { toks.pop(); mudou = true; }
  }
  return toks.join(" ");
}

// Chave de consulta do chamador. CNPJ manda quando existe (é a chave forte); só o CNPJ
// COMPLETO vale — "00.000" não pode fundir empresas diferentes.
export function chaveDe(p: PedidoEmpresa): string {
  const d = chaveCnpj(p.cnpj);          // aceita 12 alfanuméricos + 2 dígitos
  if (d) return `c:${d}`;
  const n = chaveNome(p.nome);
  return n ? `n:${n}` : "";
}

function fatiar<T>(arr: T[], n = FATIA): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function resolverEmpresas(
  supabase: any,
  tenant_id: string,
  user_id: string | undefined,
  pedidos: PedidoEmpresa[]
): Promise<ResultadoEmpresas> {
  const porChave = new Map<string, string>();

  // 1) desduplica o próprio arquivo. Uma lista de 2.000 contatos costuma ter bem menos
  //    empresas distintas — é aqui que a maior parte do trabalho some.
  const unicos = new Map<string, { nome: string; cnpj: string }>();
  for (const p of pedidos) {
    const k = chaveDe(p);
    if (!k || unicos.has(k)) continue;
    unicos.set(k, { nome: (p.nome || "").trim(), cnpj: chaveCnpj(p.cnpj) });
  }
  if (!unicos.size) return { porChave, encontradas: 0, criadas: 0 };

  const cnpjs = [...unicos.values()].map((v) => v.cnpj).filter(Boolean);
  const nomes = [...unicos.entries()].filter(([k]) => k.startsWith("n:")).map(([, v]) => v.nome).filter(Boolean);
  const chavesNome = nomes.map((n) => chaveNome(n)).filter(Boolean);

  let semMigration = false;

  // 2) o que já existe, por CNPJ
  for (const fatia of fatiar(cnpjs)) {
    const { data, error } = await supabase
      .from("accounts").select("id, cnpj_key").eq("tenant_id", tenant_id).in("cnpj_key", fatia);
    if (error) {
      if (String((error as any).code) === "42703") { semMigration = true; break; }
      throw error;
    }
    for (const a of ((data as any[]) || [])) if (a.cnpj_key) porChave.set(`c:${a.cnpj_key}`, a.id);
  }

  // 3) o que já existe, por nome normalizado
  if (!semMigration) {
    for (const fatia of fatiar(Array.from(new Set(chavesNome)))) {
      const { data, error } = await supabase
        .from("accounts").select("id, name_key").eq("tenant_id", tenant_id).in("name_key", fatia);
      if (error) {
        if (String((error as any).code) === "42703") { semMigration = true; break; }
        throw error;
      }
      for (const a of ((data as any[]) || [])) if (a.name_key) porChave.set(`n:${a.name_key}`, a.id);
    }
  }

  // 3b) CAMINHO REDUZIDO — a migration 0103 ainda não foi aplicada.
  // Procura por CNPJ nos dois formatos possíveis e por nome EXATO. Casa menos que o
  // normalizado ("Alfa Ltda" ≠ "Alfa"), mas não tem o teto de 1.000 do jeito antigo e
  // não cria duplicada de quem bate exatamente.
  if (semMigration) {
    porChave.clear();
    const { formatarCnpj } = await import("@/lib/cnpjFormato");
    const variantes = Array.from(new Set(cnpjs.flatMap((d) => [d, formatarCnpj(d)])));
    for (const fatia of fatiar(variantes)) {
      const { data } = await supabase.from("accounts").select("id, cnpj").eq("tenant_id", tenant_id).in("cnpj", fatia);
      for (const a of ((data as any[]) || [])) {
        const d = chaveCnpj(a.cnpj);
        if (d) porChave.set(`c:${d}`, a.id);
      }
    }
    for (const fatia of fatiar(Array.from(new Set(nomes)))) {
      const { data } = await supabase.from("accounts").select("id, name").eq("tenant_id", tenant_id).in("name", fatia);
      for (const a of ((data as any[]) || [])) {
        const k = chaveNome(a.name);
        if (k && !porChave.has(`n:${k}`)) porChave.set(`n:${k}`, a.id);
      }
    }
  }

  const encontradas = porChave.size;

  // 4) cria o que faltou, em lotes
  const faltando = [...unicos.entries()].filter(([k]) => !porChave.has(k));
  let criadas = 0;
  for (const lote of fatiar(faltando, LOTE_INSERT)) {
    const linhas = lote.map(([, v]) => ({
      tenant_id,
      owner_id: user_id ?? null,
      name: v.nome || v.cnpj,
      cnpj: v.cnpj || null,
    }));
    const { data, error } = await supabase.from("accounts").insert(linhas).select("id, name, cnpj");
    if (error) {
      // Corrida com o índice único de CNPJ (0070): outra importação criou a mesma
      // empresa entre a busca e o insert. Cai para um-a-um, para que UMA colisão não
      // derrube o lote inteiro e deixe 200 contatos sem empresa.
      for (const [k, v] of lote) {
        const { data: um } = await supabase
          .from("accounts")
          .insert({ tenant_id, owner_id: user_id ?? null, name: v.nome || v.cnpj, cnpj: v.cnpj || null })
          .select("id").maybeSingle();
        if (um) { porChave.set(k, (um as any).id); criadas++; continue; }
        if (v.cnpj) {
          const { data: ja } = await supabase
            .from("accounts").select("id").eq("tenant_id", tenant_id).eq("cnpj", v.cnpj).limit(1).maybeSingle();
          if (ja) porChave.set(k, (ja as any).id);
        }
      }
      continue;
    }
    // devolve na MESMA ordem enviada? Não dá para garantir — casa pela chave.
    for (const a of ((data as any[]) || [])) {
      const k = chaveDe({ nome: a.name, cnpj: a.cnpj });
      if (k) { porChave.set(k, a.id); criadas++; }
    }
  }

  return {
    porChave,
    encontradas,
    criadas,
    aviso: semMigration
      ? "A migration 0103 ainda não foi aplicada: o vínculo com a empresa casou só por CNPJ e por nome exato. Aplique a 0103 para casar também variações de sufixo (Ltda/ME/EIRELI)."
      : undefined,
  };
}
