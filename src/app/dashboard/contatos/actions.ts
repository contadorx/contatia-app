"use server";

import { canCreate, mensagemLimite } from "@/lib/plan";
import { dominioDe } from "@/lib/emailFinder";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function tenantId() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: data?.tenant_id as string | null, user_id: user?.id };
}

// Encontra (por nome, case-insensitive) ou cria a empresa em accounts e devolve o id.
async function ensureAccount(supabase: any, tenant_id: string, user_id: string | undefined, companyName: string | null | undefined, cnpj?: string | null) {
  const name = (companyName || "").trim();
  if (!name) return null;
  const { data: found } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenant_id)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (found) return (found as any).id as string;
  const { data: created, error } = await supabase
    .from("accounts")
    .insert({ tenant_id, owner_id: user_id ?? null, name, cnpj: cnpj?.trim() || null })
    .select("id")
    .single();
  if (error) return null;
  return (created as any).id as string;
}

export async function addContact(formData: FormData) {
  // limite de contatos do plano
  const lim = await canCreate("contatos");
  if (!lim.permitido) {
    return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };
  }

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const payload = {
    tenant_id,
    assigned_to: user_id,
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    company: String(formData.get("company") || "").trim() || null,
    origin: String(formData.get("origin") || "").trim() || null,
  };
  if (!payload.name) return { error: "Nome é obrigatório." };

  // se veio empresa, encontra/cria em Empresas e vincula
  const account_id = await ensureAccount(supabase, tenant_id, user_id, payload.company);

  const { error } = await supabase.from("contacts").insert({ ...payload, account_id });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

type Row = { name: string; email?: string; phone?: string; company?: string; origin?: string };

export async function importContacts(rows: Row[]) {
  // limite de contatos do plano (a importação não pode furar o teto)
  const limImp = await canCreate("contatos");
  if (!limImp.permitido) {
    return { error: mensagemLimite("contatos", limImp.usado, limImp.limite, limImp.sugerido) };
  }

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const clean = rows
    .filter((r) => r.name && r.name.trim())
    .map((r) => ({
      tenant_id,
      assigned_to: user_id,
      name: r.name.trim(),
      email: r.email?.trim().toLowerCase() || null,
      phone: r.phone?.trim() || null,
      company: r.company?.trim() || null,
      origin: r.origin?.trim() || "Import CSV",
    }));

  if (!clean.length) return { error: "Nenhuma linha válida (coluna 'name' é obrigatória)." };

  // resolve empresas únicas uma vez (encontra/cria) e mapeia nome→account_id
  const companyNames = Array.from(new Set(clean.map((c) => (c.company || "").trim().toLowerCase()).filter(Boolean)));
  const nameToId: Record<string, string> = {};
  for (const c of clean) {
    const key = (c.company || "").trim().toLowerCase();
    if (!key || nameToId[key]) continue;
    const id = await ensureAccount(supabase, tenant_id, user_id, c.company);
    if (id) nameToId[key] = id;
  }
  const withAccounts = clean.map((c) => ({ ...c, account_id: nameToId[(c.company || "").trim().toLowerCase()] || null }));

  // verifica e-mails por DOMÍNIO único (uma checagem de MX por domínio, não por linha)
  const { verifyEmail } = await import("@/lib/emailverify");
  const domainStatus: Record<string, boolean> = {}; // domínio → recebe e-mail (MX)
  const emailRe = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;
  for (const c of withAccounts) {
    const m = (c.email || "").toLowerCase().match(emailRe);
    if (!m) continue;
    const dom = m[1];
    if (dom in domainStatus) continue;
    const check = await verifyEmail(`x@${dom}`);
    domainStatus[dom] = check.hasMx && !check.disposable;
  }
  const withStatus = withAccounts.map((c) => {
    const m = (c.email || "").toLowerCase().match(emailRe);
    let email_status = "ok";
    if (c.email) {
      if (!m) email_status = "invalid";
      else email_status = domainStatus[m[1]] ? "ok" : "invalid";
    }
    return { ...c, email_status };
  });
  const invalidCount = withStatus.filter((c) => c.email && c.email_status === "invalid").length;

  // insere em lotes de 500
  for (let i = 0; i < withStatus.length; i += 500) {
    const { error } = await supabase.from("contacts").insert(withStatus.slice(i, i + 500));
    if (error) return { error: error.message };
  }
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true, count: withStatus.length, companies: companyNames.length, invalid: invalidCount };
}

