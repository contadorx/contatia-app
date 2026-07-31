"use server";

// ============================================================
// EXCLUSÃO DE EMPRESAS POR FILTRO
//
// Espelha o que existe em Contatos, com uma diferença importante e assumida:
// a lista de Empresas aplica PARTE dos filtros na tela, não no banco. `produto` e as
// visões (sem contato / sem oportunidade / com oportunidade aberta) são calculadas em
// memória depois de buscar 300 empresas.
//
// Ignorar esses filtros aqui apagaria MAIS do que o operador está vendo — que é
// exatamente o erro que não se pode cometer. Por isso a regra é dura: quando um filtro
// só-da-tela estiver ativo, a exclusão em massa NÃO é oferecida. Só valem os filtros que
// o banco também entende: busca (nome/CNPJ/domínio) e tag.
// ============================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { msgErro } from "@/lib/erros";
import { comoLista } from "@/lib/filtros";
import { logAction, recortarItens } from "@/lib/actionLog";
import { apagarLote } from "@/lib/apagarLote";

// O PostgREST devolve no máximo 1.000 linhas por consulta. Quem apaga é apagarLote():
// pela função do banco (0102) é UMA ida por 1.000; sem ela, pedaços de 200 (URL).
const ONDA_BUSCA = 1000;
const TETO_POR_CHAMADA = 20000;
const ORCAMENTO_MS = 40_000;   // sai limpo antes dos 60s da função
const PAGINA_VINCULOS = 1000;

export type FiltroEmpresas = { q?: string; tag?: string[] };

function limparFiltro(f: any): FiltroEmpresas {
  return {
    q: typeof f?.q === "string" ? f.q.trim().slice(0, 80) : "",
    tag: comoLista(f?.tag),
  };
}
// mesma higienização da página (os caracteres vão para um `or=(...)` do PostgREST)
const buscaEfetiva = (q?: string) => (q || "").replace(/[,()%*]/g, " ").trim();

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: ((me as any)?.tenant_id as string) || null, user_id: user?.id };
}

// ids de empresa que têm alguma das tags — paginado, senão o PostgREST corta em 1.000
// e o filtro passa a mentir (a tela mostraria um conjunto e a exclusão pegaria outro).
async function idsPorTag(supabase: any, tenant_id: string, tags: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (let inicio = 0; inicio < 100000; inicio += PAGINA_VINCULOS) {
    const { data, error } = await supabase
      .from("account_tags").select("account_id")
      .eq("tenant_id", tenant_id).in("tag_id", tags)
      .order("account_id", { ascending: true })
      .range(inicio, inicio + PAGINA_VINCULOS - 1);
    if (error) throw error;
    const linhas = ((data as any[]) || []);
    for (const r of linhas) if (r?.account_id) ids.push(r.account_id);
    if (linhas.length < PAGINA_VINCULOS) break;
  }
  return Array.from(new Set(ids));
}

// ------------------------------------------------------------
// FATIAS — por que o filtro de tag precisa ser quebrado
//
// O filtro de tag vira `id=in.("uuid","uuid",…)` na URL. Medido: 200 uuids já dão 9 KB
// e 1.000 dão 45 KB. Uma tag com mais de ~150 empresas estourava o tamanho da URL e a
// consulta falhava — a tela mostrava "0 empresas" ou dava erro, e a exclusão em massa
// simplesmente não saía do lugar.
//
// Solução: uma consulta por fatia de 150 ids, somando os resultados. As fatias são
// DISJUNTAS (os ids são únicos), então somar contagens é aritmeticamente correto —
// nenhuma empresa é contada duas vezes.
//
// Sem filtro de tag não há lista de ids: uma fatia só, valendo `null`.
// ------------------------------------------------------------
const FATIA_IDS = 150;

async function fatiasDeIds(supabase: any, tenant_id: string, f: FiltroEmpresas): Promise<(string[] | null)[]> {
  if (!f.tag?.length) return [null];
  const ids = await idsPorTag(supabase, tenant_id, f.tag);
  if (!ids.length) return [[]];        // interseção vazia = NENHUMA, não "todas"
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += FATIA_IDS) out.push(ids.slice(i, i + FATIA_IDS));
  return out;
}

