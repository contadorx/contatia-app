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

const DIAS_TRIGGERS = ["no_activity_days", "opportunity_lost", "opportunity_won"];

export async function createAutomation(input: {
  name: string;
  trigger_type: string;
  trigger_value?: string;
  action_type: string;
  action_seq?: string;
  action_stage?: string;
  action_tag?: string;
  product_id?: string;
  source_seq?: string;
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.name.trim()) return { error: "Dê um nome à automação." };
  if (input.action_type === "enroll" && !input.action_seq) return { error: "Escolha a cadência para inscrever." };
  if (input.action_type === "move_stage" && !input.action_stage) return { error: "Escolha o estágio de destino." };
  if (input.action_type === "add_tag" && !input.action_tag) return { error: "Escolha a tag a aplicar." };
  if (input.trigger_type === "score_gte" && !input.trigger_value) return { error: "Informe o score mínimo." };
  if (DIAS_TRIGGERS.includes(input.trigger_type) && !input.trigger_value) return { error: "Informe a quantidade de dias." };

  const { error } = await supabase.from("automations").insert({
    tenant_id,
    name: input.name.trim(),
    trigger_type: input.trigger_type,
    trigger_value: input.trigger_value || null,
    action_type: input.action_type,
    action_seq: input.action_type === "enroll" ? input.action_seq : null,
    action_stage: input.action_type === "move_stage" ? input.action_stage : null,
    action_tag: input.action_type === "add_tag" ? input.action_tag : null,
    // escopo por produto (opcional) para gatilhos que dependem de "no produto"
    product_id: input.product_id || null,
    // cadência de origem do gatilho "terminou a cadência"
    source_seq: input.trigger_type === "cadence_completed" ? input.source_seq || null : null,
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
