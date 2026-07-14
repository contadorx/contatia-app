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

  // aplica o papel escolhido no convite ao perfil recém-vinculado (AUT-03).
  try {
    const { data: inv } = await supabase
      .from("tenant_invites")
      .select("team_role")
      .eq("token", token)
      .maybeSingle();
    const papel = (inv as any)?.team_role;
    if (["admin", "gestor", "sdr", "vendedor"].includes(papel || "")) {
      await supabase.from("profiles").update({ team_role: papel }).eq("id", user.id);
    }
  } catch { /* papel pode ser ajustado depois em Equipe */ }

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
