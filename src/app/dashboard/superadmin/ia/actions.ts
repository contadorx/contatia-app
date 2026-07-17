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

export async function saveAssistant(
  kind: "support" | "sales",
  patch: { enabled?: boolean; greeting?: string; brain?: string; notify_email?: string | null; model?: string | null }
) {
  if (!(await guard())) return { error: "Sem permissão." };
  const admin = createAdminClient();
  if (!admin) return { error: "Indisponível." };
  const upd: any = { updated_at: new Date().toISOString() };
  (["enabled", "greeting", "brain", "model", "notify_email"] as const).forEach((k) => {
    if (k in patch) upd[k] = (patch as any)[k];
  });
  const { error } = await admin.from("ai_assistants").update(upd).eq("kind", kind);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/ia");
  return { ok: true };
}

export async function loadConversation(id: string) {
  if (!(await guard())) return { error: "Sem permissão." };
  const admin = createAdminClient();
  if (!admin) return { error: "Indisponível." };
  const { data } = await admin
    .from("ai_messages")
    .select("role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  return { ok: true, messages: (data as any[]) || [] };
}

export async function setConversation(id: string, patch: { handled?: boolean; status?: string }) {
  if (!(await guard())) return { error: "Sem permissão." };
  const admin = createAdminClient();
  if (!admin) return { error: "Indisponível." };
  const { error } = await admin.from("ai_conversations").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/ia");
  return { ok: true };
}
