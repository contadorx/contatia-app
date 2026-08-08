// ============================================================
// HORÁRIO COMERCIAL DA FILA — "quando", ao lado do "quantos"
//
// O limite por hora diz quantas mensagens cabem; esta janela diz em que horas elas
// podem sair. São freios diferentes e ambos são reais: prospecção que chega às 3h de
// um domingo é lida como robô pelo destinatário ANTES de ser lida pelo filtro dele.
//
// REGRA DE ESCOPO (a parte que costuma confundir): a janela vale para a FILA — o
// "Enviar todos", que decide sozinho o que sai e em que ordem. O botão de enviar UMA
// tarefa, e o "enviar marcadas", continuam saindo na hora do clique: ali quem escolheu
// foi uma pessoa. A tela avisa que está fora do horário; não recusa.
//
// FUSO: Brasília fixo em UTC-3, a mesma convenção do resto do app (o servidor da Vercel
// roda em UTC; sem o deslocamento, "18h" viraria 15h e a fila pararia no meio da tarde).
// O Brasil não tem horário de verão desde 2019 — se voltar, é AQUI que muda, num lugar
// só.
// ============================================================

const BRT_OFFSET_H = 3;
const BRT_OFFSET_MS = BRT_OFFSET_H * 3600_000;

export type JanelaEnvio = {
  ligado: boolean;
  inicio: number;    // hora local de Brasília em que a fila pode começar (8 = 08:00)
  fim: number;       // hora local em que a fila para (18 = 17:59 ainda envia)
  dias: number[];    // 0=dom … 6=sáb
};

const PADRAO: JanelaEnvio = { ligado: false, inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] };

// Lê a janela da linha de `tenants`. Tolera a 0114 não aplicada (colunas ausentes vêm
// `undefined`) — nesse caso a janela fica desligada e nada muda no envio.
export function janelaDoTenant(t: any): JanelaEnvio {
  if (!t) return { ...PADRAO };
  const dias = String(t.envio_dias ?? "1,2,3,4,5")
    .split(",")
    .map((d: string) => Number(d.trim()))
    .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
  const inicio = Number.isFinite(Number(t.envio_hora_inicio)) ? Number(t.envio_hora_inicio) : 8;
  const fim = Number.isFinite(Number(t.envio_hora_fim)) ? Number(t.envio_hora_fim) : 18;
  return {
    ligado: !!t.envio_horario_on,
    inicio: Math.min(23, Math.max(0, inicio)),
    fim: Math.min(24, Math.max(1, fim)),
    dias: dias.length ? dias : [1, 2, 3, 4, 5],
  };
}

/** Relógio de parede de Brasília para um instante qualquer. */
export function partesBRT(d: Date = new Date()) {
  const b = new Date(d.getTime() - BRT_OFFSET_MS);
  return {
    ano: b.getUTCFullYear(),
    mes: b.getUTCMonth(),
    dia: b.getUTCDate(),
    dow: b.getUTCDay(),
    hora: b.getUTCHours(),
    min: b.getUTCMinutes(),
  };
}

/** Instante UTC correspondente a uma hora cheia local de Brasília. */
function instanteBRT(ano: number, mes: number, dia: number, hora: number): Date {
  return new Date(Date.UTC(ano, mes, dia, hora, 0, 0) + BRT_OFFSET_MS);
}

export function dentroDaJanela(j: JanelaEnvio, quando: Date = new Date()): boolean {
  if (!j.ligado) return true;                 // desligada = sempre pode
  const p = partesBRT(quando);
  if (!j.dias.includes(p.dow)) return false;
  return p.hora >= j.inicio && p.hora < j.fim;
}

/**
 * Quando a janela abre de novo. `null` quando já está aberta (ou desligada) — assim o
 * chamador nunca precisa perguntar duas coisas.
 *
 * Procura em até 9 dias: cobre feriado prolongado + uma janela configurada só para um
 * dia da semana. Sem teto, um `dias` vazio viraria laço infinito — e `dias` vazio já é
 * impossível pela leitura acima, mas laço infinito em produção não se defende com "é
 * impossível".
 */
export function proximaAbertura(j: JanelaEnvio, quando: Date = new Date()): Date | null {
  if (dentroDaJanela(j, quando)) return null;
  const p = partesBRT(quando);
  for (let off = 0; off <= 9; off++) {
    // dia candidato, em relógio de Brasília
    const base = new Date(Date.UTC(p.ano, p.mes, p.dia + off));
    const dow = base.getUTCDay();
    if (!j.dias.includes(dow)) continue;
    const abre = instanteBRT(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), j.inicio);
    if (abre.getTime() > quando.getTime()) return abre;
  }
  return null;
}

/** Quando a janela de HOJE fecha (para projetar quanto ainda cabe). null se fora dela. */
export function fechamentoDeHoje(j: JanelaEnvio, quando: Date = new Date()): Date | null {
  if (!j.ligado) return null;
  if (!dentroDaJanela(j, quando)) return null;
  const p = partesBRT(quando);
  return instanteBRT(p.ano, p.mes, p.dia, j.fim);
}

const NOMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function rotuloJanela(j: JanelaEnvio): string {
  const dias = [...j.dias].sort((a, b) => a - b);
  const seq = dias.length > 1 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const quais = !dias.length
    ? "nenhum dia"
    : seq && dias.length > 2
      ? `${NOMES[dias[0]]} a ${NOMES[dias[dias.length - 1]]}`
      : dias.map((d) => NOMES[d]).join(", ");
  return `${quais}, das ${j.inicio}h às ${j.fim}h`;
}

/** "hoje às 14:00" / "amanhã às 08:00" / "seg 08:00" — para dizer QUANDO volta. */
export function quandoTexto(d: Date, agora: Date = new Date()): string {
  const a = partesBRT(agora);
  const p = partesBRT(d);
  const hh = `${String(p.hora).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
  const diasDeDiferenca = Math.round(
    (Date.UTC(p.ano, p.mes, p.dia) - Date.UTC(a.ano, a.mes, a.dia)) / 86400000
  );
  if (diasDeDiferenca === 0) return `hoje às ${hh}`;
  if (diasDeDiferenca === 1) return `amanhã às ${hh}`;
  return `${NOMES[p.dow]} ${String(p.dia).padStart(2, "0")}/${String(p.mes + 1).padStart(2, "0")} às ${hh}`;
}
