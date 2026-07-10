"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setGoal(input: { period: string; mrr_target: number; touch_target: number }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const tenant_id = profile?.tenant_id as string | undefined;
  if (!tenant_id || !user) return { error: "Sem workspace." };

  const { error } = await supabase.from("goals").upsert(
    {
      tenant_id,
      user_id: user.id,
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
