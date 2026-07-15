"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canCreate, mensagemLimite } from "@/lib/plan";
import { buscarAtividades, buscarEmpresas, buscarEmpresaPorCnpj, receitaConfigurada, type FiltroReceita } from "@/lib/receita";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

const soDigitos = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
const normNome = (s: string | null | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Monta o filtro da API a partir do que a tela envia (validação básica).
function montarFiltro(input: any): FiltroReceita {
  const cnae = Array.isArray(input?.cnae) ? input.cnae.map(soDigitos).filter((c: string) => /^\d{7}$/.test(c)) : [];
  return {
    atividade: typeof input?.atividade === "string" && input.atividade.trim().length >= 3 ? input.atividade.trim() : undefined,
    cnae: cnae.length ? cnae : undefined,
    uf: typeof input?.uf === "string" && /^[A-Za-z]{2}$/.test(input.uf.trim()) ? input.uf.trim().toUpperCase() : undefined,
    municipio: typeof input?.municipio === "string" && input.municipio.trim() ? input.municipio.trim() : undefined,
    porte: ["ME", "EPP", "Demais"].includes(input?.porte) ? input.porte : undefined,
    com_email: input?.com_email === true,
    com_telefone: input?.com_telefone === true,
  };
}

// marca cada resultado com jaTem=true se o CNPJ já estiver em Empresas (evita repuxar)
async function marcarJaTem(rows: any[]): Promise<any[]> {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return rows;
  const cnpjs = Array.from(new Set(rows.map((r) => soDigitos(r.cnpj)).filter((d) => d.length === 14)));
  const tem = new Set<string>();
  for (let i = 0; i < cnpjs.length; i += 500) {
    const { data } = await supabase.from("accounts").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", cnpjs.slice(i, i + 500));
    for (const a of (data as any[]) || []) if (a.cnpj) tem.add(soDigitos(a.cnpj));
  }
  return rows.map((r) => ({ ...r, jaTem: tem.has(soDigitos(r.cnpj)) }));
}

// garante a tag "Radar" e devolve o id (marca as empresas que vieram do Radar)
async function tagRadarId(supabase: any, tenant_id: string): Promise<string | null> {
  const { data: t } = await supabase.from("tags").select("id").eq("tenant_id", tenant_id).ilike("name", "Radar").maybeSingle();
  if (t) return (t as any).id;
  const { data: c } = await supabase.from("tags").insert({ tenant_id, name: "Radar", color: "#4A3AFF" }).select("id").maybeSingle();
  return (c as any)?.id || null;
}

// ============================================================
// Autocomplete de atividade (campo principal da busca).
// ============================================================
export async function atividadesReceita(q: string) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { atividades: [], error: "Sem workspace." };
  return await buscarAtividades(q);
}

// ============================================================
// Busca na base — devolve uma página de resultados + total.
// A tela mostra os resultados com checkbox; a ação em lote é o envio.
// ============================================================
export async function buscarNaBase(input: any, offset = 0) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!receitaConfigurada()) return { error: "Base da Receita não configurada (defina RECEITA_API_URL e RECEITA_API_TOKEN)." };

  const f = montarFiltro(input);

  // Busca por NOME ou CNPJ (razão social / nome fantasia / CNPJ).
  const busca = typeof input?.busca === "string" ? input.busca.trim() : "";
  const digitos = busca.replace(/\D/g, "");
  if (digitos.length === 14) {
    // CNPJ completo → busca exata (traz mesmo se não tiver e-mail)
    const r = await buscarEmpresaPorCnpj(digitos);
    if (r.error) return { error: r.error };
    const rows = await marcarJaTem(r.empresa ? [r.empresa] : []);
    return { ok: true, total: rows.length, atividades: [], rows, offset: 0 };
  }
  if (busca.length >= 3) {
    // texto → procura em razão social + nome fantasia; não força "só com e-mail"
    f.termo = busca;
    f.com_email = false;
  }

  if (!f.atividade && !f.cnae && !f.uf && !f.termo) {
    return { error: "Escolha uma atividade/UF, ou digite um nome ou CNPJ para buscar." };
  }
  const off = Math.max(Number(offset) || 0, 0);
  const r = await buscarEmpresas({ ...f, limit: 100, offset: off, contar: off === 0 });
  if (r.error) return { error: r.error };
  const rows = await marcarJaTem(r.rows);
  return { ok: true, total: r.total, atividades: r.atividades, rows, offset: off };
}

