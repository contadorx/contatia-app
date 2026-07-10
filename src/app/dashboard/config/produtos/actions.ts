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

export async function createProduct(input: { name: string; kind: string; billing: string; price: number }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.name.trim()) return { error: "Dê um nome ao item." };
  const { error } = await supabase.from("products").insert({
    tenant_id,
    name: input.name.trim(),
    kind: input.kind === "produto" ? "produto" : "servico",
    billing: input.billing === "avulso" ? "avulso" : "recorrente",
    price: Number(input.price) || 0,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config/produtos");
  return { ok: true };
}

export async function updateProduct(id: string, patch: { name?: string; kind?: string; billing?: string; price?: number; active?: boolean }) {
  const { supabase } = await ctx();
  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) { if (!patch.name.trim()) return { error: "Nome não pode ficar vazio." }; clean.name = patch.name.trim(); }
  if (patch.kind !== undefined) clean.kind = patch.kind === "produto" ? "produto" : "servico";
  if (patch.billing !== undefined) clean.billing = patch.billing === "avulso" ? "avulso" : "recorrente";
  if (patch.price !== undefined) clean.price = Number(patch.price) || 0;
  if (patch.active !== undefined) clean.active = patch.active;
  const { error } = await supabase.from("products").update(clean).eq("id", id);
  if (error) return { error: error.message };
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
