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

import { extractWhatsApp, extractPhones, ehFixoBr } from "@/lib/webPhone";
import { extractEmails, rank } from "@/lib/webEmail";
import { extrairInstagram, extrairLinkedin, extrairFacebook } from "@/lib/webSocial";
import { baixarPagina } from "@/lib/baixarPagina";

// União das três listas, da mais provável para a menos. Continuam existindo porque
// acertam na maioria dos sites e não custam nada quando acertam.
const CAMINHOS = [
  "", "/contato", "/contact", "/fale-conosco", "/faleconosco",
  "/sobre", "/quem-somos", "/contato.html",
];

// ============================================================
// ADIVINHAR CAMINHO NÃO ESCALA — O SITE JÁ DIZ ONDE FICA
//
// Caso real: a fiscoimbra publica a página de contato em `/site/contato/`. Nenhum
// palpite da lista acima chega lá, então a varredura lia só a home, não achava o
// botão de WhatsApp e concluía "o site não publica". De novo o mesmo erro de leitura:
// "não achei" quando o certo era "não fui lá".
//
// Dá para continuar empilhando palpites (/site/contato, /pt/contato,
// /institucional/contato, /contato-2…) e ficar sempre um site atrás. Ou ler o MENU da
// home, que é onde o próprio site diz onde as coisas estão. É o que esta parte faz.
//
// Só links do MESMO host, e no máximo alguns — o objetivo é achar a página de
// contato, não varrer o site inteiro.
// ============================================================
const PISTA_CONTATO = /(contato|contact|fale[-\s_]?conosco|faleconosco|atendimento|onde[-\s_]?estamos|localiza)/i;
const PISTA_SOBRE = /(sobre|quem[-\s_]?somos|institucional|a[-\s_]empresa|nossa[-\s_]historia)/i;
const IGNORAR = /\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4|webp)(\?|$)|^mailto:|^tel:|^javascript:|^#/i;

function linksInternos(html: string, host: string): { url: string; peso: number }[] {
  const achados = new Map<string, number>();
  // captura href + o texto do link, porque muito menu usa href="/p/12" com o texto
  // "Contato" — só o endereço não entregaria.
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const href = (m[1] || "").trim();
    const texto = (m[2] || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || IGNORAR.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, `https://${host}/`);
    } catch { continue; }
    // só o mesmo site (com ou sem www) — não seguimos para fora
    const mesmo = u.hostname.replace(/^www\./, "") === host.replace(/^www\./, "");
    if (!mesmo || (u.protocol !== "https:" && u.protocol !== "http:")) continue;
    const alvo = `${u.pathname}${u.search}`;
    if (alvo === "/" || alvo === "") continue;
    if (alvo.length > 120) continue;

    const casa = `${alvo} ${texto}`;
    const peso = PISTA_CONTATO.test(casa) ? 2 : PISTA_SOBRE.test(casa) ? 1 : 0;
    if (!peso) continue;
    const jaTem = achados.get(alvo) || 0;
    if (peso > jaTem) achados.set(alvo, peso);
  }
  return Array.from(achados.entries())
    .map(([url, peso]) => ({ url, peso }))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 4);
}

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
  /** o site só respondeu ignorando a cadeia do certificado (ver lib/baixarPagina) */
  tlsFraco: boolean;
  /** o endereço que respondeu — pode ser o com www, quando o sem www não abre */
  hostUsado: string | null;
};

// O download mora em @/lib/baixarPagina: é lá que fica o tratamento de site com
// cadeia de certificado incompleta, que é comum em PME brasileira e fazia a varredura
// voltar vazia dizendo "o site não publica esses dados".

export async function varrerSite(
  dominio: string,
  opts?: { quero?: CampoSite[] }
): Promise<AchadosSite> {
  const base = (dominio || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
  const vazio: AchadosSite = {
    instagram: null, linkedin: null, facebook: null, email: null, telefone: null, whatsapp: null,
    fonte: {}, paginasLidas: 0, paginasTentadas: 0, siteInacessivel: true,
    tlsFraco: false, hostUsado: null,
  };
  if (!base) return vazio;

  const quero = new Set<CampoSite>(opts?.quero?.length ? opts.quero : ["instagram", "linkedin", "facebook", "email", "telefone", "whatsapp"]);

  const achados: AchadosSite = { ...vazio, fonte: {}, paginasTentadas: 0 };
  const emails = new Set<string>();
  const telefones = new Set<string>();

  const guardar = (campo: CampoSite, valor: string | null, url: string) => {
    if (!valor || achados[campo]) return;
    (achados as any)[campo] = valor;
    achados.fonte[campo] = url;
  };

  // ============================================================
  // SEM www E COM www NÃO SÃO O MESMO ENDEREÇO
  //
  // O código normaliza tirando o `www.`, o que é certo para comparar domínios e
  // errado para BUSCAR: existe site cujo certificado só cobre o www, ou cujo host sem
  // www simplesmente não responde. A home decide: se ela não abrir de um jeito,
  // tentamos o outro antes de desistir do site inteiro.
  // ============================================================
  let host = base;
  {
    const home = await baixarPagina(`https://${host}`);
    if (!home) {
      const comWww = await baixarPagina(`https://www.${base}`);
      if (comWww) host = `www.${base}`;
    }
  }

  // A home vem primeiro e é ela que revela o resto do caminho.
  const roteiro: string[] = [""];
  {
    const home = await baixarPagina(`https://${host}`);
    if (home) {
      for (const l of linksInternos(home.html, host)) {
        if (!roteiro.includes(l.url)) roteiro.push(l.url);
      }
    }
  }
  for (const p of CAMINHOS) if (!roteiro.includes(p)) roteiro.push(p);
  achados.paginasTentadas = roteiro.length;

  for (const caminho of roteiro) {
    // Só https. O http foi retirado de propósito: dobrava as requisições para cobrir
    // um caso que praticamente não existe mais, e o `redirect: "follow"` já resolve
    // site que só responde em http e redireciona.
    const url = `https://${host}${caminho}`;
    const pag = await baixarPagina(url);
    if (!pag) continue;
    const html = pag.html;
    if (pag.tlsFraco) achados.tlsFraco = true;
    achados.paginasLidas++;
    achados.siteInacessivel = false;
    achados.hostUsado = host;

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
    if (melhor) guardar("email", melhor, achados.fonte.email || `https://${host}`);
  }
  if (!achados.telefone && telefones.size) {
    // ============================================================
    // ENTRE OS NÚMEROS DA PÁGINA, O CELULAR VALE MAIS
    //
    // A regra era "o primeiro que apareceu" — e o primeiro é quase sempre o fixo do
    // cabeçalho, que existe em toda página. O celular, que é o único que pode ter
    // WhatsApp, ficava para trás mesmo estando publicado na mesma tela. Depois o
    // WhatsApp "não vinha", e a causa parecia ser a captura.
    // ============================================================
    const lista = Array.from(telefones);
    const celular = lista.find((t) => !ehFixoBr(t));
    guardar("telefone", celular || lista[0], `https://${host}`);
  }

  return achados;
}
