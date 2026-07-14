"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id, role").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, user, tenant_id: (prof as any)?.tenant_id as string | null, role: (prof as any)?.role };
}

// Conta os usuários ATIVOS do workspace (para calcular o valor por assento).
// is_active=true: desativados não ocupam assento (senão sobrecobra e pode travar o
// plano Individual). Alinha com o RPC seat_check.
async function seatCount(supabase: any, tenant_id: string): Promise<number> {
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id)
    .eq("is_active", true);
  return Math.max(1, count ?? 1);
}

function addMonthsISO(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

export async function subscribePlan(planId: string, docNumber?: string, couponCode?: string, requestedSeats?: number) {
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

  // Assentos a cobrar: o maior entre (gente hoje), (mínimo do plano) e (o que o dono
  // escolheu comprar agora) — assim já dá pra contratar 10 assentos de uma vez e a 1ª
  // fatura sai correta. Respeita o teto do plano quando houver.
  const wanted = Math.max(0, Math.floor(Number(requestedSeats) || 0));
  let billedSeats = Math.max(seats, minSeats, wanted);
  if (maxSeats) billedSeats = Math.min(billedSeats, maxSeats);
  const full = Number((plan as any).price_monthly) * billedSeats;

  // cupom (opcional): platform_coupons é superadmin-only → tudo via admin client.
  // A6: o resgate é ATÔMICO (RPC redeem_coupon incrementa só se houver vaga). Se for o
  // MESMO cupom que o tenant já tinha (troca de plano), reaproveita o desconto SEM
  // resgatar de novo. Se a assinatura falhar depois, liberamos a reserva (release_coupon).
  let coupon: any = null;
  let couponReserved = false;
  const code = couponCode?.trim()?.toUpperCase() || "";
  if (code) {
    const { createAdminClient } = await import("@/lib/supabaseAdmin");
    const admin = createAdminClient();
    if (!admin) return { error: "Cupons indisponíveis no momento." };

    const alreadyOnTenant = String((tenant as any).coupon_code || "").toUpperCase() === code;
    if (alreadyOnTenant) {
      const { data: c } = await admin.from("platform_coupons").select("code, percent_off, duration_months").eq("code", code).maybeSingle();
      if (c) coupon = c; // reaplica sem contar nova redenção
    } else {
      const { data: red } = await admin.rpc("redeem_coupon", { p_code: code });
      const row = Array.isArray(red) ? red[0] : red;
      if (!row) return { error: "coupon_invalid" }; // inválido, expirado ou esgotado
      coupon = { code, percent_off: (row as any).percent_off, duration_months: (row as any).duration_months };
      couponReserved = true;
    }
  }

  // libera a reserva do cupom (usado nos caminhos de falha após reservar)
  async function releaseCoupon() {
    if (!couponReserved) return;
    try {
      const { createAdminClient } = await import("@/lib/supabaseAdmin");
      const admin = createAdminClient();
      if (admin) await admin.rpc("release_coupon", { p_code: code });
    } catch { /* melhor esforço */ }
  }

  const factor = coupon ? Math.max(0, 1 - Number(coupon.percent_off) / 100) : 1;
  const value = Math.round(full * factor * 100) / 100;

  const { ensureAsaasCustomer, createAsaasSubscription, updateAsaasSubscription } = await import("@/lib/asaas");

  // garante o cliente no Asaas (e atualiza o documento se o customer já existia sem ele)
  const cust = await ensureAsaasCustomer({
    name: (tenant as any).legal_name || (tenant as any).name || "Cliente Contatia",
    email: (tenant as any).contact_email,
    cpfCnpj: doc,
    existingId: (tenant as any).asaas_customer_id,
  });
  if (cust.error || !cust.id) { await releaseCoupon(); return { error: cust.error || "Falha ao registrar cliente no Asaas." }; }

  // M5: TROCA de plano REPRECIFICA a assinatura existente (updatePendingPayments) em vez
  // de cancelar+recriar — o cancelar+recriar deixava o boleto antigo pagável junto do
  // novo (duas cobranças em aberto). Assinatura nova só quando não havia nenhuma.
  const prevSub = (tenant as any).asaas_subscription_id as string | null;
  let sub: { id?: string; link?: string | null; error?: string; firstPayment?: any };
  if (prevSub) {
    const upd = await updateAsaasSubscription(prevSub, value);
    if (upd.error) { await releaseCoupon(); return { error: `Não foi possível atualizar a assinatura: ${upd.error}` }; }
    sub = { id: prevSub, link: null, firstPayment: null };
    // reprecifica a fatura pendente local (o Asaas reprecifica a dele via updatePendingPayments)
    try {
      const { createAdminClient } = await import("@/lib/supabaseAdmin");
      const admin = createAdminClient();
      if (admin) await admin.from("platform_invoices").update({ amount: value }).eq("tenant_id", tenant_id).eq("asaas_subscription_id", prevSub).eq("status", "pending");
    } catch { /* não bloqueia a troca */ }
  } else {
    sub = await createAsaasSubscription({
      customerId: cust.id,
      value,
      description: `Contatia ${(plan as any).name} — ${billedSeats} usuário(s)`,
    });
    if (sub.error) { await releaseCoupon(); return { error: sub.error }; }
  }

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

  // registra JÁ a 1ª fatura na central de cobranças (não espera o webhook do Asaas).
  // Deduplica por asaas_payment_id → quando o webhook PAYMENT_CREATED chegar, ele
  // encontra esta fatura e não cria outra.
  if ((sub as any).firstPayment?.asaasId) {
    try {
      const { createAdminClient } = await import("@/lib/supabaseAdmin");
      const admin = createAdminClient();
      if (admin) {
        const fp = (sub as any).firstPayment;
        // M3: upsert idempotente por asaas_payment_id — se o webhook PAYMENT_CREATED
        // chegar junto, um dos dois vence e não duplica (índice único 0070).
        await admin.from("platform_invoices").upsert({
          tenant_id,
          amount: fp.value ?? value,
          description: fp.description || `Contatia ${(plan as any).name} — ${billedSeats} usuário(s)`,
          due_date: fp.dueDate || null,
          payment_link: fp.invoiceUrl || sub.link || null,
          asaas_payment_id: fp.asaasId,
          asaas_subscription_id: sub.id || null,
          status: "pending",
        }, { onConflict: "asaas_payment_id", ignoreDuplicates: true });
      }
    } catch { /* a fatura também chega pelo webhook; não bloqueia a assinatura */ }
  }

  // (a redenção do cupom já foi contada atomicamente lá em cima, no redeem_coupon)

  revalidatePath("/dashboard/planos");
  return { ok: true, link: sub.link, value, full, seats, billedSeats, planName: (plan as any).name, discountPct: coupon?.percent_off || 0 };
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

  // M4: faturas pendentes desta assinatura deixam de ser cobráveis — marca canceladas
  // para não ficarem em aberto na central (e um pagamento tardio não reativa a conta,
  // graças à guarda no webhook).
  await supabase.from("platform_invoices").update({ status: "canceled" }).eq("tenant_id", tenant_id).eq("status", "pending");

  revalidatePath("/dashboard/planos");
  return { ok: true };
}
