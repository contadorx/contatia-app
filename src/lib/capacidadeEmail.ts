import "server-only";

// ============================================================
// QUANTO DÁ PARA ENVIAR AGORA — uma conta só, feita num lugar só
//
// "Selecionei 260 e saíram 10." A conta estava certa (o limite do dia era 10 mesmo), a
// resposta é que estava errada: a tela dizia "190 ainda na fila — clique de novo para
// continuar", e clicar de novo não enviava nada. O operador ficava clicando contra um
// teto que ninguém tinha dito qual era, nem por quê.
//
// São QUATRO freios diferentes para o mesmo número pequeno, e eles pedem ações opostas:
//   · aquecimento em curso          → esperar (amanhã sobe sozinho);
//   · `daily_cap` configurado baixo → mudar em Configurações → Canais (1 clique);
//   · `hourly_cap` (0114)           → esperar MINUTOS, não um dia — e a tela diz a hora;
//   · só uma caixa conectada        → conectar outra (soma capacidade).
// Sem dizer QUAL deles é, qualquer mensagem vira "tente amanhã" — que é palpite.
//
// Este módulo é a fonte única dessa conta: o envio usa para DECIDIR, e o relatório do
// lote usa para EXPLICAR. Duas contas separadas divergiriam, e aí a tela prometeria uma
// capacidade que o envio não honra.
//
// ------------------------------------------------------------
// POR QUE O LIMITE POR HORA EXISTE (0114)
//
// Quem hospeda e-mail em cPanel — HostGator, Locaweb, KingHost — não é limitado por dia:
// é limitado por HORA. E estourar esse teto não devolve "limite atingido"; o servidor
// passa a RECUSAR CONEXÃO pela hora inteira. Ou seja, a conta do dia podia estar
// perfeita (80 de 200) e o lote quebrar assim mesmo, porque as 80 saíram em 4 minutos.
//
// A janela é MÓVEL (últimos 60 minutos), não a hora do relógio. Contar por hora cheia
// deixaria passar o dobro na virada: 100 às 14h59 e 100 às 15h01 são 200 em 2 minutos —
// e é exatamente isso que o servidor do provedor está medindo.
// ============================================================

import { effectiveDailyCap } from "@/lib/warmup";
import {
  janelaDoTenant, dentroDaJanela, proximaAbertura, fechamentoDeHoje,
  rotuloJanela, quandoTexto, type JanelaEnvio,
} from "@/lib/janelaEnvio";

const JANELA_HORA_MS = 3600_000;

export type FolgaCaixa = {
  conta: any;
  email: string;
  cap: number;
  usados: number;
  /** folga considerando SÓ o limite do dia */
  folgaDia: number;
  capHora: number | null;
  usadosHora: number;
  /** folga considerando SÓ o limite por hora (null = esta caixa não tem teto por hora) */
  folgaHora: number | null;
  /** a folga que vale: o menor dos dois. É esta que o envio usa. */
  folga: number;
  /** qual freio está segurando ESTA caixa agora */
  freio: "dia" | "hora" | null;
  /** quando o teto por hora desta caixa abre espaço (ISO) */
  liberaHoraEm: string | null;
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
  /** folga EFETIVA agora (dia ∩ hora ∩ teto geral do workspace) */
  folga: number;
  /** folga olhando só o dia — o que ainda sai hoje se você esperar as horas necessárias */
  folgaDia: number;
  capAmanha: number | null;
  algumaAquecendo: boolean;

  // ---- por hora (0114) ----
  capHoraGeral: number | null;
  usadosHora: number;
  folgaHoraGeral: number | null;
  /** true = o que segura AGORA é o teto por hora (e não o do dia) */
  travadoPorHora: boolean;
  /** instante (ISO) em que o teto por hora abre espaço de novo */
  liberaEm: string | null;

  // ---- horário comercial (0114) ----
  janela: JanelaEnvio;
  dentroDoHorario: boolean;
  /** instante (ISO) em que a janela comercial reabre; null se está aberta/desligada */
  abreEm: string | null;

  /** frase pronta, já no tom de quem responde "por que só saíram 10?" */
  resumo: string;
};

