import "server-only";
import { promises as dns } from "dns";

// Checa os registros de autenticação de e-mail de um domínio (grátis, via DNS).
// SPF, DMARC e MX são consultáveis diretamente. DKIM depende do "selector" do provedor
// (ex.: Brevo usa brevo1/brevo2), então checamos os selectors conhecidos.

export type DomainHealth = {
  domain: string;
  mx: { ok: boolean; records: string[] };
  spf: { ok: boolean; value?: string; includesBrevo?: boolean };
  dmarc: { ok: boolean; value?: string; policy?: string };
  dkim: { ok: boolean; foundSelectors: string[] };
  score: number; // 0-4
};

const DKIM_SELECTORS = ["brevo1", "brevo2", "smtp", "default", "google", "selector1", "selector2", "k1", "mail"];

export async function checkDomainHealth(rawDomain: string): Promise<DomainHealth> {
  const domain = (rawDomain || "").toLowerCase().trim().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  // MX
  let mxRecords: string[] = [];
  try {
    const mx = await dns.resolveMx(domain);
    mxRecords = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  } catch { /* sem MX */ }

  // TXT (SPF + procura genérica)
  let txt: string[] = [];
  try {
    const recs = await dns.resolveTxt(domain);
    txt = recs.map((r) => r.join(""));
  } catch { /* sem TXT */ }
  const spfValue = txt.find((t) => t.toLowerCase().startsWith("v=spf1"));
  const includesBrevo = !!spfValue && /(sendinblue|brevo|spf\.brevo\.com)/i.test(spfValue);

  // DMARC (_dmarc.dominio)
  let dmarcValue: string | undefined;
  try {
    const recs = await dns.resolveTxt(`_dmarc.${domain}`);
    dmarcValue = recs.map((r) => r.join("")).find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  } catch { /* sem DMARC */ }
  const dmarcPolicy = dmarcValue?.match(/p=([a-z]+)/i)?.[1];

  // DKIM: procura selectors conhecidos em selector._domainkey.dominio
  const foundSelectors: string[] = [];
  for (const sel of DKIM_SELECTORS) {
    try {
      const host = `${sel}._domainkey.${domain}`;
      // pode ser CNAME (Brevo) ou TXT
      let hit = false;
      try { const t = await dns.resolveTxt(host); if (t.length) hit = true; } catch {}
      if (!hit) { try { const c = await dns.resolveCname(host); if (c.length) hit = true; } catch {} }
      if (hit) foundSelectors.push(sel);
    } catch { /* selector não existe */ }
  }

  const mxOk = mxRecords.length > 0;
  const spfOk = !!spfValue;
  const dmarcOk = !!dmarcValue;
  const dkimOk = foundSelectors.length > 0;
  const score = [mxOk, spfOk, dmarcOk, dkimOk].filter(Boolean).length;

  return {
    domain,
    mx: { ok: mxOk, records: mxRecords },
    spf: { ok: spfOk, value: spfValue, includesBrevo },
    dmarc: { ok: dmarcOk, value: dmarcValue, policy: dmarcPolicy },
    dkim: { ok: dkimOk, foundSelectors },
    score,
  };
}
