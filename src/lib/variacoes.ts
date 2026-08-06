// ============================================================
// VÁRIAS MENSAGENS PARA O MESMO PASSO
//
// WhatsApp e Instagram olham repetição: cinquenta contas recebendo o texto idêntico,
// na mesma janela, saído do mesmo número, é o padrão que os dois sistemas usam para
// separar conversa de disparo. Não é teoria de conversão — é o que decide se a conta
// continua de pé.
//
// A cadência passa a guardar N redações para o MESMO passo, e cada inscrição leva uma.
// O cronograma não muda: continua sendo "passo 1 no dia 0, passo 2 no dia 3"; o que
// varia é a redação que cada contato recebe.
//
// A ESCOLHA É DETERMINÍSTICA, e isso importa por dois motivos:
//   · reinscrever o mesmo contato não troca o texto no meio do caminho;
//   · duas execuções do mesmo lote produzem a mesma distribuição, então dá para
//     conferir o que foi enviado sem depender de sorte.
// O hash do id do contato espalha bem o suficiente — contatos vizinhos na lista caem
// em variações diferentes, que é justamente o que o motor do WhatsApp observa.
//
// `Math.random()` foi descartado de propósito: com sorteio, duas mensagens seguidas
// podem sair iguais com boa probabilidade, e o problema que isto existe para resolver
// é exatamente a sequência de textos idênticos.
// ============================================================

// Junta a redação principal com as alternativas, jogando fora vazio e repetido.
// A ORDEM é estável (principal primeiro) porque o índice guardado na tarefa aponta
// para esta lista — mudar a ordem depois viraria relatório mentiroso.
export function variacoesDoPasso(bodyTemplate?: string | null, extras?: unknown): string[] {
  const lista: string[] = [];
  const juntar = (v: unknown) => {
    const t = String(v ?? "").trim();
    if (!t) return;
    if (lista.some((x) => x === t)) return;   // texto repetido não é variação
    lista.push(t);
  };
  juntar(bodyTemplate);
  if (Array.isArray(extras)) for (const e of extras) juntar(e);
  return lista;
}

// FNV-1a de 32 bits: pequeno, sem dependência, e distribui bem para o que precisamos.
function hash(chave: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chave.length; i++) {
    h ^= chave.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function escolherVariacao(
  variacoes: string[],
  chave: string
): { texto: string; indice: number } {
  if (!variacoes.length) return { texto: "", indice: 0 };
  if (variacoes.length === 1) return { texto: variacoes[0], indice: 0 };
  const i = hash(String(chave || "")) % variacoes.length;
  return { texto: variacoes[i], indice: i };
}

// Quantas redações diferentes o passo tem — para a tela dizer "3 versões" sem
// reimplementar a limpeza.
export function quantasVariacoes(bodyTemplate?: string | null, extras?: unknown): number {
  return variacoesDoPasso(bodyTemplate, extras).length;
}
