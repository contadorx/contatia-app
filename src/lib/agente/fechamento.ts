import "server-only";
import { diaISO, diaISOmais } from "@/lib/datas";

// ============================================================
// O FECHAMENTO — três travas em série, e a ordem importa
//
// A espec proíbe uma coisa acima de todas: *"o modelo nunca decide preço"*. Fechar venda
// é onde essa proibição encosta em dinheiro de verdade, então são três conferências:
//
//   1. O VALOR bate com a tabela do playbook, dentro do desconto autorizado?
//   2. O VALOR está abaixo de `valor_max_fechar`? Acima disso a regra vira reunião —
//      o agente não fecha contrato grande sozinho.
//   3. Existe uma PROPOSTA na mesa, apresentada e não vencida, e o lead disse sim a ELA?
//
// A terceira é a que quase todo mundo esqueceria, e é a mais importante: sem ela, "sim"
// não tem a que se referir. O agente poderia propor R$ 297, o lead concordar, e a
// cobrança sair de R$ 597 porque o modelo se confundiu na hora de fechar.
//
// POR ISSO A COBRANÇA USA O VALOR DA PROPOSTA GRAVADA, e não o argumento que o modelo
// mandou junto com `fechar_venda`. Se os dois discordam, quem manda é o que o lead leu.
// O argumento do modelo serve só para detectar a discordância — e detectá-la é motivo
// para recusar, não para escolher um dos dois.
// ============================================================

/** Quantos dias uma proposta continua valendo. Um "sim" depois disso é confusão, não aceite. */
export const PROPOSTA_VALE_DIAS = 7;

export type Proposta = {
  plano: string;
  valor: number;
  vencimento: string;   // YYYY-MM-DD
  produto_id?: string | null;
};

/**
 * A recusa de um fechamento. Tipo PRÓPRIO, e não uma união com o caso de sucesso: as
 * funções abaixo devolvem `null` quando está tudo certo, e misturar o sucesso aqui faria
 * o TypeScript exigir uma checagem que o chamador não precisa fazer — e, pior, deixaria
 * `motivo` opcional justamente onde ele é a única coisa que importa.
 */
export type RecusaFechamento = { ok: false; motivo: string; degradaParaReuniao?: boolean };

/** O valor cabe na tabela, no desconto e no teto de alçada? */
export function checarValorFechamento(
  valor: number,
  opts: { precosTabela: number[]; tetoDescontoPct: number; valorMaxFechar: number | null }
): RecusaFechamento | null {
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, motivo: "valor inválido." };

  const tabela = (opts.precosTabela || []).filter((v) => v > 0);
  if (!tabela.length) return { ok: false, motivo: "não há tabela de preços publicada; você não pode fechar nada." };

  const teto = Math.min(100, Math.max(0, Number(opts.tetoDescontoPct) || 0));
  const cabeNaTabela = tabela.some((p) => valor <= p + 0.01 && valor >= p * (1 - teto / 100) - 0.01);
  if (!cabeNaTabela) {
    return {
      ok: false,
      motivo:
        teto > 0
          ? `R$ ${valor} não está na tabela nem no desconto autorizado (até ${teto}%). Tabela: ${tabela.join(", ")}.`
          : `R$ ${valor} não está na tabela e não há desconto autorizado. Tabela: ${tabela.join(", ")}.`,
    };
  }

  // ALÇADA. Repare que não é "recusa": é DEGRADAÇÃO para reunião, como a espec pede.
  // Um lead disposto a assinar um contrato grande não pode ouvir "não posso" — ele
  // precisa ouvir "vou te colocar com alguém do time", que é a verdade.
  const max = opts.valorMaxFechar;
  if (max === null || max === undefined) {
    return { ok: false, motivo: "não há valor máximo de fechamento configurado; você não fecha sozinho. Agende uma reunião.", degradaParaReuniao: true };
  }
  if (valor > Number(max)) {
    return {
      ok: false,
      motivo: `R$ ${valor} passa da sua alçada (máximo R$ ${max}). Não feche: agende uma reunião com o time.`,
      degradaParaReuniao: true,
    };
  }
  return null; // null = passou nas conferências de valor
}

