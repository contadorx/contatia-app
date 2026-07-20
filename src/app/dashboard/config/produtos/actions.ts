"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data as any)?.tenant_id as string | null };
}

// Reescreve o POOL de caixas do produto (rodízio). Substitui as linhas atuais.
async function setPool(supabase: any, tenant_id: string, productId: string, ids: string[]) {
  const clean = Array.from(new Set((ids || []).filter(Boolean)));
  await supabase.from("product_email_accounts").delete().eq("tenant_id", tenant_id).eq("product_id", productId);
  if (clean.length) {
    const rows = clean.map((email_account_id) => ({ tenant_id, product_id: productId, email_account_id }));
    await supabase.from("product_email_accounts").upsert(rows, { onConflict: "product_id,email_account_id", ignoreDuplicates: true });
  }
}

export async function createProduct(input: { name: string; kind: string; billing: string; price: number; email_account_ids?: string[] }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.name.trim()) return { error: "Dê um nome ao item." };
  const { data, error } = await supabase.from("products").insert({
    tenant_id,
    name: input.name.trim(),
    kind: input.kind === "produto" ? "produto" : "servico",
    billing: input.billing === "avulso" ? "avulso" : "recorrente",
    price: Number(input.price) || 0,
    // caixa única legada fica nula — o pool (abaixo) é a fonte da verdade
    email_account_id: null,
  }).select("id").single();
  if (error) return { error: error.message };
  await setPool(supabase, tenant_id, (data as any).id, input.email_account_ids || []);
  revalidatePath("/dashboard/config/produtos");
  return { ok: true };
}

export async function updateProduct(id: string, patch: { name?: string; kind?: string; billing?: string; price?: number; active?: boolean; email_account_ids?: string[] }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) { if (!patch.name.trim()) return { error: "Nome não pode ficar vazio." }; clean.name = patch.name.trim(); }
  if (patch.kind !== undefined) clean.kind = patch.kind === "produto" ? "produto" : "servico";
  if (patch.billing !== undefined) clean.billing = patch.billing === "avulso" ? "avulso" : "recorrente";
  if (patch.price !== undefined) clean.price = Number(patch.price) || 0;
  if (patch.active !== undefined) clean.active = patch.active;
  if (Object.keys(clean).length) {
    const { error } = await supabase.from("products").update(clean).eq("id", id);
    if (error) return { error: error.message };
  }
  // ao editar o pool, zera a caixa única legada (evita ambiguidade de fonte)
  if (patch.email_account_ids !== undefined) {
    await supabase.from("products").update({ email_account_id: null }).eq("id", id);
    await setPool(supabase, tenant_id, id, patch.email_account_ids);
  }
  revalidatePath("/dashboard/config/produtos");
  return { ok: true };
}

export async function deleteProduct(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config/produtos");
  return { ok: true };
}
