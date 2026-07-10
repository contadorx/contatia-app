import "server-only";

export type AiStep = {
  channel: "email" | "whatsapp" | "call" | "linkedin";
  delay_days: number;
  subject: string;
  body: string;
};

function extractJsonArray(text: string): string {
  let t = text.trim();
  t = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}

const CHANNELS = new Set(["email", "whatsapp", "call", "linkedin"]);

export async function generateSequence(brief: {
  market: string;
  product: string;
  icp: string;
  tone?: string;
}): Promise<{ steps?: AiStep[]; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "Falta ANTHROPIC_API_KEY no ambiente (Vercel)." };
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const system = [
    "Você é especialista em cadências de prospecção B2B outbound no Brasil.",
    "Gere uma cadência multicanal de 5 passos, em português do Brasil, no tom pedido.",
    "Regras: mensagens curtas e humanas; foco em valor, não em recurso; um CTA claro por passo;",
    "use as variáveis {{primeiro_nome}} e {{empresa}} quando fizer sentido; nada de promessas",
    "exageradas ou dados inventados (um humano vai revisar antes de enviar).",
    "Responda APENAS com um array JSON, sem texto ao redor. Cada item:",
    '{"channel":"email|whatsapp|call|linkedin","delay_days":number,"subject":"...","body":"..."}',
    "O primeiro passo tem delay_days 0. subject só importa para email (use string vazia nos demais).",
  ].join(" ");

  const user = [
    `Mercado: ${brief.market}`,
    `Produto/serviço: ${brief.product}`,
    `Cliente ideal (ICP): ${brief.icp}`,
    `Tom: ${brief.tone || "profissional, direto e consultivo"}`,
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 404 && /model/i.test(t)) {
        return {
          error: `Modelo "${model}" indisponível na sua conta. Ajuste a env var ANTHROPIC_MODEL (ex.: claude-sonnet-4-5, claude-haiku-4-5) e refaça o deploy. Liste os seus em GET /v1/models.`,
        };
      }
      return { error: `API ${res.status}: ${t.slice(0, 180)}` };
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const parsed = JSON.parse(extractJsonArray(text));
    if (!Array.isArray(parsed)) return { error: "Resposta da IA em formato inesperado." };

    const steps: AiStep[] = parsed
      .map((s: any) => ({
        channel: CHANNELS.has(s.channel) ? s.channel : "email",
        delay_days: Number(s.delay_days) || 0,
        subject: (s.subject || "").toString(),
        body: (s.body || "").toString(),
      }))
      .slice(0, 8);
    if (!steps.length) return { error: "A IA não retornou passos." };
    return { steps };
  } catch (e: any) {
    return { error: e?.message || "Falha ao gerar com IA." };
  }
}
