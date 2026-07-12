"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// Gestão de assinatura pelo superadmin (as RPCs checam is_superadmin no banco).
// ============================================================

export async function getSubscription(tenantId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("superadmin_get_subscription", { p_tenant: tenantId });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row };
}

export async function saveSubscription(tenantId: string, fd: FormData) {
  const supabase = createClient();

  const txt = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v || null;
  };
  const data = (k: string) => {
    const v = txt(k);
    return v ? new Date(v + "T12:00:00").toISOString() : null;
  };

  const { error } = await supabase.rpc("superadmin_update_subscription", {
    p_tenant: tenantId,
    p_status: txt("status") || "",
    p_plan_id: txt("plan_id"),
    p_mrr: txt("mrr") ? Number(txt("mrr")) : null,
    p_cycle: txt("cycle") || "",
    p_trial_ends_at: data("trial_ends_at"),
    p_bonus_until: data("bonus_until"),
    p_next_due_date: txt("next_due_date"),
    p_partner_ref: txt("partner_ref"),
    p_internal_notes: txt("internal_notes"),
    p_is_test: fd.get("is_test") === "on",
    p_asaas_customer: txt("asaas_customer"),
    p_asaas_subscription: txt("asaas_subscription"),
  });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin");
  return { ok: true };
}
