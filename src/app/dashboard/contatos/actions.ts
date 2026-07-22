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

// Normaliza o nome de uma empresa para comparação: minúsculo, sem acento, sem
// pontuação, sem sufixos societários (ME, MEI, LTDA, EPP, EIRELI, S/A...), espaços
// colapsados. Assim "Padaria do Bairro ME" e "Padaria do Bairro" batem como a MESMA.
function normalizeCompany(raw: string): string {
  const s = (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acentos
    .replace(/[.,/\\\-&]/g, " ")      // pontuação vira espaço
    .replace(/\s+/g, " ")
    .trim();

  // Sufixos societários. Separamos em dois grupos por AMBIGUIDADE:
  //  - UNAMBÍGUOS: nunca são palavra real de nome (LTDA, EIRELI, EPP, MEI, ME) →
  //    podem ser removidos mesmo que sobre uma única palavra ("TechLógica EIRELI" == "TechLógica").
  //  - AMBÍGUOS: podem ser sobrenome/iniciais (SA→"Sá", SS, EI) → só removemos quando
  //    ainda sobram ≥2 palavras, pra NÃO fundir "Consultoria Sá" com "Consultoria".
  const UNAMBIG = new Set(["ltda", "eireli", "epp", "mei", "me"]);
  const AMBIG = new Set(["sa", "ss", "ei"]);
  const toks = s.split(" ").filter(Boolean);
  let changed = true;
  while (changed && toks.length > 0) {
    changed = false;
    const last = toks[toks.length - 1];
    if (UNAMBIG.has(last) && toks.length >= 2) {
      toks.pop();
      changed = true;
    } else if (AMBIG.has(last) && toks.length >= 3) {
      toks.pop();
      changed = true;
    }
  }
  return toks.join(" ");
}

function onlyDigits(v: string | null | undefined): string {
  return (v || "").replace(/\D/g, "");
}

// Encontra (por CNPJ, ou por nome normalizado) ou cria a empresa em accounts e
// devolve o id. Dedup robusto: casa mesmo com sufixo societário diferente e
// prioriza o CNPJ quando houver.
async function ensureAccount(supabase: any, tenant_id: string, user_id: string | undefined, companyName: string | null | undefined, cnpj?: string | null) {
  const name = (companyName || "").trim();
  // B4: só trata como CNPJ (chave de dedup) quando tem os 14 dígitos completos —
  // "00.000" não pode fundir empresas nem virar chave.
  const cnpjDigits = onlyDigits(cnpj).length === 14 ? onlyDigits(cnpj) : "";
  if (!name && !cnpjDigits) return null;

  // busca todas as empresas do tenant (poucas por conta; dedup em JS é seguro)
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, cnpj")
    .eq("tenant_id", tenant_id);
  const list = (accounts as any[]) || [];

  // 1) match por CNPJ (mais forte)
  if (cnpjDigits) {
    const byCnpj = list.find((a) => onlyDigits(a.cnpj) && onlyDigits(a.cnpj) === cnpjDigits);
    if (byCnpj) return byCnpj.id as string;
  }

  // 2) match por nome normalizado
  if (name) {
    const target = normalizeCompany(name);
    if (target) {
      const byName = list.find((a) => normalizeCompany(a.name || "") === target);
      if (byName) {
        // se a empresa achada não tem CNPJ e agora temos um, completa
        if (cnpjDigits && !onlyDigits(byName.cnpj)) {
          await supabase.from("accounts").update({ cnpj: cnpj?.trim() || null }).eq("id", byName.id).eq("tenant_id", tenant_id);
        }
        return byName.id as string;
      }
    }
  }

  const { data: created, error } = await supabase
    .from("accounts")
    .insert({ tenant_id, owner_id: user_id ?? null, name: name || cnpjDigits, cnpj: cnpj?.trim() || null })
    .select("id")
    .single();
  if (!error) return (created as any).id as string;

  // M11: corrida — outra requisição criou a mesma empresa (índice único de CNPJ 0070).
  // Em vez de devolver null (contato ficaria sem empresa), busca a existente.
  if (cnpjDigits) {
    const { data: again } = await supabase
      .from("accounts")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("cnpj", cnpj?.trim() || "")
      .limit(1)
      .maybeSingle();
    if (again) return (again as any).id as string;
  }
  return null;
}

export async function addContact(formData: FormData) {
  // limite de contatos do plano
  const lim = await canCreate("contatos");
  if (!lim.permitido) {
    return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };
  }

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const cnpj = String(formData.get("cnpj") || "").trim() || null;
  const payload = {
    tenant_id,
    assigned_to: user_id,
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    company: String(formData.get("company") || "").trim() || null,
    role_title: String(formData.get("role_title") || "").trim() || null,
    cnpj,
    origin: String(formData.get("origin") || "").trim() || null,
  };
  if (!payload.name) return { error: "Nome é obrigatório." };

  // se veio empresa (ou CNPJ), encontra/cria em Empresas e vincula
  const account_id = await ensureAccount(supabase, tenant_id, user_id, payload.company, cnpj);

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert({ ...payload, account_id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true, id: (inserted as any)?.id as string | undefined };
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
  const domainUnknown: Record<string, boolean> = {}; // domínio → checagem indeterminada
  const emailRe = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;
  for (const c of withAccounts) {
    const m = (c.email || "").toLowerCase().match(emailRe);
    if (!m) continue;
    const dom = m[1];
    if (dom in domainStatus) continue;
    const check = await verifyEmail(`x@${dom}`);
    domainStatus[dom] = check.hasMx && !check.disposable;
    domainUnknown[dom] = !!check.unknown; // M6: DNS falhou → não marcar inválido
  }
  const withStatus = withAccounts.map((c) => {
    const m = (c.email || "").toLowerCase().match(emailRe);
    let email_status = "ok";
    if (c.email) {
      if (!m) email_status = "invalid";
      // M6: domínio indeterminado (soluço de DNS) → dá o benefício da dúvida ("ok"),
      // não grava "invalid" e não tira o contato da cadência de e-mail.
      else if (domainUnknown[m[1]]) email_status = "ok";
      else email_status = domainStatus[m[1]] ? "ok" : "invalid";
    }
    return { ...c, email_status };
  });
  const invalidCount = withStatus.filter((c) => c.email && c.email_status === "invalid").length;

  // insere em lotes de 500. B7: se um lote falhar no meio, reporta quantos JÁ entraram
  // (em vez de sumir com o número) — o usuário sabe de onde continuar.
  let inserted = 0;
  for (let i = 0; i < withStatus.length; i += 500) {
    const chunk = withStatus.slice(i, i + 500);
    const { error } = await supabase.from("contacts").insert(chunk);
    if (error) {
      revalidatePath("/dashboard/contatos");
      revalidatePath("/dashboard/contas");
      return { error: `${error.message} (importados ${inserted} de ${withStatus.length} antes da falha).`, partial: inserted };
    }
    inserted += chunk.length;
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

  // e-mail alterado → re-verifica automaticamente (MX/descartável) e grava o status,
  // igual à importação. Assim a ficha reflete "válido/ inválido" sem passo manual.
  if (patch.email !== undefined) {
    const em = (clean.email as string | null) || null;
    if (!em) {
      clean.email_status = null;
    } else {
      const emailRe = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;
      const m = em.match(emailRe);
      if (!m) {
        clean.email_status = "invalid";
      } else {
        const { verifyEmail } = await import("@/lib/emailverify");
        const check = await verifyEmail(em);
        // M6: se a checagem ficou indeterminada (DNS falhou), não marca inválido.
        clean.email_status = check.unknown ? "ok" : check.hasMx && !check.disposable ? "ok" : "invalid";
      }
    }
  }

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

  // B3: só sobrescreve quando o provedor trouxe valor (fallback ReceitaWS é mais enxuto
  // que a BrasilAPI — não apaga o que já estava bom no custom).
  const custom = { ...(((c as any).custom as Record<string, unknown>) || {}) };
  if (d.cnae) custom.cnae = d.cnae;
  if (d.cnae_descricao) custom.cnae_descricao = d.cnae_descricao;
  if (d.situacao) custom.situacao = d.situacao;
  if (d.porte) custom.porte = d.porte;
  if (d.uf) custom.uf = d.uf;
  if (d.municipio) custom.municipio = d.municipio;
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
    .select("account_id, company, cnpj, company_domain, accounts(domain)")
    .eq("id", sourceContactId)
    .maybeSingle();
  // o sócio herda o domínio da empresa → já entra na esteira de captura no site
  const dominioSocio = dominioDe((src as any)?.company_domain || (src as any)?.accounts?.domain || null);

  // M10: evita duplicar. Com empresa, checa dentro da empresa; SEM empresa (o guard
  // antigo só rodava com account_id), checa por nome + empresa/CNPJ no tenant.
  let dupQuery = supabase
    .from("contacts")
    .select("id")
    .eq("tenant_id", tenant_id)
    .ilike("name", name)
    .limit(1);
  if ((src as any)?.account_id) {
    dupQuery = dupQuery.eq("account_id", (src as any).account_id);
  } else if ((src as any)?.cnpj) {
    dupQuery = dupQuery.eq("cnpj", (src as any).cnpj);
  } else if ((src as any)?.company) {
    dupQuery = dupQuery.ilike("company", (src as any).company);
  }
  const { data: dup } = await dupQuery.maybeSingle();
  if (dup) return { error: "Já existe um contato com esse nome para esta empresa." };

  const { error } = await supabase.from("contacts").insert({
    tenant_id,
    assigned_to: user_id,
    name,
    company: (src as any)?.company || null,
    account_id: (src as any)?.account_id || null,
    cnpj: (src as any)?.cnpj || null,
    company_domain: dominioSocio,
    origin: "Sócio (Receita)",
    status: "novo",
    // com domínio da empresa, o sócio já entra na fila de captura (busca o WhatsApp
    // no site) — e o que for achado cai sozinho na fila de verificação.
    web_capture: dominioSocio ? "queued" : null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${sourceContactId}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

// Exclui um contato (FKs são cascade/set null — não deixa órfãos).
export async function deleteContact(id: string) {
  const { supabase, tenant_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("contacts").delete().eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

// Exclui vários contatos de uma vez (barra de lote).
export async function bulkDeleteContacts(ids: string[]) {
  const { supabase, tenant_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };
  const clean = (ids || []).filter(Boolean);
  if (!clean.length) return { error: "Nenhum contato selecionado." };
  const { error } = await supabase.from("contacts").delete().eq("tenant_id", tenant_id).in("id", clean);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: clean.length };
}
