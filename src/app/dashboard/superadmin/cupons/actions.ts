"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// B8: guarda explícita de superadmin — em vez de deixar vazar o erro cru do Postgres
// da RLS quando um não-superadmin tenta, respondemos uma mensagem clara.
async function assertSuper() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, ok: !!(data as any)?.is_superadmin };
}

// platform_coupons tem RLS superadmin-only; estas actions rodam como o superadmin logado.
export async function createCoupon(input: {
  code: string;
  percentOff: number;
  durationMonths?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}) {
  const { supabase, ok } = await assertSuper();
  if (!ok) return { error: "Apenas superadmin gerencia cupons." };
  const code = (input.code || "").trim().toUpperCase().replace(/\s/g, "");
  if (!code) return { error: "Informe o código." };
  const pct = Number(input.percentOff);
  if (!(pct > 0 && pct <= 100)) return { error: "Desconto deve ser entre 1 e 100." };

  const { error } = await supabase.from("platform_coupons").insert({
    code,
    percent_off: Math.round(pct),
    duration_months: input.durationMonths ? Number(input.durationMonths) : null,
    max_redemptions: input.maxRedemptions ? Number(input.maxRedemptions) : null,
    expires_at: input.expiresAt || null,
    is_active: true,
  });
  if (error) return { error: error.message.includes("duplicate") ? "Já existe um cupom com esse código." : error.message };
  revalidatePath("/dashboard/superadmin/cupons");
  return { ok: true };
}

export async function toggleCoupon(id: string, active: boolean) {
  const { supabase, ok } = await assertSuper();
  if (!ok) return { error: "Apenas superadmin gerencia cupons." };
  const { error } = await supabase.from("platform_coupons").update({ is_active: active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/cupons");
  return { ok: true };
}
