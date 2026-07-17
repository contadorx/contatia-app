"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canCreate, mensagemLimite } from "@/lib/plan";
import { nomeProprio } from "@/lib/cnpj";

const soDig = (s: any) => String(s || "").replace(/\D/g, "");
const normNome = (s: any) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function createAccount(input: {
  name: string;
  cnpj?: string;
  uf?: string;
  domain?: string;
  phone?: string;
  website?: string;
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!input.name.trim()) return { error: "Nome da empresa é obrigatório." };

  const { error } = await supabase.from("accounts").insert({
    tenant_id,
    owner_id: user_id,
    name: input.name.trim(),
    cnpj: input.cnpj?.trim() || null,
    uf: input.uf?.trim() || null,
    domain: input.domain?.trim() || null,
    phone: input.phone?.trim() || null,
    website: input.website?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

export async function setContactAccount(contactId: string, accountId: string | null) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("contacts").update({ account_id: accountId }).eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

// Edita os dados de uma empresa (corrigir/completar informações).
export async function updateAccount(id: string, patch: {
  name?: string; cnpj?: string; uf?: string; municipio?: string; domain?: string; phone?: string; website?: string;
}) {
  const { supabase } = await ctx();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = (typeof v === "string" ? v.trim() : v) || null;
  }
  if (clean.name === null) return { error: "O nome não pode ficar vazio." };
  const { error } = await supabase.from("accounts").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${id}`);
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

// Enriquece a EMPRESA pelo CNPJ (dela, ou de um contato vinculado que já tenha CNPJ)
// via BrasilAPI — traz CNAE, porte, situação, município/UF e telefone. Resolve o
// caso "a ficha da empresa fica em branco" quando o CNPJ só estava no contato.
export async function enrichAccount(id: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: acc } = await supabase
    .from("accounts")
    .select("id, cnpj, phone, email, custom")
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (!acc) return { error: "Empresa não encontrada." };

  let cnpj = ((acc as any).cnpj || "").toString();
  // sem CNPJ na empresa? pega o de algum contato vinculado que tenha.
  if (!cnpj) {
    const { data: c } = await supabase
      .from("contacts")
      .select("cnpj")
      .eq("account_id", id)
      .not("cnpj", "is", null)
      .limit(1)
      .maybeSingle();
    cnpj = ((c as any)?.cnpj || "").toString();
  }
  if (!cnpj) return { error: "Sem CNPJ na empresa nem nos contatos. Preencha o CNPJ em Editar dados." };

  const { enrichCnpj } = await import("@/lib/cnpj");
  const r = await enrichCnpj(cnpj);
  if (r.error || !r.data) return { error: r.error || "Não foi possível enriquecer." };
  const d = r.data;

  // só grava o que veio (não apaga dado bom já existente)
  const patch: Record<string, unknown> = { cnpj };
  if (d.cnae) patch.cnae = d.cnae;
  if (d.cnae_descricao) patch.cnae_descricao = d.cnae_descricao;
  if (d.porte) patch.porte = d.porte;
  if (d.uf) patch.uf = d.uf;
  if (d.municipio) patch.municipio = d.municipio;
  if (d.situacao) patch.situacao = d.situacao;
  if (d.cep) patch.cep = d.cep;
  if (d.bairro) patch.bairro = d.bairro;
  if (d.logradouro) patch.logradouro = d.logradouro;
  if (d.numero) patch.numero = d.numero;
  if (d.complemento) patch.complemento = d.complemento;
  // e-mail/telefone só preenchem se estiverem vazios (não sobrescreve o que você digitou)
  if (!(acc as any).email && d.email) patch.email = d.email;
  if (!(acc as any).phone && d.telefone) patch.phone = d.telefone;

  // dados menos centrais ficam no jsonb `custom`
  const custom: Record<string, unknown> = { ...((acc as any).custom || {}) };
  if (d.socios?.length) custom.socios = d.socios;
  if (d.capital_social != null) custom.capital_social = d.capital_social;
  if (d.natureza_juridica) custom.natureza_juridica = d.natureza_juridica;
  if (d.abertura) custom.abertura = d.abertura;
  if (d.telefone2) custom.telefone2 = d.telefone2;
  custom.enriched_at = new Date().toISOString();
  custom.enrich_fontes = r.fontes || [];
  patch.custom = custom;

  const { error } = await supabase.from("accounts").update(patch as any).eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${id}`);
  revalidatePath("/dashboard/contas");
  return { ok: true, fontes: r.fontes };
}

// Cria um NOVO contato já vinculado a esta empresa (a partir da ficha da empresa).
export async function createContactForAccount(
  accountId: string,
  input: { name: string; email?: string; phone?: string; role_title?: string }
) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const name = (input.name || "").trim();
  if (!name) return { error: "Nome é obrigatório." };

  const lim = await canCreate("contatos");
  if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };

  const { data: acc } = await supabase.from("accounts").select("name, cnpj").eq("id", accountId).eq("tenant_id", tenant_id).maybeSingle();
  if (!acc) return { error: "Empresa não encontrada." };

  const { error } = await supabase.from("contacts").insert({
    tenant_id,
    assigned_to: user_id ?? null,
    name,
    email: (input.email || "").trim().toLowerCase() || null,
    phone: (input.phone || "").trim() || null,
    role_title: (input.role_title || "").trim() || null,
    company: (acc as any).name || null,
    cnpj: (acc as any).cnpj || null,
    account_id: accountId,
    origin: "Empresa",
    status: "novo",
  });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${accountId}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

