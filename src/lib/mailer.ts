import "server-only";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

export type EmailAccount = {
  provider: "gmail" | "smtp";
  from_email: string;
  display_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  oauth_refresh_token: string | null;
  // usados só para gravar a cópia em "Enviados" (IMAP APPEND) — ver sendEmail
  id?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  save_to_sent?: boolean | null;
};

function buildTransport(a: EmailAccount) {
  if (a.provider === "gmail" && a.oauth_refresh_token) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error("Faltam GOOGLE_CLIENT_ID/SECRET no ambiente para enviar via Gmail.");
    }
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: a.from_email,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: a.oauth_refresh_token,
      },
    });
  }
  // SMTP genérico (Outlook, servidor próprio, ou Gmail com senha de app)
  if (!a.smtp_host || !a.smtp_user) throw new Error("Caixa SMTP incompleta (host/usuário).");
  return nodemailer.createTransport({
    host: a.smtp_host,
    port: a.smtp_port || 587,
    secure: !!a.smtp_secure, // true = 465; false = 587/STARTTLS
    auth: { user: a.smtp_user, pass: a.smtp_pass || "" },
  });
}

export async function sendEmail(
  account: EmailAccount,
  msg: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    // convite de calendário (.ics). O nodemailer monta o MIME certo
    // (text/calendar; method=REQUEST) → Gmail/Outlook mostram o convite e travam a agenda.
    icalEvent?: { method: string; content: string; filename?: string };
  }
): Promise<{ copiaEmEnviados?: boolean; erroCopia?: string }> {
  const transport = buildTransport(account);
  const from = account.display_name
    ? `${account.display_name} <${account.from_email}>`
    : account.from_email;

  // Message-ID definido por NÓS, e não pelo nodemailer, para que a cópia gravada em
  // "Enviados" tenha o MESMO id da mensagem que saiu. Sem isso, a resposta do cliente
  // não se encadeia com a cópia e o webmail mostra duas conversas soltas.
  const dominio = (account.from_email || "").split("@")[1] || "contatia.com.br";
  const messageId = `<${randomUUID()}@${dominio}>`;

  const opcoes: any = {
    from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    messageId,
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.icalEvent
      ? { icalEvent: { method: msg.icalEvent.method, filename: msg.icalEvent.filename || "convite.ics", content: msg.icalEvent.content } }
      : {}),
  };

  await transport.sendMail(opcoes);

  // ---------- cópia em "Enviados" ----------
  // A mensagem JÁ SAIU. Daqui para baixo nada pode virar erro na tela: dizer "falhou"
  // sobre um e-mail que o cliente já recebeu faria o operador mandar de novo.
  //
  // Gmail/Outlook.com gravam a cópia sozinhos no servidor deles — fazer o APPEND numa
  // caixa dessas criaria duas cópias.
  if (account.provider === "gmail" || account.save_to_sent === false) {
    return {};
  }
  try {
    const MailComposer = (await import("nodemailer/lib/mail-composer")).default as any;
    const raw: Buffer = await new MailComposer(opcoes).compile().build();
    const { salvarEmEnviados } = await import("@/lib/imap");

    // TETO DE TEMPO: o envio é de 1 clique e a pessoa está olhando. Um IMAP que não
    // responde não pode segurar a tela — 8s e seguimos sem a cópia.
    const r = await Promise.race([
      salvarEmEnviados(account as any, raw),
      new Promise<{ error: string }>((res) => setTimeout(() => res({ error: "IMAP não respondeu em 8s" }), 8000)),
    ]);
    if ((r as any)?.ok) return { copiaEmEnviados: true };
    return { copiaEmEnviados: false, erroCopia: (r as any)?.error || "falha desconhecida" };
  } catch (e: any) {
    return { copiaEmEnviados: false, erroCopia: e?.message || "falha ao compor a cópia" };
  }
}
