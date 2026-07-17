import "server-only";

// Régua de RETENÇÃO / arquivamento (roda no cron diário), sempre com porta de volta.
//   30 dias suspenso → e-mail "última chance".
//   60 dias suspenso → arquiva a conta e APAGA os dados dos leads (LGPD),
//                      MANTENDO a conta, os usuários e as faturas (reativável).
// Contagem a partir de tenants.suspended_at. Textos editáveis (track 'retencao').

import { renderTemplate, logEmail } from "@/lib/regua";

// Tabelas de "dados do lead" (PII de prospecção) — apagadas no arquivamento.
// Ordem: dependentes primeiro, contatos/empresas por último. Best-effort por tabela.
const LEAD_TABLES = [
  "link_clicks",
  "whatsapp_messages",
  "email_messages",
  "events",
  "tasks",
  "enrollments",
  "meetings",
  "opportunities",
  "contact_suggestions",
  "contact_tags",
  "account_tags",
  "radar_leads",
  "capture_batches",
  "email_discovery_queue",
  "email_suppressions",
  "documents",
  "document_shares",
  "contacts",
  "accounts",
];

async function purgeLeadData(admin: any, tenantId: string): Promise<void> {
  for (const table of LEAD_TABLES) {
    try {
      await admin.from(table).delete().eq("tenant_id", tenantId);
    } catch {
      /* tabela ausente ou FK — segue para a próxima; nunca aborta o arquivamento */
    }
  }
}

export async function runRetention(admin: any): Promise<{ warned: number; archived: number; errors: string[] }> {
  const errors: string[] = [];
  let warned = 0;
  let archived = 0;

  // contas suspensas ainda não arquivadas
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, contact_email, subscription_status, suspended_at")
    .eq("subscription_status", "suspended")
    .not("suspended_at", "is", null)
    .is("archived_at", null);
  if (!tenants?.length) return { warned, archived, errors };

  const { data: msgs } = await admin
    .from("business_messages")
    .select("key, enabled, trigger_days, subject, body")
    .eq("track", "retencao");
  const byKey: Record<string, any> = {};
  for (const m of (msgs as any[]) || []) byKey[m.key] = m;
  const lastChance = byKey["ret_last_chance"];
  const archivedMsg = byKey["ret_archived"];

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const now = Date.now();

  async function destinatario(t: any): Promise<string> {
    let to = (t.contact_email || "").trim();
    if (!to) {
      const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", t.id).eq("role", "owner").limit(1).maybeSingle();
      to = (owner as any)?.email || "";
    }
    return to;
  }

  for (const t of tenants as any[]) {
    try {
      const days = Math.floor((now - new Date(t.suspended_at).getTime()) / 86400000);
      const arcDays = Number(archivedMsg?.trigger_days) || 60;
      const warnDays = Number(lastChance?.trigger_days) || 30;

      // 60 dias → ARQUIVA + apaga leads
      if (days >= arcDays) {
        await purgeLeadData(admin, t.id);
        await admin.from("tenants").update({ subscription_status: "archived", archived_at: new Date().toISOString() }).eq("id", t.id);
        archived++;
        if (archivedMsg && archivedMsg.enabled !== false) {
          const to = await destinatario(t);
          if (to) {
            const subject = renderTemplate(archivedMsg.subject, { name: t.name });
            const text = renderTemplate(archivedMsg.body, { name: t.name });
            const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject, text });
            await logEmail(admin, { tenant_id: t.id, to, subject, kind: "retencao", status: r?.error ? "error" : "sent", error: r?.error });
          }
        }
        continue;
      }

      // 30 dias → última chance (uma vez)
      if (days >= warnDays && lastChance && lastChance.enabled !== false) {
        const { data: done } = await admin.from("business_message_sends").select("key").eq("tenant_id", t.id).eq("key", "ret_last_chance").maybeSingle();
        if (done) continue;
        const to = await destinatario(t);
        if (!to) continue;
        const subject = renderTemplate(lastChance.subject, { name: t.name });
        const text = renderTemplate(lastChance.body, { name: t.name });
        const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject, text });
        if (r?.error) {
          errors.push(`${t.id}/ret_last_chance: ${r.error}`);
          await logEmail(admin, { tenant_id: t.id, to, subject, kind: "retencao", status: "error", error: r.error });
          continue;
        }
        await admin.from("business_message_sends").insert({ tenant_id: t.id, key: "ret_last_chance" });
        await logEmail(admin, { tenant_id: t.id, to, subject, kind: "retencao", status: "sent" });
        warned++;
      }
    } catch (e: any) {
      errors.push(`${t.id}: ${e?.message || "erro"}`);
    }
  }

  return { warned, archived, errors };
}
