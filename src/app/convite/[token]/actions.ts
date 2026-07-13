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

  // entrou um assento: reajusta o valor da assinatura no Asaas (per-seat)
  try {
    const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
    const tid = (prof as any)?.tenant_id;
    if (tid) {
      const { syncTenantSeats } = await import("@/lib/billing");
      await syncTenantSeats(tid);
    }
  } catch { /* não bloqueia o aceite do convite */ }

  return { ok: true };
}
