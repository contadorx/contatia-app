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
  name?: string; cnpj?: string; uf?: string; domain?: string; phone?: string; website?: string;
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
