"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

async function guard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return !!(me as any)?.is_superadmin;
}

export async function saveBusinessMessage(
  key: string,
  patch: { enabled?: boolean; subject?: string; body?: string; trigger_days?: number }
) {
  if (!(await guard())) return { error: "Sem permissão." };
  const admin = createAdminClient();
  if (!admin) return { error: "Indisponível." };
  const upd: any = { updated_at: new Date().toISOString() };
  if ("enabled" in patch) upd.enabled = patch.enabled;
  if ("subject" in patch) upd.subject = patch.subject;
  if ("body" in patch) upd.body = patch.body;
  if ("trigger_days" in patch) upd.trigger_days = Math.trunc(Number(patch.trigger_days) || 0); // negativo = antes de vencer
  const { error } = await admin.from("business_messages").update(upd).eq("key", key);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/comunicacao");
  return { ok: true };
}
