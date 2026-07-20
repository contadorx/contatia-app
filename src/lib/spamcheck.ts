import "server-only";

// Verifica o "spam score" do CONTEÚDO de um e-mail rodando-o pelo SpamAssassin —
// via API pública e gratuita do Postmark (sem chave, sem cadastro).
// Regra do SpamAssassin: quanto MENOR o score, melhor. A maioria dos provedores
// marca como spam a partir de ~5.0. Aqui: <3 bom · 3–5 atenção · ≥5 risco.

export type SpamRule = { rule: string; score: number; description: string };
export type SpamResult = {
  score: number; // score total do SpamAssassin (menor = melhor)
  rules: SpamRule[]; // regras que pontuaram (maior peso primeiro)
  verdict: "bom" | "atencao" | "risco";
};

const ENDPOINT = "https://spamcheck.postmarkapp.com/filter";

// Monta um e-mail RFC822 realista (multipart texto + html) a partir de assunto/corpo.
// Quanto mais parecido com um envio real, mais fiel o score do SpamAssassin.
function buildRawEmail(subject: string, htmlBody: string): string {
  const from = "Remetente <remetente@exemplo.com.br>";
  const to = "destinatario@exemplo.com.br";
  const boundary = "contatia_spamcheck_boundary_x1";
  const text = htmlToText(htmlBody);
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${sanitizeHeader(subject) || "(sem assunto)"}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomId()}@exemplo.com.br>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    text || "(sem texto)",
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    htmlBody?.trim() || "<p></p>",
    ``,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

function htmlToText(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/ /g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Cabeçalhos não podem ter quebra de linha (evita header injection).
function sanitizeHeader(s: string): string {
  return (s || "").replace(/[\r\n]+/g, " ").trim();
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function checkSpamScore(subject: string, htmlBody: string): Promise<SpamResult> {
  const email = buildRawEmail(subject, htmlBody);

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, options: "long" }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });

  if (!resp.ok) {
    throw new Error(`Serviço de verificação indisponível no momento (HTTP ${resp.status}). Tente de novo em instantes.`);
  }

  const data = (await resp.json()) as {
    success?: boolean;
    score?: string | number;
    rules?: Array<{ rule?: string; score?: string | number; description?: string }>;
    message?: string;
  };

  if (!data?.success) {
    throw new Error(data?.message || "Não foi possível verificar agora. Tente de novo.");
  }

  const score = Number(data.score) || 0;
  const rules: SpamRule[] = Array.isArray(data.rules)
    ? data.rules
        .map((r) => ({
          rule: String(r.rule || "").trim(),
          score: Number(r.score) || 0,
          description: String(r.description || "").trim(),
        }))
        .filter((r) => r.score !== 0)
        .sort((a, b) => b.score - a.score)
    : [];

  const verdict: SpamResult["verdict"] = score < 3 ? "bom" : score < 5 ? "atencao" : "risco";
  return { score, rules, verdict };
}