/**
 * `tenantId` é OPCIONAL e faz toda a diferença conforme quem chama:
 *   · usuário logado → pode omitir; a RLS já limita tudo ao workspace dele;
 *   · cron (client admin) → OBRIGATÓRIO. Sem ele, `email_accounts` traz as caixas de
 *     TODOS os clientes, e a conta de capacidade — e o rodízio que a usa — passaria a
 *     enxergar caixa de terceiro. Nada daria erro; o e-mail sairia pelo remetente errado.
 */
export async function capacidadeDeHoje(supabase: any, tenantId?: string | null): Promise<CapacidadeDia> {
  let qContas = supabase
    .from("email_accounts")
    // `*` de propósito: nomear colunas faria TODO envio quebrar com "column does not
    // exist" no intervalo entre publicar o app e aplicar a migration.
    .select("*")
    .eq("is_active", true);
  if (tenantId) qContas = qContas.eq("tenant_id", tenantId);
  const { data: accts } = await qContas.order("created_at", { ascending: true });

  const contas = ((accts as any[]) || []);

  // Configuração do workspace: teto por hora + horário comercial. Se a 0114 ainda não
  // foi aplicada, o PostgREST recusa o select inteiro (42703) e `data` vem null — o que
  // é exatamente o comportamento certo aqui: sem as colunas, os freios novos não
  // existem e o envio segue como antes.
  let qTenant = supabase
    .from("tenants")
    .select("hourly_cap, envio_horario_on, envio_hora_inicio, envio_hora_fim, envio_dias");
  if (tenantId) qTenant = qTenant.eq("id", tenantId);
  const { data: tnt } = await qTenant.maybeSingle();
  const capHoraGeral = Number((tnt as any)?.hourly_cap) > 0 ? Number((tnt as any).hourly_cap) : null;
  const janela = janelaDoTenant(tnt);

  // meia-noite de Brasília (UTC-3 fixo): o servidor roda em UTC e, sem isto, o "dia" do
  // limite viraria às 21h — a caixa poderia enviar 2× o limite num dia real.
  const BRT_OFFSET_MS = 3 * 3600000;
  const agora = Date.now();
  const nowBRT = new Date(agora - BRT_OFFSET_MS);
  const inicioDoDia = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const inicioDaHora = new Date(agora - JANELA_HORA_MS);

  // UMA consulta para os dois recortes. Perto da meia-noite a janela de 60 min invade o
  // dia anterior — por isso o `desde` é o MENOR dos dois começos, e não o do dia.
  const desde = new Date(Math.min(inicioDoDia.getTime(), inicioDaHora.getTime()));
  let qEventos = supabase
    .from("events")
    .select("email_account_id, created_at")
    .eq("type", "email_sent")
    .gte("created_at", desde.toISOString());
  // idem: sem o filtro, o cron contaria os envios do sistema inteiro como se fossem
  // deste workspace — e a fila de todo mundo pararia por causa do vizinho.
  if (tenantId) qEventos = qEventos.eq("tenant_id", tenantId);
  const { data: enviadosRecentes } = await qEventos;

  const usadosPorCaixa: Record<string, number> = {};
  const usadosHoraPorCaixa: Record<string, number> = {};
  // carimbos de tempo dentro da janela — é com eles que se calcula QUANDO abre espaço
  const marcasPorCaixa: Record<string, number[]> = {};
  const marcasGerais: number[] = [];

  for (const e of ((enviadosRecentes as any[]) || [])) {
    const id = e.email_account_id as string | null;
    const t = new Date(e.created_at).getTime();
    if (t >= inicioDoDia.getTime() && id) usadosPorCaixa[id] = (usadosPorCaixa[id] || 0) + 1;
    if (t >= inicioDaHora.getTime()) {
      marcasGerais.push(t);
      if (id) {
        usadosHoraPorCaixa[id] = (usadosHoraPorCaixa[id] || 0) + 1;
        (marcasPorCaixa[id] ||= []).push(t);
      }
    }
  }

  // Quando o teto abre espaço para MAIS UM: a contagem cai abaixo do teto quando os
  // envios mais antigos completam 60 minutos. Com `usados` acima do teto em `k`, é o
  // (k+1)-ésimo mais antigo que precisa expirar.
  const liberaQuando = (marcas: number[], teto: number | null): string | null => {
    if (teto == null) return null;
    if (marcas.length < teto) return null;
    const ord = [...marcas].sort((a, b) => a - b);
    const k = marcas.length - teto;             // >= 0
    const alvo = ord[Math.min(k, ord.length - 1)];
    return new Date(alvo + JANELA_HORA_MS).toISOString();
  };

  const porCaixa: FolgaCaixa[] = contas.map((a) => {
    const aquecimentoLigado = (a.warmup_stage ?? 0) !== -1;
    const r = effectiveDailyCap(a.created_at, a.daily_cap ?? 40, aquecimentoLigado);
    const usados = usadosPorCaixa[a.id] || 0;
    const folgaDia = Math.max(0, r.cap - usados);

    const capHora = Number(a.hourly_cap) > 0 ? Number(a.hourly_cap) : null;
    const usadosHora = usadosHoraPorCaixa[a.id] || 0;
    const folgaHora = capHora == null ? null : Math.max(0, capHora - usadosHora);

    const folga = folgaHora == null ? folgaDia : Math.min(folgaDia, folgaHora);
    const freio: "dia" | "hora" | null =
      folga > 0 ? null : (folgaHora != null && folgaHora <= 0 && folgaDia > 0 ? "hora" : "dia");

    return {
      conta: a,
      email: (a.from_email as string) || "caixa sem endereço",
      cap: r.cap,
      usados,
      folgaDia,
      capHora,
      usadosHora,
      folgaHora,
      folga,
      freio,
      liberaHoraEm: liberaQuando(marcasPorCaixa[a.id] || [], capHora),
      motivo: r.motivo,
      capAmanha: r.capAmanha,
      aquecendo: r.warming,
    };
  });

  const capTotal = porCaixa.reduce((s, c) => s + c.cap, 0);
  const usados = porCaixa.reduce((s, c) => s + c.usados, 0);
  const folgaDia = porCaixa.reduce((s, c) => s + c.folgaDia, 0);
  const usadosHora = marcasGerais.length;
  const folgaHoraGeral = capHoraGeral == null ? null : Math.max(0, capHoraGeral - usadosHora);

  const folgaSomada = porCaixa.reduce((s, c) => s + c.folga, 0);
  const folga = folgaHoraGeral == null ? folgaSomada : Math.min(folgaSomada, folgaHoraGeral);

  // O que está segurando AGORA é a hora? Duas formas: o teto geral do workspace estourou,
  // ou todas as caixas que ainda têm dia disponível estão presas na hora delas.
  const geralTravado = folgaHoraGeral != null && folgaHoraGeral <= 0;
  const caixasTravadasNaHora = porCaixa.filter((c) => c.freio === "hora");
  const travadoPorHora = folga <= 0 && (geralTravado || (caixasTravadasNaHora.length > 0 && folgaDia > 0));

  const liberaCandidatos = [
    geralTravado ? liberaQuando(marcasGerais, capHoraGeral) : null,
    ...caixasTravadasNaHora.map((c) => c.liberaHoraEm),
  ].filter(Boolean) as string[];
  // o PRIMEIRO horário em que alguma coisa volta a caber
  const liberaEm = liberaCandidatos.length
    ? liberaCandidatos.sort()[0]
    : null;

  const agoraD = new Date(agora);
  const dentro = dentroDaJanela(janela, agoraD);
  const abre = proximaAbertura(janela, agoraD);

  const amanha = porCaixa.reduce((s, c) => s + (c.capAmanha ?? c.cap), 0);
  const capAmanha = amanha > capTotal ? amanha : null;

  return {
    contas,
    usadosPorCaixa,
    porCaixa,
    capTotal,
    usados,
    folga,
    folgaDia,
    capAmanha,
    algumaAquecendo: porCaixa.some((c) => c.aquecendo),
    capHoraGeral,
    usadosHora,
    folgaHoraGeral,
    travadoPorHora,
    liberaEm,
    janela,
    dentroDoHorario: dentro,
    abreEm: abre ? abre.toISOString() : null,
    resumo: montarResumo(porCaixa, capTotal, usados, capAmanha, capHoraGeral, usadosHora, janela, dentro),
  };
}

