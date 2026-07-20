// Classificador de INTENÇÃO da resposta por palavra-chave (transparente e previsível).
// Ordem de prioridade: parar > adiar > interesse > outro. "parar" sempre vence — é a
// decisão sensível (LGPD/domínio). A decisão final é humana (fila de triagem); isto
// só SUGERE. As listas ficam aqui para serem fáceis de auditar e ajustar.

export type ReplyIntent = "parar" | "adiar" | "interesse" | "outro";

// pedido de saída / opt-out
const PARAR = [
  "parar", "pare", "para de mandar", "pare de mandar", "para com isso",
  "descadastr", "descadastre", "me descadastra", "remover", "me remove", "remove da lista", "tira da lista", "me tira",
  "sair da lista", "nao quero receber", "não quero receber", "nao quero mais", "não quero mais",
  "nao me mande", "não me mande", "nao me manda", "não me manda", "para de me mandar",
  "unsubscribe", "opt out", "cancelar inscri", "sem interesse",
];

// adiamento / "me chama depois"
const ADIAR = [
  "depois", "mais tarde", "agora nao", "agora não", "nao agora", "não agora",
  "mes que vem", "mês que vem", "proximo mes", "próximo mês", "semana que vem", "semana que vir",
  "fechamento", "no fim do mes", "no fim do mês", "fim do mes", "fim do mês",
  "me chama depois", "me procura", "me procure", "outra hora", "outro momento",
  "mais pra frente", "mais para frente", "futuramente", "nao e o momento", "não é o momento",
  "nao e a hora", "não é a hora", "to sem tempo", "tô sem tempo", "estou sem tempo", "sem tempo agora",
  "adiar", "adia", "me lembra", "me lembre",
];

// sinal de interesse
const INTERESSE = [
  "quero", "tenho interesse", "me interessa", "interessad", "me manda", "manda mais", "pode mandar",
  "quero saber", "como funciona", "quanto custa", "qual o valor", "qual valor", "preco", "preço",
  "gostei", "interessante", "vamos", "bora", "quero sim", "me explica", "quero conhecer", "quero ver",
  "faz sentido", "podemos falar", "vamos conversar", "me liga", "pode me ligar", "topo",
];

const norm = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const hitsAny = (t: string, list: string[]) => list.some((k) => t.includes(k));

export function classifyReply(text?: string | null): ReplyIntent {
  const t = norm(text || "");
  if (!t) return "outro";
  if (hitsAny(t, PARAR)) return "parar";
  if (hitsAny(t, ADIAR)) return "adiar";
  if (hitsAny(t, INTERESSE)) return "interesse";
  return "outro";
}

export const INTENT_LABEL: Record<ReplyIntent, string> = {
  parar: "Pediu para parar",
  adiar: "Quer adiar",
  interesse: "Sinal de interesse",
  outro: "Resposta (avaliar)",
};
