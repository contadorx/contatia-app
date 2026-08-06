// ============================================================
// O VEREDITO DO E-MAIL — uma resposta só, usada em todo lugar
//
// A lista mostra embaixo do nome se o endereço serve ("bate com o nome") ou pede
// trabalho ("caixa geral", "outro nome"). Agora dá para FILTRAR por isso. Se o rótulo
// da tela e a peneira do filtro fossem calculados em dois lugares, um dia divergiriam
// e a lista mostraria "bate com o nome" numa linha que o filtro "bate com o nome" não
// traz — o tipo de contradição que faz o operador perder a confiança na ferramenta.
//
// Por isso o julgamento mora aqui, sozinho, e as regras continuam sendo as MESMAS que
// o enriquecimento individual e o em lote usam (@/lib/emailFinder). Este módulo não é
// `server-only` de propósito: a tabela de contatos é componente de cliente.
// ============================================================

import { ehCaixaDeBalcao, pareceEmailDaPessoa } from "@/lib/emailFinder";

export type VereditoEmail = "bate" | "caixa" | "outro" | "sem";

export const VEREDITOS_EMAIL: VereditoEmail[] = ["bate", "caixa", "outro", "sem"];

export function vereditoEmail(email?: string | null, nome?: string | null): VereditoEmail {
  const e = String(email || "").trim();
  if (!e) return "sem";
  if (ehCaixaDeBalcao(e)) return "caixa";
  if (!pareceEmailDaPessoa(e, nome)) return "outro";
  return "bate";
}

export const ROTULO_VEREDITO: Record<VereditoEmail, { curto: string; cls: string; ajuda: string }> = {
  bate: {
    curto: "bate com o nome",
    cls: "text-emerald-700",
    ajuda: "O endereço combina com o nome do contato. Nada a fazer aqui — é só aceitar.",
  },
  caixa: {
    curto: "caixa geral",
    cls: "text-amber-700",
    ajuda: "Endereço compartilhado da empresa (contato@, financeiro@…). Chega em alguém, mas não no decisor — vale procurar o pessoal.",
  },
  outro: {
    curto: "outro nome",
    cls: "text-amber-700",
    ajuda: "O endereço não parece ser desta pessoa. Pode ser de outro sócio ou ter sobrado de um cadastro antigo — confira antes de escrever.",
  },
  sem: {
    curto: "sem e-mail",
    cls: "text-subtle",
    ajuda: "Contato sem endereço de e-mail.",
  },
};
