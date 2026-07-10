"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function createAutomation(input: {
  name: string;
  trigger_type: string;
  trigger_value?: string;
  action_type: string;
  action_seq?: string;
  action_stage?: string;
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.name.trim()) return { error: "Dê um nome à automação." };
  if (input.action_type === "enroll" && !input.action_seq) return { error: "Escolha a cadência para inscrever." };
  if (input.action_type === "move_stage" && !input.action_stage) return { error: "Escolha o estágio de destino." };
  if (input.trigger_type === "score_gte" && !input.trigger_value) return { error: "Informe o score mínimo." };
  if (input.trigger_type === "no_activity_days" && !input.trigger_value) return { error: "Informe os dias de inatividade." };

  const { error } = await supabase.from("automations").insert({
    tenant_id,
    name: input.name.trim(),
    trigger_type: input.trigger_type,
    trigger_value: input.trigger_value || null,
    action_type: input.action_type,
    action_seq: input.action_type === "enroll" ? input.action_seq : null,
    action_stage: input.action_type === "move_stage" ? input.action_stage : null,
    created_by: user_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

export async function toggleAutomation(id: string, active: boolean) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("automations").update({ is_active: active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

export async function deleteAutomation(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("automations").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}
