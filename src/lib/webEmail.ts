import "server-only";

// ============================================================
// CAMADA 0 — e-mail PUBLICADO no site da empresa.
//
// Roda no próprio app (Vercel): é HTTP (porta 443), então não depende do worker
// nem da porta 25. Busca a home + páginas de contato e extrai o e-mail que a
// EMPRESA publicou (contato@, comercial@…), além de JSON-LD schema.org.
//
// É o e-mail mais SEGURO em LGPD: a empresa o divulgou para ser contatada — o
// oposto do celular pessoal do sócio. Não é o e-mail do decisor, mas é um canal
// válido e entregável quando a descoberta do decisor falha.
// ============================================================

const PATHS = ["", "/contato", "/contact", "/fale-conosco", "/faleconosco", "/sobre", "/contato.html"];

const PREFERRED = ["contato", "comercial", "vendas", "atendimento", "faleconosco", "contact", "sales", "hello", "oi"];
const REJECT = ["example.com", "sentry", "wixpress", "godaddy", ".png", ".jpg", ".gif", "domain.com", "email.com", "seudominio"];

function extractEmails(html: string, domain: string): string[] {
  const found = new Set<string>();

  // mailto:
  const mailto = html.matchAll(/mailto:([^"'?>\s]+)/gi);
  for (const m of mailto) found.add(m[1].toLowerCase());

  // e-mails soltos no texto
  const raw = html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  for (const m of raw) found.add(m[0].toLowerCase());

  // JSON-LD schema.org: "email": "..."
  const ld = html.matchAll(/"email"\s*:\s*"([^"]+)"/gi);
  for (const m of ld) found.add(m[1].toLowerCase().replace(/^mailto:/, ""));

  const base = domain.replace(/^www\./, "");
  return Array.from(found).filter((e) => {
    if (REJECT.some((r) => e.includes(r))) return false;
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(e)) return false;
    // prioriza o mesmo domínio (evita e-mails de terceiros/ferramentas no rodapé)
    const dom = e.split("@")[1] || "";
    return dom === base || dom.endsWith("." + base) || dom === domain;
  });
}

function rank(emails: string[]): string | null {
  if (!emails.length) return null;
  for (const p of PREFERRED) {
    const hit = emails.find((e) => e.startsWith(p + "@"));
    if (hit) return hit;
  }
  // senão, o mais curto (costuma ser o institucional)
  return emails.sort((a, b) => a.length - b.length)[0];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
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

/** Procura um e-mail publicado no site do domínio. Devolve o melhor ou null. */
export async function findPublishedEmail(domain: string): Promise<{ email: string; source: string } | null> {
  const base = domain.replace(/^www\./, "");
  const all = new Set<string>();

  for (const path of PATHS) {
    for (const scheme of ["https://", "http://"]) {
      const url = `${scheme}${base}${path}`;
      const html = await fetchText(url);
      if (!html) continue;
      for (const e of extractEmails(html, base)) all.add(e);
      // achou algo preferido nesta página? já pode parar cedo
      const early = rank(Array.from(all));
      if (early && PREFERRED.some((p) => early.startsWith(p + "@"))) {
        return { email: early, source: url };
      }
      break; // deu certo no https; não tenta http do mesmo path
    }
  }

  const best = rank(Array.from(all));
  return best ? { email: best, source: `https://${base}` } : null;
}