/** O vencimento proposto faz sentido? */
export function checarVencimento(vencimento: string, agora: Date): { ok: boolean; motivo?: string; dia?: string } {
  const dia = String(vencimento || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { ok: false, motivo: "vencimento precisa ser uma data AAAA-MM-DD." };
  const hoje = diaISO(agora);
  if (dia < hoje) return { ok: false, motivo: "o vencimento já passou." };
  // Mais de 60 dias não é vencimento, é promessa vaga — e uma cobrança que só aparece
  // daqui a dois meses é esquecida pelos dois lados.
  if (dia > diaISOmais(60, agora)) return { ok: false, motivo: "vencimento muito distante; use algo nos próximos 60 dias." };
  return { ok: true, dia };
}

/** A proposta na mesa ainda vale? */
export function propostaValida(
  pendente: any,
  propostaEm: string | null,
  agora: Date
): { ok: boolean; motivo?: string; proposta?: Proposta } {
  if (!pendente || typeof pendente !== "object") {
    return { ok: false, motivo: "não há proposta na mesa. Use propor_fechamento primeiro e espere o lead confirmar." };
  }
  const p: Proposta = {
    plano: String(pendente.plano ?? ""),
    valor: Number(pendente.valor) || 0,
    vencimento: String(pendente.vencimento ?? ""),
    produto_id: pendente.produto_id ?? null,
  };
  if (!p.plano || !p.valor) return { ok: false, motivo: "a proposta gravada está incompleta. Proponha de novo." };

  if (propostaEm) {
    const idade = agora.getTime() - new Date(propostaEm).getTime();
    if (idade > PROPOSTA_VALE_DIAS * 86400_000) {
      return {
        ok: false,
        motivo: `a proposta tem mais de ${PROPOSTA_VALE_DIAS} dias e venceu. Apresente o resumo de novo antes de fechar.`,
      };
    }
  }
  return { ok: true, proposta: p };
}

// ---------- o "sim" ----------
//
// Não é análise de sentimento e não passa por modelo: é uma lista de formas de dizer sim
// em português. Se a confirmação fosse julgada pelo modelo, a mesma frase ambígua
// poderia virar cobrança num dia e não no outro — e a diferença entre "acho que sim" e
// "fechado" é dinheiro saindo da conta de alguém.
//
// A lista é DELIBERADAMENTE curta e exigente. Na dúvida, o agente pergunta de novo;
// perguntar duas vezes custa uma mensagem, cobrar errado custa a relação.
const SIM: RegExp[] = [
  /\b(fechado|fechou|fecha|combinado|topo|top)\b/,
  /\bpode (ser|mandar|gerar|emitir|fazer)\b/,
  /\b(sim|isso|exato|exatamente|perfeito|beleza|blz|ok|okay)\b/,
  /\b(quero|aceito|concordo|confirmo|confirmado)\b/,
  /\bvamos (nessa|fechar|em frente)\b/,
  /\bmanda (o|a) (boleto|link|cobran[çc]a|pix)\b/,
];

const NAO: RegExp[] = [
  /\bnao\b/,
  /\bainda nao\b/,
  /\bdepois\b/,
  /\bvou pensar\b/,
  /\bmais caro\b/,
  /\bmuito caro\b/,
  /\btalvez\b/,
  /\bpreciso (ver|conversar|falar|pensar)\b/,
];

export function ehConfirmacao(texto: string): boolean {
  const t = (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!t) return false;
  // A NEGATIVA VENCE. "sim, mas vou pensar" e "ok, depois eu vejo" contêm um sim e não
  // são aceites — e é assim que um resumo bom vira cobrança indevida.
  if (NAO.some((r) => r.test(t))) return false;
  return SIM.some((r) => r.test(t));
}

/** Texto do resumo que o lead vai ler. Fechado, sem margem para interpretação. */
export function textoDaProposta(p: Proposta, produtoNome?: string | null): string {
  // \u00A0: o Intl do pt-BR separa "R$" do número com espaço NÃO-SEPARÁVEL. Ele é
  // invisível, some nos logs e atrapalha a quebra de linha no WhatsApp — vira espaço
  // normal antes de a mensagem existir.
  const valor = p.valor
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replace(/\u00a0/g, " ");
  const venc = p.vencimento.split("-").reverse().join("/");
  return [
    "Fechando então:",
    `· ${produtoNome ? `${produtoNome} — ` : ""}${p.plano}`,
    `· ${valor}`,
    `· primeiro vencimento em ${venc}`,
    "",
    "Confirma que posso gerar a cobrança?",
  ].join("\n");
}
