import "server-only";

// ============================================================
// MUITO SITE BRASILEIRO DE PME TEM A CADEIA DO CERTIFICADO INCOMPLETA
//
// O caso da JJP Consultoria: o site abre normalmente no navegador, o Instagram está
// lá na página — e a nossa varredura não trazia nada. A causa não estava na extração,
// estava antes dela: `fetch` do Node **verifica TLS** e aborta quando o servidor não
// envia o certificado intermediário. O erro vira `cause.code =
// UNABLE_TO_VERIFY_LEAF_SIGNATURE` (ou DEPTH_ZERO_SELF_SIGNED_CERT, CERT_HAS_EXPIRED…),
// o nosso `catch` devolvia `null`, e a conclusão registrada era "o site não publica
// esses dados" — quando o certo seria "não consegui entrar".
//
// O navegador não reclama porque guarda intermediários de visitas anteriores e sabe
// buscar o que falta (AIA). O Node não faz nem uma coisa nem outra. Por isso o mesmo
// site "funciona para você e não funciona para o app".
//
// A DECISÃO, e ela é de segurança, então fica escrita:
//
//   1. A primeira tentativa é SEMPRE com verificação completa. Nada muda para os
//      sites bem configurados, que são a maioria.
//   2. Só quando o erro é especificamente de CADEIA DE CERTIFICADO é que há uma
//      segunda tentativa, sem verificar. Erro de rede, timeout ou 404 não caem aqui.
//   3. O resultado vem marcado com `tlsFraco`, para a tela poder dizer de onde veio.
//
// Por que isso é aceitável AQUI e não seria em outro lugar: estamos lendo uma página
// pública de marketing e não enviamos nada — sem cookie, sem token, sem credencial. O
// pior caso de um ataque no meio do caminho é nos entregar um telefone errado, que é
// o mesmo risco de o site publicar um telefone errado. Em qualquer requisição que
// carregue segredo, esta função NÃO deve ser usada.
// ============================================================

const CODIGOS_DE_CERTIFICADO = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
]);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CABECALHOS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
};
const TETO_BYTES = 3_000_000;   // Elementor/WordPress passa de 500 KB só de CSS no <head>
const TEMPO_MS = 15_000;

export type PaginaBaixada = { html: string; tlsFraco: boolean };

function ehErroDeCertificado(e: any): boolean {
  const code = e?.cause?.code || e?.code || "";
  if (CODIGOS_DE_CERTIFICADO.has(String(code))) return true;
  const msg = String(e?.cause?.message || e?.message || "");
  return /certificate|self[- ]signed|unable to verify/i.test(msg);
}

/** Segunda tentativa, sem verificar a cadeia. Usa node:https para não depender do undici. */
function baixarSemVerificar(url: string, saltos = 3): Promise<string | null> {
  return new Promise((resolve) => {
    let terminou = false;
    const fim = (v: string | null) => { if (!terminou) { terminou = true; resolve(v); } };
    try {
      const https = require("node:https") as typeof import("node:https");
      const u = new URL(url);
      const req = https.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: "GET",
          headers: CABECALHOS,
          rejectUnauthorized: false,   // ver o comentário do topo: só página pública
          timeout: TEMPO_MS,
        },
        (res) => {
          const status = res.statusCode || 0;
          const local = res.headers.location;
          if (status >= 300 && status < 400 && local && saltos > 0) {
            res.resume();
            const proxima = new URL(local, url).toString();
            baixarSemVerificar(proxima, saltos - 1).then(fim);
            return;
          }
          if (status < 200 || status >= 300) { res.resume(); return fim(null); }
          const ct = String(res.headers["content-type"] || "");
          if (!ct.includes("text/html") && !ct.includes("application/xhtml")) { res.resume(); return fim(null); }
          let corpo = "";
          res.setEncoding("utf8");
          res.on("data", (p) => {
            corpo += p;
            if (corpo.length > TETO_BYTES) { corpo = corpo.slice(0, TETO_BYTES); res.destroy(); }
          });
          res.on("end", () => fim(corpo));
          res.on("error", () => fim(corpo || null));
        }
      );
      req.on("timeout", () => { req.destroy(); fim(null); });
      req.on("error", () => fim(null));
      req.end();
    } catch {
      fim(null);
    }
  });
}

/**
 * Baixa uma página pública. Devolve `null` quando realmente não deu para ler.
 * `tlsFraco` indica que só foi possível ler ignorando a cadeia do certificado.
 */
export async function baixarPagina(url: string): Promise<PaginaBaixada | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TEMPO_MS),
      headers: CABECALHOS,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    return { html: (await res.text()).slice(0, TETO_BYTES), tlsFraco: false };
  } catch (e: any) {
    if (!ehErroDeCertificado(e)) return null;
    const html = await baixarSemVerificar(url);
    return html ? { html, tlsFraco: true } : null;
  }
}
