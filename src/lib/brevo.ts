import "server-only";

// Envio transacional pela API do Brevo (não SMTP). Usa BREVO_API_KEY + EMAIL_FROM/NAME.
export async function sendBrevoEmail(input: {
  to: string;
  toName?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}): Promise<{ ok?: boolean; error?: string; id?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "suporte@contatia.com.br";
  const fromName = process.env.EMAIL_FROM_NAME || "Contatia";
  if (!apiKey) return { error: "BREVO_API_KEY não configurada." };

  const html = input.html || `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${(input.text || "").replace(/</g, "&lt;")}</pre>`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: input.to, ...(input.toName ? { name: input.toName } : {}) }],
      subject: input.subject,
      htmlContent: html,
      ...(input.text ? { textContent: input.text } : {}),
      ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
    }),
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = await res.json();
      detail = j?.message || detail;
    } catch {}
    return { error: `Brevo: ${detail}` };
  }
  const j = (await res.json()) as { messageId?: string };
  return { ok: true, id: j.messageId };
}
