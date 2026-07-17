import "server-only";

// Régua de COBRANÇA PRÓ-ATIVA (substitui a régua paga do Asaas). Baseada na FATURA
// (platform_invoices), com link de pagamento, valor e vencimento nos e-mails.
// Etapas (editáveis no painel, track 'cobranca'):
//   bill_created  → ao criar a fatura ("sua fatura está disponível")
//   bill_pre3     → 3 dias ANTES de vencer (preventivo)
//   bill_pre1     → 1 dia ANTES de vencer (preventivo)
//   dun_d1/d5/d10 → 1/5/10 dias APÓS vencer (lembrete/aviso/suspensão)
// Na etapa de maior atraso (suspensão), a conta é marcada 'suspended'.
// Dedup por (invoice_id, key) em invoice_notice_sends.

import { renderTemplate, logEmail } from "@/lib/regua";

const CREATED_KEY = "bill_created";

function reached(triggerDays: number, daysFromDue: number): boolean {
  // preventivo (negativo): só ANTES de vencer e já dentro da janela
  if (triggerDays < 0) return daysFromDue >= triggerDays && daysFromDue < 0;
  // atraso (>=0): a partir do dia do atraso
  return daysFromDue >= triggerDays;
}

// Envia a etapa "fatura criada" para UMA fatura (chamado pelo webhook, na hora).
export async function sendInvoiceCreated(admin: any, invoiceId: string): Promise<void> {
  try {
    const { data: inv } = await admin
      .from("platform_invoices")
      .select("id, tenant_id, amount, due_date, payment_link, status")
      .eq("id", invoiceId)
      .maybeSingle();
    if (!inv || (inv as any).status === "paid" || (inv as any).status === "canceled") return;

    const { data: step } = await admin
      .from("business_messages")
      .select("key, enabled, subject, body")
      .eq("key", CREATED_KEY)
      .maybeSingle();
    if (!step || (step as any).enabled === false) return;

    const { data: already } = await admin
      .from("invoice_notice_sends")
      .select("key")
      .eq("invoice_id", (inv as any).id)
      .eq("key", CREATED_KEY)
      .maybeSingle();
    if (already) return;

    await deliver(admin, inv, step);
  } catch { /* nunca derruba o webhook */ }
}

async function deliver(admin: any, inv: any, step: any): Promise<boolean> {
  const { data: t } = await admin.from("tenants").select("name, contact_email").eq("id", inv.tenant_id).maybeSingle();
  let to = ((t as any)?.contact_email || "").trim();
  if (!to) {
    const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", inv.tenant_id).eq("role", "owner").limit(1).maybeSingle();
    to = (owner as any)?.email || "";
  }
  if (!to) return false;

  const ctx = { name: (t as any)?.name, link: inv.payment_link, valor: Number(inv.amount), venc: inv.due_date };
  const subject = renderTemplate(step.subject, ctx);
  const text = renderTemplate(step.body, ctx);

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const r = await sendBrevoEmail({ to, toName: (t as any)?.name || undefined, subject, text });
  if (r?.error) {
    await logEmail(admin, { tenant_id: inv.tenant_id, to, subject, kind: "cobranca", status: "error", error: r.error });
    return false;
  }
  await admin.from("invoice_notice_sends").insert({ invoice_id: inv.id, key: step.key });
  await logEmail(admin, { tenant_id: inv.tenant_id, to, subject, kind: "cobranca", status: "sent" });
  return true;
}

export async function runBilling(admin: any): Promise<{ sent: number; suspended: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  let suspended = 0;

  const { data: msgs } = await admin
    .from("business_messages")
    .select("key, enabled, trigger_days, subject, body")
    .eq("track", "cobranca")
    .order("trigger_days", { ascending: true });
  const steps = ((msgs as any[]) || []).filter((m) => m.enabled !== false);
  if (!steps.length) return { sent, suspended, errors };

  const createdStep = steps.find((s) => s.key === CREATED_KEY);
  const daySteps = steps.filter((s) => s.key !== CREATED_KEY);
  const positives = daySteps.map((s) => Number(s.trigger_days) || 0).filter((n) => n > 0);
  const maxTrigger = positives.length ? Math.max(...positives) : Infinity; // etapa de suspensão

  // faturas em aberto
  const { data: invoices } = await admin
    .from("platform_invoices")
    .select("id, tenant_id, amount, due_date, payment_link, status")
    .in("status", ["pending", "overdue"])
    .not("due_date", "is", null)
    .limit(1000);
  if (!invoices?.length) return { sent, suspended, errors };

  const now = Date.now();

  for (const inv of invoices as any[]) {
    try {
      const daysFromDue = Math.floor((now - new Date(inv.due_date).getTime()) / 86400000);

      const { data: doneRows } = await admin.from("invoice_notice_sends").select("key").eq("invoice_id", inv.id);
      const done = new Set(((doneRows as any[]) || []).map((d) => d.key));

      // 1ª ação: "fatura criada" (uma vez)
      let step: any = null;
      if (createdStep && !done.has(CREATED_KEY)) {
        step = createdStep;
      } else {
        // etapa por dia: menor trigger ainda não enviado e já "alcançado"
        const eligible = daySteps
          .filter((s) => !done.has(s.key) && reached(Number(s.trigger_days) || 0, daysFromDue))
          .sort((a, b) => (Number(a.trigger_days) || 0) - (Number(b.trigger_days) || 0));
        step = eligible[0] || null;
      }
      if (!step) continue;

      const ok = await deliver(admin, inv, step);
      if (!ok) continue;
      sent++;

      // suspensão automática na etapa de maior atraso
      if (step.key !== CREATED_KEY && (Number(step.trigger_days) || 0) >= maxTrigger) {
        const { data: tt } = await admin.from("tenants").select("subscription_status").eq("id", inv.tenant_id).maybeSingle();
        if ((tt as any)?.subscription_status !== "suspended") {
          await admin.from("tenants").update({ subscription_status: "suspended" }).eq("id", inv.tenant_id);
          suspended++;
        }
      }
    } catch (e: any) {
      errors.push(`${inv.id}: ${e?.message || "erro"}`);
    }
  }

  return { sent, suspended, errors };
}
