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

  // ============================================================
  // UM 2xx É ENVIO FEITO — MESMO QUE O CORPO NÃO SEJA O ESPERADO
  //
  // A versão anterior fazia `await res.json()` DEPOIS de confirmar o 2xx, sem
  // proteção. Se o Brevo aceitasse a mensagem e devolvesse qualquer coisa que não
  // fosse JSON (corpo vazio, HTML de um proxy, resposta cortada), esta função LANÇAVA
  // — e quem chamou entendia "não enviou".
  //
  // Nas réguas, "não enviou" significava não registrar o envio e tentar de novo na
  // próxima rodada. Com o e-mail já entregue. A cada 5 minutos. Foi assim que o mesmo
  // aviso de reengajamento saiu repetidas vezes: ele SEMPRE saía, e o app SEMPRE
  // achava que tinha falhado.
  //
  // Regra: o que decide se o e-mail saiu é o STATUS da resposta, não o formato dela.
  // ============================================================
  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
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
  } catch (e: any) {
    // A conexão caiu. Aqui não dá para saber se o Brevo recebeu ou não — quem chama
    // precisa tratar isto como "pode ter saído", nunca como "não saiu, tente já".
    return { error: `Brevo: falha de rede (${e?.message || "sem detalhe"})` };
  }

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = await res.json();
      detail = (j as any)?.message || detail;
    } catch { /* corpo ilegível: o status já basta */ }
    return { error: `Brevo: ${detail}` };
  }

  let id: string | undefined;
  try {
    const j = (await res.json()) as { messageId?: string };
    id = j?.messageId;
  } catch { /* aceito sem corpo legível: continua sendo aceito */ }
  return { ok: true, id };
}
