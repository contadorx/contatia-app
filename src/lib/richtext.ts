// Helpers de HTML de e-mail — compartilhados pelo EDITOR visual (cliente) e pelo
// ENVIO (servidor). O corpo e a assinatura são conteúdo PRÓPRIO do tenant (mesmo
// nível de confiança da assinatura, que já era enviada como HTML cru).
//
// Regra de ouro: se o texto tem tag HTML, tratamos como HTML; se não tem, é texto
// puro (escapa e quebra linha) — assim os e-mails antigos (texto) seguem iguais e
// os novos (formatados no editor visual) chegam com a formatação.

export function looksHtml(s: string | null | undefined): boolean {
  return !!s && /<[a-z!/][\s\S]*>/i.test(s);
}

// Texto puro → HTML seguro (escapa & < > e vira <br> nas quebras de linha).
export function plainToHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// HTML → texto puro (fallback do e-mail e prévia sem tags).
export function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Normaliza o valor para exibir no editor visual (texto puro ganha <br>).
export function toEditorHtml(s: string | null | undefined): string {
  const t = (s || "").toString();
  if (!t) return "";
  return looksHtml(t) ? t : plainToHtml(t);
}

// Monta o corpo final do e-mail (corpo + assinatura).
// Retorna html=undefined quando TUDO é texto puro (comportamento legado: e-mail
// vai só como texto). Caso o corpo OU a assinatura tenham HTML, gera as duas
// versões (html + text de fallback).
export function buildEmailHtml(
  bodyText: string,
  sigRendered: string
): { html?: string; text: string } {
  const bodyIsHtml = looksHtml(bodyText);
  const sigIsHtml = looksHtml(sigRendered);

  if (!bodyIsHtml && !sigIsHtml) {
    const text = sigRendered ? `${bodyText}\n\n${sigRendered}` : bodyText;
    return { html: undefined, text };
  }

  const bodyHtml = bodyIsHtml ? bodyText : plainToHtml(bodyText);
  const sigHtml = sigRendered ? (sigIsHtml ? sigRendered : plainToHtml(sigRendered)) : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16172A;line-height:1.5">${bodyHtml}${sigHtml ? `<br><br>${sigHtml}` : ""}</div>`;

  const bodyPlain = bodyIsHtml ? stripTags(bodyText) : bodyText;
  const sigPlain = sigRendered ? stripTags(sigRendered) : "";
  const text = sigPlain ? `${bodyPlain}\n\n${sigPlain}` : bodyPlain;

  return { html, text };
}
