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
      signal: AbortSignal.timeout(55000), // a conversa SMTP é lenta (vários padrões × servidor lento)
    });
    if (!res.ok) return { email: null, status: "error" };
    return (await res.json()) as DiscoverResult;
  } catch {
    return { email: null, status: "error" };
  }
}

// ============================================================
// DESCOBERTA PARALELA (app-side): gera os padrões nome@domínio e verifica TODOS de
// uma vez (Promise.all), em vez de deixar o worker testar um a um (que estoura o tempo
// em servidores lentos/tarpit). Cada verificação é uma conversa SMTP independente;
// paralelas, o total ≈ a mais lenta, não a soma. Não exige mudar o worker.
// ============================================================
const CAND_LIMIT = 6;

export function candidatePatterns(nome: string, dominioRaw: string): string[] {
  const d = (dominioDe(dominioRaw) || "").replace(/^@/, "");
  if (!d) return [];
  const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const parts = strip(nome || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const set = new Set<string>();
  if (first) set.add(`${first}@${d}`);
  if (first && last) {
    set.add(`${first}.${last}@${d}`);
    set.add(`${first}${last}@${d}`);
    set.add(`${first[0]}${last}@${d}`);
    set.add(`${first}.${last[0]}@${d}`);
    set.add(`${last}@${d}`);
  }
  return Array.from(set).slice(0, CAND_LIMIT);
}

export async function discoverEmailParallel(nome: string, dominio: string): Promise<DiscoverResult> {
  const cands = candidatePatterns(nome, dominio);
  if (!cands.length) return { email: null, status: "not_found", tentativas: [] };

  const results = await Promise.all(
    cands.map(async (email) => {
      const r = await verifyEmail(email); // { status, reason } — valid|invalid|uncertain|blocked|error
      return { email, status: r.status, reason: (r as any).reason || "" };
    })
  );
  const tentativas = results.map((r) => ({ email: r.email, status: r.status, reason: r.reason }));

  const hit = results.find((r) => r.status === "valid");
  if (hit) return { email: hit.email, status: "valid", tentativas };

  if (results.every((r) => r.status === "error")) return { email: null, status: "error", tentativas: [] };

  const temDefinitivoNao = results.some((r) => r.status === "invalid");
  const temBloqueado = results.some((r) => r.status === "blocked");
  const temIncerto = results.some((r) => r.status === "uncertain" || r.status === "error");
  if (temBloqueado && !temDefinitivoNao) return { email: null, status: "blocked", tentativas };
  if (temIncerto && !temDefinitivoNao) return { email: null, status: "uncertain", tentativas };
  return { email: null, status: "not_found", tentativas };
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
      signal: AbortSignal.timeout(45000), // servidores reais podem levar 20-30s pra responder o RCPT
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

// Provedores de e-mail PÚBLICOS: o domínio deles não é o site da empresa, então
// não serve para captura no site (raspar gmail.com não traz o telefone da empresa).
const PROVEDOR_PUBLICO = new Set([
  "gmail.com", "googlemail.com", "gmail.com.br",
  "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br",
  "live.com", "live.com.br", "msn.com",
  "yahoo.com", "yahoo.com.br", "ymail.com", "rocketmail.com",
  "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br", "r7.com",
  "icloud.com", "me.com", "mac.com", "aol.com",
  "globomail.com", "globo.com", "zipmail.com.br", "oi.com.br",
]);

/**
 * Domínio CORPORATIVO a partir de um e-mail: devolve o domínio só quando ele é o
 * site da empresa (não um provedor público). Usado no Radar/enriquecimento para
 * decidir se dá para raspar o site em busca de telefone/WhatsApp.
 */
export function dominioCorporativo(email?: string | null): string | null {
  const d = dominioDe(email);
  if (!d) return null;
  return PROVEDOR_PUBLICO.has(d) ? null : d;
}
