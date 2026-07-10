"use server";

import { createClient } from "@/lib/supabase/server";

export async function acceptInvite(token: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login primeiro." };
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) return { error: error.message };
  if (data === "invalid") return { error: "Convite inválido ou expirado." };
  return { ok: true };
}
