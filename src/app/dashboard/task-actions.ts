"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";
import { logAction, recortarItens } from "@/lib/actionLog";
import { renderTemplate } from "@/lib/cadence";
import { buildEmailHtml } from "@/lib/richtext";
import { diaISO } from "@/lib/datas";

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

// ============================================================
// CONTEXTO DE LOTE — o que não faz sentido refazer 200 vezes
//
// Enviando um a um, cada e-mail repetia: 2 consultas de capacidade, 1 da assinatura do
// workspace, e um aperto de mão SMTP inteiro. Somado, dava ~4 segundos por mensagem —
// e o lote, com 40 segundos de orçamento, entregava 10. O contexto carrega o que é
// igual para todas as mensagens da volta e mantém a conexão aberta.
//
// A capacidade é a única parte delicada: ela precisa ANDAR durante o lote, senão as
// 200 mensagens leriam "folga 80" e passariam do limite. Por isso `usadosNoLote`.
// ============================================================
type ContextoLote = {
  cap: Awaited<ReturnType<typeof import("@/lib/capacidadeEmail").capacidadeDeHoje>>;
  usadosNoLote: Record<string, number>;
  transportes: Map<string, any>;
  // sessão de "Enviados" por caixa, aberta na primeira cópia e reaproveitada.
  // `null` = já tentamos abrir e não deu — não insiste a cada mensagem.
  imap: Map<string, any>;
  assinaturaTenant?: string | null;
  // ONDE O TEMPO VAI. Duas respostas minhas sobre este problema foram palpite (o
  // limite da caixa, depois o SMTP). Medido, deixa de ser palpite.
  tempos: { banco: number; smtp: number; copia: number };
};

// Abre (uma vez por caixa) a sessão de "Enviados" do lote. Caixa que grava a cópia
// sozinha no servidor — Gmail, Outlook.com — não entra aqui: o APPEND criaria duplicata.
async function sessaoEnviadosDoLote(lote: ContextoLote, acct: any) {
  if (acct.provider === "gmail" || acct.save_to_sent === false) return undefined;
  if (lote.imap.has(acct.id)) {
    const s = lote.imap.get(acct.id);
    return s ? (raw: Buffer) => s.append(raw) : undefined;
  }
  const { abrirEnviados } = await import("@/lib/imap");
  const s = await abrirEnviados(acct);
  if ((s as any)?.append) {
    lote.imap.set(acct.id, s);
    return (raw: Buffer) => (s as any).append(raw);
  }
  lote.imap.set(acct.id, null);   // não tenta de novo a cada mensagem
  return undefined;
}

