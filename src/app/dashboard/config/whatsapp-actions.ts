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
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

export async function saveWhatsApp(input: { evolution_url: string; api_key: string; instance: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.evolution_url.trim() || !input.api_key.trim() || !input.instance.trim())
    return { error: "Preencha URL, API key e instância." };
  const { error } = await supabase.from("whatsapp_accounts").insert({
    tenant_id,
    evolution_url: input.evolution_url.trim(),
    api_key: input.api_key.trim(),
    instance: input.instance.trim(),
    is_active: true,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function deleteWhatsApp(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function whatsappQR(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };
  const { getQR } = await import("@/lib/whatsapp");
  return await getQR(acc as any);
}

export async function whatsappStatus(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };
  const { getStatus } = await import("@/lib/whatsapp");
  return await getStatus(acc as any);
}
