import "server-only";

// Régua de ciclo de vida do ASSINANTE. Roda no cron diário. Os TEXTOS agora vêm
// de business_messages (track 'comunicacao'), editáveis no painel — a LÓGICA de
// quando disparar cada estágio continua aqui. Cada estágio é enviado uma vez.

import { renderTemplate, logEmail } from "@/lib/regua";

type Stage = "welcome" | "onboard_email" | "onboard_cadence" | "reengage";
const KEY: Record<Stage, string> = {
  welcome: "life_welcome",
  onboard_email: "life_onboard_email",
  onboard_cadence: "life_onboard_cadence",
  reengage: "life_reengage",
};

export async function runLifecycle(admin: any): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, contact_email, created_at, lifecycle_enabled")
    .eq("lifecycle_enabled", true);
  if (!tenants?.length) return { sent, errors };

  // textos editáveis da régua de comunicação
  const { data: msgs } = await admin.from("business_messages").select("key, enabled, subject, body").eq("track", "comunicacao");
  const byKey: Record<string, any> = {};
  for (const m of (msgs as any[]) || []) byKey[m.key] = m;

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const now = Date.now();

  for (const t of tenants as any[]) {
    try {
      let to = (t.contact_email || "").trim();
      if (!to) {
        const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", t.id).eq("role", "owner").limit(1).maybeSingle();
        to = (owner as any)?.email || "";
      }
      if (!to) continue;

      const { data: sends } = await admin.from("lifecycle_sends").select("stage").eq("tenant_id", t.id);
      const done = new Set(((sends as any[]) || []).map((s) => s.stage));
      const ageDays = Math.floor((now - new Date(t.created_at).getTime()) / 86400000);

      const { count: mailboxes } = await admin.from("email_accounts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
      const { count: cadences } = await admin.from("sequences").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);

      let stage: Stage | null = null;
      if (!done.has("welcome")) stage = "welcome";
      else if (!done.has("onboard_email") && ageDays >= 1 && (mailboxes ?? 0) === 0) stage = "onboard_email";
      else if (!done.has("onboard_cadence") && ageDays >= 3 && (mailboxes ?? 0) > 0 && (cadences ?? 0) === 0) stage = "onboard_cadence";
      else if (!done.has("reengage") && ageDays >= 14) {
        const { count: contacts } = await admin.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
        if ((cadences ?? 0) === 0 && (contacts ?? 0) === 0) stage = "reengage";
      }
      if (!stage) continue;

      const tpl = byKey[KEY[stage]];
      if (!tpl || tpl.enabled === false) continue; // estágio desligado no painel

      const subject = renderTemplate(tpl.subject, { name: t.name });
      const text = renderTemplate(tpl.body, { name: t.name });
      const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject, text });
      if (r?.error) {
        errors.push(`${t.id}/${stage}: ${r.error}`);
        await logEmail(admin, { tenant_id: t.id, to, subject, kind: "comunicacao", status: "error", error: r.error });
        continue;
      }

      await admin.from("lifecycle_sends").insert({ tenant_id: t.id, stage });
      await logEmail(admin, { tenant_id: t.id, to, subject, kind: "comunicacao", status: "sent" });
      sent++;
    } catch (e: any) {
      errors.push(`${t.id}: ${e?.message || "erro"}`);
    }
  }

  return { sent, errors };
}
