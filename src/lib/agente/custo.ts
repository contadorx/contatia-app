// ============================================================
// QUANTO CUSTOU — em dólar, por modelo
//
// `agent_decisoes` guarda tokens de entrada e saída por turno. Isto os transforma em
// dinheiro, que é a única unidade em que "vale a pena?" tem resposta.
//
// OS PREÇOS SÃO UM RETRATO, NÃO UMA VERDADE PERMANENTE. Conferidos em 30/08/2026 contra
// a tabela vigente da API. Preço de modelo muda, e um número velho aqui vira relatório
// mentiroso — por isso a data está escrita e o relatório a mostra ao lado do valor.
//
// Modelo desconhecido cai no mais caro da lista, de propósito: subestimar custo é o erro
// que faz alguém descobrir a conta no fim do mês.
// ============================================================

export const PRECOS_CONFERIDOS_EM = "30/08/2026";

/** Dólares por milhão de tokens. */
const TABELA: Record<string, { entrada: number; saida: number }> = {
  "claude-haiku-4-5": { entrada: 1, saida: 5 },
  "claude-sonnet-5": { entrada: 2, saida: 10 },
  "claude-opus-5": { entrada: 5, saida: 25 },
};

const MAIS_CARO = { entrada: 5, saida: 25 };

export function custoUsd(modelo: string | null | undefined, tokensIn: number, tokensOut: number): number {
  const p = TABELA[String(modelo || "")] || MAIS_CARO;
  return ((tokensIn || 0) * p.entrada + (tokensOut || 0) * p.saida) / 1_000_000;
}

export function modeloConhecido(modelo: string | null | undefined): boolean {
  return !!TABELA[String(modelo || "")];
}
