import "server-only";
import { createAdminClient } from "@/lib/supabaseAdmin";

// ============================================================
// Sincroniza o VALOR da assinatura no Asaas com o nº de assentos (e o cupom
// ativo, quando houver). No modelo per-seat, adicionar/remover usuário precisa
// reajustar a cobrança — senão o valor congela no que era na contratação.
//
// Roda com SERVICE ROLE (admin) para funcionar independente de quem disparou
// (ex.: o novo membro que aceitou o convite não é dono do workspace).
// ============================================================

// desconto de cupom ativo (0..1). Tolerante à ausência das colunas de cupom.
function couponFactor(t: any): number {
  const pct = Number(t?.coupon_percent_off || 0);
  if (!pct) return 1;
  // se já passou da data de reversão, sem desconto
  const until = t?.coupon_reverts_on ? new Date(t.coupon_reverts_on) : null;
  if (until && until.getTime() < Date.now()) return 1;
  return Math.max(0, 1 - pct / 100);
}

export async function syncTenantSeats(tenantId: string): Promise<{ changed?: boolean; error?: string }> {
  const admin = createAdminClient();
  if (!admin) return { error: "sem admin" };

  const { data: t } = await admin
    .from("tenants")
    .select("id, asaas_subscription_id, subscription_status, mrr, platform_plans(price_monthly, min_seats)")
    .eq("id", tenantId)
    .maybeSingle();
  if (!t) return {};

  const subId = (t as any).asaas_subscription_id as string | null;
  const status = (t as any).subscription_status as string;
  if (!subId || !["active", "pending", "past_due"].includes(status)) return {};

  const price = Number((t as any).platform_plans?.price_monthly || 0);
  if (!price) return {};
  const minSeats = Math.max(1, Number((t as any).platform_plans?.min_seats) || 1);

  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const seats = Math.max(minSeats, count ?? 1);

  // cupom (se as colunas existirem)
  let factor = 1;
  let couponExpired = false;
  try {
    const { data: cup } = await admin.from("tenants").select("coupon_percent_off, coupon_reverts_on").eq("id", tenantId).maybeSingle();
    factor = couponFactor(cup);
    const until = (cup as any)?.coupon_reverts_on ? new Date((cup as any).coupon_reverts_on) : null;
    couponExpired = !!((cup as any)?.coupon_percent_off && until && until.getTime() < Date.now());
  } catch { /* colunas de cupom ainda não existem */ }

  const value = Math.round(price * seats * factor * 100) / 100;

  // nada mudou E o cupom não venceu → nada a fazer
  if (Number((t as any).mrr) === value && !couponExpired) return { changed: false };

  const { updateAsaasSubscription } = await import("@/lib/asaas");
  const r = await updateAsaasSubscription(subId, value);
  if (r.error) return { error: r.error };

  // ao reverter o cupom, limpa os campos para não recomputar todo dia
  const patch: Record<string, unknown> = { mrr: value };
  if (couponExpired) { patch.coupon_code = null; patch.coupon_percent_off = null; patch.coupon_reverts_on = null; }
  await admin.from("tenants").update(patch).eq("id", tenantId);
  return { changed: true };
}

// Reconciliação em lote (roda no cron diário): pega qualquer mudança de assentos
// que não passou pelo hook (remoção de membro, etc.).
export async function reconcileAllSeats(): Promise<{ synced: number }> {
  const admin = createAdminClient();
  if (!admin) return { synced: 0 };
  const { data: subs } = await admin
    .from("tenants")
    .select("id")
    .not("asaas_subscription_id", "is", null)
    .in("subscription_status", ["active", "pending", "past_due"]);
  let synced = 0;
  for (const t of ((subs as any[]) || [])) {
    const r = await syncTenantSeats((t as any).id);
    if (r.changed) synced++;
  }
  return { synced };
}
