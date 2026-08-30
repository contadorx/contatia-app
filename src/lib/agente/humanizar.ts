// ============================================================
// FAZER PARECER GENTE — e por que isso não é enfeite
//
// Um número que responde em 2 segundos, sempre, com um parágrafo perfeito, é a coisa
// mais fácil de identificar num WhatsApp. Quem identifica não é só o lead: é a própria
// plataforma, e o preço de ser identificado é o número.
//
// Três medidas, nesta ordem de importância:
//   1. ESPERAR antes de responder — proporcional ao tamanho do que vai escrever;
//   2. QUEBRAR em 2-3 balões — é assim que gente escreve no WhatsApp;
//   3. "digitando…" entre os balões, pelo tempo que digitar aquilo levaria.
//
// As funções de cálculo são puras, e é de propósito: o tempo de espera é o tipo de coisa
// que precisa ser conferida sem esperar de verdade.
// ============================================================

/** Velocidade de digitação de uma pessoa comum no celular, em caracteres por segundo. */
const CPS = 12;

/**
 * Quanto esperar antes do primeiro balão.
 *
 * Cresce com o tamanho da resposta (ler a pergunta e pensar leva tempo proporcional) e
 * carrega um sorteio, porque o que denuncia máquina não é a rapidez, é a REGULARIDADE:
 * 45 segundos cravados, sempre, é mais suspeito que 40 segundos uma vez e 90 na outra.
 */
export function esperaAntesDeResponder(
  tamanhoResposta: number,
  cfg: { minS: number; maxS: number },
  sorteio: () => number = Math.random
): number {
  const min = Math.max(0, cfg.minS);
  const max = Math.max(min, cfg.maxS);
  // A resposta longa puxa para o topo da faixa; a curta fica perto do piso.
  const proporcao = Math.min(1, tamanhoResposta / 400);
  const base = min + (max - min) * proporcao;
  // ±25% de sorteio em cima da base, sem sair da faixa configurada.
  const jitter = base * (0.75 + sorteio() * 0.5);
  return Math.round(Math.min(max, Math.max(min, jitter)) * 1000);
}

/** Quanto tempo "digitando…" deve ficar aceso para um balão deste tamanho. */
export function tempoDigitando(texto: string): number {
  const s = (texto || "").length / CPS;
  // Piso de 1,2s (um balão de 3 letras com 0,2s de "digitando" fica pior que nenhum) e
  // teto de 9s (ninguém encara "digitando" por meio minuto sem desconfiar).
  return Math.round(Math.min(9, Math.max(1.2, s)) * 1000);
}

/**
 * Quebra a resposta em 2-3 balões, como gente escreve.
 *
 * A quebra respeita FRASE: cortar no meio de uma frase para caber num balão é pior que
 * não quebrar, porque a primeira metade chega sozinha e não faz sentido. Se o texto tem
 * uma frase só, ele fica inteiro — um balão bom é melhor que dois ruins.
 *
 * A quebra por parágrafo vem primeiro: quando o modelo já separou com linha em branco,
 * ele decidiu onde cortar, e a decisão dele é melhor que a nossa heurística.
 */
export function quebrarEmBaloes(texto: string, maxBaloes = 3): string[] {
  const t = (texto || "").trim();
  if (!t) return [];

  const paragrafos = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragrafos.length > 1) return paragrafos.slice(0, maxBaloes);

  const linhas = t.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (linhas.length > 1) return linhas.slice(0, maxBaloes);

  // Texto curto não se quebra: dois balões de 20 caracteres parecem nervosismo.
  if (t.length <= 140) return [t];

  const frases = t.match(/[^.!?]+[.!?]*\s*/g)?.map((f) => f.trim()).filter(Boolean) || [t];
  if (frases.length < 2) return [t];

  // Distribui as frases em no máximo `maxBaloes` grupos de tamanho parecido.
  const alvo = Math.ceil(t.length / Math.min(maxBaloes, frases.length));
  const baloes: string[] = [];
  let atual = "";
  for (const f of frases) {
    if (atual && (atual + " " + f).length > alvo && baloes.length < maxBaloes - 1) {
      baloes.push(atual.trim());
      atual = f;
    } else {
      atual = atual ? `${atual} ${f}` : f;
    }
  }
  if (atual.trim()) baloes.push(atual.trim());
  return baloes.slice(0, maxBaloes);
}

/** Espera de verdade. Isolada para o motor poder ser testado sem esperar nada. */
export function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
