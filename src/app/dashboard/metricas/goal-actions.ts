"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setGoal(input: { period: string; mrr_target: number; touch_target: number; target_user_id?: string }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role, team_role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const tenant_id = (profile as any)?.tenant_id as string | undefined;
  if (!tenant_id || !user) return { error: "Sem workspace." };

  const isManager = (profile as any)?.role === "owner" || ["admin", "gestor"].includes((profile as any)?.team_role);
  // gestor pode definir meta de outro; vendedor só a própria
  const targetUser = input.target_user_id && isManager ? input.target_user_id : user.id;

  const { error } = await supabase.from("goals").upsert(
    {
      tenant_id,
      user_id: targetUser,
      period: input.period,
      mrr_target: Number(input.mrr_target) || 0,
      touch_target: Number(input.touch_target) || 0,
    },
    { onConflict: "tenant_id,user_id,period" }
  );
  if (error) return { error: error.message };
  revalidatePath("/dashboard/metricas");
  return { ok: true };
}
