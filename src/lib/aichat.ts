import "server-only";

// ============================================================
// Motor das IAs de atendimento (Suporte + Vendas).
// Chama a API da Anthropic com o "cérebro" (system prompt editável) + histórico
// da conversa. A IA encerra com o marcador [[ESCALAR]] quando precisa de humano;
// aqui a gente detecta, tira o marcador do texto e sinaliza o escalonamento.
// ============================================================

export type ChatMsg = { role: "user" | "assistant"; content: string };

const ESCALATE = "[[ESCALAR]]";

const RULES = [
  "REGRAS DE FORMATO:",
  "- Responda curto (2-5 frases), em português do Brasil, sem markdown pesado.",
  "- Uma pergunta por vez. Não repita a saudação a cada mensagem.",
  `- Quando precisar passar para um humano (não sabe resolver, é caso de conta específica, a pessoa pediu, ou é um lead interessado): peça o NOME e o melhor contato (e-mail ou WhatsApp) se ainda não tiver, agradeça, diga que o time retorna em breve, e escreva ${ESCALATE} na ÚLTIMA linha (o usuário não vê esse marcador).`,
  "- Nunca invente preços, prazos, políticas ou funcionalidades que não estejam no seu conhecimento.",
].join("\n");

export function buildSystem(brain: string, kbContext?: string): string {
  const parts = [brain.trim(), RULES];
  if (kbContext && kbContext.trim()) {
    parts.push("BASE DE CONHECIMENTO (use como fonte de verdade):\n" + kbContext.trim());
  }
  return parts.join("\n\n");
}

// Monta o contexto da KB (artigos publicados) num texto compacto.
export function kbToContext(articles: { title: string; category?: string | null; body: string }[]): string {
  return articles
    .slice(0, 40)
    .map((a) => `# ${a.title}${a.category ? ` (${a.category})` : ""}\n${(a.body || "").slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 24000);
}

export async function assistantReply(input: {
  system: string;
  messages: ChatMsg[];
  model?: string;
}): Promise<{ text?: string; escalate?: boolean; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "IA indisponível (configuração do servidor)." };
  const model = input.model || process.env.ANTHROPIC_CHAT_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  // manda só as últimas mensagens (janela) para conter custo/contexto
  const msgs = input.messages.slice(-14).map((m) => ({ role: m.role, content: m.content }));

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 700, system: input.system, messages: msgs }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { error: `IA ${res.status}: ${t.slice(0, 160)}` };
    }
    const data = await res.json();
    let text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    const escalate = text.includes(ESCALATE);
    if (escalate) text = text.replace(ESCALATE, "").trim();
    return { text, escalate };
  } catch (e: any) {
    return { error: e?.message || "Falha ao falar com a IA." };
  }
}

// Extrai e-mail e telefone do texto das mensagens do usuário (para o contato do lead).
const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const RE_PHONE = /(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-.\s]?\d{4}/;

export function extractContact(messages: ChatMsg[]): { email?: string; phone?: string } {
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const email = userText.match(RE_EMAIL)?.[0];
  const phone = userText.match(RE_PHONE)?.[0]?.replace(/\s+/g, " ").trim();
  return { email, phone };
}
