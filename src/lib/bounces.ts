import "server-only";

// Interpreta um aviso de "mailer-daemon" que caiu na caixa (SMTP puro) e extrai:
//  - o e-mail do destinatário que FALHOU;
//  - se é bounce PERMANENTE (hard, 5.x.x) — o único que suprimimos.
// Conservador de propósito: só devolve resultado quando tem um destinatário plausível
// E um sinal de falha permanente. Assim não suprimimos ninguém por engano (auto-resposta,
// "fora do escritório", soft bounce temporário etc. → ignorados).

export type BounceParse = { email: string; hard: boolean } | null;

const DAEMON = /(mailer-daemon|postmaster|mail delivery (subsystem|system)|mail administrator|microsoft ?exchange|mdaemon|no-?reply)/i;

const BOUNCE_SUBJECT =
  /(delivery status|undeliverable|delivery (failure|has failed|incomplete)|returned mail|failure notice|mail delivery failed|delivery notification: failure|n[aã]o\s*(foi\s*)?entregue|falha na entrega|mensagem devolvida|devolvid|retornad)/i;

const HARD_STATUS = /status:\s*5\.\d+\.\d+/i;
const SOFT_STATUS = /status:\s*4\.\d+\.\d+/i;
const HARD_CODE = /\b(550|551|553|554)\b/;
const SOFT_CODE = /\b(421|450|451|452)\b/;
const HARD_TEXT =
  /(user unknown|unknown user|does ?n[o']?t exist|no such user|no such (mailbox|recipient)|mailbox (unavailable|not found|does not exist|is disabled)|address (rejected|not found|does not exist)|recipient (not found|rejected|does not exist)|account (has been )?(disabled|closed|suspended)|no longer (active|exists|in use)|invalid (recipient|address|mailbox)|usu[aá]rio (desconhecido|inexistente)|conta (inexistente|desativada|inativa|n[aã]o existe)|endere[cç]o (inv[aá]lido|inexistente))/i;

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;

function clean(s: string): string {
  return (s || "").replace(/[<>()"']/g, "").replace(/[.,;:]+$/, "").trim().toLowerCase();
}

function acceptable(email: string, ownDomain?: string | null): boolean {
  if (!email || !EMAIL_RE.test(email)) return false;
  if (DAEMON.test(email)) return false;
  const dom = email.split("@")[1] || "";
  if (ownDomain && dom === ownDomain.toLowerCase()) return false; // não é o próprio remetente
  return true;
}

// Extrai o destinatário que falhou. Prioriza cabeçalhos de DSN (mais confiáveis);
// depois tenta o e-mail próximo de um código de erro; por fim o 1º e-mail plausível.
function extractFailedRecipient(text: string, ownDomain?: string | null): string | null {
  const headerPatterns = [
    /Final-Recipient:\s*(?:rfc822;)?\s*([^\s<>,]+@[^\s<>,]+)/i,
    /Original-Recipient:\s*(?:rfc822;)?\s*([^\s<>,]+@[^\s<>,]+)/i,
    /X-Failed-Recipients:\s*([^\s<>,]+@[^\s<>,]+)/i,
  ];
  for (const re of headerPatterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const e = clean(m[1]);
      if (acceptable(e, ownDomain)) return e;
    }
  }
  // e-mail na mesma linha de um código/frase de erro
  for (const ln of text.split(/\r?\n/)) {
    if (HARD_CODE.test(ln) || /\b5\.\d\.\d\b/.test(ln) || HARD_TEXT.test(ln)) {
      const m = ln.match(EMAIL_RE);
      if (m) { const e = clean(m[0]); if (acceptable(e, ownDomain)) return e; }
    }
  }
  // último recurso: 1º e-mail plausível do corpo (o destinatário costuma vir antes do rodapé)
  const all = text.match(new RegExp(EMAIL_RE.source, "gi")) || [];
  for (const a of all) { const e = clean(a); if (acceptable(e, ownDomain)) return e; }
  return null;
}

function isHardBounce(text: string): boolean {
  if (HARD_STATUS.test(text)) return true;
  if (SOFT_STATUS.test(text)) return false;
  if (HARD_CODE.test(text)) return true;
  if (SOFT_CODE.test(text)) return false;
  if (HARD_TEXT.test(text)) return true;
  return false; // ambíguo → NÃO suprime (evita falso positivo)
}

export function parseBounce(
  msg: { from: string; subject: string; text: string },
  ownDomain?: string | null
): BounceParse {
  const from = (msg.from || "").toLowerCase();
  const subject = msg.subject || "";
  const text = msg.text || "";

  const looksBounce =
    DAEMON.test(from) ||
    BOUNCE_SUBJECT.test(subject) ||
    /content-type:\s*message\/delivery-status/i.test(text) ||
    /Final-Recipient:/i.test(text) ||
    /Diagnostic-Code:/i.test(text);
  if (!looksBounce) return null;

  const hard = isHardBounce(text);
  if (!hard) return null; // só suprimimos bounce permanente

  const email = extractFailedRecipient(text, ownDomain);
  if (!email) return null;

  return { email, hard: true };
}
