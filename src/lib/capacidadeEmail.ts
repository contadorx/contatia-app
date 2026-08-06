import "server-only";

// ============================================================
// QUANTO DÁ PARA ENVIAR HOJE — uma conta só, feita num lugar só
//
// "Selecionei 260 e saíram 10." A conta estava certa (o limite do dia era 10 mesmo), a
// resposta é que estava errada: a tela dizia "190 ainda na fila — clique de novo para
// continuar", e clicar de novo não enviava nada. O operador ficava clicando contra um
// teto que ninguém tinha dito qual era, nem por quê.
//
// São TRÊS causas diferentes para o mesmo número pequeno, e elas pedem ações opostas:
//   · aquecimento em curso        → esperar (amanhã sobe sozinho);
//   · `daily_cap` configurado baixo → mudar em Configurações → Canais (1 clique);
//   · só uma caixa conectada       → conectar outra (soma capacidade).
// Sem dizer QUAL delas é, qualquer mensagem vira "tente amanhã" — que é palpite.
//
// Este módulo é a fonte única dessa conta: o envio usa para DECIDIR, e o relatório do
// lote usa para EXPLICAR. Duas contas separadas divergiriam, e aí a tela prometeria uma
// capacidade que o envio não honra.
// ============================================================

import { effectiveDailyCap } from "@/lib/warmup";

export type FolgaCaixa = {
  conta: any;
  email: string;
  cap: number;
  usados: number;
  folga: number;
  motivo: string;
  capAmanha: number | null;
  aquecendo: boolean;
};

export type CapacidadeDia = {
  /** linhas cruas de email_accounts ativas (quem envia precisa delas inteiras) */
  contas: any[];
  usadosPorCaixa: Record<string, number>;
  porCaixa: FolgaCaixa[];
  capTotal: number;
  usados: number;
  folga: number;
  capAmanha: number | null;
  algumaAquecendo: boolean;
  /** frase pronta, já no tom de quem responde "por que só saíram 10?" */
  resumo: string;
};

export async function capacidadeDeHoje(supabase: any): Promise<CapacidadeDia> {
  const { data: accts } = await supabase
    .from("email_accounts")
    // `*` de propósito: nomear colunas faria TODO envio quebrar com "column does not
    // exist" no intervalo entre publicar o app e aplicar a migration.
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const contas = ((accts as any[]) || []);

  // meia-noite de Brasília (UTC-3 fixo): o servidor roda em UTC e, sem isto, o "dia" do
  // limite viraria às 21h — a caixa poderia enviar 2× o limite num dia real.
  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const inicioDoDia = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);

  const { data: enviadosHoje } = await supabase
    .from("events")
    .select("email_account_id")
    .eq("type", "email_sent")
    .gte("created_at", inicioDoDia.toISOString());

  const usadosPorCaixa: Record<string, number> = {};
  for (const e of ((enviadosHoje as any[]) || [])) {
    const id = e.email_account_id;
    if (id) usadosPorCaixa[id] = (usadosPorCaixa[id] || 0) + 1;
  }

  const porCaixa: FolgaCaixa[] = contas.map((a) => {
    const aquecimentoLigado = (a.warmup_stage ?? 0) !== -1;
    const r = effectiveDailyCap(a.created_at, a.daily_cap ?? 40, aquecimentoLigado);
    const usados = usadosPorCaixa[a.id] || 0;
    return {
      conta: a,
      email: (a.from_email as string) || "caixa sem endereço",
      cap: r.cap,
      usados,
      folga: Math.max(0, r.cap - usados),
      motivo: r.motivo,
      capAmanha: r.capAmanha,
      aquecendo: r.warming,
    };
  });

  const capTotal = porCaixa.reduce((s, c) => s + c.cap, 0);
  const usados = porCaixa.reduce((s, c) => s + c.usados, 0);
  const folga = porCaixa.reduce((s, c) => s + c.folga, 0);
  const amanha = porCaixa.reduce((s, c) => s + (c.capAmanha ?? c.cap), 0);
  const capAmanha = amanha > capTotal ? amanha : null;

  return {
    contas,
    usadosPorCaixa,
    porCaixa,
    capTotal,
    usados,
    folga,
    capAmanha,
    algumaAquecendo: porCaixa.some((c) => c.aquecendo),
    resumo: montarResumo(porCaixa, capTotal, usados, capAmanha),
  };
}

function montarResumo(porCaixa: FolgaCaixa[], capTotal: number, usados: number, capAmanha: number | null): string {
  if (!porCaixa.length) return "Nenhuma caixa de e-mail conectada — cadastre a sua em Configurações → Canais.";

  // Uma caixa só: dá para dizer o MOTIVO exato, que é o que resolve.
  if (porCaixa.length === 1) {
    const c = porCaixa[0];
    // o `motivo` do aquecimento já diz "amanhã sobe para X" — repetir a frase logo em
    // seguida deixa a mensagem com cara de texto montado por máquina
    const jaFalouDeAmanha = /amanhã/i.test(c.motivo);
    return (
      `${c.email} envia ${c.cap} por dia (${c.motivo}) e já usou ${c.usados} hoje.` +
      (capAmanha && !jaFalouDeAmanha ? ` Amanhã sobe para ${capAmanha}.` : "")
    );
  }

  const detalhe = porCaixa.map((c) => `${c.email}: ${c.usados}/${c.cap}`).join(" · ");
  return (
    `Suas ${porCaixa.length} caixas somam ${capTotal} envios por dia e já usaram ${usados} hoje (${detalhe}).` +
    (capAmanha ? ` Amanhã o total sobe para ${capAmanha}.` : "")
  );
}

// O que fazer para enviar mais HOJE — a parte acionável, separada do diagnóstico.
export function comoAumentar(cap: CapacidadeDia): string {
  const configurada = cap.porCaixa.filter((c) => /limite configurado/.test(c.motivo));
  const partes: string[] = [];
  if (configurada.length) {
    partes.push(
      `o limite de ${configurada.map((c) => c.email).join(", ")} está segurando o envio por configuração, não por aquecimento — dá para subir agora em Configurações → Canais`
    );
  }
  if (cap.algumaAquecendo) {
    partes.push("as caixas em aquecimento sobem sozinhas a cada dia (subir na marra é o caminho mais curto para a caixa de spam)");
  }
  partes.push("conectar outra caixa soma capacidade no mesmo dia");
  return partes.join("; ") + ".";
}
