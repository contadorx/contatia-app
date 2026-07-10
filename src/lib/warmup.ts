// Rampa de warm-up: caixas novas não devem disparar o volume cheio no dia 1.
// O limite efetivo cresce a cada dia desde a criação da caixa até atingir o daily_cap alvo.
// Sem infra externa — apenas calcula quantos e-mails a caixa pode mandar HOJE.

// Curva conservadora (e-mails/dia) por dia de vida da caixa. Índice = dias desde a criação.
// Depois do último passo, usa o daily_cap configurado.
const RAMP = [10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 125, 150, 175, 200];

export function effectiveDailyCap(createdAt: string | Date | null | undefined, targetCap: number, warmupEnabled = true): { cap: number; warming: boolean; dayIndex: number } {
  const target = Number(targetCap) || 40;
  if (!warmupEnabled || !createdAt) return { cap: target, warming: false, dayIndex: -1 };

  const created = new Date(createdAt);
  const days = Math.floor((Date.now() - created.getTime()) / 86400000); // dias completos desde a criação
  if (days < 0) return { cap: RAMP[0], warming: true, dayIndex: 0 };

  if (days >= RAMP.length) return { cap: target, warming: false, dayIndex: days };

  // durante a rampa, o limite é o MENOR entre o passo da curva e o alvo configurado
  const rampCap = Math.min(RAMP[days], target);
  const warming = rampCap < target;
  return { cap: rampCap, warming, dayIndex: days };
}