// ============================================================
// Envia as empresas escolhidas para Empresas + Contatos, JÁ ENRIQUECIDAS.
// Como a busca já traz e-mail/telefone/CNAE/município da base, não precisa de
// nenhuma chamada externa: grava direto. Deduplica por CNPJ.
// ============================================================
export async function enviarParaCadastro(empresas: any[]) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!Array.isArray(empresas) || !empresas.length) return { error: "Nenhuma empresa selecionada." };

  // teto do plano (o envio não pode furar o limite de contatos)
  const lim = await canCreate("contatos");
  if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };

  // 1) carrega empresas e contatos existentes do workspace (dedup em memória)
  const { data: accs } = await supabase.from("accounts").select("id, name, cnpj").eq("tenant_id", tenant_id);
  const contaPorCnpj = new Map<string, string>();
  const contaPorNome = new Map<string, string>();
  for (const a of (accs as any[]) || []) {
    const d = soDigitos(a.cnpj);
    if (d.length === 14) contaPorCnpj.set(d, a.id);
    const n = normNome(a.name);
    if (n && !contaPorNome.has(n)) contaPorNome.set(n, a.id);
  }
  const { data: cts } = await supabase.from("contacts").select("cnpj").eq("tenant_id", tenant_id).not("cnpj", "is", null);
  const contatoTemCnpj = new Set<string>();
  for (const c of (cts as any[]) || []) {
    const d = soDigitos(c.cnpj);
    if (d.length === 14) contatoTemCnpj.add(d);
  }

  let empresasCriadas = 0;
  let contatosCriados = 0;
  let pulados = 0;
  const vistos = new Set<string>();
  const tagId = await tagRadarId(supabase, tenant_id); // marca as empresas como vindas do Radar
  const contasParaMarcar = new Set<string>();

  for (const e of empresas) {
    const cnpj = soDigitos(e.cnpj);
    if (cnpj.length !== 14) { pulados++; continue; }
    if (vistos.has(cnpj)) { pulados++; continue; }
    vistos.add(cnpj);

    const nomeEmpresa = (e.nome_fantasia || e.razao_social || "").trim() || cnpj;
    const email = (e.email || "").trim().toLowerCase() || null;
    const dominio = email && email.includes("@") ? email.split("@")[1] : null;

    // 2) garante a EMPRESA (por CNPJ; senão por nome; senão cria enriquecida)
    let account_id = contaPorCnpj.get(cnpj) || contaPorNome.get(normNome(nomeEmpresa)) || null;
    if (!account_id) {
      const { data: nova, error: errA } = await supabase
        .from("accounts")
        .insert({
          tenant_id,
          owner_id: user_id ?? null,
          name: nomeEmpresa,
          cnpj,
          cnae: e.cnae ? (e.cnae_descricao ? `${e.cnae} — ${e.cnae_descricao}` : e.cnae) : null,
          uf: e.uf || null,
          municipio: e.municipio || null,
          domain: dominio,
          phone: e.telefone || null,
        })
        .select("id")
        .single();
      if (errA) {
        // corrida no índice único de CNPJ (0070): busca a que acabou de existir
        const { data: ja } = await supabase.from("accounts").select("id").eq("tenant_id", tenant_id).eq("cnpj", cnpj).limit(1).maybeSingle();
        account_id = (ja as any)?.id || null;
      } else {
        account_id = (nova as any).id;
        empresasCriadas++;
      }
      if (account_id) contaPorCnpj.set(cnpj, account_id);
    }
    if (account_id) contasParaMarcar.add(account_id); // será marcada com a tag Radar

    // 3) cria o CONTATO (a empresa vira o contato, já que sócios ficaram pra depois),
    //    a não ser que já exista um contato com esse CNPJ (dedup).
    if (contatoTemCnpj.has(cnpj)) { pulados++; continue; }
    const { error: errC } = await supabase.from("contacts").insert({
      tenant_id,
      assigned_to: user_id ?? null,
      name: nomeEmpresa,
      company: e.razao_social || e.nome_fantasia || null,
      account_id,
      cnpj,
      email,
      phone: e.telefone || null,
      origin: "Radar",
      status: "novo",
    });
    if (!errC) {
      contatoTemCnpj.add(cnpj);
      contatosCriados++;
    }
  }

  // marca todas as empresas tocadas com a tag "Radar"
  if (tagId && contasParaMarcar.size) {
    const rows = Array.from(contasParaMarcar).map((account_id) => ({ tenant_id, account_id, tag_id: tagId }));
    await supabase.from("account_tags").upsert(rows, { onConflict: "account_id,tag_id", ignoreDuplicates: true });
  }

  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true, empresasCriadas, contatosCriados, pulados };
}
