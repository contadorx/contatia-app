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
