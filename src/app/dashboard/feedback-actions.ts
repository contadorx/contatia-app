"use server";

import { createClient } from "@/lib/supabase/server";

export async function submitFeedback(score: number, comment: string) {
  if (!(score >= 0 && score <= 10)) return { error: "Escolha uma nota de 0 a 10." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login." };
  const { data: me } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
  const { error } = await supabase.from("feedback").insert({
    tenant_id: (me as any)?.tenant_id ?? null,
    user_id: user.id,
    score,
    comment: (comment || "").trim().slice(0, 1000) || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