// Exclui uma empresa. contacts.account_id / opportunities.account_id são 'on delete set null'
// (não apaga contatos/negócios, só desvincula); account_tags é cascade.
export async function deleteAccountCompany(id: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("accounts").delete().eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contas");
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

// Cria UM contato a partir de um sócio específico (botão por sócio, igual à ficha do contato).
export async function criarContatoSocio(accountId: string, nomeSocio: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const nome = nomeProprio(nomeSocio) || "";
  if (!nome) return { error: "Nome do sócio vazio." };

  const lim = await canCreate("contatos");
  if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };

  const { data: acc } = await supabase.from("accounts").select("name, cnpj").eq("id", accountId).eq("tenant_id", tenant_id).maybeSingle();
  if (!acc) return { error: "Empresa não encontrada." };

  const { data: dup } = await supabase.from("contacts").select("id").eq("tenant_id", tenant_id).eq("account_id", accountId).ilike("name", nome).limit(1).maybeSingle();
  if (dup) return { error: "Já existe um contato com esse nome nesta empresa." };

  const { error } = await supabase.from("contacts").insert({
    tenant_id,
    assigned_to: user_id ?? null,
    name: nome,
    company: (acc as any).name || null,
    account_id: accountId,
    cnpj: (acc as any).cnpj || null,
    origin: "Sócio",
    status: "novo",
  });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${accountId}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

// Cria contatos a partir dos SÓCIOS que o enriquecimento trouxe (custom.socios).
// Assim o fluxo fecha: Radar → Empresas (enriquece com sócios) → Contatos (os sócios).
export async function criarContatosDosSocios(accountId: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: acc } = await supabase.from("accounts").select("name, cnpj, custom").eq("id", accountId).eq("tenant_id", tenant_id).maybeSingle();
  if (!acc) return { error: "Empresa não encontrada." };
  const socios: string[] = Array.isArray((acc as any).custom?.socios) ? (acc as any).custom.socios : [];
  if (!socios.length) return { error: "Sem sócios ainda. Clique em 'Enriquecer' pelo CNPJ primeiro." };

  const lim = await canCreate("contatos");
  if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };

  // dedup: contatos que já existem nesta empresa (por nome)
  const { data: existentes } = await supabase.from("contacts").select("name").eq("tenant_id", tenant_id).eq("account_id", accountId);
  const jaTem = new Set(((existentes as any[]) || []).map((c) => normNome(c.name)));

  let criados = 0;
  let pulados = 0;
  for (const nomeRaw of socios) {
    const nome = nomeProprio(nomeRaw) || "";
    if (!nome || jaTem.has(normNome(nome))) { pulados++; continue; }
    const { error } = await supabase.from("contacts").insert({
      tenant_id,
      assigned_to: user_id ?? null,
      name: nome,
      company: (acc as any).name || null,
      account_id: accountId,
      cnpj: (acc as any).cnpj || null,
      origin: "Sócio",
      status: "novo",
    });
    if (!error) { criados++; jaTem.add(normNome(nome)); }
  }

  revalidatePath(`/dashboard/contas/${accountId}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true, criados, pulados };
}

// Cria uma NOVA oportunidade para esta empresa (no primeiro estágio do pipeline).
export async function createOpportunityForAccount(
  accountId: string,
  input: { title?: string; value_mrr?: number; primary_contact_id?: string }
) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: acc } = await supabase.from("accounts").select("name").eq("id", accountId).eq("tenant_id", tenant_id).maybeSingle();
  if (!acc) return { error: "Empresa não encontrada." };
  const title = (input.title || "").trim() || (acc as any).name;

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return { error: "Crie ao menos um estágio no Pipeline antes." };

  const { error } = await supabase.from("opportunities").insert({
    tenant_id,
    title,
    account_id: accountId,
    primary_contact_id: input.primary_contact_id || null,
    owner_id: user_id ?? null,
    stage_id: (stage as any).id,
    status: "open",
    value_mrr: Number(input.value_mrr) || 0,
  });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${accountId}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

// ============================================================
// Importar empresas por CSV (mora aqui, em Empresas).
// Cria as EMPRESAS (contas) e, quando a linha tiver contato/e-mail/telefone,
// cria também o CONTATO vinculado. Deduplica empresa por CNPJ/nome e contato por CNPJ.
// Cabeçalho flexível (aceita vírgula ou ponto-e-vírgula).
// ============================================================
export async function importEmpresasCsv(csv: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const lines = String(csv || "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "CSV vazio ou sem linhas de dados." };

  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const col = {
    cnpj: idx(["cnpj"]),
    razao: idx(["razao_social", "razão social", "razao", "nome"]),
    fantasia: idx(["nome_fantasia", "fantasia"]),
    cnae: idx(["cnae", "cnae_fiscal"]),
    uf: idx(["uf", "estado"]),
    municipio: idx(["municipio", "município", "cidade"]),
    domain: idx(["dominio", "domínio", "site", "website"]),
    contato: idx(["contato_principal", "contato", "responsavel"]),
    email: idx(["email", "e-mail"]),
    telefone: idx(["telefone", "fone", "phone"]),
  };
  if (col.razao < 0 && col.fantasia < 0 && col.cnpj < 0) {
    return { error: "O CSV precisa ter ao menos a coluna 'razao_social' (ou 'nome_fantasia'/'cnpj')." };
  }

  // carrega o que já existe (dedup em memória)
  const { data: accs } = await supabase.from("accounts").select("id, name, cnpj").eq("tenant_id", tenant_id);
  const contaPorCnpj = new Map<string, string>();
  const contaPorNome = new Map<string, string>();
  for (const a of (accs as any[]) || []) {
    const d = soDig(a.cnpj);
    if (d.length === 14) contaPorCnpj.set(d, a.id);
    const n = normNome(a.name);
    if (n && !contaPorNome.has(n)) contaPorNome.set(n, a.id);
  }
  const { data: cts } = await supabase.from("contacts").select("cnpj").eq("tenant_id", tenant_id).not("cnpj", "is", null);
  const contatoTemCnpj = new Set<string>();
  for (const c of (cts as any[]) || []) { const d = soDig(c.cnpj); if (d.length === 14) contatoTemCnpj.add(d); }

  // se o CSV traz contatos, respeita o teto do plano
  const temContatoNoCsv = col.contato >= 0 || col.email >= 0 || col.telefone >= 0;
  if (temContatoNoCsv) {
    const lim = await canCreate("contatos");
    if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };
  }

  let empresas = 0;
  let contatos = 0;
  const vistas = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(delim);
    const get = (k: number) => (k >= 0 ? (c[k] || "").trim() : "");
    const cnpj = soDig(get(col.cnpj));
    const nome = nomeProprio(get(col.fantasia) || get(col.razao)) || (cnpj ? cnpj : "");
    if (!nome) continue;
    const email = get(col.email).toLowerCase() || null;
    const telefone = get(col.telefone) || null;
    const contatoNome = nomeProprio(get(col.contato)) || null;
    const dominio = get(col.domain) || (email && email.includes("@") ? email.split("@")[1] : "") || null;

    const chave = cnpj || normNome(nome);
    if (vistas.has(chave)) continue; // linha duplicada no próprio arquivo (por empresa)
    vistas.add(chave);

    // 1) empresa (conta)
    let account_id =
      (cnpj.length === 14 ? contaPorCnpj.get(cnpj) : null) || contaPorNome.get(normNome(nome)) || null;
    if (!account_id) {
      const { data: nova, error } = await supabase
        .from("accounts")
        .insert({
          tenant_id,
          owner_id: user_id ?? null,
          name: nome,
          cnpj: cnpj.length === 14 ? cnpj : null,
          cnae: get(col.cnae) || null,
          uf: get(col.uf).toUpperCase() || null,
          municipio: nomeProprio(get(col.municipio)) || null,
          domain: dominio,
          phone: telefone,
        })
        .select("id")
        .single();
      if (error) {
        if (cnpj.length === 14) {
          const { data: ja } = await supabase.from("accounts").select("id").eq("tenant_id", tenant_id).eq("cnpj", cnpj).limit(1).maybeSingle();
          account_id = (ja as any)?.id || null;
        }
      } else {
        account_id = (nova as any).id;
        empresas++;
        if (cnpj.length === 14) contaPorCnpj.set(cnpj, account_id!);
        contaPorNome.set(normNome(nome), account_id!);
      }
    }

    // 2) contato (só se a linha tiver algo de contato e ainda não houver um com esse CNPJ)
    const criarContato = temContatoNoCsv && (contatoNome || email || telefone);
    if (criarContato && !(cnpj.length === 14 && contatoTemCnpj.has(cnpj))) {
      const { error } = await supabase.from("contacts").insert({
        tenant_id,
        assigned_to: user_id ?? null,
        name: contatoNome || nome,
        company: get(col.razao) || get(col.fantasia) || null,
        account_id,
        cnpj: cnpj.length === 14 ? cnpj : null,
        email,
        phone: telefone,
        origin: "Import CSV",
        status: "novo",
      });
      if (!error) {
        contatos++;
        if (cnpj.length === 14) contatoTemCnpj.add(cnpj);
      }
    }
  }

  revalidatePath("/dashboard/contas");
  revalidatePath("/dashboard/contatos");
  return { ok: true, empresas, contatos };
}
