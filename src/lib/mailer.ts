import "server-only";
import nodemailer from "nodemailer";

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
  msg: { to: string; subject: string; text: string; html?: string }
) {
  const transport = buildTransport(account);
  const from = account.display_name
    ? `${account.display_name} <${account.from_email}>`
    : account.from_email;
  await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}) });
}