function montarResumo(
  porCaixa: FolgaCaixa[],
  capTotal: number,
  usados: number,
  capAmanha: number | null,
  capHoraGeral: number | null,
  usadosHora: number,
  janela: JanelaEnvio,
  dentro: boolean
): string {
  if (!porCaixa.length) return "Nenhuma caixa de e-mail conectada — cadastre a sua em Configurações → Canais.";

  // a parte por hora só entra na frase quando existe teto por hora — senão vira ruído
  const temHora = capHoraGeral != null || porCaixa.some((c) => c.capHora != null);
  const parteHora = temHora
    ? capHoraGeral != null
      ? ` Por hora, o teto do workspace é ${capHoraGeral} e ${usadosHora} saíram nos últimos 60 min.`
      : ` Por hora: ${porCaixa.filter((c) => c.capHora != null).map((c) => `${c.email} ${c.usadosHora}/${c.capHora}`).join(" · ")}.`
    : "";
  const parteJanela = janela.ligado
    ? ` A fila envia ${rotuloJanela(janela)}${dentro ? "" : " — fora desse horário agora"}.`
    : "";

  // Uma caixa só: dá para dizer o MOTIVO exato, que é o que resolve.
  if (porCaixa.length === 1) {
    const c = porCaixa[0];
    // o `motivo` do aquecimento já diz "amanhã sobe para X" — repetir a frase logo em
    // seguida deixa a mensagem com cara de texto montado por máquina
    const jaFalouDeAmanha = /amanhã/i.test(c.motivo);
    return (
      `${c.email} envia ${c.cap} por dia (${c.motivo}) e já usou ${c.usados} hoje.` +
      (capAmanha && !jaFalouDeAmanha ? ` Amanhã sobe para ${capAmanha}.` : "") +
      parteHora + parteJanela
    );
  }

  const detalhe = porCaixa.map((c) => `${c.email}: ${c.usados}/${c.cap}`).join(" · ");
  return (
    `Suas ${porCaixa.length} caixas somam ${capTotal} envios por dia e já usaram ${usados} hoje (${detalhe}).` +
    (capAmanha ? ` Amanhã o total sobe para ${capAmanha}.` : "") +
    parteHora + parteJanela
  );
}

