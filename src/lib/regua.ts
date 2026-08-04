import "server-only";

// Helpers das réguas (comunicação + cobrança): render dos tokens e log de e-mail.

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://app.contatia.com.br");

// Tokens dos textos editáveis:
//   {{ola}}  saudação    {{app}}  URL do app
//   {{link}} link de pagamento da fatura   {{valor}} valor (R$)   {{venc}} vencimento (dd/mm/aaaa)
export function renderTemplate(
  text: string,
  opts: { name?: string | null; link?: string | null; valor?: number | null; venc?: string | null }
): string {
  const first = (opts.name || "").trim().split(" ")[0] || "";
  const ola = first ? `Olá, ${first}!` : "Olá!";
  const valor =
    typeof opts.valor === "number"
      ? opts.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "";
  const venc = opts.venc ? opts.venc.split("-").reverse().join("/") : ""; // yyyy-mm-dd → dd/mm/yyyy
  return (text || "")
    .replace(/\{\{\s*ola\s*\}\}/gi, ola)
    .replace(/\{\{\s*app\s*\}\}/gi, APP_URL)
    .replace(/\{\{\s*link\s*\}\}/gi, opts.link || `${APP_URL}/dashboard/planos`)
    .replace(/\{\{\s*valor\s*\}\}/gi, valor)
    .replace(/\{\{\s*venc\s*\}\}/gi, venc);
}

// ============================================================
// DISJUNTOR: A MESMA MENSAGEM NÃO SAI DUAS VEZES NO MESMO DIA
//
// Hoje as réguas da plataforma (ciclo de vida, cobrança, retenção) mandaram o mesmo
// e-mail de 5 em 5 minutos. A causa imediata foi o cron sem trava, mas o desenho já
// era frágil antes disso: TODAS mandam primeiro e só depois gravam que mandaram — e
// nenhuma conferia se a gravação deu certo. Gravação que falha em silêncio vira
// reenvio infinito.
//
// Conferir a gravação (feito) resolve a causa conhecida. Este disjuntor cobre as que
// eu não conheço: seja qual for o motivo, se o MESMO assunto já saiu para o MESMO
// endereço nas últimas horas, não sai de novo. `email_log` registra todo envio das
// réguas — é a única fonte que não depende do controle específico de cada uma estar
// funcionando.
//
// Custo: uma consulta por envio. Barato perto de 288 e-mails por dia.
// ============================================================
export async function jaEnviado(
  admin: any,
  input: { to?: string | null; subject?: string | null; horas?: number }
): Promise<boolean> {
  const to = (input.to || "").trim().toLowerCase();
  const subject = (input.subject || "").trim();
  if (!to || !subject) return false;
  try {
    const desde = new Date(Date.now() - (input.horas ?? 20) * 3600000).toISOString();
    const { data, error } = await admin
      .from("email_log")
      .select("id")
      .eq("to_email", to)
      .eq("subject", subject)
      .eq("status", "sent")
      .gte("created_at", desde)
      .limit(1);
    // Erro na consulta NÃO libera o envio: na dúvida, o silêncio custa menos que o
    // spam. Era exatamente o contrário disso que produziu o problema de hoje.
    if (error) return true;
    return ((data as any[]) || []).length > 0;
  } catch {
    return true;
  }
}

// Registra um envio na Central de E-mails (best-effort — nunca quebra o fluxo).
// O endereço é gravado em minúsculas de propósito: `jaEnviado` procura por ele, e
// uma comparação sensível a maiúsculas deixaria o disjuntor passar batido.
export async function logEmail(
  admin: any,
  input: { tenant_id?: string | null; to?: string | null; subject?: string; kind?: string; status?: "sent" | "error"; error?: string | null }
) {
  try {
    await admin.from("email_log").insert({
      tenant_id: input.tenant_id ?? null,
      to_email: (input.to || "").trim().toLowerCase() || null,
      subject: input.subject ?? null,
      kind: input.kind ?? "outro",
      status: input.status ?? "sent",
      error: input.error ?? null,
    });
  } catch {
    /* log não pode derrubar o envio */
  }
}
