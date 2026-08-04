import { dataCurta } from "@/lib/datas";

// ============================================================
// LINKS DE 1 CLIQUE — Instagram e LinkedIn
//
// POR QUE ASSISTIDO, e não automático. Levantei em 02/08/2026:
//
//  · A Instagram Messaging API NÃO permite a primeira mensagem. Só dá para responder
//    dentro de 24h a contar de uma interação que o PROSPECT iniciou (DM, comentário,
//    resposta de story). Fora disso a plataforma recusa. A extensão de 7 dias
//    ("human agent") é explicitamente só para humanos — automação com ela é rejeitada.
//  · O LinkedIn não tem API pública de mensagem nem de convite, e detecta automação
//    por comportamento e fingerprint, com restrição de conta.
//
// Ou seja: automatizar esses dois canais não é uma escolha de engenharia, é uma
// violação de plataforma que termina em conta bloqueada. O que o app faz é preparar o
// link e o texto; quem envia é uma pessoa. Risco de plataforma: zero.
//
// Este arquivo NÃO é "server-only": a tela precisa montar o link no clique.
// ============================================================

/** Limpa o que a pessoa colou e devolve só o usuário do Instagram. */
export function handleInstagram(v?: string | null): string {
  return String(v || "").trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/^instagram\.com\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/**
 * Link que abre a conversa no Instagram com o texto já digitado.
 *
 * O `?text=` funciona na maioria das versões do app, mas NÃO em todas — por isso a
 * tela também oferece "copiar texto". Depender só do prefill deixaria a pessoa na
 * frente de uma caixa vazia sem saber o que escrever.
 */
export function linkInstagramDM(handle?: string | null, texto?: string): string | null {
  const h = handleInstagram(handle);
  if (!h) return null;
  const base = `https://ig.me/m/${encodeURIComponent(h)}`;
  return texto && texto.trim() ? `${base}?text=${encodeURIComponent(texto.slice(0, 900))}` : base;
}

/** Perfil público do Instagram (para conferir antes de falar). */
export function linkInstagramPerfil(handle?: string | null): string | null {
  const h = handleInstagram(handle);
  return h ? `https://www.instagram.com/${encodeURIComponent(h)}` : null;
}

/**
 * LinkedIn: só o link do PERFIL.
 *
 * Não existe URL pública que abra uma conversa nova já endereçada — a de "mensagem"
 * exige sessão e o identificador interno do destinatário. Fingir que existe seria pior
 * que não ter: a pessoa clicaria e cairia no lugar errado. Então: abre o perfil, e o
 * texto vai para a área de transferência.
 */
export function linkLinkedin(url?: string | null): string | null {
  const v = String(url || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return /linkedin\.com/i.test(v) ? v : null;
  if (/^(www\.)?linkedin\.com\//i.test(v)) return `https://${v.replace(/^www\./, "")}`;
  // veio só o slug (ex.: "joao-silva") → assume perfil de pessoa
  return `https://www.linkedin.com/in/${encodeURIComponent(v.replace(/^\/+/, ""))}`;
}

export const REDE_LABEL: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

// ============================================================
// OS TRÊS NÍVEIS DE CONFIANÇA — e por que não existe um quarto
//
// WhatsApp e e-mail têm "verificado" porque existe alguém do outro lado respondendo:
// a Evolution pergunta ao WhatsApp se o número tem conta, o SMTP do domínio confirma
// se a caixa existe. Instagram e LinkedIn não têm esse alguém — conferir um perfil
// exigiria buscar a página, e requisição de IP de datacenter (Vercel = AWS, VPS =
// Contabo) é bloqueada de imediato, com teto de ~200/hora e bloqueio de horas que
// atingiria o workspace inteiro.
//
// Então o app não finge verificar. Ele mostra o que sabe de verdade:
//
//   1. ORIGEM     — veio do site da empresa (forte) ou foi digitado (depende de quem).
//   2. DE QUEM    — organização ou pessoa (dá para ler da URL do LinkedIn).
//   3. CONFERIDO  — um humano abriu e confirmou. É o único equivalente a "verificado",
//                   e o único possível: quem verifica é a única parte capaz disso.
// ============================================================

export type NivelRede = {
  nivel: "conferido" | "site" | "manual" | "desconhecido";
  selo: string;
  cor: string;
  titulo: string;
};

export function nivelRede(opts: {
  valor?: string | null;
  origem?: string | null;
  conferidoEm?: string | null;
  rede: "instagram" | "linkedin";
}): NivelRede | null {
  if (!opts.valor) return null;
  const nome = opts.rede === "instagram" ? "Instagram" : "LinkedIn";

  if (opts.conferidoEm) {
    const quando = dataCurta(opts.conferidoEm);
    return {
      nivel: "conferido",
      selo: "conferido ✓",
      cor: "bg-signal/10 text-signal border-signal/30",
      titulo: `Alguém da equipe abriu este ${nome} em ${quando} e confirmou que é o perfil certo. É o mais perto de "verificado" que existe aqui — nenhuma API responde isso.`,
    };
  }
  if (opts.origem === "site") {
    return {
      nivel: "site",
      selo: "do site",
      cor: "bg-brand-soft text-brand-dark border-brand/30",
      titulo: `Capturado do site da empresa — ou seja, é o perfil que ela publica. Costuma ser a conta INSTITUCIONAL, não a pessoal de quem decide: quem lê a mensagem é quem cuida da conta. Abra uma vez e marque "era esse" para virar conferido.`,
    };
  }
  if (opts.origem === "manual") {
    return {
      nivel: "manual",
      selo: "à mão",
      cor: "bg-muted text-subtle border-line",
      titulo: `Digitado por alguém da equipe. Abra uma vez e marque "era esse" para virar conferido.`,
    };
  }
  return {
    nivel: "desconhecido",
    selo: "não conferido",
    cor: "bg-warn/10 text-warn border-warn/30",
    titulo: `Este ${nome} está no cadastro, mas ninguém confirmou que é o perfil certo. O toque pode cair no lugar errado — abra e marque "era esse".`,
  };
}

/** Organização ou pessoa? Dá para ler da URL do LinkedIn; do Instagram não dá. */
export function tipoLinkedin(url?: string | null): "empresa" | "pessoa" | null {
  const v = String(url || "");
  if (!v) return null;
  if (/linkedin\.com\/(company|school)\//i.test(v)) return "empresa";
  if (/linkedin\.com\/(in|pub)\//i.test(v)) return "pessoa";
  return null;
}
