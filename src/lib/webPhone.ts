import "server-only";

// ============================================================
// CAPTURA DE TELEFONE / WHATSAPP no site da empresa (HTTP — porta 443).
//
// Roda no próprio app: não depende do Evolution nem do worker de e-mail. Lê a home
// + páginas de contato e extrai, em ordem de confiança:
//   1) links wa.me / api.whatsapp.com  → é um WhatsApp CONFIRMADO (o dono publicou)
//   2) links tel:                       → telefone declarado
//   3) padrões de telefone BR no texto  → fallback
//
// LGPD: é o número que a EMPRESA publicou para ser contatada — o oposto do celular
// pessoal do sócio. Em micro/pequena empresa, essa linha costuma ser o próprio dono.
// ============================================================

const PATHS = ["", "/contato", "/contact", "/fale-conosco", "/faleconosco"];

function digits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// Normaliza para o formato do WhatsApp BR: 55 + DDD + assinante (12 ou 13 dígitos).
// Devolve null quando não parece um telefone brasileiro plausível.
function normBr(raw: string): string | null {
  let d = digits(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  // já com país
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = Number(d.slice(2, 4));
    return ddd >= 11 && ddd <= 99 ? d : null;
  }
  // sem país: 10 (fixo) ou 11 (móvel)
  if (d.length === 10 || d.length === 11) {
    const ddd = Number(d.slice(0, 2));
    return ddd >= 11 && ddd <= 99 ? "55" + d : null;
  }
  return null;
}

function extractWhatsApp(html: string): string[] {
  const out = new Set<string>();
  const re = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp:\/\/send\?phone=|whatsapp\.com\/send\?phone=)(\+?[\d]{8,15})/gi;
  for (const m of html.matchAll(re)) {
    const n = normBr(m[1]);
    if (n) out.add(n);
  }
  return Array.from(out);
}

function extractPhones(html: string): string[] {
  const out = new Set<string>();
  // tel: (declarado)
  for (const m of html.matchAll(/tel:(\+?[\d\s().-]{8,20})/gi)) {
    const n = normBr(m[1]);
    if (n) out.add(n);
  }
  // padrão BR no texto: (11) 99999-9999 / +55 11 99999 9999 / 11 3333-4444
  for (const m of html.matchAll(/(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g)) {
    const n = normBr(m[0]);
    if (n) out.add(n);
  }
  return Array.from(out);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; ContatiaBot/1.0)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  }
}

export type ContatoWeb = { whatsapp: string | null; phone: string | null; source: string | null };

/** Procura WhatsApp/telefone publicado no site. Prioriza wa.me (WhatsApp confirmado). */
export async function findPublishedContact(domain: string): Promise<ContatoWeb> {
  const base = (domain || "").replace(/^www\./, "");
  if (!base) return { whatsapp: null, phone: null, source: null };

  const phones = new Set<string>();

  for (const path of PATHS) {
    const url = `https://${base}${path}`;
    const html = await fetchText(url);
    if (!html) continue;

    const was = extractWhatsApp(html);
    if (was.length) return { whatsapp: was[0], phone: was[0], source: url }; // wa.me = confirmado, para cedo

    for (const p of extractPhones(html)) phones.add(p);
    // se já achamos um telefone na home, não precisa varrer tudo
    if (phones.size && path === "") break;
  }

  const phone = phones.size ? Array.from(phones)[0] : null;
  return { whatsapp: null, phone, source: phone ? `https://${base}` : null };
}

export type CapContact = { id: string; domain: string | null };
export type CapResult = { id: string; whatsapp: string | null; phone: string | null; source: string | null; skipped?: boolean };

// Captura em lote com concorrência limitada e PRAZO opcional: se o tempo estourar,
// os contatos não alcançados ficam marcados como skipped (o chamador os deixa na
// fila para a próxima rodada do cron). Não escreve no banco — quem chama grava.
export async function captureContactsBatch(
  contacts: CapContact[],
  concurrency = 6,
  deadlineMs?: number
): Promise<CapResult[]> {
  const out: CapResult[] = contacts.map((c) => ({ id: c.id, whatsapp: null, phone: null, source: null, skipped: true }));
  let i = 0;
  async function worker() {
    while (i < contacts.length) {
      if (deadlineMs && Date.now() > deadlineMs) return;
      const idx = i++;
      const c = contacts[idx];
      if (!c.domain) { out[idx] = { id: c.id, whatsapp: null, phone: null, source: null }; continue; }
      const r = await findPublishedContact(c.domain);
      out[idx] = { id: c.id, whatsapp: r.whatsapp, phone: r.phone, source: r.source };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, contacts.length) }, worker));
  return out;
}

// Monta o UPDATE do contato a partir do resultado da captura:
//  - wa.me → WhatsApp confirmado (wa_status='valid'), preenche o telefone se estiver vazio
//  - telefone comum → preenche se vazio e joga na fila de verificação (wa_status='queued')
//  - nada → web_capture='notfound'
export function buildCaptureUpdate(
  r: CapResult,
  cur: { phone?: string | null; wa_status?: string | null },
  nowIso: string
): Record<string, any> {
  const upd: Record<string, any> = {};
  if (r.whatsapp) {
    if (!cur.phone) upd.phone = r.whatsapp;
    upd.wa_number = r.whatsapp;
    upd.wa_status = "valid";
    upd.wa_checked_at = nowIso;
    upd.web_capture = "done";
  } else if (r.phone) {
    if (!cur.phone) upd.phone = r.phone;
    if (cur.wa_status !== "valid") upd.wa_status = "queued";
    upd.web_capture = "done";
  } else {
    upd.web_capture = "notfound";
  }
  return upd;
}