async function enviarUm(
  taskId: string,
  override?: { subject?: string; body?: string },
  lote?: ContextoLote
) {
  const tInicio = Date.now();
  const { sendEmail } = await import("@/lib/mailer");
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // se veio corpo/assunto editado, persiste na task antes de enviar
  if (override && (override.subject !== undefined || override.body !== undefined)) {
    const patch: Record<string, unknown> = {};
    if (override.subject !== undefined) patch.title = override.subject;
    if (override.body !== undefined) patch.generated_content = override.body;
    if (Object.keys(patch).length) {
      // `body_editado` (0112): texto escrito por gente não pode ser sobrescrito pela
      // reaplicação do texto da cadência. Se a coluna ainda não existe, grava sem ela —
      // um PGRST204 aqui impediria o próprio envio.
      const { error } = await supabase.from("tasks").update({ ...patch, body_editado: true }).eq("id", taskId);
      if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
        await supabase.from("tasks").update(patch).eq("id", taskId);
      }
    }
  }

  const { data: task } = await supabase
    .from("tasks")
    // enrollment_id/step_position entram aqui para o rastreio saber DE QUAL PASSO o
    // e-mail saiu — sem isso, "cliques e aberturas por passo" é impossível de montar
    // depois: a origem só é conhecida no momento do envio.
    .select("id, channel, title, generated_content, contact_id, email_account_id, enrollment_id, step_position, condicao, contacts(*)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "email") return { error: "Tarefa não é de e-mail." };

  // ============================================================
  // A ÚLTIMA PORTA ANTES DO DESTINATÁRIO
  //
  // As tarefas guardam o texto JÁ MONTADO. Quem foi criado enquanto o Radar produzia
  // nomes quebrados carrega "[object Object]" dentro do corpo, e nenhum conserto no
  // render alcança o que já está gravado. Só a checagem no envio alcança.
  //
  // Recusar é a escolha certa aqui: um e-mail que sai errado não volta, e o custo de
  // segurar é uma mensagem na tela para quem pode corrigir.
  // ============================================================
  {
    const { textoTemLixo, AVISO_LIXO } = await import("@/lib/nomeValido");
    if (textoTemLixo((task as any).title) || textoTemLixo((task as any).generated_content)) {
      return { error: AVISO_LIXO };
    }
  }
  // ---- PASSO CONDICIONAL: reconfere antes de mandar ----
  // O cron já limpa a fila do dia; isto é a rede para a janela entre uma coisa e outra
  // (e para quem dispara uma tarefa de amanhã pela ficha).
  if ((task as any).condicao) {
    const { avaliarCondicao, rotuloCondicao } = await import("@/lib/condicoes");
    const r = await avaliarCondicao(supabase, (task as any).condicao, {
      contactId: (task as any).contact_id,
      enrollmentId: (task as any).enrollment_id,
      contato: (task as any).contacts || {},
    });
    if (!r.ok) {
      await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId).eq("status", "pending");
      return { error: `Passo condicional (${rotuloCondicao((task as any).condicao)}): ${r.motivo}. Toque pulado.` };
    }
  }

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

  // ROTAÇÃO DE CAIXAS: quem sabe quanto cada caixa ainda pode enviar hoje é
  // capacidadeDeHoje — a MESMA conta que o relatório do lote mostra na tela. Antes esta
  // conta morava aqui dentro e a tela tinha a sua; quando as duas discordassem, o
  // operador leria uma capacidade que o envio não honra.
  const { capacidadeDeHoje } = await import("@/lib/capacidadeEmail");
  const cap = lote?.cap ?? (await capacidadeDeHoje(supabase));
  const accts = cap.contas;
  if (!accts.length) {
    return { error: "Nenhuma caixa de e-mail conectada. Cadastre a sua em Configurações → Canais." };
  }
  const anyWarming = cap.algumaAquecendo;
  const folgaPorId = new Map(cap.porCaixa.map((c) => [c.conta.id as string, c.folga]));
  // desconta o que JÁ saiu nesta volta: sem isto o lote leria a folga do começo em
  // todas as mensagens e passaria direto pelo limite diário.
  const folgaDe = (a: any) => (folgaPorId.get(a.id) ?? 0) - (lote?.usadosNoLote[a.id] || 0);

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
      const dSlack = folgaDe(d);
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
  // ORDEM IMPORTA: primeiro a etiqueta {{documento:…}} vira um link /s/{token}, e só
  // depois o wrapLinks passa. Invertido, o wrapLinks embrulharia o link da proposta
  // num /l/ e o clique deixaria de contar como ABERTURA de proposta (doc_opened) —
  // trocaria o sinal forte pelo fraco.
  try {
    if (baseUrl) {
      const { expandirDocumentos, temTagDocumento } = await import("@/lib/docLink");
      if (temTagDocumento(bodyText)) {
        bodyText = await expandirDocumentos(supabase, atribuicao, bodyText, baseUrl);
      }
    }
  } catch {
    /* link de documento não deve bloquear o envio */
  }
  try {
    if (baseUrl) {
      const { wrapLinks } = await import("@/lib/linktrack");
      bodyText = await wrapLinks(supabase, { ...atribuicao, body: bodyText, baseUrl });
    }
  } catch {
    /* rastreio de link não deve bloquear o envio */
  }

  // assinatura do negócio (renderiza {{primeiro_nome}}/{{empresa}} com os dados do contato)
  const tnt = lote && lote.assinaturaTenant !== undefined
    ? { email_signature: lote.assinaturaTenant }
    : ((await supabase.from("tenants").select("email_signature").maybeSingle()).data as any);
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
  const tSmtp = Date.now();
  if (lote) lote.tempos.banco += tSmtp - tInicio;
  try {
    copia = await sendEmail(
      acct as any,
      { to, subject: task.title || "", text: bodyText, html },
      {
        adiarCopia: true,           // a cópia sai do caminho crítico (ver mailer)
        transport: lote?.transportes.get((acct as any).id),
        gravarEnviados: lote ? await sessaoEnviadosDoLote(lote, acct) : undefined,
      }
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

  if (lote) {
    lote.usadosNoLote[(acct as any).id] = (lote.usadosNoLote[(acct as any).id] || 0) + 1;
    lote.tempos.smtp += Date.now() - tSmtp;
  }

  // Agora sim a cópia em "Enviados" (best-effort, fora do caminho crítico).
  if (copia.copiar) {
    const tCopia = Date.now();
    try { copia = { ...(await copia.copiar()) }; } catch { /* nunca derruba o envio */ }
    if (lote) lote.tempos.copia += Date.now() - tCopia;
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

  // no lote, quem revalida é o final da volta — 200 revalidações não adiantam nada
  if (!lote) revalidatePath("/dashboard");
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

  // O PRIMEIRO TOQUE automático é exclusividade do modo Evolution. No assistido e no
  // híbrido ele sai pela mão — no híbrido isso é escolha, não limitação: a sessão está
  // lá para receber, verificar e responder, e o disparo em massa é justamente a parte
  // que mais chama atenção.
  const { data: tmode } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  const { envioAutomatico } = await import("@/lib/waModo");
  if (!envioAutomatico((tmode as any)?.whatsapp_mode)) {
    return { error: "Neste modo o envio do primeiro toque é manual: abra o link do WhatsApp (botão “Abrir WhatsApp”)." };
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

  const { data: task } = await supabase
    .from("tasks")
    .select("id, channel, generated_content, contact_id, enrollment_id, condicao, contacts(*)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "whatsapp") return { error: "Tarefa não é de WhatsApp." };
  {
    // mesma porta do e-mail: no WhatsApp o estrago é ainda mais visível
    const { textoTemLixo, AVISO_LIXO } = await import("@/lib/nomeValido");
    if (textoTemLixo((task as any).generated_content)) return { error: AVISO_LIXO };
  }
  if ((task as any).condicao) {
    const { avaliarCondicao, rotuloCondicao } = await import("@/lib/condicoes");
    const r = await avaliarCondicao(supabase, (task as any).condicao, {
      contactId: (task as any).contact_id,
      enrollmentId: (task as any).enrollment_id,
      contato: (task as any).contacts || {},
    });
    if (!r.ok) {
      await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId).eq("status", "pending");
      return { error: `Passo condicional (${rotuloCondicao((task as any).condicao)}): ${r.motivo}. Toque pulado.` };
    }
  }

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
  if (res.error) {
    // "não tem WhatsApp" não é só um erro de envio: é um FATO sobre o contato, e a
    // descoberta custou uma consulta ao WhatsApp. Marcado, ele some da fila de envio e
    // aparece na lista de revisão — em vez de reaparecer amanhã com o mesmo erro.
    const { ehErroSemWhatsapp, marcarSemWhatsapp } = await import("@/lib/semWhatsapp");
    if (ehErroSemWhatsapp(res.error)) {
      const r = await marcarSemWhatsapp(supabase, {
        tenantId: tenant_id,
        contactId: (task as any).contact_id,
        phone,
      });
      revalidatePath("/dashboard");
      return {
        error:
          res.error +
          (r.ok
            ? r.motivo === "fixo"
              ? " Marquei o contato como sem WhatsApp (o número é fixo) — ele está em Contatos → Sem WhatsApp para você achar um celular."
              : " Marquei o contato como sem WhatsApp — ele está em Contatos → Sem WhatsApp para revisão."
            : " (não consegui marcar o contato — ele vai reaparecer nesta fila)"),
        semWhatsapp: true,
      };
    }
    return { error: res.error };
  }

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

export async function sendAllEmailTasks(selecionadas?: string[]) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const today = diaISO();

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
  const { capacidadeDeHoje: capHoje } = await import("@/lib/capacidadeEmail");
  const { transporteDeLote } = await import("@/lib/mailer");
  const capInicial = await capHoje(supabase);
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

  for (; i < ids.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_ENVIO_MS) { tempoEsgotado = true; break; }
    const res = (await enviarUm(ids[i], undefined, lote)) as { ok?: boolean; error?: string; caixa?: string };
    if (res?.ok) {
      sent++;
      if (res.caixa) porCaixa[res.caixa] = (porCaixa[res.caixa] || 0) + 1;
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
  const { capacidadeDeHoje, comoAumentar } = await import("@/lib/capacidadeEmail");
  const cap = await capacidadeDeHoje(supabase);

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
  let i = 0;

  for (; i < elegiveis.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_ENVIO_MS) { paradoPorTempo = true; break; }
    const t = elegiveis[i];

    const res =
      t.channel === "email"
        ? ((await enviarUm(t.id, undefined, lote)) as { ok?: boolean; error?: string })
        : ((await sendWhatsAppTask(t.id)) as { ok?: boolean; error?: string });

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

  return {
    ok: true,
    enviados,
    porCanal,
    falhas,
    ignoradas,
    restantes: Math.max(0, elegiveis.length - i),
    paradoPorTempo,
    motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}× ${m}`),
    detalhe: Object.entries(porCanal)
      .map(([c, n]) => `${n} ${c === "email" ? "e-mail" : "WhatsApp"}`)
      .join(" · "),
  };
}