// Edita os dados de um contato (corrigir/completar informações).
export async function updateContact(id: string, patch: {
  name?: string; email?: string; phone?: string; company?: string; company_domain?: string;
  role_title?: string; cnpj?: string; status?: string;
}) {
  const { supabase, tenant_id, user_id } = await tenantId();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = (typeof v === "string" ? v.trim() : v) || null;
  }
  // normaliza o domínio com a função única (trata https://, www., caminho, e-mail)
  if (typeof clean.company_domain === "string") {
    clean.company_domain = dominioDe(clean.company_domain as string);
  }
  if (typeof clean.email === "string") clean.email = (clean.email as string).toLowerCase();
  if (clean.name === null) return { error: "O nome não pode ficar vazio." };

  // empresa alterada → encontra/cria em Empresas e revincula
  if (patch.company !== undefined && tenant_id) {
    clean.account_id = await ensureAccount(supabase, tenant_id, user_id, patch.company, patch.cnpj);
  }

  // O domínio pertence à EMPRESA, não só ao contato: propaga para Empresas,
  // para que os outros contatos da mesma empresa também o tenham.
  if (clean.company_domain && tenant_id) {
    const accId = (clean.account_id as string) || (await supabase
      .from("contacts").select("account_id").eq("id", id).maybeSingle()
      .then((r: any) => r.data?.account_id));

    if (accId) {
      await supabase
        .from("accounts")
        .update({ domain: clean.company_domain, website: `https://${clean.company_domain}` } as any)
        .eq("id", accId)
        .eq("tenant_id", tenant_id);
    }
  }

  const { error } = await supabase.from("contacts").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${id}`);
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

// Salva os dados de RAPPORT e o LinkedIn no jsonb `custom`, SEM apagar o que o
// Radar já gravou lá (cnae, sócios, etc.) — faz merge, não overwrite.
export async function saveContactExtra(id: string, input: { linkedin?: string; rapport?: Record<string, string> }) {
  const { supabase } = await tenantId();
  const { data: cur } = await supabase.from("contacts").select("custom").eq("id", id).maybeSingle();
  const custom = { ...(((cur as any)?.custom as Record<string, unknown>) || {}) };
  if (input.linkedin !== undefined) {
    const lk = (input.linkedin || "").trim();
    if (lk) custom.linkedin = lk;
    else delete custom.linkedin;
  }
  if (input.rapport !== undefined) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.rapport)) {
      const val = (v || "").trim();
      if (val) clean[k] = val;
    }
    if (Object.keys(clean).length) custom.rapport = clean;
    else delete custom.rapport;
  }
  const { error } = await supabase.from("contacts").update({ custom } as any).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${id}`);
  return { ok: true };
}

// Enriquece o contato pelo CNPJ (dele ou da empresa) via BrasilAPI — traz CNAE,
// porte, situação, município e sócios, e completa telefone/e-mail se faltarem.
export async function enrichContact(id: string) {
  const { supabase, tenant_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: c } = await supabase
    .from("contacts")
    .select("id, cnpj, email, phone, account_id, custom, accounts(cnpj)")
    .eq("id", id)
    .maybeSingle();
  if (!c) return { error: "Contato não encontrado." };

  const cnpj = ((c as any).cnpj || (c as any).accounts?.cnpj || "").toString();
  if (!cnpj) return { error: "Este contato não tem CNPJ (nem a empresa). Preencha o CNPJ em Editar dados." };

  const { enrichCnpj } = await import("@/lib/cnpj");
  const r = await enrichCnpj(cnpj);
  if (r.error || !r.data) return { error: r.error || "Não foi possível enriquecer." };
  const d = r.data;

  const custom = { ...(((c as any).custom as Record<string, unknown>) || {}) };
  custom.cnae = d.cnae;
  custom.cnae_descricao = d.cnae_descricao;
  custom.situacao = d.situacao;
  custom.porte = d.porte;
  custom.uf = d.uf;
  custom.municipio = d.municipio;
  if (Array.isArray(d.socios) && d.socios.length) custom.socios = d.socios;
  custom.enriched_at = new Date().toISOString();

  const patch: Record<string, unknown> = { custom };
  if (!(c as any).email && d.email) patch.email = d.email;
  if (!(c as any).phone && d.telefone) patch.phone = d.telefone;
  if (!(c as any).cnpj) patch.cnpj = cnpj;

  const { error } = await supabase.from("contacts").update(patch as any).eq("id", id);
  if (error) return { error: error.message };

  // propaga para a empresa também
  const accId = (c as any).account_id;
  if (accId) {
    await supabase
      .from("accounts")
      .update({ cnpj, cnae: d.cnae, uf: d.uf, municipio: d.municipio, porte: d.porte } as any)
      .eq("id", accId)
      .eq("tenant_id", tenant_id);
  }

  revalidatePath(`/dashboard/contatos/${id}`);
  return { ok: true };
}

// Cria um novo contato a partir do nome de um SÓCIO (da Receita), vinculado à
// mesma empresa — multiplica os decisores por conta.
export async function addSocioContact(sourceContactId: string, socioName: string) {
  const lim = await canCreate("contatos");
  if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };
  const name = (socioName || "").trim();
  if (!name) return { error: "Nome do sócio vazio." };

  const { data: src } = await supabase
    .from("contacts")
    .select("account_id, company, cnpj")
    .eq("id", sourceContactId)
    .maybeSingle();

  // evita duplicar: já existe um contato com esse nome na mesma empresa?
  if ((src as any)?.account_id) {
    const { data: dup } = await supabase
      .from("contacts")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("account_id", (src as any).account_id)
      .ilike("name", name)
      .maybeSingle();
    if (dup) return { error: "Já existe um contato com esse nome nesta empresa." };
  }

  const { error } = await supabase.from("contacts").insert({
    tenant_id,
    assigned_to: user_id,
    name,
    company: (src as any)?.company || null,
    account_id: (src as any)?.account_id || null,
    cnpj: (src as any)?.cnpj || null,
    origin: "Sócio (Receita)",
    status: "novo",
  });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${sourceContactId}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}
