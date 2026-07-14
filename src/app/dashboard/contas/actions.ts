"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, cnpj, phone")
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

  const patch: Record<string, unknown> = {
    cnpj,
    cnae: d.cnae,
    porte: d.porte,
    uf: d.uf,
    municipio: d.municipio,
  };
  if (!(acc as any).phone && d.telefone) patch.phone = d.telefone;

  const { error } = await supabase.from("accounts").update(patch as any).eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${id}`);
  revalidatePath("/dashboard/contas");
  return { ok: true };
}
