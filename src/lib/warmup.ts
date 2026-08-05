// ============================================================
// A RAMPA DE AQUECIMENTO — E POR QUE ELA PARECIA PARADA
//
// Caixa nova não pode disparar volume cheio no dia 1: provedor lê isso como spam. A
// curva abaixo é o limite por dia de vida da caixa.
//
// O DEFEITO QUE ISTO CORRIGE: o "dia" era calculado em blocos de 24 horas contados a
// partir do INSTANTE em que a caixa foi criada — `(agora - criacao) / 86.400.000`.
// Caixa cadastrada às 20h de segunda só passava para o degrau seguinte às 20h de
// terça. Como o contador de enviados zera à MEIA-NOITE de Brasília, existia uma
// janela todo dia em que o contador já tinha zerado e o limite ainda era o de ontem:
// "ontem 10, hoje 10", exatamente o que se vê na tela.
//
// Agora o degrau anda por DIA DE CALENDÁRIO em Brasília, igual ao contador. Os dois
// passam a virar na mesma hora, que é o único jeito de o número da tela bater com a
// experiência de quem envia.
//
// A SEGUNDA RAZÃO para o número não subir não é defeito: se o `daily_cap` da caixa
// está em 10, a rampa nunca ultrapassa 10 — o limite configurado manda. Isso não
// aparecia em lugar nenhum, então a tela dizia 10 e não dizia por quê. `motivo` e
// `capAmanha` existem para a tela responder essa pergunta.
// ============================================================

import { diaISO } from "@/lib/datas";

// Curva conservadora (e-mails/dia) por dia de vida da caixa. Índice = dias desde a criação.
// Depois do último passo, usa o daily_cap configurado.
const RAMP = [10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 125, 150, 175, 200];

/** Dias de calendário (Brasília) entre a criação e hoje. */
function diasDeCalendario(createdAt: string | Date): number {
  const iso = diaISO(createdAt);          // AAAA-MM-DD do dia da criação, em Brasília
  const hoje = diaISO();                  // idem, hoje
  // Meio-dia UTC nos dois: distante o bastante das bordas para nenhum horário de
  // verão histórico mudar a contagem.
  const a = Date.parse(`${iso}T12:00:00Z`);
  const b = Date.parse(`${hoje}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export type CapDoDia = {
  cap: number;
  warming: boolean;
  dayIndex: number;
  /** o limite de amanhã, se a rampa ainda tiver degrau — para a tela poder prometer */
  capAmanha: number | null;
  /** por que o número é este, em uma frase */
  motivo: string;
};

export function effectiveDailyCap(
  createdAt: string | Date | null | undefined,
  targetCap: number,
  warmupEnabled = true
): CapDoDia {
  const target = Number(targetCap) || 40;

  if (!warmupEnabled || !createdAt) {
    return {
      cap: target, warming: false, dayIndex: -1, capAmanha: null,
      motivo: warmupEnabled ? "sem data de criação da caixa — usando o limite configurado" : "aquecimento desligado nesta caixa",
    };
  }

  const dias = Math.max(0, diasDeCalendario(createdAt));

  if (dias >= RAMP.length) {
    return {
      cap: target, warming: false, dayIndex: dias, capAmanha: null,
      motivo: `aquecimento concluído (${RAMP.length} dias) — vale o limite configurado de ${target}/dia`,
    };
  }

  const passo = RAMP[dias];
  const cap = Math.min(passo, target);
  const proximo = dias + 1 < RAMP.length ? Math.min(RAMP[dias + 1], target) : target;

  // O limite configurado é MENOR que o degrau: quem está segurando é a configuração,
  // não o aquecimento. Sem dizer isso, a pessoa espera um aumento que nunca vem.
  if (passo > target) {
    return {
      cap: target, warming: false, dayIndex: dias, capAmanha: null,
      motivo: `o aquecimento já liberaria ${passo}/dia, mas o limite configurado desta caixa é ${target}/dia`,
    };
  }

  return {
    cap,
    warming: cap < target,
    dayIndex: dias,
    capAmanha: proximo > cap ? proximo : null,
    motivo: `aquecimento, dia ${dias + 1} de ${RAMP.length}${proximo > cap ? ` — amanhã sobe para ${proximo}` : ""}`,
  };
}
