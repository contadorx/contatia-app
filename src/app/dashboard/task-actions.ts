"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";
import { logAction, recortarItens } from "@/lib/actionLog";
import { diaISO } from "@/lib/datas";
// O motor de envio de e-mail vive fora daqui de propósito — ver o bloco "O MOTOR MOROU
// AQUI ATÉ A v68", mais abaixo.
import { enviarUm, type ContextoLote } from "@/lib/envioEmail";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function completeTask(id: string, contactId?: string) {
  const { supabase, tenant_id } = await ctx();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: msgErro(error) };
  if (tenant_id && contactId) await scoreEvent(supabase, { tenant_id, contact_id: contactId, type: "task_done" });
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function skipTask(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("tasks").update({ status: "skipped" }).eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function snoozeTask(id: string, days: number) {
  const { supabase } = await ctx();
  const d = new Date();
  d.setDate(d.getDate() + (days || 1));
  const { error } = await supabase
    .from("tasks")
    .update({ due_date: diaISO(d) })
    .eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard");
  return { ok: true };
}

// Marca que o contato RESPONDEU: pausa a(s) sequência(s), cancela toques futuros
// pendentes e pontua alto (fica quente). É o "respondeu → pausa" manual (WhatsApp/
// ligação/LinkedIn) enquanto a detecção automática de e-mail não entra.
export async function markReplied(contactId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: enrs } = await supabase
    .from("enrollments")
    .select("id")
    .eq("contact_id", contactId)
    .eq("status", "active");
  const ids = ((enrs as any[]) || []).map((e) => e.id);
  if (ids.length) {
    await supabase.from("enrollments").update({ status: "replied" }).in("id", ids);
    await supabase.from("tasks").update({ status: "skipped" }).in("enrollment_id", ids).eq("status", "pending");
  }
  await scoreEvent(supabase, { tenant_id, contact_id: contactId, type: "replied" });
  try {
    const { runAutomations } = await import("@/lib/automations");
    await runAutomations(supabase, { tenantId: tenant_id, contactId, trigger: "replied" });
  } catch {
    /* automação não deve quebrar o fluxo */
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---- Envio de e-mail real (SMTP/Gmail) a partir de uma tarefa da fila ----
//
// A ação PÚBLICA é esta casca. O miolo (`enviarUm`) aceita um contexto de lote que o
// cliente não tem como forjar — se o `lote` fosse parâmetro da server action, bastaria
// mandar uma capacidade inventada para furar o limite diário do próprio workspace.
export async function sendEmailTask(taskId: string, override?: { subject?: string; body?: string }) {
  return await enviarUm(taskId, override);
}

// O MOTOR MOROU AQUI ATÉ A v68.
//
// Ele saiu para `@/lib/envioEmail` quando o cron da fila (envio automático, sem
// ninguém logado) precisou do MESMO motor. O motivo é de segurança e está escrito lá:
// neste arquivo ("use server") toda função exportada vira uma server action chamável
// pelo navegador — exportar `enviarUm` deixaria o cliente mandar um `lote` forjado,
// com capacidade inventada, furando o limite diário e o teto por hora.
//
// Duplicar o motor para o cron seria pior: dois envios com regras que divergem no
// primeiro conserto feito só de um lado.

// Envia a tarefa de WhatsApp via Evolution API (caixa ativa do tenant), com cap diário.
//
// O MOTOR MORA EM `lib/envioWhatsapp.ts` desde que a fila automática passou a existir.
// Este arquivo é "use server": tudo que ele exporta vira server action chamável pelo
// navegador, então o cron não pode importar daqui. E manter dois motores seria o pior
// dos dois mundos — "dois envios com regras que divergem no primeiro conserto feito só
// de um lado", que é exatamente o que o e-mail já aprendeu.
//
// O que fica AQUI é o que só vale para o clique: o modo do WhatsApp, o texto editado na
// hora, a escolha da instância DA PESSOA que apertou, e o revalidate da tela.
export async function sendWhatsAppTask(taskId: string, overrideBody?: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // O PRIMEIRO TOQUE automático é exclusividade do modo Evolution. No assistido e no
  // híbrido ele sai pela mão — no híbrido isso é escolha, não limitação: a sessão está
  // lá para receber, verificar e responder, e o disparo em massa é justamente a parte
  // que mais chama atenção.
  const { data: tmode } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  const { envioAutomatico } = await import("@/lib/waModo");
  if (!envioAutomatico((tmode as any)?.whatsapp_mode)) {
    return { error: "Neste modo o envio do primeiro toque é manual: abra o link do WhatsApp (botão \u201cAbrir WhatsApp\u201d)." };
  }

  if (overrideBody !== undefined) {
    const { error } = await supabase
      .from("tasks")
      .update({ generated_content: overrideBody, body_editado: true })
      .eq("id", taskId);
    if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
      await supabase.from("tasks").update({ generated_content: overrideBody }).eq("id", taskId);
    }
  }

  // instância do PRÓPRIO usuário quando ela existe (ver lib/instanciaWa)
  const { instanciaDoUsuario, SEM_INSTANCIA } = await import("@/lib/instanciaWa");
  const { acc } = await instanciaDoUsuario(supabase, tenant_id, user_id);
  if (!acc) return { error: SEM_INSTANCIA };

  const { enviarTarefaWa } = await import("@/lib/envioWhatsapp");
  const r = await enviarTarefaWa(supabase, {
    tenantId: tenant_id,
    userId: user_id,
    taskId,
    acc: acc as any,
    // false: quem apertou foi uma pessoa — e é isso que faz o agente calar na conversa.
    automatico: false,
  });

  revalidatePath("/dashboard");
  return r;
}

// Envia TODAS as tarefas de e-mail pendentes de hoje, respeitando o cap diário.
// ============================================================
// ENVIAR TODOS — com freio, orçamento de tempo e relatório
//
// O QUE ACONTECIA: este laço percorria até 500 tarefas chamando sendEmailTask uma a
// uma, dentro de UMA execução de função. Três consequências, todas ruins:
//
//   1) Passava dos 60 segundos e a função era morta no meio. A tela não recebia
//      resposta — e a pessoa clicava de novo.
//   2) Como a tarefa só era marcada como feita DEPOIS do envio, quem foi enviado no
//      momento da morte continuava pendente. O clique seguinte MANDAVA DE NOVO.
//   3) O evento também não era gravado, então o contador do dia não subia e o limite
//      diário nunca disparava. Foi assim que saíram ~300 e-mails com o painel
//      marcando 40.
//
// A reserva da tarefa (em sendEmailTask) resolve o reenvio. Aqui resolvemos o resto:
// orçamento de tempo, parada imediata quando o limite é atingido, e um relatório que
// diz por quais caixas os e-mails saíram.
// ============================================================
const ORCAMENTO_ENVIO_MS = 40_000;   // sai limpo antes dos 60s da função
const TETO_POR_CLIQUE = 200;

export async function sendAllEmailTasks(selecionadas?: string[]) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const today = diaISO();

  // ============================================================
  // HORÁRIO COMERCIAL — a primeira porta, antes de reservar qualquer tarefa
  //
  // Esta é a FILA: quem escolhe o que sai é o sistema. Fora do horário configurado ela
  // não dispara — e não porque "deu erro", mas porque prospecção que chega às 3h da
  // manhã é lida como robô antes de ser lida por gente.
  //
  // A checagem vem ANTES de qualquer update: uma tarefa reservada e devolvida deixa
  // rastro (completed_at indo e voltando) sem nada ter saído.
  //
  // Só a fila é barrada. "Enviar marcadas" e o botão de uma tarefa continuam saindo na
  // hora do clique — ali quem escolheu foi uma pessoa, e recusar seria o app achando
  // que sabe mais do que ela.
  // ============================================================
  const { capacidadeDeHoje: capHoje } = await import("@/lib/capacidadeEmail");
  const capInicial = await capHoje(supabase);
  if (!capInicial.dentroDoHorario) {
    const { rotuloJanela, quandoTexto } = await import("@/lib/janelaEnvio");
    const volta = capInicial.abreEm ? quandoTexto(new Date(capInicial.abreEm)) : "no próximo dia útil";
    return {
      ok: true, sent: 0, failed: 0, restantes: 0,
      foraDoHorario: true,
      abreEm: capInicial.abreEm,
      diagnostico:
        `Fora do horário de envio da fila (${rotuloJanela(capInicial.janela)}). A fila volta ${volta}. ` +
        `Para mandar agora mesmo, marque os toques e use "Enviar marcadas" — a seleção ignora a janela.`,
    };
  }

  // ============================================================
  // A SELEÇÃO DA TELA VALE — mas quem decide o que pode sair é o servidor
  //
  // Marcar 260 linhas e ver "10 enviados" com o resto virando "clique de novo" é a
  // queixa que originou isto. Duas coisas passam a ser ditas: a seleção é respeitada
  // (antes o botão ignorava e pegava as mais antigas), e o que foi descartado dela —
  // porque não é e-mail, porque já saiu, ou porque ainda não venceu — vira número, não
  // silêncio. O filtro continua no servidor: o cliente manda ids, nunca a permissão.
  // ============================================================
  const pedidos = (selecionadas || []).filter(Boolean);
  let descartadasDaSelecao = 0;
  let ids: string[] = [];

  if (pedidos.length) {
    const elegiveis: string[] = [];
    // fatias de 200: 1.000 uuids numa URL do PostgREST passam de 37 KB e o servidor recusa
    for (let i = 0; i < pedidos.length; i += 200) {
      const { data } = await supabase
        .from("tasks")
        .select("id")
        .in("id", pedidos.slice(i, i + 200))
        .eq("channel", "email")
        .eq("status", "pending")
        .lte("due_date", today)
        .order("due_date", { ascending: true });
      elegiveis.push(...(((data as any[]) || []).map((t) => t.id)));
    }
    descartadasDaSelecao = pedidos.length - elegiveis.length;
    ids = elegiveis.slice(0, TETO_POR_CLIQUE);
  } else {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id")
      .eq("channel", "email")
      .eq("status", "pending")
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(TETO_POR_CLIQUE);
    ids = ((tasks as any[]) || []).map((t) => t.id);
  }

  // ============================================================
  // "ENVIEI E NÃO SAIU NADA" PRECISA DE UMA RESPOSTA, NÃO DE UM ZERO
  //
  // Sem tarefa vencida, esta função devolvia `sent: 0` e a tela escrevia
  // "✓ 0 e-mail(is) enviado(s)." — que é verdade e não informa nada. Quem clica quer
  // saber POR QUE não saiu, e as causas são bem diferentes entre si:
  //
  //   · não há tarefa de e-mail nenhuma (ninguém foi inscrito em cadência de e-mail);
  //   · há, mas vencem nos próximos dias — o motor agenda, não dispara antes da hora;
  //   · há vencidas, mas os contatos não têm e-mail, ou estão suprimidos;
  //   · as caixas bateram o limite do dia.
  //
  // As duas primeiras são respondidas aqui, ANTES de tentar enviar, porque nesses
  // casos não há nem o que tentar.
  // ============================================================
  if (!ids.length) {
    const { count: futuras } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("status", "pending")
      .gt("due_date", today);
    const { data: proxima } = await supabase
      .from("tasks")
      .select("due_date")
      .eq("channel", "email")
      .eq("status", "pending")
      .gt("due_date", today)
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    const quando = (proxima as any)?.due_date ? String((proxima as any).due_date).split("-").reverse().join("/") : null;
    return {
      ok: true, sent: 0, failed: 0, restantes: 0,
      diagnostico: (futuras ?? 0) > 0
        ? `Nenhum e-mail vence hoje. Há ${futuras} agendado(s) para os próximos dias${quando ? ` — o primeiro em ${quando}` : ""}. A cadência dispara na data de cada passo; este botão só envia o que já venceu.`
        : "Não há nenhuma tarefa de e-mail pendente. Inscreva contatos numa cadência que tenha passo de e-mail — ou confira se as tarefas foram concluídas/puladas.",
    };
  }

  const inicio = Date.now();
  let sent = 0;
  let failed = 0;
  let limiteAtingido: string | null = null;
  let primeiroErro: string | null = null;
  const porCaixa: Record<string, number> = {};
  const motivos: Record<string, number> = {};
  let i = 0;
  let tempoEsgotado = false;

  // ---- contexto do lote: capacidade, assinatura e CONEXÕES abertas uma vez só ----
  // `capInicial` já foi calculada lá em cima (a porta do horário comercial precisou
  // dela). Calcular de novo aqui seriam 3 consultas repetidas por volta — e, pior, duas
  // fotos diferentes da mesma capacidade dentro da mesma execução.
  const { transporteDeLote } = await import("@/lib/mailer");
  const { data: tenantRow } = await supabase.from("tenants").select("email_signature").maybeSingle();
  const lote: ContextoLote = {
    cap: capInicial,
    usadosNoLote: {},
    transportes: new Map<string, any>(),
    imap: new Map<string, any>(),
    assinaturaTenant: ((tenantRow as any)?.email_signature as string) ?? null,
    tempos: { banco: 0, smtp: 0, copia: 0 },
  };
  for (const c of capInicial.porCaixa) {
    // conexão só para caixa que ainda tem folga hoje — abrir a das esgotadas seria
    // pagar aperto de mão para não mandar nada
    if (c.folga <= 0) continue;
    try { lote.transportes.set(c.conta.id as string, transporteDeLote(c.conta)); }
    catch { /* caixa mal configurada cai no caminho de sempre e reporta o erro dela */ }
  }

  let travouPorHora = false;
  let liberaEm: string | null = null;
  let trocaramDeCaixa = 0;
  let avisoTroca: string | null = null;

  for (; i < ids.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_ENVIO_MS) { tempoEsgotado = true; break; }
    const res = (await enviarUm(ids[i], undefined, lote)) as
      { ok?: boolean; error?: string; caixa?: string; travaHora?: boolean; liberaEm?: string | null;
        trocouDeCaixa?: boolean; aviso?: string };
    // Teto por hora: parar é obrigatório, e o motivo NÃO é o mesmo de "acabou o dia".
    // Insistir aqui é o caminho para o provedor cortar a conexão da hora inteira.
    if (res?.travaHora) {
      travouPorHora = true;
      liberaEm = res.liberaEm ?? null;
      if (res.error) motivos[res.error] = (motivos[res.error] || 0) + 1;
      if (!primeiroErro) primeiroErro = res.error ?? null;
      break;
    }
    if (res?.ok) {
      sent++;
      if (res.caixa) porCaixa[res.caixa] = (porCaixa[res.caixa] || 0) + 1;
      // Trocou de remetente porque a caixa designada estava sem folga (ou inativa). O
      // e-mail saiu — e o destinatário viu OUTRO endereço. Isso não pode passar em
      // silêncio: foi assim que o lead do Enquadria recebeu um e-mail do BPOx.
      if (res.trocouDeCaixa) {
        trocaramDeCaixa++;
        if (!avisoTroca && res.aviso) avisoTroca = res.aviso;
      }
      continue;
    }
    failed++;
    if (!primeiroErro && res?.error) primeiroErro = res.error;
    // Agrupar os motivos: com 40 tarefas de contatos sem e-mail, mostrar só o primeiro
    // erro faz parecer caso isolado. O número ao lado do motivo é o que revela o
    // padrão — e o padrão é o que se conserta.
    if (res?.error) motivos[res.error] = (motivos[res.error] || 0) + 1;
    // Limite diário atingido: PARAR. Insistir só produz 200 falhas iguais e some com o
    // motivo no meio delas.
    if (res?.error && /[Ll]imite/.test(res.error)) { limiteAtingido = res.error; break; }
  }

  // fecha as conexões do lote — deixar pool aberto num ambiente serverless segura a
  // função viva e o servidor de e-mail vê a sessão pendurada
  for (const t of lote.transportes.values()) { try { t.close?.(); } catch { /* nada a fazer */ } }
  for (const s of lote.imap.values()) { if (s) { try { await s.fechar(); } catch { /* nada a fazer */ } } }
  revalidatePath("/dashboard");

  const processados = i;
  const restantes = Math.max(0, ids.length - processados);
  const duracaoMs = Date.now() - inicio;
  // quanto custou cada mensagem: é este número que diz se o freio é a conexão, o
  // servidor de e-mail ou o banco — e sem ele a conversa vira palpite (já virou).
  const msPorEmail = processados ? Math.round(duracaoMs / processados) : null;

  // A CONTA DO DIA, sempre — é ela que transforma "saíram 10" em resposta.
  // Vem de capacidadeDeHoje, a MESMA função que o envio usa para decidir; duas contas
  // separadas divergiriam e a tela prometeria o que o envio não honra.
  const { capacidadeDeHoje, comoAumentar, projetarFila } = await import("@/lib/capacidadeEmail");
  const cap = await capacidadeDeHoje(supabase);

  // Quantos toques ainda esperam de verdade — não só os desta volta. É esse número que
  // faz o plano ser um plano ("500 em 5 horas") em vez de um resto ("400 na fila").
  const { count: pendentesAgora } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .eq("status", "pending")
    .lte("due_date", today);
  const naFila = pendentesAgora ?? restantes;
  const plano = projetarFila(cap, naFila);

  // Nada saiu mesmo tendo o que tentar: o motivo mais frequente é a resposta.
  const maisComum = Object.entries(motivos).sort((a, b) => b[1] - a[1])[0];
  const diagnostico =
    sent === 0 && maisComum
      ? `Nenhum e-mail saiu. Motivo mais comum (${maisComum[1]} de ${processados}): ${maisComum[0]}`
      : null;

  revalidatePath("/dashboard");
  return {
    ok: true,
    sent,
    failed,
    restantes,
    limiteAtingido,
    // parou porque acabou o limite do dia (e não por tempo ou por fim da fila):
    // com isto a tela deixa de mandar "clicar de novo" contra um teto.
    paradoPorLimite: !!limiteAtingido,
    // parou porque o orçamento de tempo da função acabou: aqui clicar de novo ADIANTA
    paradoPorTempo: tempoEsgotado,
    // parou pelo teto POR HORA: clicar de novo agora devolve zero, mas às 15:07 (o
    // `liberaEm`) volta a sair. É a diferença entre "espere um dia" e "espere 6 minutos".
    paradoPorHora: travouPorHora,
    liberaEm: liberaEm || cap.liberaEm,
    capacidadeHora: cap.capHoraGeral,
    usadosHora: cap.usadosHora,
    folgaHora: cap.folgaHoraGeral,
    // o plano completo: quantos agora, quantos em cada hora, quando termina
    plano,
    naFila,
    duracaoMs,
    msPorEmail,
    // onde o tempo foi: banco/preparo, SMTP, cópia em "Enviados"
    tempos: lote.tempos,
    capacidadeHoje: cap.capTotal,
    usadosHoje: cap.usados,
    folgaHoje: cap.folga,
    resumoCapacidade: cap.resumo,
    comoAumentar: comoAumentar(cap),
    // a seleção da tela: quantas linhas marcadas não podiam sair agora
    descartadasDaSelecao,
    // saíram por uma caixa diferente da que estava designada
    trocaramDeCaixa,
    avisoTroca,
    // o teto por clique bateu: existe mais fila do que esta volta pegou
    tetoPorClique: ids.length >= TETO_POR_CLIQUE ? TETO_POR_CLIQUE : null,
    primeiroErro,
    porCaixa,
    diagnostico,
    // todos os motivos, do mais frequente para o menos
    motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}× ${m}`),
    // total do dia por caixa, para a tela poder mostrar de onde saiu
    detalhe: Object.entries(porCaixa).map(([caixa, n]) => `${n} por ${caixa}`).join(", "),
  };
}

// Conclui várias tarefas de uma vez (fila sequencial por tipo — ex.: todos os LinkedIn).
export async function completeTasks(ids: string[]) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!ids.length) return { ok: true, done: 0 };
  const list = ids.slice(0, 300);
  // pega os contatos para pontuar
  const { data: tks } = await supabase.from("tasks").select("id, contact_id").in("id", list);
  // .select("id") no fim: precisamos do que REALMENTE mudou. A RLS pode barrar tarefa
  // de outra pessoa e o .eq("status","pending") pode não casar — logar o número pedido
  // em vez do número afetado deixaria o registro mentindo.
  const { data: afetadas, error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .in("id", list)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: msgErro(error) };
  const feitas = new Set(((afetadas as any[]) || []).map((r) => r.id));
  if (tenant_id) {
    for (const t of ((tks as any[]) || [])) {
      if (t.contact_id && feitas.has(t.id)) await scoreEvent(supabase, { tenant_id, contact_id: t.contact_id, type: "task_done" });
    }
  }
  if (feitas.size) {
    await logAction(supabase, {
      tenant_id,
      user_id,
      action: "task_complete_bulk",
      entity: "task",
      qtd: feitas.size,
      detail: `${feitas.size} tarefa(s) concluída(s) em lote.`,
    });
  }
  revalidatePath("/dashboard");
  return { ok: true, done: feitas.size };
}

// ------------------------------------------------------------------
// Ações em LOTE da caixa de hoje (seleção por checkbox)
// ------------------------------------------------------------------
const LOTE_MAX = 300;

// Foto das tarefas ANTES de mexer nelas — é o que sobra no log depois do delete.
async function fotoTarefas(supabase: any, list: string[], tenant_id: string) {
  const { data } = await supabase
    .from("tasks")
    .select("id, title, channel, due_date, contact_id, contacts(name, company)")
    .eq("tenant_id", tenant_id)
    .in("id", list);
  return ((data as any[]) || []).map((t) => ({
    id: t.id,
    titulo: t.title || null,
    canal: t.channel || null,
    vencimento: t.due_date || null,
    contato: t.contacts?.name || null,
    empresa: t.contacts?.company || null,
  }));
}

// PULAR em lote: mantém a linha no banco com status 'skipped' (some da caixa, mas o
// relatório de cadência continua sabendo que o toque existiu e foi dispensado).
export async function skipTasks(ids: string[]) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const list = Array.from(new Set((ids || []).filter(Boolean))).slice(0, LOTE_MAX);
  if (!list.length) return { error: "Nenhuma tarefa selecionada." };

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "skipped" })
    .eq("tenant_id", tenant_id)
    .in("id", list)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: msgErro(error) };
  const n = ((data as any[]) || []).length;
  // nada mudou = as tarefas já saíram da fila (outra aba, cron, cadência). Avisar é
  // melhor do que dizer "✓ 0 puladas" e gravar um registro vazio no log.
  if (!n) return { error: "Nada foi alterado — as tarefas já tinham saído da fila." };

  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "task_skip_bulk",
    entity: "task",
    qtd: n,
    detail: `${n} tarefa(s) pulada(s) em lote.`,
  });
  revalidatePath("/dashboard");
  return { ok: true, count: n };
}

// EXCLUIR em lote: apaga a linha de verdade (DELETE). Não tem volta — por isso a
// foto vai inteira para o action_log antes, com título, canal, contato e vencimento.
export async function deleteTasks(ids: string[]) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const list = Array.from(new Set((ids || []).filter(Boolean))).slice(0, LOTE_MAX);
  if (!list.length) return { error: "Nenhuma tarefa selecionada." };

  const foto = await fotoTarefas(supabase, list, tenant_id);

  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("tenant_id", tenant_id)
    .in("id", list)
    .select("id");
  if (error) return { error: msgErro(error) };
  const n = ((data as any[]) || []).length;
  if (!n) return { error: "Nada foi excluído — as tarefas podem já ter saído da fila." };

  const apagadas = new Set(((data as any[]) || []).map((r) => r.id));
  const { itens, truncado } = recortarItens(foto.filter((f) => apagadas.has(f.id)));
  const canais = Array.from(new Set(itens.map((i) => i.canal).filter(Boolean)));

  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "task_delete",
    entity: "task",
    qtd: n,
    detail:
      `${n} tarefa(s) excluída(s) da caixa de hoje` +
      (canais.length ? ` (${canais.join(", ")})` : "") +
      ".",
    meta: { itens, truncado, selecionadas: list.length },
  });
  revalidatePath("/dashboard");
  return { ok: true, count: n };
}

// ============================================================
// ENVIAR SÓ O QUE ESTÁ MARCADO — e-mail E WhatsApp na mesma volta
//
// "Enviar todos" é uma decisão grande demais para o dia a dia: quase sempre o operador
// quer disparar um punhado, olhar o que volta, e continuar. Até aqui a fila só sabia
// fazer tudo (e-mail) ou um a um (WhatsApp) — não havia meio-termo, e o meio-termo é
// justamente onde se trabalha.
//
// O canal é decidido POR TAREFA, não pelo botão: marcou três e-mails e dois WhatsApps,
// saem os cinco pelos caminhos certos, cada um com as suas travas (limite diário da
// caixa, número sem WhatsApp, texto com lixo).
//
// O RITMO DO WHATSAPP É DE PROPÓSITO. Cinco mensagens saindo no mesmo segundo, do mesmo
// número, é o padrão que derruba conta. A pausa entre elas não é lentidão acidental —
// é a única parte do envio que protege o número, e some do orçamento de tempo com
// consciência: em 40 segundos cabem ~12 WhatsApps, e está certo que seja assim.
// ============================================================
const PAUSA_WHATSAPP_MS = 2500;

export async function enviarSelecionadas(ids: string[]): Promise<{
  ok?: boolean; enviados?: number; porCanal?: Record<string, number>; falhas?: number;
  motivos?: string[]; restantes?: number; paradoPorTempo?: boolean; ignoradas?: number;
  detalhe?: string; error?: string;
  paradoPorHora?: boolean; liberaEm?: string | null; avisoHorario?: string | null;
}> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const pedidos = (ids || []).filter(Boolean);
  if (!pedidos.length) return { error: "Nada marcado." };

  const hoje = diaISO();
  const elegiveis: { id: string; channel: string }[] = [];
  // fatias de 200: 1.000 uuids numa URL do PostgREST passam de 37 KB e o servidor recusa
  for (let i = 0; i < pedidos.length; i += 200) {
    const { data } = await supabase
      .from("tasks")
      .select("id, channel, due_date")
      .in("id", pedidos.slice(i, i + 200))
      .eq("status", "pending")
      .lte("due_date", hoje)
      .in("channel", ["email", "whatsapp"])
      .order("due_date", { ascending: true });
    for (const t of ((data as any[]) || [])) elegiveis.push({ id: t.id, channel: t.channel });
  }
  const ignoradas = pedidos.length - elegiveis.length;
  if (!elegiveis.length) {
    return {
      ok: true, enviados: 0, ignoradas,
      error: "Nenhuma das marcadas pode sair agora: ou não é e-mail/WhatsApp, ou já saiu, ou vence depois de hoje.",
    };
  }

  // contexto de lote só para o e-mail (conexões reaproveitadas); o WhatsApp é HTTP
  const { capacidadeDeHoje: capHoje } = await import("@/lib/capacidadeEmail");
  const { transporteDeLote } = await import("@/lib/mailer");
  const temEmail = elegiveis.some((t) => t.channel === "email");
  const capInicial = await capHoje(supabase);
  const { data: tenantRow } = temEmail
    ? await supabase.from("tenants").select("email_signature").maybeSingle()
    : { data: null as any };
  const lote: ContextoLote = {
    cap: capInicial,
    usadosNoLote: {},
    transportes: new Map<string, any>(),
    imap: new Map<string, any>(),
    assinaturaTenant: ((tenantRow as any)?.email_signature as string) ?? null,
    tempos: { banco: 0, smtp: 0, copia: 0 },
  };
  if (temEmail) {
    for (const c of capInicial.porCaixa) {
      if (c.folga <= 0) continue;
      try { lote.transportes.set(c.conta.id as string, transporteDeLote(c.conta)); } catch { /* cai no caminho de sempre */ }
    }
  }

  const inicio = Date.now();
  const porCanal: Record<string, number> = {};
  const motivos: Record<string, number> = {};
  let enviados = 0;
  let falhas = 0;
  let paradoPorTempo = false;
  let paradoPorHora = false;
  let liberaEm: string | null = null;
  let i = 0;

  for (; i < elegiveis.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_ENVIO_MS) { paradoPorTempo = true; break; }
    const t = elegiveis[i];

    const res =
      t.channel === "email"
        ? ((await enviarUm(t.id, undefined, lote)) as { ok?: boolean; error?: string; travaHora?: boolean; liberaEm?: string | null })
        : ((await sendWhatsAppTask(t.id)) as { ok?: boolean; error?: string });

    // O teto por HORA vale aqui também, mesmo com a seleção sendo um gesto deliberado:
    // ele não é uma política nossa, é o limite físico do servidor do provedor. Passar
    // dele não manda mais e-mail — faz o provedor recusar a conexão pela hora inteira.
    // (O horário comercial é outra coisa: aquele é regra nossa e a seleção ignora.)
    if ((res as any)?.travaHora) {
      paradoPorHora = true;
      liberaEm = (res as any).liberaEm ?? null;
      if (res?.error) motivos[res.error] = (motivos[res.error] || 0) + 1;
      break;
    }

    if (res?.ok) {
      enviados++;
      porCanal[t.channel] = (porCanal[t.channel] || 0) + 1;
      // ritmo humano entre WhatsApps — ver o comentário do topo
      if (t.channel === "whatsapp" && i < elegiveis.length - 1) {
        await new Promise((r) => setTimeout(r, PAUSA_WHATSAPP_MS));
      }
      continue;
    }
    falhas++;
    if (res?.error) motivos[res.error] = (motivos[res.error] || 0) + 1;
    // limite do dia atingido: insistir só produz falhas iguais e some com o motivo
    if (res?.error && /[Ll]imite/.test(res.error)) break;
  }

  for (const tr of lote.transportes.values()) { try { tr.close?.(); } catch { /* nada a fazer */ } }
  for (const se of lote.imap.values()) { if (se) { try { await se.fechar(); } catch { /* nada a fazer */ } } }
  revalidatePath("/dashboard");

  const { rotuloJanela } = await import("@/lib/janelaEnvio");

  return {
    ok: true,
    enviados,
    porCanal,
    falhas,
    ignoradas,
    restantes: Math.max(0, elegiveis.length - i),
    paradoPorTempo,
    paradoPorHora,
    liberaEm,
    // A seleção passa fora do horário — mas passa AVISADA. Sem a linha, a pessoa manda
    // 40 e-mails às 23h sem perceber, e descobre pelo resultado deles.
    avisoHorario:
      !capInicial.dentroDoHorario && temEmail
        ? `Enviado fora do horário da fila (${rotuloJanela(capInicial.janela)}) — foi por marcação, então saiu mesmo assim.`
        : null,
    motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}× ${m}`),
    detalhe: Object.entries(porCanal)
      .map(([c, n]) => `${n} ${c === "email" ? "e-mail" : "WhatsApp"}`)
      .join(" · "),
  };
}
