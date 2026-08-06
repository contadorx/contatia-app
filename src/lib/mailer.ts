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

// ============================================================
// UMA CONEXÃO POR LOTE — o que fazia "enviar todos" render 10 e-mails
//
// Cada envio abria uma conexão SMTP NOVA: TCP, TLS, EHLO, AUTH, mensagem, QUIT. Num
// servidor comum isso é 1 a 3 segundos ANTES de a mensagem começar a andar. Com o
// orçamento de 40 segundos do envio em lote, davam ~10 e-mails por clique — e a conta
// não tinha nada a ver com o limite diário da caixa (80), que é onde eu tinha
// apostado. O gargalo era o aperto de mão, repetido 200 vezes.
//
// `pool: true` mantém a conexão aberta e manda as mensagens em sequência por ela, que
// é exatamente o que qualquer cliente de e-mail faz. `maxConnections: 1` é de
// propósito: paralelizar envio pela mesma caixa é a forma mais rápida de o provedor
// tratar você como robô. Ganho de tempo sim, ganho de agressividade não.
// ============================================================
function buildTransport(a: EmailAccount, lote = false) {
  const opcoesLote = lote ? { pool: true, maxConnections: 1, maxMessages: 500 } : {};
  if (a.provider === "gmail" && a.oauth_refresh_token) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error("Faltam GOOGLE_CLIENT_ID/SECRET no ambiente para enviar via Gmail.");
    }
    return nodemailer.createTransport({
      service: "gmail",
      ...opcoesLote,
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
    ...opcoesLote,
    auth: { user: a.smtp_user, pass: a.smtp_pass || "" },
  });
}

// Conexão reaproveitável para um lote. Quem cria é responsável por fechar (close()).
export function transporteDeLote(a: EmailAccount) {
  return buildTransport(a, true);
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
  },
  // `adiarCopia` devolve a cópia em "Enviados" como uma função para o chamador rodar
  // DEPOIS. Existe porque a cópia leva até 8 segundos de IMAP, e esse tempo estava
  // DENTRO da janela entre "o e-mail saiu" e "o envio foi registrado". Se a função
  // morresse ali, o e-mail estava na rua e não havia registro nenhum dele — o contador
  // do dia não subia e o limite ficava cego.
  opts?: {
    adiarCopia?: boolean;
    transport?: any;
    // no lote, a sessão de "Enviados" também é reaproveitada: sem isto cada cópia
    // reabre o IMAP e relista todas as pastas (2 a 4 segundos por mensagem)
    gravarEnviados?: (raw: Buffer) => Promise<{ ok?: boolean; error?: string }>;
  }
): Promise<{ copiaEmEnviados?: boolean; erroCopia?: string; copiar?: () => Promise<{ copiaEmEnviados?: boolean; erroCopia?: string }> }> {
  // no lote, a conexão vem pronta de fora e é reaproveitada entre as mensagens
  const transport = opts?.transport || buildTransport(account);
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

  const fazerCopia = async (): Promise<{ copiaEmEnviados?: boolean; erroCopia?: string }> => {
  try {
    const MailComposer = (await import("nodemailer/lib/mail-composer")).default as any;
    const raw: Buffer = await new MailComposer(opcoes).compile().build();

    // TETO DE TEMPO: o envio é de 1 clique e a pessoa está olhando. Um IMAP que não
    // responde não pode segurar a tela. No lote o teto é menor porque a conexão já
    // está aberta — se um APPEND leva mais que isso, o problema é do servidor e o
    // custo de esperar multiplica por 200.
    const noLote = !!opts?.gravarEnviados;
    const teto = noLote ? 4000 : 8000;
    const gravar = opts?.gravarEnviados
      ? opts.gravarEnviados(raw)
      : import("@/lib/imap").then(({ salvarEmEnviados }) => salvarEmEnviados(account as any, raw));

    const r = await Promise.race([
      gravar,
      new Promise<{ error: string }>((res) => setTimeout(() => res({ error: `IMAP não respondeu em ${teto / 1000}s` }), teto)),
    ]);
    if ((r as any)?.ok) return { copiaEmEnviados: true };
    return { copiaEmEnviados: false, erroCopia: (r as any)?.error || "falha desconhecida" };
  } catch (e: any) {
    return { copiaEmEnviados: false, erroCopia: e?.message || "falha ao compor a cópia" };
  }
  };

  if (opts?.adiarCopia) return { copiar: fazerCopia };
  return await fazerCopia();
}