function montarConsulta(
  supabase: any, tenant_id: string, f: FiltroEmpresas,
  opts: { select: string; count?: "exact"; head?: boolean; limit?: number },
  fatia: string[] | null
) {
  let q = supabase
    .from("accounts")
    .select(opts.select, opts.count ? { count: opts.count, head: !!opts.head } : undefined)
    .eq("tenant_id", tenant_id);
  if (opts.limit) q = q.limit(opts.limit);
  if (fatia) q = q.in("id", fatia.length ? fatia : ["00000000-0000-0000-0000-000000000000"]);
  const qs = buscaEfetiva(f.q);
  if (qs) q = q.or(`name.ilike.%${qs}%,cnpj.ilike.%${qs}%,domain.ilike.%${qs}%`);
  return q;
}

// Total real = soma das fatias. Com ATALHO importante: se o único filtro é a tag, o
// total já é o tamanho da lista de ids (cada vínculo aponta para uma empresa existente
// do mesmo tenant) — não precisa de UMA consulta por fatia. Sem esse atalho, contar uma
// tag com 78 mil empresas custaria ~520 idas ao banco, e o orçamento de tempo acabaria
// antes de apagar a primeira linha.
async function contarTudo(supabase: any, tenant_id: string, f: FiltroEmpresas): Promise<number> {
  const temBusca = !!buscaEfetiva(f.q);
  if (f.tag?.length && !temBusca) {
    return (await idsPorTag(supabase, tenant_id, f.tag)).length;
  }
  const fatias = await fatiasDeIds(supabase, tenant_id, f);
  let total = 0;
  for (const fatia of fatias) {
    const { count, error } = await montarConsulta(
      supabase, tenant_id, f, { select: "id", count: "exact", head: true }, fatia
    );
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

export async function contarEmpresasPorFiltro(
  filtro: FiltroEmpresas
): Promise<{ total?: number; semFiltro?: boolean; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  try {
    const f = limparFiltro(filtro);
    const total = await contarTudo(supabase, tenant_id, f);
    return { total, semFiltro: !buscaEfetiva(f.q) && !f.tag?.length };
  } catch (e: any) {
    return { error: msgErro(e) };
  }
}

export async function excluirEmpresasPorFiltro(
  filtro: FiltroEmpresas,
  confirmacao: { total: number }
): Promise<{ ok?: boolean; excluidas?: number; restam?: number; incompleto?: boolean; error?: string; aviso?: string }> {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const f = limparFiltro(filtro);
  const esperado = Math.floor(Number(confirmacao?.total));
  if (!Number.isFinite(esperado) || esperado <= 0) {
    return { error: "Confirmação inválida. Recarregue a lista e selecione de novo." };
  }

  const contar = () => contarTudo(supabase, tenant_id, f);

  let totalAgora = 0;
  try { totalAgora = await contar(); } catch (e: any) { return { error: msgErro(e) }; }
  if (!totalAgora) return { error: "Nenhuma empresa bate com esse filtro." };

  // Só recusa se o conjunto CRESCEU. Encolher é esperado — apagar uma base grande leva
  // várias chamadas e a tela reenvia como confirmação o total que sobrou.
  if (totalAgora > esperado + Math.max(5, esperado * 0.05)) {
    return { error: `O filtro passou a pegar mais empresas do que você conferiu (${esperado} → ${totalAgora}). Recarregue a lista e confirme de novo.` };
  }

  const limiteAbsoluto = Math.min(Math.ceil(esperado * 1.05), TETO_POR_CHAMADA);
  const semFiltro = !buscaEfetiva(f.q) && !f.tag?.length;
  const inicio = Date.now();
  let excluidas = 0;
  const amostra: any[] = [];
  let falha: string | null = null;
  let tempoEsgotado = false;

  try {
    const fatias = await fatiasDeIds(supabase, tenant_id, f);
    // percorre fatia por fatia; dentro de cada uma, repete até esgotá-la
    for (const fatia of fatias) {
      if (falha || tempoEsgotado || excluidas >= limiteAbsoluto) break;
      while (excluidas < limiteAbsoluto) {
        if (Date.now() - inicio > ORCAMENTO_MS) { tempoEsgotado = true; break; }

        const { data, error } = await montarConsulta(supabase, tenant_id, f, {
          select: "id, name, cnpj",
          limit: Math.min(ONDA_BUSCA, limiteAbsoluto - excluidas),
        }, fatia);
        if (error) { falha = msgErro(error); break; }
        const linhas = ((data as any[]) || []);
        if (!linhas.length) break;   // esta fatia acabou

        for (const a of linhas) {
          if (amostra.length < 50) amostra.push({ id: a.id, nome: a.name, cnpj: a.cnpj });
        }

        const r = await apagarLote(supabase, "accounts", tenant_id, linhas.map((a) => a.id));
        excluidas += r.n;
        if (r.erro) { falha = r.erro; break; }
        if (!r.n) break; // RLS barrou: insistir viraria laço infinito
      }
    }
  } catch (e: any) {
    falha = msgErro(e);
  }

  if (excluidas > 0) {
    const { itens, truncado } = recortarItens(amostra);
    await logAction(supabase, {
      tenant_id, user_id, action: "account_delete_bulk", entity: "account", qtd: excluidas,
      detail:
        `${excluidas} empresa(s) excluída(s) por filtro` +
        (semFiltro ? " — SEM filtro nenhum (base inteira)" : "") +
        (falha ? " (interrompido por erro no meio)" : "") +
        (tempoEsgotado ? " (volta parcial: orçamento de tempo)" : "") + ".",
      meta: { itens, truncado, filtro: f, semFiltro, confirmado: esperado, falha, tempoEsgotado },
    });
    revalidatePath("/dashboard/contas");
    revalidatePath("/dashboard/contatos");
  }

  if (falha) {
    return excluidas > 0
      ? { ok: true, excluidas, aviso: `Parou no meio: ${falha}. ${excluidas} já foram excluídas e estão no registro — clique de novo para continuar.` }
      : { error: falha };
  }

  let restam = 0;
  try { restam = await contar(); } catch { /* informativo */ }
  return { ok: true, excluidas, restam, incompleto: restam > 0 && excluidas > 0 };
}

// ============================================================
// EXPORTAR CSV das empresas que batem com o filtro
//
// Espelha o de Contatos e vale a mesma ressalva: só os filtros que o BANCO entende
// (busca e tag). Com produto/visão ativos, a tela não oferece o botão — exportar por
// eles devolveria empresas que você não está vendo, o que é confuso na exportação e
// perigoso se o arquivo virar base para uma exclusão depois.
// ============================================================
const TETO_EXPORT = 20000;

export async function exportarEmpresasPorFiltro(
  filtro: FiltroEmpresas,
  opts?: { ids?: string[] }
): Promise<{ csv?: string; linhas?: number; truncado?: boolean; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { montarCsv, dataCsv } = await import("@/lib/csv");
  const f = limparFiltro(filtro);
  const selecao = (opts?.ids || []).filter(Boolean);

  const SELECT =
    "id, name, cnpj, uf, municipio, domain, phone, email, cnae, cnae_descricao, porte, " +
    "created_at, account_tags(tags(name)), contacts(id)";

  const linhas: any[] = [];
  let truncado = false;

  try {
    if (selecao.length) {
      for (let i = 0; i < selecao.length && linhas.length < TETO_EXPORT; i += 200) {
        const { data, error } = await supabase
          .from("accounts").select(SELECT).eq("tenant_id", tenant_id).in("id", selecao.slice(i, i + 200));
        if (error) return { error: msgErro(error) };
        linhas.push(...(((data as any[]) || [])));
      }
    } else {
      const fatias = await fatiasDeIds(supabase, tenant_id, f);
      for (const fatia of fatias) {
        if (linhas.length >= TETO_EXPORT) { truncado = true; break; }
        for (let pagina = 0; pagina * 1000 < TETO_EXPORT; pagina++) {
          const q = montarConsulta(supabase, tenant_id, f, { select: SELECT }, fatia);
          const { data, error } = await q.range(pagina * 1000, pagina * 1000 + 999);
          if (error) return { error: msgErro(error) };
          const lote = ((data as any[]) || []);
          linhas.push(...lote);
          if (lote.length < 1000) break;
          if (linhas.length >= TETO_EXPORT) { truncado = true; break; }
        }
      }
    }
  } catch (e: any) {
    return { error: msgErro(e) };
  }

  if (!linhas.length) return { error: "Nada para exportar com esse filtro." };

  const csv = montarCsv(
    ["Empresa", "CNPJ", "UF", "Município", "Domínio", "Telefone", "E-mail",
     "CNAE", "Atividade", "Porte", "Contatos", "Tags", "Criada em"],
    linhas.slice(0, TETO_EXPORT).map((a) => [
      a.name, a.cnpj, a.uf, a.municipio, a.domain, a.phone, a.email,
      a.cnae, a.cnae_descricao, a.porte,
      ((a.contacts as any[]) || []).length,
      ((a.account_tags as any[]) || []).map((t) => t?.tags?.name).filter(Boolean).join(", "),
      dataCsv(a.created_at),
    ])
  );

  return { csv, linhas: Math.min(linhas.length, TETO_EXPORT), truncado };
}
