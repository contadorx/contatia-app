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

export type Brief = {
  market: string;
  product: string;
  icp: string;
  tone?: string;
  pain?: string;
  proof?: string;
  goal?: string;
  cta?: string;
  avoid?: string;
  steps?: number;
  channels?: string[];
};

export async function generateSequence(
  brief: Brief,
  opts?: { apiKey?: string; model?: string }
): Promise<{ steps?: AiStep[]; error?: string }> {
  const key = opts?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "Configure a chave da IA em Config (ou ANTHROPIC_API_KEY no ambiente)." };
  const model = opts?.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const nSteps = Math.min(8, Math.max(3, Number(brief.steps) || 5));
  const channels = brief.channels?.length ? brief.channels.join(", ") : "email, whatsapp, linkedin, call";

  const system = [
    "Você é especialista em cadências de prospecção B2B outbound no Brasil, no estilo consultivo.",
    `Gere uma cadência de EXATAMENTE ${nSteps} passos, em português do Brasil, usando só estes canais: ${channels}.`,
    "Princípios: mensagens curtas e humanas (2-5 frases no email; 1-3 no whatsapp); cada passo com UM CTA claro;",
    "foco na DOR e no VALOR, nunca em features; variar o ângulo a cada passo (não repetir a mesma abertura);",
    "usar {{primeiro_nome}} e {{empresa}} quando fizer sentido; escalonar o tom (educar → prova → urgência leve → despedida).",
    "NUNCA inventar dados, números ou casos que não foram fornecidos. Um humano vai revisar antes de enviar.",
    "Responda APENAS com um array JSON, sem texto ao redor. Cada item:",
    '{"channel":"email|whatsapp|call|linkedin","delay_days":number,"subject":"...","body":"..."}',
    "O 1º passo tem delay_days 0. subject só importa no email (string vazia nos demais). Espaçar os delays de forma realista.",
  ].join(" ");

  const lines = [
    `Mercado-alvo: ${brief.market}`,
    `Produto/serviço: ${brief.product}`,
    `Cliente ideal (ICP): ${brief.icp}`,
    brief.pain ? `Dor que resolvemos: ${brief.pain}` : "",
    brief.proof ? `Prova/diferencial (use com cuidado, sem exagerar): ${brief.proof}` : "",
    brief.goal ? `Objetivo da cadência: ${brief.goal}` : "Objetivo da cadência: agendar uma conversa/diagnóstico.",
    brief.cta ? `CTA preferido: ${brief.cta}` : "",
    brief.tone ? `Tom de voz: ${brief.tone}` : "Tom de voz: profissional, direto e consultivo.",
    brief.avoid ? `NUNCA dizer / evitar: ${brief.avoid}` : "",
  ].filter(Boolean);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2000, system, messages: [{ role: "user", content: lines.join("\n") }] }),
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
