import "server-only";
import { sendBrevoEmail } from "@/lib/brevo";

// Avisa você por e-mail quando a IA escala um atendimento. O badge no painel é
// resolvido por dado (status='escalated' + handled=false), então mesmo sem e-mail
// configurado o escalonamento não se perde.
export async function notifyEscalation(input: {
  kind: "support" | "sales";
  notifyEmail?: string | null;
  visitorName?: string | null;
  visitorEmail?: string | null;
  visitorPhone?: string | null;
  transcript: string;
  source: string;
}) {
  const to = input.notifyEmail || process.env.NOTIFY_EMAIL || process.env.EMAIL_FROM || null;
  if (!to) return;
  const label = input.kind === "sales" ? "VENDAS" : "SUPORTE";
  const contato =
    [input.visitorName, input.visitorEmail, input.visitorPhone].filter(Boolean).join(" · ") || "(não informado)";
  const subject = `🔔 ${label} — a IA encaminhou um atendimento`;
  const text =
    `A IA de ${label.toLowerCase()} não conseguiu resolver e passou para você.\n\n` +
    `Contato: ${contato}\nOrigem: ${input.source}\n\n` +
    `--- Conversa ---\n${input.transcript}\n\n` +
    `Responda direto por e-mail/WhatsApp. Ver no painel: /dashboard/superadmin/ia`;
  await sendBrevoEmail({ to, subject, text, replyTo: input.visitorEmail || undefined }).catch(() => {});
}
