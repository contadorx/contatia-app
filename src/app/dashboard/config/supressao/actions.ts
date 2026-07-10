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

export async function addSuppression(email: string, reason = "manual") {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const e = (email || "").toLowerCase().trim();
  if (!e || !e.includes("@")) return { error: "E-mail inválido." };
  const { error } = await supabase.from("email_suppressions").upsert(
    { tenant_id, email: e, reason },
    { onConflict: "tenant_id,email", ignoreDuplicates: true }
  );
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config/supressao");
  return { ok: true };
}

export async function removeSuppression(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("email_suppressions").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config/supressao");
  return { ok: true };
}
