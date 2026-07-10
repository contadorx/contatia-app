import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Asaas envia eventos de pagamento. Protegido por token (header asaas-access-token
// ou ?token=). Casa o pagamento ao tenant por asaas_subscription_id/customer_id.
export async function POST(req: Request) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "billing não configurado" }, { status: 500 });

  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  const url = new URL(req.url);
  const token = req.headers.get("asaas-access-token") || url.searchParams.get("token");
  if (expected && token !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const event = body?.event as string | undefined;
  const payment = body?.payment || {};
  const subId = payment?.subscription as string | undefined;
  const custId = payment?.customer as string | undefined;
  const payId = payment?.id as string | undefined;
  const dueDate = payment?.dueDate as string | undefined;
  const value = Number(payment?.value) || 0;

  if (!event) return NextResponse.json({ ok: true, ignored: "sem evento" });

  // 1) casa uma FATURA da central por asaas_payment_id (fluxo link de pagamento)
  if (payId) {
    const { data: inv } = await admin.from("platform_invoices").select("id, tenant_id").eq("asaas_payment_id", payId).maybeSingle();
    if (inv) {
      if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
        await admin.from("platform_invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", (inv as any).id);
        // reflete na assinatura do tenant
        const base = dueDate ? new Date(dueDate) : new Date();
        base.setMonth(base.getMonth() + 1);
        await admin.from("tenants").update({ subscription_status: "active", current_period_end: base.toISOString().slice(0, 10), ...(value ? { mrr: value } : {}) }).eq("id", (inv as any).tenant_id);
      } else if (event === "PAYMENT_OVERDUE") {
        await admin.from("platform_invoices").update({ status: "overdue" }).eq("id", (inv as any).id);
        await admin.from("tenants").update({ subscription_status: "past_due" }).eq("id", (inv as any).tenant_id);
      }
      return NextResponse.json({ ok: true, event, invoice: (inv as any).id });
    }
  }

  // localiza o tenant
  let q = admin.from("tenants").select("id");
  if (subId) q = q.eq("asaas_subscription_id", subId);
  else if (custId) q = q.eq("asaas_customer_id", custId);
  else return NextResponse.json({ ok: true, ignored: "sem assinatura/cliente" });
  const { data: tenant } = await q.maybeSingle();
  if (!tenant) return NextResponse.json({ ok: true, ignored: "tenant não encontrado" });

  const tid = (tenant as any).id;
  const patch: any = {};

  if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
    patch.subscription_status = "active";
    if (value) patch.mrr = value;
    // estende o período ~1 mês a partir do vencimento pago
    const base = dueDate ? new Date(dueDate) : new Date();
    base.setMonth(base.getMonth() + 1);
    patch.current_period_end = base.toISOString().slice(0, 10);
  } else if (event === "PAYMENT_OVERDUE") {
    patch.subscription_status = "past_due";
  } else if (event === "PAYMENT_DELETED" || event === "SUBSCRIPTION_DELETED") {
    patch.subscription_status = "canceled";
  } else {
    return NextResponse.json({ ok: true, ignored: event });
  }

  await admin.from("tenants").update(patch).eq("id", tid);
  return NextResponse.json({ ok: true, event, tenant: tid });
}
