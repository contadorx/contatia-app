"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function guard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, ok: !!(me as any)?.is_superadmin };
}

export async function setTenantPlan(input: {
  tenant_id: string;
  plan_id?: string;
  subscription_status?: string;
  mrr?: number;
  asaas_customer_id?: string;
  asaas_subscription_id?: string;
}) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  const patch: any = {};
  if (input.plan_id !== undefined) patch.plan_id = input.plan_id || null;
  if (input.subscription_status) patch.subscription_status = input.subscription_status;
  if (input.mrr !== undefined) patch.mrr = Number(input.mrr) || 0;
  if (input.asaas_customer_id !== undefined) patch.asaas_customer_id = input.asaas_customer_id || null;
  if (input.asaas_subscription_id !== undefined) patch.asaas_subscription_id = input.asaas_subscription_id || null;
  const { error } = await supabase.from("tenants").update(patch).eq("id", input.tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/cobranca");
  return { ok: true };
}
