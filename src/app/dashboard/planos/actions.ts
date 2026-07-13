"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id, role").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, user, tenant_id: (prof as any)?.tenant_id as string | null, role: (prof as any)?.role };
}

// Conta os usuários ativos do workspace (para calcular o valor por assento).
async function seatCount(supabase: any, tenant_id: string): Promise<number> {
  const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id);
  return Math.max(1, count ?? 1);
}

function addMonthsISO(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

export async function subscribePlan(planId: string, docNumber?: string, couponCode?: string) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode assinar." };

  const { data: plan } = await supabase
    .from("platform_plans")
    .select("id, name, price_monthly, max_seats, min_seats, segment")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { error: "Plano não encontrado." };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, legal_name, cnpj, contact_email, asaas_customer_id, asaas_subscription_id")
    .eq("id", tenant_id)
    .maybeSingle();
  if (!tenant) return { error: "Workspace não encontrado." };

  // O Asaas exige CPF/CNPJ para cobrar: usa o do cadastro ou o informado agora.
  const doc = String(docNumber || (tenant as any).cnpj || "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    return { error: "need_doc" }; // a tela pede o CPF/CNPJ
  }
  // salva no cadastro para as próximas cobranças (e NF)
  if (doc !== String((tenant as any).cnpj || "").replace(/\D/g, "")) {
    await supabase.from("tenants").update({ cnpj: doc }).eq("id", tenant_id);
  }

  const seats = await seatCount(supabase, tenant_id);
  const minSeats = Math.max(1, Number((plan as any).min_seats) || 1);
  const maxSeats = (plan as any).max_seats as number | null;

  // plano Individual não comporta time
  if (maxSeats && seats > maxSeats) {
    return { error: `Este plano é para até ${maxSeats} usuário(s), mas seu workspace tem ${seats}. Escolha um plano de Equipes.` };
  }

  // Equipes cobra por um mínimo de assentos (mesmo com menos gente hoje)
  const billedSeats = Math.max(seats, minSeats);
  const full = Number((plan as any).price_monthly) * billedSeats;

  // cupom (opcional): validado com o admin client, pois platform_coupons é superadmin-only
  let coupon: any = null;
  if (couponCode && couponCode.trim()) {
    const { createAdminClient } = await import("@/lib/supabaseAdmin");
    const admin = createAdminClient();
    if (!admin) return { error: "Cupons indisponíveis no momento." };
    const code = couponCode.trim().toUpperCase();
    const { data: c } = await admin.from("platform_coupons").select("*").eq("code", code).maybeSingle();
    if (!c) return { error: "coupon_invalid" };
    const expired = (c as any).expires_at && new Date((c as any).expires_at) < new Date();
    const esgotado = (c as any).max_redemptions != null && (c as any).redeemed_count >= (c as any).max_redemptions;
    if (!(c as any).is_active || expired || esgotado) return { error: "coupon_invalid" };
    coupon = c;
  }

  const factor = coupon ? Math.max(0, 1 - Number(coupon.percent_off) / 100) : 1;
  const value = Math.round(full * factor * 100) / 100;

  const { ensureAsaasCustomer, createAsaasSubscription, cancelAsaasSubscription } = await import("@/lib/asaas");

  // garante o cliente no Asaas (e atualiza o documento se o customer já existia sem ele)
  const cust = await ensureAsaasCustomer({
    name: (tenant as any).legal_name || (tenant as any).name || "Cliente Contatia",
    email: (tenant as any).contact_email,
    cpfCnpj: doc,
    existingId: (tenant as any).asaas_customer_id,
  });
  if (cust.error || !cust.id) return { error: cust.error || "Falha ao registrar cliente no Asaas." };

  // troca de plano: cancela a assinatura anterior ANTES de criar a nova (evita cobrança dupla)
  const prevSub = (tenant as any).asaas_subscription_id as string | null;
  if (prevSub) {
    const cancel = await cancelAsaasSubscription(prevSub);
    if (cancel.error) return { error: `Não foi possível cancelar a assinatura anterior: ${cancel.error}` };
  }

  // cria a assinatura recorrente
  const sub = await createAsaasSubscription({
    customerId: cust.id,
    value,
    description: `Contatia ${(plan as any).name} — ${billedSeats} usuário(s)`,
  });
  if (sub.error) return { error: sub.error };

  // vincula o plano ao tenant (status aguardando 1º pagamento; o webhook confirma)
  const revertsOn = coupon && Number(coupon.duration_months) > 0 ? addMonthsISO(Number(coupon.duration_months)) : null;
  await supabase.from("tenants").update({
    plan_id: (plan as any).id,
    asaas_customer_id: cust.id,
    asaas_subscription_id: sub.id || null,
    subscription_status: "pending",
    mrr: value,
    coupon_code: coupon?.code || null,
    coupon_percent_off: coupon?.percent_off || null,
    coupon_reverts_on: revertsOn,
  }).eq("id", tenant_id);

  // resgata o cupom (conta a redenção)
  if (coupon) {
    try {
      const { createAdminClient } = await import("@/lib/supabaseAdmin");
      const admin = createAdminClient();
      if (admin) await admin.from("platform_coupons").update({ redeemed_count: Number(coupon.redeemed_count) + 1 }).eq("id", coupon.id);
    } catch { /* não bloqueia a assinatura */ }
  }

  revalidatePath("/dashboard/planos");
  return { ok: true, link: sub.link, value, full, seats, planName: (plan as any).name, discountPct: coupon?.percent_off || 0 };
}

// Valida um cupom sem assinar (para a tela mostrar o desconto antes de confirmar).
export async function validateCoupon(code: string) {
  if (!code || !code.trim()) return { error: "Informe o código." };
  const { createAdminClient } = await import("@/lib/supabaseAdmin");
  const admin = createAdminClient();
  if (!admin) return { error: "Cupons indisponíveis." };
  const { data: c } = await admin.from("platform_coupons").select("code, percent_off, duration_months, is_active, expires_at, max_redemptions, redeemed_count").eq("code", code.trim().toUpperCase()).maybeSingle();
  if (!c) return { error: "Cupom não encontrado." };
  const expired = (c as any).expires_at && new Date((c as any).expires_at) < new Date();
  const esgotado = (c as any).max_redemptions != null && (c as any).redeemed_count >= (c as any).max_redemptions;
  if (!(c as any).is_active || expired || esgotado) return { error: "Cupom inválido ou esgotado." };
  return { ok: true, percentOff: (c as any).percent_off, durationMonths: (c as any).duration_months || 0 };
}

// Cancela a assinatura do próprio cliente (self-service, owner).
export async function cancelSubscription() {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode cancelar." };

  const { data: t } = await supabase.from("tenants").select("asaas_subscription_id").eq("id", tenant_id).maybeSingle();
  const subId = (t as any)?.asaas_subscription_id as string | null;
  if (subId) {
    const { cancelAsaasSubscription } = await import("@/lib/asaas");
    const r = await cancelAsaasSubscription(subId);
    if (r.error) return { error: r.error };
  }

  await supabase.from("tenants").update({
    subscription_status: "canceled",
    asaas_subscription_id: null,
    mrr: 0,
  }).eq("id", tenant_id);

  revalidatePath("/dashboard/planos");
  return { ok: true };
}
