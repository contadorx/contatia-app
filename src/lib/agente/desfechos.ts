// ============================================================
// Os desfechos de uma conversa, e como se chamam na tela.
//
// Mora fora de `conversas/actions.ts` porque aquele arquivo é "use server": um módulo
// de server actions só pode exportar funções async, então uma tabela de rótulos ali
// quebra o build. E mora fora do componente porque o servidor também precisa dela.
// ============================================================

export const DESFECHOS = ["reuniao", "venda", "recusa", "silencio", "opt_out"] as const;
export type Desfecho = (typeof DESFECHOS)[number];

export const DESFECHO_LABEL: Record<Desfecho, string> = {
  reuniao: "Reunião marcada",
  venda: "Venda fechada",
  recusa: "Recusou",
  silencio: "Sumiu",
  opt_out: "Pediu para parar",
};

export function ehDesfecho(v: string): v is Desfecho {
  return (DESFECHOS as readonly string[]).includes(v);
}
