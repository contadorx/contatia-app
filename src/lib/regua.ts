import "server-only";

// Helpers das réguas (comunicação + cobrança): render dos tokens e log de e-mail.

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://app.contatia.com.br");

// Tokens dos textos editáveis: {{ola}} (saudação) e {{app}} (URL do app).
export function renderTemplate(text: string, opts: { name?: string | null }): string {
  const first = (opts.name || "").trim().split(" ")[0] || "";
  const ola = first ? `Olá, ${first}!` : "Olá!";
  return (text || "").replace(/\{\{\s*ola\s*\}\}/gi, ola).replace(/\{\{\s*app\s*\}\}/gi, APP_URL);
}

// Registra um envio na Central de E-mails (best-effort — nunca quebra o fluxo).
export async function logEmail(
  admin: any,
  input: { tenant_id?: string | null; to?: string | null; subject?: string; kind?: string; status?: "sent" | "error"; error?: string | null }
) {
  try {
    await admin.from("email_log").insert({
      tenant_id: input.tenant_id ?? null,
      to_email: input.to ?? null,
      subject: input.subject ?? null,
      kind: input.kind ?? "outro",
      status: input.status ?? "sent",
      error: input.error ?? null,
    });
  } catch {
    /* log não pode derrubar o envio */
  }
}
