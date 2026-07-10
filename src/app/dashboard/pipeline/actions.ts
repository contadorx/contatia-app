"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function createOpportunity(input: {
  title: string;
  value_mrr: number;
  stage_id: string | null;
  primary_contact_id: string | null;
  account_id?: string | null;
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!input.title.trim()) return { error: "Dê um título à oportunidade." };

  const { error } = await supabase.from("opportunities").insert({
    tenant_id,
    owner_id: user_id,
    title: input.title.trim(),
    value_mrr: Number(input.value_mrr) || 0,
    stage_id: input.stage_id,
    primary_contact_id: input.primary_contact_id,
    account_id: input.account_id || null,
    status: "open",
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

export async function moveOpportunity(id: string, stageId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // status acompanha o estágio (won/lost/open)
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("is_won, is_lost")
    .eq("id", stageId)
    .single();
  const status = stage?.is_won ? "won" : stage?.is_lost ? "lost" : "open";

  const { error } = await supabase
    .from("opportunities")
    .update({ stage_id: stageId, status })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
