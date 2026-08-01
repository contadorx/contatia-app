// Objetivos possíveis de uma cadência. Vive à parte porque três telas precisam da
// MESMA lista: o construtor (para escolher), a lista (para exibir) e o filtro (para
// selecionar). Duas cópias divergiriam no primeiro objetivo novo.
export const OBJETIVOS = [
  { v: "reuniao", l: "Marcar reunião" },
  { v: "venda", l: "Venda direta" },
  { v: "reativacao", l: "Reativar quem esfriou" },
  { v: "nutricao", l: "Nutrir / educar" },
  { v: "evento", l: "Convite para evento" },
  { v: "cobranca", l: "Cobrança / renovação" },
  { v: "outro", l: "Outro" },
] as const;

export const OBJETIVO_LABEL: Record<string, string> = Object.fromEntries(
  OBJETIVOS.map((o) => [o.v, o.l])
);
