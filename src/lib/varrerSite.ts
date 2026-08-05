import "server-only";

// ============================================================
// UMA LEITURA DO SITE, TODOS OS DADOS
//
// O app tinha TRÊS varreduras do mesmo site, cada uma abrindo as próprias páginas:
//
//   webSocial  7 caminhos   ""  /contato /contact /fale-conosco /faleconosco /sobre /quem-somos
//   webPhone   5 caminhos   ""  /contato /contact /fale-conosco /faleconosco
//   webEmail   7 caminhos × 2 esquemas (https e http)
//
// Até 26 requisições ao mesmo servidor para responder três perguntas sobre o mesmo
// HTML. Isso é lento e deselegante, mas o desperdício não é o pior.
//
// O PIOR É QUE AS LISTAS SÃO DIFERENTES. O WhatsApp publicado em /sobre ou
// /quem-somos NUNCA seria achado — a varredura de telefone não visita essas páginas.
// A varredura de redes visita, lê o HTML inteiro, encontra o botão do WhatsApp ali
// dentro e joga fora, porque procura outra coisa. Um dado que o app tinha em mãos e
// descartava por causa de qual função estava rodando.
//
// Aqui a página é baixada UMA vez e passa por todos os extratores. Quem lê /sobre
// atrás do Instagram acha o WhatsApp de graça — mesmo HTML, mesma requisição.
//
// A ORDEM DOS CAMINHOS É POR PROBABILIDADE, não alfabética: home e /contato primeiro,
// porque é onde o dado está na maioria dos sites, e a parada antecipada só acontece
// quando tudo o que foi pedido já foi encontrado.
// ============================================================

import { extractWhatsApp, extractPhones } from "@/lib/webPhone";
import { extractEmails, rank } from "@/lib/webEmail";
import { extrairInstagram, extrairLinkedin, extrairFacebook } from "@/lib/webSocial";

// União das três listas, da mais provável para a menos.
const CAMINHOS = [
  "", "/contato", "/contact", "/fale-conosco", "/faleconosco",
  "/sobre", "/quem-somos", "/contato.html",
];

export type CampoSite = "instagram" | "linkedin" | "facebook" | "email" | "telefone" | "whatsapp";

export type AchadosSite = {
  instagram: string | null;
  linkedin: string | null;
  facebook: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  /** de qual URL veio cada achado — a ficha mostra "encontrado em …" */
  fonte: Partial<Record<CampoSite, string>>;
  paginasLidas: number;
  paginasTentadas: number;
  /** true quando nenhuma página abriu: "não achei" e "não consegui entrar" são coisas
   *  diferentes, e confundir as duas já nos custou rodadas atrás de regex quando o
   *  problema era o download. */
  siteInacessivel: boolean;
};

async function baixar(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        // Agente de navegador comum: "ContatiaBot" é convite para WAF bloquear.
        // Não é disfarce — continuamos só lendo a página pública, sem executar nada.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    // 3 MB: página em Elementor/WordPress passa de 500 KB só de CSS embutido no
    // <head>, e o botão de WhatsApp costuma vir depois. Cortar antes disso era cortar
    // exatamente o que se procura.
    return (await res.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

export async function varrerSite(
  dominio: string,
  opts?: { quero?: CampoSite[] }
): Promise<AchadosSite> {
  const base = (dominio || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
  const vazio: AchadosSite = {
    instagram: null, linkedin: null, facebook: null, email: null, telefone: null, whatsapp: null,
    fonte: {}, paginasLidas: 0, paginasTentadas: 0, siteInacessivel: true,
  };
  if (!base) return vazio;

  const quero = new Set<CampoSite>(opts?.quero?.length ? opts.quero : ["instagram", "linkedin", "facebook", "email", "telefone", "whatsapp"]);

  const achados: AchadosSite = { ...vazio, fonte: {}, paginasTentadas: CAMINHOS.length };
  const emails = new Set<string>();
  const telefones = new Set<string>();

  const guardar = (campo: CampoSite, valor: string | null, url: string) => {
    if (!valor || achados[campo]) return;
    (achados as any)[campo] = valor;
    achados.fonte[campo] = url;
  };

  for (const caminho of CAMINHOS) {
    // Só https. O http foi retirado de propósito: dobrava as requisições para cobrir
    // um caso que praticamente não existe mais, e o `redirect: "follow"` já resolve
    // site que só responde em http e redireciona.
    const url = `https://${base}${caminho}`;
    const html = await baixar(url);
    if (!html) continue;
    achados.paginasLidas++;
    achados.siteInacessivel = false;

    // ===== todos os extratores no MESMO html =====
    if (quero.has("whatsapp") && !achados.whatsapp) {
      const was = extractWhatsApp(html);
      if (was.length) {
        guardar("whatsapp", was[0], url);
        // wa.me é WhatsApp CONFIRMADO: serve de telefone também, e é melhor que
        // qualquer número solto em texto.
        guardar("telefone", was[0], url);
      }
    }
    if (quero.has("telefone")) for (const p of extractPhones(html)) telefones.add(p);
    if (quero.has("email")) for (const e of extractEmails(html, base)) emails.add(e);
    if (quero.has("instagram")) guardar("instagram", extrairInstagram(html), url);
    if (quero.has("linkedin")) guardar("linkedin", extrairLinkedin(html), url);
    if (quero.has("facebook")) guardar("facebook", extrairFacebook(html), url);

    // Parada antecipada só quando TUDO o que foi pedido já foi achado. A versão
    // antiga parava assim que a home tinha um telefone qualquer em texto — e um fixo
    // no cabeçalho, que quase toda página tem, encerrava a busca antes de /contato,
    // que é onde mora o botão de WhatsApp.
    const faltaAlgo = Array.from(quero).some((c) => {
      if (c === "email") return !emails.size;
      if (c === "telefone") return !achados.whatsapp && !telefones.size;
      return !achados[c];
    });
    if (!faltaAlgo) break;
  }

  if (!achados.email && emails.size) {
    const melhor = rank(Array.from(emails));
    if (melhor) guardar("email", melhor, achados.fonte.email || `https://${base}`);
  }
  if (!achados.telefone && telefones.size) {
    guardar("telefone", Array.from(telefones)[0], `https://${base}`);
  }

  return achados;
}
