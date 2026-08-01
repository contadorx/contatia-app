"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";
import { logAction, recortarItens } from "@/lib/actionLog";
import { renderTemplate } from "@/lib/cadence";
import { buildEmailHtml } from "@/lib/richtext";

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
    .update({ due_date: d.toISOString().slice(0, 10) })
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
export async function sendEmailTask(taskId: string, override?: { subject?: string; body?: string }) {
  const { sendEmail } = await import("@/lib/mailer");
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // se veio corpo/assunto editado, persiste na task antes de enviar
  if (override && (override.subject !== undefined || override.body !== undefined)) {
    const patch: Record<string, unknown> = {};
    if (override.subject !== undefined) patch.title = override.subject;
    if (override.body !== undefined) patch.generated_content = override.body;
    if (Object.keys(patch).length) await supabase.from("tasks").update(patch).eq("id", taskId);
  }

  const { data: task } = await supabase
    .from("tasks")
    // enrollment_id/step_position entram aqui para o rastreio saber DE QUAL PASSO o
    // e-mail saiu — sem isso, "cliques e aberturas por passo" é impossível de montar
    // depois: a origem só é conhecida no momento do envio.
    .select("id, channel, title, generated_content, contact_id, email_account_id, enrollment_id, step_position, contacts(email, name, email_status)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "email") return { error: "Tarefa não é de e-mail." };
  const to = (task as any).contacts?.email as string | undefined;
  if (!to) {
    // contato sem e-mail: pula a tarefa (não fica pendente para sempre) — cobre também
    // tarefas criadas antes do gate de inscrição.
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: "Contato sem e-mail. Tarefa de e-mail pulada." };
  }

  // não envia para e-mail marcado como inválido/bounce (protege reputação)
  const estatus = (task as any).contacts?.email_status as string | undefined;
  if (estatus && ["invalid", "hard_bounce", "complaint"].includes(estatus)) {
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: `E-mail marcado como "${estatus}". Envio bloqueado para proteger sua reputação.` };
  }

  // proteção de reputação: não envia para e-mail suprimido (bounce/spam/unsubscribe)
  const { data: supp } = await supabase
    .from("email_suppressions")
    .select("reason")
    .eq("tenant_id", tenant_id)
    .eq("email", to.toLowerCase())
    .maybeSingle();
  if (supp) {
    // marca a task como pulada para não insistir e proteger o domínio
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: `E-mail na lista de supressão (${(supp as any).reason}). Envio bloqueado para proteger sua reputação.` };
  }

  // ROTAÇÃO DE CAIXAS: busca todas as caixas ativas e escolhe a com mais folga hoje
  // (cap efetivo do dia − enviados hoje). Distribui a carga e protege cada domínio.
  const { data: accts } = await supabase
    .from("email_accounts")
    .select("*")   // `*` de propósito: listar as colunas faria TODO envio quebrar com "column
           // does not exist" no intervalo entre publicar o app e aplicar a migration —
           // e o app é publicado pela Vercel enquanto a migration é aplicada à mão.
           // A linha é pequena e já a líamos quase inteira.
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (!accts || !accts.length) {
    return { error: "Nenhuma caixa de e-mail conectada. Cadastre a sua em Configurações → Canais." };
  }

  // meia-noite BRT (UTC-3, fixo): o servidor roda em UTC — sem isso o "dia" do cap
  // diário resetaria às 21h de Brasília e a caixa poderia enviar 2x o limite num dia real.
  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const { effectiveDailyCap } = await import("@/lib/warmup");

  // contagem de enviados hoje por caixa
  const { data: sentToday } = await supabase
    .from("events")
    .select("email_account_id")
    .eq("type", "email_sent")
    .gte("created_at", startOfDay.toISOString());
  const sentByAcct: Record<string, number> = {};
  for (const e of (sentToday as any[]) || []) {
    const id = e.email_account_id;
    if (id) sentByAcct[id] = (sentByAcct[id] || 0) + 1;
  }

  // folga do dia de uma caixa (cap efetivo do aquecimento − enviados hoje)
  let anyWarming = false;
  const folgaDe = (a: any) => {
    const warmupOn = (a.warmup_stage ?? 0) !== -1;
    const { cap, warming } = effectiveDailyCap(a.created_at, a.daily_cap ?? 40, warmupOn);
    if (warming) anyWarming = true;
    return cap - (sentByAcct[a.id] || 0);
  };
  for (const a of accts as any[]) folgaDe(a);   // só para saber se ALGUMA está aquecendo

  // ESCOLHA POR CAMADAS: minha → do workspace → emprestada (ver lib/caixas).
  //
  // Antes isto era "a caixa com maior folga", sem olhar de quem ela é. Numa equipe isso
  // fazia um gestor sem caixa própria enviar pela caixa PESSOAL de outra pessoa, só
  // porque ela era a mais nova e portanto a mais vazia — o destinatário via o endereço
  // da colega e a resposta caía na caixa dela.
  const { escolherCaixa } = await import("@/lib/caixas");
  const escolha = escolherCaixa(accts as any[], folgaDe, user_id);
  let acct: any = escolha.caixa;
  let bestSlack = escolha.folga;

  // CAIXA DESIGNADA (produto/cadência): se a tarefa foi carimbada com uma caixa e
  // ela está ativa e com folga hoje, envia POR ELA (mantém a marca certa). Se estiver
  // inativa ou sem folga, cai no rodízio acima (degradação segura — o e-mail sai).
  const desiredBoxId = (task as any).email_account_id as string | null;
  if (desiredBoxId) {
    const d = (accts as any[]).find((a) => a.id === desiredBoxId);
    if (d) {
      const warmupOn = (d.warmup_stage ?? 0) !== -1;
      const { cap } = effectiveDailyCap(d.created_at, d.daily_cap ?? 40, warmupOn);
      const dSlack = cap - (sentByAcct[d.id] || 0);
      if (dSlack > 0) { acct = d; bestSlack = dSlack; }
    }
  }

  if (!acct || bestSlack <= 0) {
    return { error: anyWarming
      ? "Limite de envio de hoje atingido em todas as caixas (algumas ainda em aquecimento). Tente amanhã ou conecte outra caixa."
      : "Limite diário atingido em todas as caixas (Envio Seguro). Tente amanhã ou conecte outra caixa." };
  }

  // ---- RASTREIO: links + pixel de abertura, ambos atribuídos ao passo ----
  let bodyText = task.generated_content || "";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? (process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`) : "";
  // a cadência de onde veio a tarefa (para o relatório por passo)
  let sequenceId: string | null = null;
  if ((task as any).enrollment_id) {
    const { data: enr } = await supabase
      .from("enrollments").select("sequence_id").eq("id", (task as any).enrollment_id).maybeSingle();
    sequenceId = ((enr as any)?.sequence_id as string) || null;
  }
  const atribuicao = {
    tenantId: tenant_id,
    contactId: (task as any).contact_id ?? null,
    enrollmentId: (task as any).enrollment_id ?? null,
    sequenceId,
    taskId: (task as any).id ?? null,
    stepPosition: (task as any).step_position ?? null,
  };
  try {
    if (baseUrl) {
      const { wrapLinks } = await import("@/lib/linktrack");
      bodyText = await wrapLinks(supabase, { ...atribuicao, body: bodyText, baseUrl });
    }
  } catch {
    /* rastreio de link não deve bloquear o envio */
  }

  // assinatura do negócio (renderiza {{primeiro_nome}}/{{empresa}} com os dados do contato)
  const { data: tnt } = await supabase.from("tenants").select("email_signature").maybeSingle();
  // assinatura DA CAIXA que enviou; se vazia, cai na assinatura geral do workspace
  const boxSig = (acct as any)?.signature as string | undefined;
  const signature = (boxSig && boxSig.trim()) ? boxSig : ((tnt as any)?.email_signature as string | undefined);
  const contact = (task as any).contacts || {};
  const sigRendered = signature?.trim() ? renderTemplate(signature, { name: contact.name, company: null, ...contact }) : "";
  // Monta o corpo final (corpo + assinatura), ciente de HTML: se o corpo OU a
  // assinatura tiverem formatação, vai como HTML; senão, texto puro (legado).
  const built = buildEmailHtml(bodyText, sigRendered);
  let html = built.html;

  // ---- PIXEL DE ABERTURA ----
  // Só em e-mail HTML. Converter um corpo de texto puro em HTML só para medir seria
  // piorar o e-mail em nome de um número fraco (ver a nota em @/lib/aberturas).
  if (html && baseUrl) {
    try {
      const { tagDePixel } = await import("@/lib/aberturas");
      const tag = await tagDePixel(supabase, atribuicao, baseUrl);
      if (tag) html = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
    } catch {
      /* rastreio nunca impede o envio */
    }
  }
  bodyText = built.text;

  // ============================================================
  // RESERVA ANTES DE ENVIAR — a trava contra envio duplicado
  //
  // A ordem antiga era: envia → grava cópia em Enviados (até 8s) → marca a tarefa como
  // feita → registra o evento. Se a função morresse em qualquer ponto dessa janela, o
  // e-mail estava na rua e a tarefa continuava PENDENTE — então "Enviar todos" mandava
  // de novo, e de novo. E como o evento também não era gravado, o contador do dia não
  // subia: o limite diário ficava CEGO e nunca disparava.
  //
  // Agora a tarefa é RESERVADA antes do envio, numa atualização condicional
  // (`status = 'pending'`). Se duas execuções disputarem a mesma tarefa, só uma leva —
  // o banco decide. Se o envio falhar depois, devolvemos para pendente.
  //
  // Em e-mail, mandar duas vezes é pior do que não mandar. Por isso a reserva vem antes.
  // ============================================================
  const { data: reservada } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!reservada) {
    return { error: "Esta tarefa já foi enviada (ou está sendo enviada agora). Recarregue a fila." };
  }
  const devolverParaFila = async () => {
    await supabase.from("tasks").update({ status: "pending", completed_at: null }).eq("id", taskId);
  };

  let copia: { copiaEmEnviados?: boolean; erroCopia?: string; copiar?: () => Promise<any> } = {};
  try {
    copia = await sendEmail(
      acct as any,
      { to, subject: task.title || "", text: bodyText, html },
      { adiarCopia: true }   // a cópia sai do caminho crítico (ver mailer)
    );
  } catch (e: any) {
    await devolverParaFila();
    const { msgSmtp } = await import("@/lib/caixas");
    const ehAuth = /535|534|Invalid login|Username and Password not accepted|authentication|Incorrect authentication/i.test(String(e?.message || ""));

    // Caixa que reprova no LOGIN é marcada como não validada. Sem isso ela continuaria
    // no rodízio e derrubaria todo envio que caísse nela — que foi como uma caixa
    // quebrada virou a remetente de todo mundo sem ninguém perceber. Marcada, ela sai
    // do rodízio (só volta se não houver alternativa) e fica VERMELHA em Config.
    if (ehAuth) {
      await supabase
        .from("email_accounts")
        .update({ verified: false, verified_at: new Date().toISOString() })
        .eq("id", (acct as any).id);
      revalidatePath("/dashboard/config");
    }
    return { error: msgSmtp(e, (acct as any).from_email) };
  }

  // REGISTRA O ENVIO IMEDIATAMENTE — antes de qualquer outra coisa que possa falhar.
  // É este registro que alimenta o limite diário; enquanto ele não existe, o envio é
  // invisível e o limite não conta. A janela de risco agora é uma consulta, não oito
  // segundos de IMAP.
  const reg = await scoreEvent(supabase, {
    tenant_id,
    contact_id: (task as any).contact_id,
    type: "email_sent",
    user_id,
    email_account_id: (acct as any).id,
    meta: { to },
  });

  // Agora sim a cópia em "Enviados" (best-effort, fora do caminho crítico).
  if (copia.copiar) {
    try { copia = { ...(await copia.copiar()) }; } catch { /* nunca derruba o envio */ }
  }

  // A cópia em "Enviados" falhou por login/host de IMAP? Desliga para ESTA caixa.
  // Sem isso, cada envio pagaria a espera do IMAP de novo — e a pessoa está olhando
  // a tela. O aviso volta no retorno para ela saber por que a cópia parou de aparecer.
  let avisoCopia: string | undefined;
  if (copia.copiaEmEnviados === false && copia.erroCopia) {
    const permanente = /auth|login|denied|ENOTFOUND|EAI_AGAIN|certificate|Invalid credentials/i.test(copia.erroCopia);
    if (permanente) {
      await supabase.from("email_accounts").update({ save_to_sent: false }).eq("id", (acct as any).id);
      avisoCopia =
        `O e-mail saiu normalmente, mas não consegui gravar a cópia em "Enviados" (${copia.erroCopia}). ` +
        `Desliguei a cópia para esta caixa para não atrasar os próximos envios — confira host/porta de IMAP em Configurações → Canais.`;
    } else {
      avisoCopia = `O e-mail saiu normalmente, mas a cópia em "Enviados" não foi gravada desta vez (${copia.erroCopia}).`;
    }
  }

  revalidatePath("/dashboard");
  // Envio sem registro é o pior estado possível: o limite diário deixa de contá-lo e a
  // pessoa perde a noção de quanto já mandou. Se acontecer, avisa alto.
  const avisoRegistro = reg?.ok === false
    ? `ATENÇÃO: o e-mail saiu, mas o registro do envio falhou (${reg.error}). Ele NÃO entra na contagem do dia nem no limite — confira o painel "Seus envios de hoje" antes de continuar.`
    : undefined;
  return { ok: true, aviso: [avisoRegistro, avisoCopia].filter(Boolean).join(" ") || undefined, caixa: (acct as any).from_email };
}

// Envia a tarefa de WhatsApp via Evolution API (caixa ativa do tenant), com cap diário.
export async function sendWhatsAppTask(taskId: string, overrideBody?: string) {
  const { sendText } = await import("@/lib/whatsapp");
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // envio automático só no modo Evolution; no assistido o envio é manual pelo link
  const { data: tmode } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  if (((tmode as any)?.whatsapp_mode || "assistido") !== "evolution") {
    return { error: "Modo assistido: abra o link do WhatsApp para enviar (botão “Abrir WhatsApp”)." };
  }

  if (overrideBody !== undefined) {
    await supabase.from("tasks").update({ generated_content: overrideBody }).eq("id", taskId);
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, channel, generated_content, contact_id, contacts(phone, name)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "whatsapp") return { error: "Tarefa não é de WhatsApp." };
  const phone = (task as any).contacts?.phone as string | undefined;
  if (!phone) return { error: "Contato sem telefone." };

  // instância do PRÓPRIO usuário quando ela existe (ver lib/instanciaWa)
  const { instanciaDoUsuario, SEM_INSTANCIA } = await import("@/lib/instanciaWa");
  const { acc } = await instanciaDoUsuario(supabase, tenant_id, user_id);
  if (!acc) return { error: SEM_INSTANCIA };

  // meia-noite BRT (UTC-3, fixo): o servidor roda em UTC — sem isso o "dia" do cap
  // diário resetaria às 21h de Brasília e a caixa poderia enviar 2x o limite num dia real.
  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("type", "whatsapp_sent")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= ((acc as any).daily_cap ?? 40)) {
    return { error: "Limite diário de WhatsApp atingido (anti-ban). Tente amanhã." };
  }

  const res = await sendText(acc as any, phone, task.generated_content || "");
  if (res.error) return { error: res.error };

  await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", taskId);
  await scoreEvent(supabase, { tenant_id, contact_id: (task as any).contact_id, type: "task_done", user_id });
  // pelo scoreEvent, e não por insert direto: é ele que sabe gravar o autor e que
  // tolera a coluna user_id ainda não existir (0106 não aplicada).
  await scoreEvent(supabase, { tenant_id, contact_id: (task as any).contact_id, type: "whatsapp_sent", user_id });
  // guarda a mensagem enviada na conversa (para a caixa de Respostas mostrar os dois lados)
  await supabase.from("whatsapp_messages").insert({
    tenant_id,
    account_id: (acc as any).id,
    contact_id: (task as any).contact_id,
    phone,
    direction: "out",
    text: task.generated_content || "",
  });
  revalidatePath("/dashboard");
  return { ok: true };
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

export async function sendAllEmailTasks() {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const today = new Date().toISOString().slice(0, 10);
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("channel", "email")
    .eq("status", "pending")
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(TETO_POR_CLIQUE);
  const ids = ((tasks as any[]) || []).map((t) => t.id);
  if (!ids.length) return { ok: true, sent: 0, failed: 0, restantes: 0 };

  const inicio = Date.now();
  let sent = 0;
  let failed = 0;
  let limiteAtingido: string | null = null;
  let primeiroErro: string | null = null;
  const porCaixa: Record<string, number> = {};
  let i = 0;

  for (; i < ids.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_ENVIO_MS) break;
    const res = (await sendEmailTask(ids[i])) as { ok?: boolean; error?: string; caixa?: string };
    if (res?.ok) {
      sent++;
      if (res.caixa) porCaixa[res.caixa] = (porCaixa[res.caixa] || 0) + 1;
      continue;
    }
    failed++;
    if (!primeiroErro && res?.error) primeiroErro = res.error;
    // Limite diário atingido: PARAR. Insistir só produz 200 falhas iguais e some com o
    // motivo no meio delas.
    if (res?.error && /[Ll]imite/.test(res.error)) { limiteAtingido = res.error; break; }
  }

  const processados = i;
  const restantes = Math.max(0, ids.length - processados);

  revalidatePath("/dashboard");
  return {
    ok: true,
    sent,
    failed,
    restantes,
    limiteAtingido,
    primeiroErro,
    porCaixa,
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