// O que fazer para enviar mais AGORA — a parte acionável, separada do diagnóstico.
export function comoAumentar(cap: CapacidadeDia): string {
  const partes: string[] = [];

  // A ordem importa: primeiro o freio que está atuando AGORA, porque é a resposta que a
  // pessoa foi buscar. Dizer "conecte outra caixa" para quem só precisa esperar 6
  // minutos é mandar resolver o problema errado.
  if (!cap.dentroDoHorario && cap.abreEm) {
    partes.push(
      `a fila está fora do horário comercial (${rotuloJanela(cap.janela)}) e volta ${quandoTexto(new Date(cap.abreEm))} — ` +
      `para mandar agora mesmo, marque os toques e use "enviar marcadas", que ignora a janela`
    );
  }
  if (cap.travadoPorHora && cap.liberaEm) {
    partes.push(
      `o teto por hora${cap.capHoraGeral ? ` (${cap.capHoraGeral}/h)` : ""} está segurando — abre espaço ${quandoTexto(new Date(cap.liberaEm))}, ` +
      `e a fila continua sozinha a partir daí`
    );
  }

  const configurada = cap.porCaixa.filter((c) => /limite configurado/.test(c.motivo));
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

// ============================================================
// A FILA NO TEMPO — quantos saem agora, quantos em cada hora, quando termina
//
// "Enviar todos" com 500 na fila e 100/h não é um clique que falha: é um plano de 5
// horas. Antes a tela dizia "100 enviados · 400 na fila — clique de novo", e clicar de
// novo devolvia zero até a janela virar. O número estava certo e a leitura era "travou".
//
// Esta projeção usa EXATAMENTE os mesmos tetos que o envio aplica (mesma função, mesma
// conta) — se ela divergir do que sai, é bug nos dois lugares ao mesmo tempo, não uma
// promessa quebrada da tela.
//
// Simplificação assumida e escrita aqui de propósito: a projeção assume o ritmo cheio
// (o teto por hora) a cada hora seguinte. Se uma caixa cair no meio do caminho, o plano
// atrasa — o que a tela mostra é o melhor caso, e o relatório real vem a cada volta.
// ============================================================
export function projetarFila(cap: CapacidadeDia, restantes: number): string | null {
  if (restantes <= 0) return null;

  // Ritmo por hora: o teto geral, ou a soma dos tetos das caixas que têm um.
  const somaCaixas = cap.porCaixa.reduce((s, c) => s + (c.capHora ?? 0), 0);
  const todasComTeto = cap.porCaixa.length > 0 && cap.porCaixa.every((c) => c.capHora != null);
  const ritmo = cap.capHoraGeral ?? (todasComTeto && somaCaixas > 0 ? somaCaixas : null);

  // Sem teto por hora e dentro do horário: não há o que projetar — o freio é o do dia,
  // que a frase de capacidade já explica.
  if (ritmo == null && cap.dentroDoHorario) return null;

  const agora = new Date();
  const partes: string[] = [];
  let fila = Math.min(restantes, cap.folgaDia);   // o dia é o teto do que sai hoje
  const sobraAmanha = restantes - fila;

  // 1) o que sai agora
  const agoraCabe = Math.min(fila, cap.folga);
  if (cap.dentroDoHorario && agoraCabe > 0) {
    partes.push(`${agoraCabe} agora`);
    fila -= agoraCabe;
  }

  // 2) as horas seguintes, respeitando a janela comercial
  const fecha = fechamentoDeHoje(cap.janela, agora);
  // De onde parte a contagem. A janela é MÓVEL: quando o teto já estourou, o próximo
  // espaço abre quando o envio mais antigo completa 60 min — 14:37, não "às 15h". Dizer
  // a hora cheia seria prometer um atraso que não existe.
  let cursor = !cap.dentroDoHorario
    ? (cap.abreEm ? new Date(cap.abreEm) : new Date(agora.getTime() + JANELA_HORA_MS))
    : cap.folga <= 0 && cap.liberaEm
      ? new Date(cap.liberaEm)
      : new Date(agora.getTime() + JANELA_HORA_MS);

  let passos = 0;
  while (fila > 0 && ritmo != null && passos < 12) {
    if (fecha && cursor.getTime() >= fecha.getTime()) break;   // a janela de hoje fechou
    const n = Math.min(fila, ritmo);
    partes.push(`${n} ${quandoTexto(cursor, agora)}`);
    fila -= n;
    cursor = new Date(cursor.getTime() + JANELA_HORA_MS);
    passos++;
  }

  if (!partes.length && ritmo == null) return null;

  const resto = fila + sobraAmanha;
  const cauda =
    resto > 0
      ? ` — os outros ${resto} ficam para o próximo dia útil (o limite do dia e o horário comercial mandam).`
      : ".";
  return `Plano da fila: ${partes.join(" · ")}${cauda}`;
}
