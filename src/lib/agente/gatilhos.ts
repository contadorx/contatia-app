// ============================================================
// O QUE O MODELO NEM CHEGA A VER
//
// Três situações em que a resposta certa é conhecida de antemão, e passar pelo modelo só
// acrescenta custo, latência e risco de ele inventar outra coisa:
//
//   1. "sai", "pare", "não quero mais"  → opt-out AGORA
//   2. "quero falar com uma pessoa"     → transfere para humano
//   3. agressão                         → transfere para humano
//
// Um regex barato antes da chamada resolve os três com garantia. E a garantia é o ponto:
// num opt-out, um modelo "quase sempre certo" é um problema legal, não um erro de
// qualidade — a LGPD não aceita 98%.
//
// PROPOSITALMENTE SEM DEPENDÊNCIA E SEM SERVER-ONLY: é lógica pura, e ser testável fora
// do Next é o que permite provar cada frase desta lista.
//
// SOBRE FALSO POSITIVO: cada padrão é ancorado em limite de palavra. "pare" não pode
// casar dentro de "parece", e "sair" não pode casar em "sairia bem" — desinscrever
// alguém que não pediu é tão ruim quanto ignorar quem pediu, só que silencioso.
// ============================================================

export type Gatilho = "opt_out" | "humano" | "agressao";

export type Disparo = { gatilho: Gatilho; motivo: string } | null;

// ---------- normalização ----------
// Sem acento e em minúsculas: o lead escreve "NÃO QUERO MAIS", "nao quero mais" e
// "Não Quero Mais", e as três são a mesma frase.
export function normalizar(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- opt-out ----------
// A lista é curta de propósito. Cada padrão aqui é uma frase que ninguém escreve por
// acaso; ampliar para "não" ou "chega" pegaria conversa legítima ("não entendi",
// "chega a quanto?") e mataria o lead por engano.
const OPT_OUT: RegExp[] = [
  // "nao quero mais" sozinho é despedida; seguido de comparativo é NEGOCIAÇÃO
  // ("não quero mais caro que isso, mas topo conversar"). O lookahead é o que separa
  // desistir de pechinchar — e desinscrever quem está pechinchando mata o lead mais
  // quente que existe, em silêncio.
  /\bnao quero mais\b(?!\s+(caro|cara|barat[oa]|cedo|tarde|que|do que|tempo|prazo|desconto|nada disso))/,
  /\bnao tenho interesse\b/,
  /\bnao me (mande|manda|envie|envia|procure|procura)\b/,
  /\bpar(e|a) de (mandar|enviar|me mandar|me enviar)\b/,
  /\b(me )?(remova|remove|retira|retire|tira|tire)\b.*\b(lista|cadastro|contatos?)\b/,
  /\bdescadastr(ar|e|o)\b/,
  /\bsair da lista\b/,
  /\bnao envi(e|ar) mais\b/,
  /\bme deixa? em paz\b/,
  /\bnao perturbe?\b/,
  /\bcancelar? (o )?(recebimento|contato)\b/,
];

// ---------- pedido de humano ----------
const HUMANO: RegExp[] = [
  /\bfalar com (o |a |uma |um )?(pessoa|humano|atendente|gerente|responsavel|vendedor)\b/,
  /\b(quero|posso|gostaria de) falar com alguem\b/,
  /\b(voce|vc) (e|eh) (um )?(rob(o|oh)|bot|maquina|ia|inteligencia artificial)\b/,
  /\bisso (e|eh) (um )?(rob(o|oh)|bot)\b/,
  /\bme (passa|passe|transfere|transfira) (pra|para) (uma |um )?(pessoa|humano|atendente)\b/,
  /\btem (alguem|alguma pessoa) (ai|a[ií])\b/,
];

// ---------- agressão ----------
// Não é filtro de palavrão: xingamento solto acontece em conversa boa ("que merda de
// sistema o meu, hein"). O que transfere é hostilidade DIRIGIDA — ameaça, ofensa à
// pessoa, ou menção a advogado/processo, que é assunto de gente, nunca de robô.
const AGRESSAO: RegExp[] = [
  /\b(vai (se|te|tomar)|toma no|vsf|vtnc|fdp)\b/,
  /\b(seu|sua) (idiota|imbecil|otari(o|a)|burr(o|a)|lix(o|a)|merda)\b/,
  /\b(processar|processo judicial|advogad(o|a)|procon|justica)\b/,
  /\b(golpe|golpist(a|as)|fraude|estelionat)/,
  /\b(denuncia(r|ndo)?|vou denunciar)\b/,
  /\b(spam|spammer)\b/,
];

function casa(regras: RegExp[], t: string): RegExp | null {
  for (const r of regras) if (r.test(t)) return r;
  return null;
}

/**
 * Olha a mensagem do lead e decide se ela dispensa o modelo.
 *
 * A ORDEM IMPORTA e não é alfabética: opt-out vence tudo. Uma mensagem como "para de
 * mandar isso, seu robô de merda" pede as três coisas ao mesmo tempo — e a única leitura
 * segura é a mais restritiva: ele quer sair. Transferir para um humano alguém que pediu
 * para parar seria responder um pedido de silêncio com mais contato.
 */
export function avaliarGatilhos(texto: string): Disparo {
  const t = normalizar(texto);
  if (!t) return null;

  const o = casa(OPT_OUT, t);
  if (o) return { gatilho: "opt_out", motivo: `pedido explícito de parar (${o.source})` };

  const a = casa(AGRESSAO, t);
  if (a) return { gatilho: "agressao", motivo: `hostilidade dirigida (${a.source})` };

  const h = casa(HUMANO, t);
  if (h) return { gatilho: "humano", motivo: `pediu atendimento humano (${h.source})` };

  return null;
}
