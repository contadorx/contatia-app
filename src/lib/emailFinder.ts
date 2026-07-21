// ============================================================
// Cliente do WORKER de verificação de e-mail (roda no VPS).
// O Vercel bloqueia a porta 25, então a conversa SMTP acontece no worker;
// aqui só chamamos o serviço.
//
// Env necessárias no Vercel:
//   WORKER_URL   = https://worker.seudominio.com.br
//   WORKER_TOKEN = o mesmo token configurado no VPS
// ============================================================

export type DiscoverResult = {
  email: string | null;
  status: "valid" | "invalid" | "uncertain" | "blocked" | "error" | "not_found";
  tentativas?: { email: string; status: string; reason: string }[];
};

function cfg() {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function workerConfigurado(): boolean {
  return !!cfg();
}

export type WorkerHealth = { configured: boolean; ok: boolean; httpStatus?: number; error?: string };

/** Diagnóstico: o worker está configurado e no ar? (autoatendimento) */
export async function workerHealth(): Promise<WorkerHealth> {
  const c = cfg();
  if (!c) return { configured: false, ok: false };
  try {
    const res = await fetch(`${c.url}/health`, {
      headers: { Authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { configured: true, ok: false, httpStatus: res.status };
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return { configured: true, ok: j?.ok !== false, httpStatus: res.status };
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : "sem conexão" };
  }
}

/**
 * Descobre o e-mail de um decisor pelo nome + domínio da empresa.
 * Só devolve um e-mail quando o servidor CONFIRMA que a caixa existe.
 * Nunca chuta: se não confirmar, devolve null e o lead vai para o WhatsApp.
 */
export async function discoverEmail(nome: string, dominio: string): Promise<DiscoverResult> {
  const c = cfg();
  if (!c) return { email: null, status: "error" };

  try {
    const res = await fetch(`${c.url}/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ nome, dominio }),
      signal: AbortSignal.timeout(45000), // a conversa SMTP é lenta
    });
    if (!res.ok) return { email: null, status: "error" };
    return (await res.json()) as DiscoverResult;
  } catch {
    return { email: null, status: "error" };
  }
}

/** Verifica um e-mail específico (usado antes de inscrever numa cadência). */
export async function verifyEmail(email: string): Promise<{ status: string; reason?: string }> {
  const c = cfg();
  if (!c) return { status: "error" };
  try {
    const res = await fetch(`${c.url}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { status: "error" };
    return await res.json();
  } catch {
    return { status: "error" };
  }
}

/**
 * A ÚNICA fonte da verdade para normalizar domínio.
 * Aceita qualquer coisa que o usuário cole e devolve só o domínio:
 *   "https://www.acme.com.br/sobre"  → "acme.com.br"
 *   "http://acme.com.br"             → "acme.com.br"
 *   "www.acme.com.br"                → "acme.com.br"
 *   "joao@acme.com.br"               → "acme.com.br"
 *   "ACME.COM.BR/  "                 → "acme.com.br"
 * Devolve null quando não sobra um domínio plausível.
 */
export function dominioDe(entrada?: string | null): string | null {
  if (!entrada) return null;

  let s = String(entrada).trim().toLowerCase();
  if (!s) return null;

  // e-mail? fica com o que vem depois do @
  if (s.includes("@")) s = s.split("@").pop() || "";

  // tira protocolo, www, caminho, query e barra final
  s = s
    .replace(/^[a-z]+:\/\//, "")   // https:// , http:// , ftp://
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/:\d+$/, "")           // porta
    .trim();

  // precisa parecer um domínio (ao menos um ponto e caracteres válidos)
  if (!s || !s.includes(".") || !/^[a-z0-9.-]+$/.test(s)) return null;
  if (s.startsWith(".") || s.endsWith(".")) return null;

  return s;
}
