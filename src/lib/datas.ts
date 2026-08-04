// ============================================================
// TODA DATA E HORA DO APP, NO FUSO DE BRASÍLIA
//
// O PROBLEMA: o app roda na Vercel, e a Vercel roda em UTC. `toLocaleString("pt-BR")`
// sem fuso usa o relógio de QUEM FORMATA. No servidor isso é UTC — três horas à
// frente. Um e-mail respondido às 14h aparecia como 17h; a hora de uma reunião saía
// errada no aviso; o rodapé de erro registrava um horário que nunca existiu.
//
// Pior que estar errado: estava errado SÓ ÀS VEZES. O mesmo componente formatando no
// navegador (fuso do Leandro) mostrava certo, e formatando no servidor mostrava
// errado. Dois resultados diferentes para o mesmo código — o tipo de bug que a gente
// "conserta" olhando a tela e volta na semana seguinte.
//
// A REGRA: ninguém chama toLocale* de data direto. Chama daqui, e aqui o fuso é fixo.
//
// ATENÇÃO À DIFERENÇA ENTRE AS DUAS FAMÍLIAS — ela não é estética:
//
//   INSTANTE (coluna timestamptz: created_at, datetime, sent_at)
//     É um ponto no tempo. Converter para Brasília é EXATAMENTE o que se quer.
//     → dataHora / dataCurta / hora / dataHoraCompacta / dataExtensa
//
//   DIA (coluna date: due_date, expires_at, current_period_end — "2026-08-10")
//     Não é um ponto no tempo, é um dia do calendário. `new Date("2026-08-10")` vira
//     meia-noite UTC; convertido para Brasília isso é 21h do dia 09 — e o vencimento
//     aparece UM DIA ANTES. Por isso o dia NÃO passa por fuso nenhum: é só reordenar
//     os números da string.
//     → dataDoDia
//
// E `diaISO` responde "que dia é hoje NO BRASIL". Entre 21h e meia-noite, o UTC já
// virou o dia seguinte: era isso que fazia a fila de hoje mostrar tarefa de amanhã e
// a cadência agendar um passo um dia adiante.
// ============================================================

export const FUSO = "America/Sao_Paulo";

type Entrada = string | number | Date | null | undefined;

function comoData(v: Entrada): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- INSTANTES ----------

/** 04/08/2026, 13:10 */
export function dataHora(v: Entrada, vazio = "—"): string {
  const d = comoData(v);
  return d ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO }) : vazio;
}

/** 04/08/2026 */
export function dataCurta(v: Entrada, vazio = "—"): string {
  const d = comoData(v);
  return d ? d.toLocaleDateString("pt-BR", { timeZone: FUSO }) : vazio;
}

/** 13:10 */
export function hora(v: Entrada, vazio = "—"): string {
  const d = comoData(v);
  return d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO }) : vazio;
}

/** 04/08, 13:10 — para listas apertadas, onde o ano não acrescenta nada */
export function dataHoraCompacta(v: Entrada, vazio = "—"): string {
  const d = comoData(v);
  return d
    ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO })
    : vazio;
}

/** terça-feira, 4 de agosto de 2026 às 13:10 */
export function dataExtensa(v: Entrada, vazio = "—"): string {
  const d = comoData(v);
  return d ? d.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short", timeZone: FUSO }) : vazio;
}

/** terça-feira, 04 de ago — cabeçalho de agrupamento por dia */
export function diaSemanaCurto(v: Entrada, vazio = "—"): string {
  const d = comoData(v);
  return d ? d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short", timeZone: FUSO }) : vazio;
}

/**
 * O dia do calendário NO BRASIL, em AAAA-MM-DD. É o substituto de
 * `new Date().toISOString().slice(0, 10)`, que devolve o dia em UTC.
 * en-CA é o truque: é o único locale comum cujo formato curto já é AAAA-MM-DD.
 */
export function diaISO(v: Entrada = new Date()): string {
  const d = comoData(v);
  return (d || new Date()).toLocaleDateString("en-CA", { timeZone: FUSO });
}

/** o dia de hoje no Brasil, deslocado de N dias (N pode ser negativo) */
export function diaISOmais(dias: number, base: Entrada = new Date()): string {
  const d = comoData(base) || new Date();
  return diaISO(new Date(d.getTime() + dias * 86400000));
}

// ---------- DIAS DE CALENDÁRIO ----------

/**
 * Formata uma coluna `date` ("2026-08-10") como 10/08/2026 SEM passar por fuso.
 * Se vier um timestamp completo, cai no caminho de instante — aí converter é o certo.
 */
export function dataDoDia(v: Entrada, vazio = "—"): string {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return dataCurta(v, vazio);
}
