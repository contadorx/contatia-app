import "server-only";

// ============================================================
// CAPTURA DE REDES SOCIAIS no site da empresa
//
// Mesma ideia do webPhone: lê a home + páginas de contato e extrai o que a EMPRESA
// publicou. O rodapé de praticamente todo site de escritório tem os ícones das redes —
// é o dado mais fácil de colher e ninguém colhia.
//
// LGPD: é o perfil que a empresa divulga para ser encontrada. O oposto do perfil
// pessoal de alguém.
//
// DUAS ARMADILHAS que este arquivo evita, e que são a maior parte do código:
//
// 1. LIXO DE COMPARTILHAMENTO. Todo site tem botão "compartilhar no Facebook/LinkedIn",
//    e esses links apontam para `/sharer`, `/share`, `/shareArticle` — não são o perfil
//    da empresa. Sem filtrar, a captura guardaria o botão de compartilhar como se fosse
//    o Instagram do escritório.
// 2. CAMINHOS INSTITUCIONAIS DA PRÓPRIA REDE. `instagram.com/explore`, `/p/` (post
//    avulso), `/reel/`, `linkedin.com/feed`, `/jobs`, `/legal`… nada disso é perfil.
// ============================================================

const PATHS = ["", "/contato", "/contact", "/fale-conosco", "/faleconosco", "/sobre", "/quem-somos"];

// Caminhos do Instagram que NÃO são perfil de ninguém.
const IG_RESERVADO = new Set([
  "p", "reel", "reels", "explore", "stories", "tv", "accounts", "about", "developer",
  "legal", "privacy", "directory", "direct", "challenge", "emails", "session", "web",
]);

// Idem para o LinkedIn: o que vem depois do domínio e não é gente nem empresa.
const LI_RESERVADO = new Set([
  "feed", "jobs", "learning", "legal", "help", "sharing", "shareArticle", "sharearticle",
  "posts", "pulse", "signup", "login", "uas", "checkpoint", "start", "premium", "groups",
]);

function limpaHandle(s: string): string {
  return (s || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[?#].*$/, "")   // querystring e âncora
    .replace(/\/+$/, "")      // barra final
    .toLowerCase();
}

/** Extrai o @ do Instagram da empresa. Devolve o usuário puro, sem @ e sem URL. */
export function extrairInstagram(html: string): string | null {
  const re = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{1,30})/gi;
  for (const m of html.matchAll(re)) {
    const h = limpaHandle(m[1]);
    if (!h || IG_RESERVADO.has(h)) continue;
    // Um "usuário" de 1 caractere quase sempre é ruído de parsing.
    if (h.length < 2) continue;
    return h;
  }
  return null;
}

/** Extrai a URL do LinkedIn (perfil OU página de empresa). Guarda a URL inteira. */
export function extrairLinkedin(html: string): string | null {
  // `/in/` = pessoa, `/company/` e `/school/` = organização. Aceitamos os três, com
  // preferência por company: no site institucional, é o perfil da EMPRESA que aparece.
  const re = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(in|company|school|pub)\/([A-Za-z0-9\-_%.]{2,100})/gi;
  let pessoa: string | null = null;
  for (const m of html.matchAll(re)) {
    const tipo = m[1].toLowerCase();
    const slug = limpaHandle(m[2]);
    if (!slug || LI_RESERVADO.has(slug)) continue;
    const url = `https://www.linkedin.com/${tipo}/${slug}`;
    if (tipo === "company" || tipo === "school") return url;   // organização ganha
    if (!pessoa) pessoa = url;
  }
  return pessoa;
}

export function extrairFacebook(html: string): string | null {
  const re = /(?:https?:\/\/)?(?:www\.|m\.|pt-br\.)?facebook\.com\/([A-Za-z0-9.\-]{2,60})/gi;
  const proibido = new Set(["sharer", "share", "dialog", "plugins", "tr", "profile.php", "login", "help", "policies"]);
  for (const m of html.matchAll(re)) {
    const h = limpaHandle(m[1]);
    if (!h || proibido.has(h)) continue;
    return `https://www.facebook.com/${h}`;
  }
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    return (await res.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

export type RedesWeb = { instagram: string | null; linkedin: string | null; facebook: string | null; source: string | null };

/** Varre o site atrás dos perfis publicados. Para assim que tiver Instagram e LinkedIn. */
export async function findRedes(domain: string): Promise<RedesWeb> {
  const base = (domain || "").replace(/^www\./, "").replace(/^https?:\/\//, "").split("/")[0];
  if (!base) return { instagram: null, linkedin: null, facebook: null, source: null };

  const out: RedesWeb = { instagram: null, linkedin: null, facebook: null, source: null };

  for (const path of PATHS) {
    const url = `https://${base}${path}`;
    const html = await fetchText(url);
    if (!html) continue;
    if (!out.source) out.source = url;

    out.instagram ||= extrairInstagram(html);
    out.linkedin ||= extrairLinkedin(html);
    out.facebook ||= extrairFacebook(html);

    // As redes ficam no rodapé, que está em toda página: se a home tem, acabou.
    if (out.instagram && out.linkedin) break;
  }

  if (!out.instagram && !out.linkedin && !out.facebook) out.source = null;
  return out;
}

export type RedeContato = { id: string; domain: string | null };
export type RedeResult = RedesWeb & { id: string; skipped?: boolean };

/** Lote com concorrência limitada e prazo — mesmo desenho do captureContactsBatch. */
export async function capturarRedesLote(
  contatos: RedeContato[],
  concurrency = 6,
  deadlineMs?: number
): Promise<RedeResult[]> {
  const out: RedeResult[] = contatos.map((c) => ({
    id: c.id, instagram: null, linkedin: null, facebook: null, source: null, skipped: true,
  }));
  let i = 0;
  async function worker() {
    while (i < contatos.length) {
      if (deadlineMs && Date.now() > deadlineMs) return;
      const idx = i++;
      const c = contatos[idx];
      if (!c.domain) { out[idx] = { id: c.id, instagram: null, linkedin: null, facebook: null, source: null }; continue; }
      const r = await findRedes(c.domain);
      out[idx] = { id: c.id, ...r };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, contatos.length) }, worker));
  return out;
}
