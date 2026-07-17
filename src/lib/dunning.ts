import "server-only";

// Régua de COBRANÇA (dunning). Roda no cron diário. Para cada assinante em atraso,
// envia — em ordem, um por dia — o lembrete (D+1), o aviso (D+5) e a suspensão (D+10).
// No estágio de MAIOR trigger_days (a suspensão), marca a conta como 'suspended'.
// Os textos vêm de business_messages (track 'cobranca'), editáveis no painel.
// O reset (quando o cliente paga) é feito no webhook do Asaas.

import { renderTemplate, logEmail } from "@/lib/regua";

export async function runDunning(admin: any): Promise<{ sent: number; suspended: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  let suspended = 0;

  // régua editável (só as etapas ligadas), em ordem crescente de atraso
  const { data: msgs } = await admin
    .from("business_messages")
    .select("key, enabled, trigger_days, subject, body")
    .eq("track", "cobranca")
    .order("trigger_days", { ascending: true });
  const steps = ((msgs as any[]) || []).filter((m) => m.enabled !== false);
  if (!steps.length) return { sent, suspended, errors };
  const maxTrigger = Math.max(...steps.map((s) => Number(s.trigger_days) || 0)); // etapa de suspensão

  const today = new Date().toISOString().slice(0, 10);
  // em atraso = past_due, OU active com período vencido
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, contact_email, subscription_status, current_period_end")
    .or(`subscription_status.eq.past_due,and(subscription_status.eq.active,current_period_end.lt.${today})`);
  if (!tenants?.length) return { sent, suspended, errors };

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const now = Date.now();

  for (const t of tenants as any[]) {
    try {
      const end = t.current_period_end ? new Date(t.current_period_end).getTime() : null;
      const daysOverdue = end ? Math.floor((now - end) / 86400000) : 0;
      if (daysOverdue < (Number(steps[0].trigger_days) || 1)) continue;

      let to = (t.contact_email || "").trim();
      if (!to) {
        const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", t.id).eq("role", "owner").limit(1).maybeSingle();
        to = (owner as any)?.email || "";
      }
      if (!to) continue;

      // etapas já enviadas nesta rodada de atraso
      const { data: done } = await admin.from("business_message_sends").select("key").eq("tenant_id", t.id);
      const doneKeys = new Set(((done as any[]) || []).map((d) => d.key));

      // manda UMA etapa por execução: a de menor atraso ainda não enviada e já vencida
      const next = steps.find((s) => !doneKeys.has(s.key) && daysOverdue >= (Number(s.trigger_days) || 0));
      if (!next) continue;

      const subject = renderTemplate(next.subject, { name: t.name });
      const text = renderTemplate(next.body, { name: t.name });
      const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject, text });
      if (r?.error) {
        errors.push(`${t.id}/${next.key}: ${r.error}`);
        await logEmail(admin, { tenant_id: t.id, to, subject, kind: "cobranca", status: "error", error: r.error });
        continue;
      }
      await admin.from("business_message_sends").insert({ tenant_id: t.id, key: next.key });
      await logEmail(admin, { tenant_id: t.id, to, subject, kind: "cobranca", status: "sent" });
      sent++;

      // suspensão automática no estágio de maior atraso
      if ((Number(next.trigger_days) || 0) >= maxTrigger && t.subscription_status !== "suspended") {
        await admin.from("tenants").update({ subscription_status: "suspended" }).eq("id", t.id);
        suspended++;
      }
    } catch (e: any) {
      errors.push(`${t.id}: ${e?.message || "erro"}`);
    }
  }

  return { sent, suspended, errors };
}
