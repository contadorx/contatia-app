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

// ============================================================
// GRAVAR CÓPIA NA PASTA "ENVIADOS"
//
// POR QUE ISTO PRECISA EXISTIR: enviar e guardar cópia são DUAS coisas diferentes.
// O SMTP só transporta a mensagem — ele não tem pasta nenhuma. A pasta "Enviados" é
// IMAP, e quem coloca a cópia lá é o programa que enviou, com um comando APPEND.
// Outlook e Thunderbird fazem isso; um sistema que só usa SMTP, não.
//
// Por isso o e-mail chegava no destinatário e sumia do seu webmail: ele saiu, mas
// ninguém tinha pedido para guardar a cópia.
//
// EXCEÇÃO: Gmail e Outlook.com gravam sozinhos, no servidor deles. Chamar isto numa
// caixa Gmail criaria DUAS cópias na pasta. Quem chama precisa pular esses provedores.
//
// É BEST-EFFORT de propósito: a mensagem JÁ FOI ENVIADA quando esta função roda.
// Falhar aqui não pode virar erro na tela — seria dizer "não enviou" sobre um e-mail
// que o cliente já recebeu, e o operador mandaria de novo.
// ============================================================

// Nomes de pasta de "enviados" que os servidores usam, em ordem de tentativa.
// O certo é o servidor declarar \Sent (SPECIAL-USE) e é isso que tentamos primeiro;
// esta lista é o plano B para servidores antigos que não declaram.
const NOMES_ENVIADOS = [
  "Sent", "INBOX.Sent", "Sent Items", "INBOX.Sent Items", "Sent Messages",
  "INBOX.Sent Messages", "Enviados", "INBOX.Enviados", "Elementos enviados",
];

export async function salvarEmEnviados(
  acc: Acc,
  raw: Buffer | string
): Promise<{ ok?: boolean; pasta?: string; error?: string }> {
  const host = acc.imap_host || acc.smtp_host;
  if (!host || !acc.smtp_user) return { error: "Caixa sem dados de IMAP." };

  const client = new ImapFlow({
    host,
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.smtp_user, pass: acc.smtp_pass || "" },
    logger: false,
    socketTimeout: 15000,
  });

  try {
    await client.connect();
    try {
      // 1) a pasta que o próprio servidor marca como "enviados"
      let destino: string | null = null;
      try {
        const lista = await client.list();
        const especial = (lista || []).find(
          (m: any) => m.specialUse === "\\Sent" || (m.flags && m.flags.has && m.flags.has("\\Sent"))
        );
        if (especial) destino = especial.path;
        // 2) plano B: casar pelo nome, respeitando o separador do servidor
        if (!destino) {
          const caminhos = new Set((lista || []).map((m: any) => m.path));
          destino = NOMES_ENVIADOS.find((n) => caminhos.has(n)) || null;
        }
      } catch { /* servidor sem LIST utilizável: tenta o nome mais comum */ }

      if (!destino) destino = "Sent";

      // \Seen porque a cópia na pasta de enviados não é "não lida" — sem isso o
      // webmail mostra um contador de não lidos que nunca faz sentido.
      await client.append(destino, raw, ["\\Seen"]);
      return { ok: true, pasta: destino };
    } finally {
      await client.logout().catch(() => {});
    }
  } catch (e: any) {
    return { error: e?.message || "Falha ao gravar em Enviados." };
  }
}

// ============================================================
// UMA SESSÃO DE "ENVIADOS" PARA O LOTE INTEIRO
//
// `salvarEmEnviados` faz, PARA CADA E-MAIL: conecta (TCP+TLS+LOGIN), lista TODAS as
// pastas da caixa para descobrir qual é a de enviados, faz o APPEND e desconecta. Isso
// é correto para um envio avulso e é ruína para um lote: são 2 a 4 segundos por
// mensagem, gastos quase todos em descobrir de novo uma resposta que não muda.
//
// Somados ao aperto de mão do SMTP (consertado em mailer.ts), eram esses segundos que
// faziam "enviar todos" render 10 e-mails dentro do orçamento de 40s da função.
//
// Aqui a conexão abre uma vez, a pasta é resolvida uma vez, e cada cópia é só o APPEND.
// Quem abre é responsável por fechar.
// ============================================================
export type SessaoEnviados = {
  append: (raw: Buffer | string) => Promise<{ ok?: boolean; pasta?: string; error?: string }>;
  fechar: () => Promise<void>;
  pasta: string;
};

export async function abrirEnviados(acc: Acc): Promise<SessaoEnviados | { error: string }> {
  const host = acc.imap_host || acc.smtp_host;
  if (!host || !acc.smtp_user) return { error: "Caixa sem dados de IMAP." };

  const client = new ImapFlow({
    host,
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.smtp_user, pass: acc.smtp_pass || "" },
    logger: false,
    socketTimeout: 15000,
  });

  try {
    await client.connect();
  } catch (e: any) {
    return { error: e?.message || "Falha ao conectar no IMAP." };
  }

  let destino: string | null = null;
  try {
    const lista = await client.list();
    const especial = (lista || []).find(
      (m: any) => m.specialUse === "\\Sent" || (m.flags && m.flags.has && m.flags.has("\\Sent"))
    );
    if (especial) destino = especial.path;
    if (!destino) {
      const caminhos = new Set((lista || []).map((m: any) => m.path));
      destino = NOMES_ENVIADOS.find((n) => caminhos.has(n)) || null;
    }
  } catch { /* servidor sem LIST utilizável: tenta o nome mais comum */ }
  if (!destino) destino = "Sent";

  const pasta = destino;
  return {
    pasta,
    append: async (raw) => {
      try {
        await client.append(pasta, raw, ["\\Seen"]);
        return { ok: true, pasta };
      } catch (e: any) {
        return { error: e?.message || "Falha ao gravar em Enviados." };
      }
    },
    fechar: async () => { await client.logout().catch(() => {}); },
  };
}
