import "server-only";
import { ImapFlow } from "imapflow";

type Acc = {
  imap_host: string | null;
  smtp_host: string | null;
  imap_port: number | null;
  smtp_user: string | null;
  smtp_pass: string | null;
};

// Conecta na INBOX e devolve os e-mails de remetentes desde `since` (minúsculas).
export async function fetchRecentSenders(acc: Acc, since: Date): Promise<string[]> {
  const host = acc.imap_host || acc.smtp_host;
  if (!host || !acc.smtp_user) return [];

  const client = new ImapFlow({
    host,
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.smtp_user, pass: acc.smtp_pass || "" },
    logger: false,
    // tolera timeouts curtos no serverless
    socketTimeout: 20000,
  });

  const senders: string[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      if (uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          const addr = msg.envelope?.from?.[0]?.address;
          if (addr) senders.push(addr.toLowerCase());
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return senders;
}

export type RecentMessage = { from: string; subject: string };

export type RecentEmail = { from: string; subject: string; text: string; messageId: string | null; date: string | null };

// Como fetchRecentMessages, mas TAMBÉM baixa o corpo (texto) de cada mensagem — para a
// caixa de Respostas mostrar O QUE o lead respondeu, não só que respondeu. Usa mailparser
// para lidar com MIME/HTML/quoted-printable. Limita a N mensagens (últimas) para não
// estourar o tempo do cron no serverless.
export async function fetchRecentEmails(acc: Acc, since: Date, limit = 40): Promise<RecentEmail[]> {
  const host = acc.imap_host || acc.smtp_host;
  if (!host || !acc.smtp_user) return [];
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host,
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.smtp_user, pass: acc.smtp_pass || "" },
    logger: false,
    socketTimeout: 20000,
  });

  const out: RecentEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      let uids = (await client.search({ since }, { uid: true })) || [];
      if (uids.length > limit) uids = uids.slice(-limit); // últimas N
      if (uids.length) {
        for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0]?.address?.toLowerCase() || "";
          if (!from) continue;
          let text = "";
          let messageId: string | null = (msg.envelope as any)?.messageId || null;
          try {
            const parsed = await simpleParser(msg.source as Buffer);
            text = (parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, " ") : "") || "").replace(/ /g, " ").trim().slice(0, 8000);
            messageId = parsed.messageId || messageId;
          } catch { /* mensagem ilegível — guarda só o assunto */ }
          out.push({
            from,
            subject: (msg.envelope?.subject || "").slice(0, 200),
            text,
            messageId,
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

// Como fetchRecentSenders, mas devolve TAMBÉM o assunto — para o vendedor saber
// SOBRE O QUE o lead respondeu, não só QUE respondeu. (O corpo exigiria baixar o
// texto de cada mensagem, mais lento/instável no serverless; o assunto vem barato
// no envelope e já resolve o contexto.)
export async function fetchRecentMessages(acc: Acc, since: Date): Promise<RecentMessage[]> {
  const host = acc.imap_host || acc.smtp_host;
  if (!host || !acc.smtp_user) return [];

  const client = new ImapFlow({
    host,
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.smtp_user, pass: acc.smtp_pass || "" },
    logger: false,
    socketTimeout: 20000,
  });

  const out: RecentMessage[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      if (uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          const addr = msg.envelope?.from?.[0]?.address;
          if (addr) out.push({ from: addr.toLowerCase(), subject: (msg.envelope?.subject || "").slice(0, 200) });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}
