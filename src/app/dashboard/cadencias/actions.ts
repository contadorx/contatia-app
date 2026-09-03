"use server";

import { msgErro } from "@/lib/erros";
import { canCreate, mensagemLimite } from "@/lib/plan";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { renderTemplate, addDaysISO, channelLabel, type Channel } from "@/lib/cadence";
import { variacoesDoPasso, escolherVariacao } from "@/lib/variacoes";
import { normalizarCondicao } from "@/lib/condicoes";
import { isManager } from "@/lib/permissions";
import { logAction } from "@/lib/actionLog";

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

// A1: os server actions da cadência (load/update/report/template) precisam repetir a
// regra de visibilidade que a LISTAGEM aplica — senão um vendedor lê/edita a cadência de
// um colega chamando o action direto com o id. Gestor/dono acessam tudo do tenant;
// vendedor/SDR só o que criaram.
async function canUseSequence(supabase: any, user_id: string | undefined, sequenceId: string): Promise<boolean> {
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user_id ?? "").maybeSingle();
  if (isManager((me as any)?.role, (me as any)?.team_role)) return true;
  const { data: seq } = await supabase.from("sequences").select("created_by").eq("id", sequenceId).maybeSingle();
  return !!seq && (seq as any).created_by === user_id;
}

export type StepInput = {
  channel: Channel;
  delay_days: number;
  subject: string;
  subject_b?: string;
  body: string;
  // redações ALTERNATIVAS do mesmo passo (a principal é `body`). WhatsApp e Instagram
  // tratam texto idêntico repetido como padrão de disparo — ver @/lib/variacoes.
  body_variants?: string[];
  // regra opcional do passo ("só se abriu o e-mail") — ver @/lib/condicoes
  condicao?: { tipo: string; passo?: number | null } | null;
};

// Limpa o que veio da tela: sem vazio, sem repetido, com teto. O teto é generoso mas
// existe: alguém colando uma planilha inteira aqui viraria uma linha de banco enorme
// carregada em toda edição de cadência.
const MAX_VARIACOES = 10;
function variacoesLimpas(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const t = String(x ?? "").trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_VARIACOES) break;
  }
  return out.length ? out : null;
}

export async function createSequence(input: {
  name: string;
  audience: string;
  goal?: string;
  steps: StepInput[];
  product_id?: string | null;
  email_account_id?: string | null;
}) {
  const lim = await canCreate("cadencias");
  if (!lim.permitido) {
    return { error: mensagemLimite("cadencias", lim.usado, lim.limite, lim.sugerido) };
  }

  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!input.name.trim()) return { error: "Dê um nome à sequência." };
  if (!input.steps.length) return { error: "Adicione ao menos um passo." };

  // `goal` nasce na migration 0107. Se ela ainda não estiver aplicada, o insert com a
  // coluna falha inteiro e a pessoa não consegue criar cadência NENHUMA — por isso a
  // segunda tentativa sem o campo. Mesma regra do bug dos 257 envios: não depender do
  // código de erro, só tentar de novo sem a coluna nova.
  const baseSeq = {
    tenant_id,
    name: input.name.trim(),
    audience: input.audience || null,
    created_by: user_id,
    product_id: input.product_id || null,
    email_account_id: input.email_account_id || null,
  };
  let { data: seq, error } = await supabase
    .from("sequences")
    .insert({ ...baseSeq, goal: (input.goal || "").trim() || null })
    .select()
    .single();
  if (error) {
    ({ data: seq, error } = await supabase.from("sequences").insert(baseSeq).select().single());
  }
  if (error) return { error: msgErro(error) };

  const steps = input.steps.map((s, i) => ({
    sequence_id: seq.id,
    tenant_id,
    position: i,
    channel: s.channel,
    delay_days: Number(s.delay_days) || 0,
    subject: s.subject || null,
    subject_b: s.channel === "email" && s.subject_b?.trim() ? s.subject_b.trim() : null,
    body_template: s.body || null,
    body_variants: variacoesLimpas(s.body_variants),
    condicao: normalizarCondicao(s.condicao),
  }));
  const { error: e2 } = await supabase.from("sequence_steps").insert(steps);
  if (e2) return { error: msgErro(e2) };

  revalidatePath("/dashboard/cadencias");
  return { ok: true };
}

// Carrega uma cadência salva (com todos os passos) para edição.
export async function loadSequence(id: string) {
  const { supabase, user_id } = await ctx();
  if (!(await canUseSequence(supabase, user_id, id))) return { error: "Cadência não encontrada." };
  // select("*"): pedir `goal` pelo nome quebraria a edição enquanto a 0107 não for aplicada.
  const { data: seq } = await supabase.from("sequences").select("*").eq("id", id).maybeSingle();
  if (!seq) return { error: "Cadência não encontrada." };
  const { data: steps } = await supabase
    .from("sequence_steps")
    // `*` de propósito: `body_variants` nasce na 0111 e, pedida pelo nome, derrubaria a
    // EDIÇÃO de cadência inteira enquanto a migration não estivesse aplicada.
    .select("*")
    .eq("sequence_id", id)
    .order("position", { ascending: true });
  return {
    ok: true,
    name: (seq as any).name || "",
    audience: (seq as any).audience || "",
    goal: (seq as any).goal || "",
    product_id: (seq as any).product_id || "",
    email_account_id: (seq as any).email_account_id || "",
    steps: ((steps as any[]) || []).map((s) => ({
      channel: s.channel as Channel,
      delay_days: Number(s.delay_days) || 0,
      subject: s.subject || "",
      subject_b: s.subject_b || "",
      body_variants: Array.isArray(s.body_variants) ? (s.body_variants as string[]) : [],
      condicao: normalizarCondicao((s as any).condicao),
      body: s.body_template || "",
    })) as StepInput[],
  };
}

// Atualiza uma cadência salva (nome/público + substitui os passos).
// As inscrições JÁ FEITAS não mudam — as tarefas delas foram geradas na inscrição
// (snapshot). A edição vale para as PRÓXIMAS inscrições.
export async function updateSequence(id: string, input: { name: string; audience: string; goal?: string; steps: StepInput[]; product_id?: string | null; email_account_id?: string | null }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!(await canUseSequence(supabase, user_id, id))) return { error: "Você não pode editar esta cadência." };
  if (!input.name.trim()) return { error: "Dê um nome à sequência." };
  if (!input.steps.length) return { error: "Adicione ao menos um passo." };

  const baseUpd = {
    name: input.name.trim(),
    audience: input.audience || null,
    product_id: input.product_id || null,
    email_account_id: input.email_account_id || null,
  };
  let { error: e1 } = await supabase
    .from("sequences")
    .update({ ...baseUpd, goal: (input.goal || "").trim() || null })
    .eq("id", id)
    .eq("tenant_id", tenant_id);
  if (e1) {
    ({ error: e1 } = await supabase.from("sequences").update(baseUpd).eq("id", id).eq("tenant_id", tenant_id));
  }
  if (e1) return { error: msgErro(e1) };

  // M2: delete + insert dos passos numa ÚNICA transação (RPC) — se algo falhar, os
  // passos antigos NÃO se perdem (antes o delete commitava antes do insert).
  const stepsJson = input.steps.map((s, i) => ({
    position: i,
    channel: s.channel,
    delay_days: Number(s.delay_days) || 0,
    subject: s.subject || null,
    subject_b: s.channel === "email" && s.subject_b?.trim() ? s.subject_b.trim() : null,
    body_template: s.body || null,
    // A FUNÇÃO DO BANCO PRECISA CONHECER O CAMPO (0111). Enquanto a migration não for
    // aplicada, ela ignora `body_variants` e as variações somem ao salvar — sem erro
    // nenhum. Por isso a migration acompanha esta entrega.
    body_variants: variacoesLimpas(s.body_variants),
    condicao: normalizarCondicao(s.condicao),
  }));
  const { error: e2 } = await supabase.rpc("replace_sequence_steps", {
    p_seq: id,
    p_tenant: tenant_id,
    p_steps: stepsJson,
  });
  if (e2) return { error: msgErro(e2) };

  revalidatePath("/dashboard/cadencias");
  return { ok: true };
}

// Inscreve um contato numa sequência e GERA as tarefas (a fila).
export async function enrollContact(contactId: string, sequenceId: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, company, phone, role_title, cnpj, custom, assigned_to, opted_out, wa_status")
    .eq("id", contactId)
    .single();
  if (!contact) return { error: "Contato não encontrado." };
  // GATE DE SUPRESSÃO: contato que pediu "parar" (opted_out) nunca é reinscrito.
  if ((contact as any).opted_out) return { error: "Contato suprimido (pediu para parar). Não pode ser reinscrito.", suppressed: true };

  // M1: não inscreve de novo quem já está ATIVO/PAUSADO nesta cadência (senão gera um
  // 2º jogo de tarefas → o lead recebe cada e-mail duas vezes). O índice único 0070 é o
  // backstop; aqui damos a mensagem amigável e evitamos o trabalho.
  const { data: jaInscrito } = await supabase
    .from("enrollments")
    .select("id")
    .eq("tenant_id", tenant_id)
    .eq("contact_id", contactId)
    .eq("sequence_id", sequenceId)
    .in("status", ["active", "paused"])
    .limit(1)
    .maybeSingle();
  if (jaInscrito) return { error: "Este contato já está ativo nesta cadência.", already: true };

  const { data: steps } = await supabase
    .from("sequence_steps")
    // `*` de propósito: `body_variants` nasce na 0111 e, pedida pelo nome, derrubaria a
    // EDIÇÃO de cadência inteira enquanto a migration não estivesse aplicada.
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });
  if (!steps?.length) return { error: "Sequência sem passos." };

  // GATE DE DADOS: o contato precisa TER o dado que cada canal exige. E-mail sem e-mail
  // e WhatsApp/ligação sem telefone não podem virar tarefa (era o bug: contato sem e-mail
  // entrava e "enviava"). Passos sem o dado são PULADOS; se sobrar zero, não inscreve.
  const hasEmail = !!(contact.email && String(contact.email).trim());
  const hasPhone = !!(contact.phone && String(contact.phone).trim());
  // ============================================================
  // JÁ SABEMOS QUE NÃO TEM WHATSAPP — não crie a tarefa
  //
  // `wa_status='invalid'` é conclusão VERIFICADA (a verificação em massa ou o próprio
  // envio perguntaram ao WhatsApp, com e sem o 9º dígito). Continuar gerando passo de
  // WhatsApp para esse contato produz uma tarefa que só existe para dar erro no dia do
  // disparo — e foi o que encheu a fila de hoje. Ligação continua valendo: o número
  // existe, só não serve para este canal.
  // ============================================================
  const semWa = (contact as any).wa_status === "invalid";
  const podeCanal = (ch: string) =>
    ch === "email" ? hasEmail : ch === "whatsapp" ? hasPhone && !semWa : ch === "call" ? hasPhone : true;
  if (!steps.some((s) => podeCanal(s.channel))) {
    return {
      error: hasEmail || hasPhone
        ? semWa
          ? "Esta cadência só tem passos que este contato não pode receber: o número dele já foi verificado e não tem WhatsApp."
          : "O contato não tem o dado necessário para nenhum passo desta cadência."
        : "Este contato não tem e-mail nem telefone — adicione um contato antes de inscrever numa cadência.",
      missingData: true,
    };
  }

  // RESOLVE a caixa de e-mail desta inscrição: override da cadência → RODÍZIO no
  // pool do produto → caixa única legada → null (rodízio geral no envio). Carimba
  // na tarefa para o envio usar direto e manter o mesmo sender para o contato.
  const { resolveEmailBox } = await import("@/lib/caixas");
  const resolvedBox: string | null = await resolveEmailBox(supabase, tenant_id, sequenceId);

  const assigned = (contact.assigned_to as string) || user_id;

  const { data: enr, error } = await supabase
    .from("enrollments")
    .insert({ tenant_id, contact_id: contactId, sequence_id: sequenceId, assigned_to: assigned, status: "active" })
    .select()
    .single();
  if (error) return { error: msgErro(error) };

  const today = new Date();
  let offset = 0;
  const tasks = [];
  for (const s of steps) {
    // o cronograma acumula sobre TODOS os passos (mantém as datas), mas só vira tarefa
    // o passo cujo canal o contato consegue receber.
    offset += Number(s.delay_days) || 0;
    if (!podeCanal(s.channel)) continue;
    // A/B de assunto: se o passo tem variante B, sorteia qual usar nesta inscrição
    const hasB = s.channel === "email" && s.subject_b && String(s.subject_b).trim();
    const variant = hasB ? (Math.random() < 0.5 ? "a" : "b") : null;
    const chosenSubject = variant === "b" ? s.subject_b : s.subject;
    // qual das redações deste passo vai para ESTE contato (ver @/lib/variacoes)
    const redacoes = variacoesDoPasso(s.body_template, (s as any).body_variants);
    const escolha = escolherVariacao(redacoes, `${contactId}:${s.position}`);
    tasks.push({
      tenant_id,
      enrollment_id: enr.id,
      contact_id: contactId,
      assigned_to: assigned,
      channel: s.channel,
      title: renderTemplate(chosenSubject, contact) || channelLabel[s.channel as Channel],
      generated_content: renderTemplate(escolha.texto || s.body_template, contact),
      body_variant: escolha.indice,
      // a condição vai JUNTO com a tarefa: ela é o compromisso já assumido com este
      // contato, e editar a cadência amanhã não pode mudar o que está na fila sozinho
      condicao: normalizarCondicao((s as any).condicao),
      due_date: addDaysISO(today, offset),
      status: "pending",
      step_position: s.position,
      subject_variant: variant,
      email_account_id: s.channel === "email" ? resolvedBox : null,
    });
  }
  // segurança: se por algum motivo nada virou tarefa, desfaz a inscrição em vez de deixá-la vazia.
  if (!tasks.length) {
    await supabase.from("enrollments").delete().eq("id", enr.id);
    return { error: "O contato não tem os dados necessários para os passos desta cadência.", missingData: true };
  }
  // inserirTarefas: tolera a 0111 ainda não aplicada (ver o comentário lá). Sem isso a
  // inscrição ficaria SEM TAREFAS na janela entre publicar o app e rodar a migration.
  const { inserirTarefas } = await import("@/lib/inserirTarefas");
  const r2 = await inserirTarefas(supabase, tasks);
  if (r2.error) return { error: msgErro(r2.error) };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: tasks.length };
}

// Gera uma cadência com IA a partir de um briefing rico (a IA rascunha; humano aprova).
export async function generateSequenceAI(
  brief: {
    market: string;
    product: string;
    icp: string;
    tone?: string;
    pain?: string;
    proof?: string;
    goal?: string;
    cta?: string;
    avoid?: string;
    steps?: number;
    channels?: string[];
  },
  opts?: { premium?: boolean; rapport?: boolean },
) {
  // IA inclusa em TODOS os planos — sem gate de feature.
  if (!brief.market?.trim() || !brief.product?.trim()) {
    return { error: "Descreva ao menos o mercado e o produto." };
  }

  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("ai_model, ai_api_key, platform_plans(ai_quota, opus_quota, segment)")
    .eq("id", tenant_id)
    .maybeSingle();

  const plan = (tenant as any)?.platform_plans;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // ---- TRAVA DE USO JUSTO (todas as gerações do mês, padrão + Opus) ----
  // fallback = 100 (alinhado ao valor dos planos na migration 0076); usa != null para
  // respeitar um 0 explícito (plano que queira desativar), em vez de cair no fallback.
  let quota = plan?.ai_quota != null ? Number(plan.ai_quota) : 100;
  if (plan?.segment === "equipe") {
    const { count: seats } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id);
    quota = quota * Math.max(1, seats ?? 1);
  }
  const { count: usedTotal } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id)
    .in("type", ["ai_generation", "ai_generation_opus"])
    .gte("created_at", monthStart);
  if ((usedTotal ?? 0) >= quota) {
    return { error: `Você atingiu o limite de ${quota} gerações de IA neste mês. O limite renova no dia 1º. Precisa de mais volume? Fale com a gente.` };
  }

  // ---- PACOTE OPUS (qualidade máxima, cota própria e bounded) ----
  const premium = !!opts?.premium;
  let model = (tenant as any)?.ai_model || undefined;
  if (premium) {
    const opusQuota = plan?.opus_quota != null ? Number(plan.opus_quota) : 20;
    const { count: usedOpus } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("type", "ai_generation_opus")
      .gte("created_at", monthStart);
    if ((usedOpus ?? 0) >= opusQuota) {
      return { error: `Você já usou as ${opusQuota} gerações no Opus (qualidade máxima) deste mês. Gere no modelo padrão ou aguarde a renovação no dia 1º.` };
    }
    model = process.env.ANTHROPIC_MODEL_PREMIUM || "claude-opus-4-5";
  }

  const { generateSequence } = await import("@/lib/anthropic");
  const result = await generateSequence(brief, {
    apiKey: (tenant as any)?.ai_api_key || undefined,
    model,
    rapport: !!opts?.rapport,
  });

  // conta a geração só quando deu certo (não penaliza erro de API)
  if ((result as any)?.steps) {
    await supabase.from("events").insert({ tenant_id, type: premium ? "ai_generation_opus" : "ai_generation", meta: {} } as any);
  }
  return result;
}

// Quanto resta do pacote Opus no mês (para a UI).
export async function opusRemaining(): Promise<{ used: number; quota: number }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { used: 0, quota: 0 };
  const { data: tenant } = await supabase.from("tenants").select("platform_plans(opus_quota)").eq("id", tenant_id).maybeSingle();
  const quota = (tenant as any)?.platform_plans?.opus_quota != null ? Number((tenant as any).platform_plans.opus_quota) : 20;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id)
    .eq("type", "ai_generation_opus")
    .gte("created_at", monthStart);
  return { used: count ?? 0, quota };
}

// Carrega o contexto salvo do negócio (para pré-preencher o painel de IA).
export async function loadAiContext() {
  const supabase = createClient();
  const { data: tenant } = await supabase.from("tenants").select("ai_context, segment, legal_name").maybeSingle();
  const ctx = ((tenant as any)?.ai_context as Record<string, unknown>) || {};
  // sugestões da ficha do negócio quando o contexto ainda está vazio
  if (!ctx.market && (tenant as any)?.segment) ctx.market = (tenant as any).segment;
  if (!ctx.product && (tenant as any)?.legal_name) ctx.product = "";
  return { context: ctx };
}

// Salva o contexto rico no negócio para reuso.
export async function saveAiContext(context: Record<string, unknown>) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  const tenant_id = profile?.tenant_id as string | undefined;
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("tenants").update({ ai_context: context }).eq("id", tenant_id);
  if (error) return { error: msgErro(error) };
  return { ok: true };
}

// Lista templates disponíveis (globais + do tenant).
export async function listTemplates() {
  const { supabase } = await ctx();
  const { data } = await supabase
    .from("sequence_templates")
    .select("id, name, audience, description, steps, is_global")
    .order("is_global", { ascending: false })
    .order("created_at", { ascending: false });
  return { templates: (data as any[]) || [] };
}

// Cria uma cadência a partir de um template (clona os passos).
export async function createFromTemplate(templateId: string) {
  const { supabase } = await ctx();
  const { data: tpl } = await supabase
    .from("sequence_templates")
    .select("name, audience, steps")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl) return { error: "Template não encontrado." };
  const steps = (((tpl as any).steps as any[]) || []).map((s) => ({
    channel: s.channel,
    delay_days: Number(s.delay_days) || 0,
    subject: s.subject || "",
    body: s.body || "",
  }));
  if (!steps.length) return { error: "Template sem passos." };
  return await createSequence({ name: (tpl as any).name, audience: (tpl as any).audience || "", steps });
}

// Salva uma cadência existente como template do tenant.
export async function saveAsTemplate(sequenceId: string, description?: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!(await canUseSequence(supabase, user_id, sequenceId))) return { error: "Cadência não encontrada." };
  const { data: seq } = await supabase.from("sequences").select("name, audience").eq("id", sequenceId).maybeSingle();
  if (!seq) return { error: "Cadência não encontrada." };
  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("channel, delay_days, subject, body_template")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });
  const stepsJson = (((steps as any[]) || []).map((s) => ({
    channel: s.channel,
    delay_days: s.delay_days,
    subject: s.subject || "",
    body: s.body_template || "",
  })));
  if (!stepsJson.length) return { error: "Cadência sem passos." };
  const { error } = await supabase.from("sequence_templates").insert({
    tenant_id,
    name: (seq as any).name,
    audience: (seq as any).audience,
    description: description || null,
    steps: stepsJson,
    is_global: false,
    created_by: user_id,
  });
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/cadencias");
  return { ok: true };
}

// Pausa uma inscrição específica (e pula as tarefas pendentes dela).
export async function pauseEnrollment(enrollmentId: string) {
  const { supabase } = await ctx();
  await supabase.from("enrollments").update({ status: "paused" }).eq("id", enrollmentId);
  await supabase.from("tasks").update({ status: "skipped" }).eq("enrollment_id", enrollmentId).eq("status", "pending");
  revalidatePath("/dashboard/contatos", "layout");
  return { ok: true };
}

// Retoma uma inscrição pausada (reativa; novas tarefas só nos próximos passos).
export async function resumeEnrollment(enrollmentId: string) {
  const { supabase } = await ctx();
  await supabase.from("enrollments").update({ status: "active" }).eq("id", enrollmentId);
  revalidatePath("/dashboard/contatos", "layout");
  return { ok: true };
}

// REMOVE o contato da cadência: encerra a inscrição (status "stopped") e cancela as
// tarefas de e-mail/WhatsApp ainda pendentes. Diferente de pausar — não há retomar.
export async function stopEnrollment(enrollmentId: string) {
  const { supabase } = await ctx();
  await supabase.from("enrollments").update({ status: "stopped" }).eq("id", enrollmentId);
  await supabase.from("tasks").update({ status: "skipped" }).eq("enrollment_id", enrollmentId).eq("status", "pending");
  revalidatePath("/dashboard/contatos", "layout");
  return { ok: true };
}

// Exclui uma cadência. Bloqueia se houver inscrições ativas/pausadas (evita perder trabalho).
export async function deleteSequence(id: string, force = false) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { count } = await supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("sequence_id", id).in("status", ["active", "paused"]);
  const ativos = count ?? 0;
  // Sem force: bloqueia e avisa (para o usuário confirmar). Devolve o total para a UI.
  if (ativos > 0 && !force) {
    return { needsConfirm: true, active: ativos, error: `Há ${ativos} contato(s) ativo(s)/pausado(s) nesta cadência.` };
  }
  // Com force: apaga a cadência mesmo com contatos dentro. Os enrollments desses contatos
  // (e as tasks pendentes deles) são removidos em cascata pelo banco (FK on delete cascade),
  // ou seja, esses contatos saem da cadência e da fila de toques automaticamente.
  const { error } = await supabase.from("sequences").delete().eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/cadencias");
  revalidatePath("/dashboard");
  return { ok: true, removed: ativos };
}

// ============================================================
// REAPLICAR O TEXTO DA CADÊNCIA NAS TAREFAS PENDENTES
//
// O texto é renderizado e GRAVADO dentro de cada tarefa no momento da inscrição —
// `{{primeiro_nome}}` já virou "Adriana" ali. É isso que faz o envio ser rápido e
// previsível, e é isso que faz editar a cadência NÃO mexer em quem já está inscrito.
// Consertar a mensagem depois de inscrever 260 contatos não consertava nada: a fila
// continuava com o texto velho, e a única saída era editar tarefa por tarefa.
//
// Esta ação fecha esse buraco, com quatro travas:
//
//  1. SÓ O QUE NÃO SAIU. Tarefa `done` ou `skipped` é história — mexer nela seria
//     reescrever o passado e estragar o relatório do que foi de fato enviado.
//  2. TEXTO ESCRITO POR GENTE FICA. `body_editado` (0112) marca a tarefa que alguém
//     ajustou na fila; ela é pulada por padrão, e incluí-la é escolha explícita.
//  3. SIMULA ANTES. `simularReaplicacao` devolve os números e exemplos ANTES/DEPOIS
//     reais, com os dados do contato — porque "confie em mim" não é revisão.
//  4. ORÇAMENTO DE TEMPO. Base grande não cabe numa execução; a volta devolve
//     `incompleto` e a tela chama de novo até zerar, igual à exclusão em massa.
//
// A variação da mensagem (0111) é reescolhida pela MESMA regra determinística da
// inscrição: mesmo contato, mesma versão — a não ser que você tenha mudado as versões,
// que é justamente o que se quer propagar.
// ============================================================
const ORCAMENTO_REAPLICAR_MS = 35_000;
const FATIA_TAREFAS = 200;

type LinhaPreparada = {
  id: string;
  contato: string;
  canal: string;
  antes: string;
  depois: string;
  tituloDepois: string | null;
  variacao: number;
  editada: boolean;
};

async function prepararReaplicacao(
  supabase: any,
  sequenceId: string,
  opts: { limite: number }
): Promise<{ linhas: LinhaPreparada[]; editadas: number; total: number; semColunaEditado: boolean; error?: string }> {
  const { data: steps } = await supabase
    .from("sequence_steps")
    // `*`: `body_variants` nasce na 0111 e, pedida pelo nome, derrubaria tudo antes dela
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });
  if (!steps?.length) return { linhas: [], editadas: 0, total: 0, semColunaEditado: false, error: "Cadência sem passos." };

  const porPosicao = new Map<number, any>();
  for (const s of steps as any[]) porPosicao.set(Number(s.position), s);

  // matrículas vivas desta cadência (quem respondeu ou terminou não entra)
  const { data: enrs } = await supabase
    .from("enrollments")
    .select("id")
    .eq("sequence_id", sequenceId)
    .in("status", ["active", "paused"])
    .order("id", { ascending: true })
    .limit(5000);
  const enrollmentIds = ((enrs as any[]) || []).map((e) => e.id);
  if (!enrollmentIds.length) return { linhas: [], editadas: 0, total: 0, semColunaEditado: false };

  const tarefas: any[] = [];
  let semColunaEditado = false;
  for (let i = 0; i < enrollmentIds.length; i += FATIA_TAREFAS) {
    const fatia = enrollmentIds.slice(i, i + FATIA_TAREFAS);
    let { data, error } = await supabase
      .from("tasks")
      .select("id, channel, title, generated_content, step_position, contact_id, body_editado, contacts(*)")
      .in("enrollment_id", fatia)
      .eq("status", "pending")
      .order("due_date", { ascending: true });
    if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
      // 0112 ainda não aplicada: seguimos sem distinguir editadas, e a tela avisa.
      semColunaEditado = true;
      const r2 = await supabase
        .from("tasks")
        .select("id, channel, title, generated_content, step_position, contact_id, contacts(*)")
        .in("enrollment_id", fatia)
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      data = r2.data as any;
      error = r2.error as any;
    }
    if (error) return { linhas: [], editadas: 0, total: 0, semColunaEditado, error: msgErro(error) };
    tarefas.push(...(((data as any[]) || [])));
  }

  let editadas = 0;
  const linhas: LinhaPreparada[] = [];
  for (const t of tarefas) {
    const passo = porPosicao.get(Number(t.step_position));
    if (!passo) continue;                       // passo removido da cadência: não inventa texto
    if (t.body_editado) { editadas++; continue; }

    const contato = t.contacts || {};
    const redacoes = variacoesDoPasso(passo.body_template, (passo as any).body_variants);
    const escolha = escolherVariacao(redacoes, `${t.contact_id}:${passo.position}`);
    const depois = renderTemplate(escolha.texto || passo.body_template, contato) || "";
    const titulo =
      passo.channel === "email"
        ? renderTemplate(passo.subject, contato) || (channelLabel as any)[passo.channel]
        : null;

    const antes = String(t.generated_content || "");
    const mudouTexto = antes.trim() !== depois.trim();
    const mudouTitulo = passo.channel === "email" && String(t.title || "").trim() !== String(titulo || "").trim();
    if (!mudouTexto && !mudouTitulo) continue;  // já está igual: não gasta escrita

    linhas.push({
      id: t.id,
      contato: (contato.name as string) || "(sem nome)",
      canal: t.channel,
      antes,
      depois,
      tituloDepois: titulo,
      variacao: escolha.indice,
      editada: false,
    });
    if (linhas.length >= opts.limite) break;
  }

  return { linhas, editadas, total: linhas.length, semColunaEditado };
}

// Mostra o que MUDARIA, sem escrever nada. É a revisão que faltava antes de 260
// mensagens saírem com o texto errado.
export async function simularReaplicacao(sequenceId: string): Promise<{
  ok?: boolean; mudam?: number; editadas?: number; semColunaEditado?: boolean;
  exemplos?: { contato: string; canal: string; antes: string; depois: string }[];
  error?: string;
}> {
  const { supabase, user_id } = await ctx();
  if (!(await canUseSequence(supabase, user_id, sequenceId))) return { error: "Cadência não encontrada." };
  const r = await prepararReaplicacao(supabase, sequenceId, { limite: 5000 });
  if (r.error) return { error: r.error };
  return {
    ok: true,
    mudam: r.linhas.length,
    editadas: r.editadas,
    semColunaEditado: r.semColunaEditado,
    exemplos: r.linhas.slice(0, 3).map((l) => ({
      contato: l.contato,
      canal: l.canal,
      antes: l.antes.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 220),
      depois: l.depois.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 220),
    })),
  };
}

export async function reaplicarTextos(sequenceId: string): Promise<{
  ok?: boolean; atualizadas?: number; editadasPuladas?: number; incompleto?: boolean; error?: string;
}> {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!(await canUseSequence(supabase, user_id, sequenceId))) return { error: "Cadência não encontrada." };

  const inicio = Date.now();
  const r = await prepararReaplicacao(supabase, sequenceId, { limite: 2000 });
  if (r.error) return { error: r.error };
  if (!r.linhas.length) return { ok: true, atualizadas: 0, editadasPuladas: r.editadas };

  let atualizadas = 0;
  let incompleto = false;
  for (const l of r.linhas) {
    if (Date.now() - inicio > ORCAMENTO_REAPLICAR_MS) { incompleto = true; break; }
    const patch: Record<string, unknown> = { generated_content: l.depois, body_variant: l.variacao };
    if (l.tituloDepois !== null) patch.title = l.tituloDepois;
    let { error } = await supabase.from("tasks").update(patch).eq("id", l.id).eq("status", "pending");
    if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
      // 0111 não aplicada: grava sem o número da variação (o texto é o que importa)
      const { body_variant, ...semVariacao } = patch as any;
      const r2 = await supabase.from("tasks").update(semVariacao).eq("id", l.id).eq("status", "pending");
      error = r2.error as any;
    }
    if (error) return { ok: true, atualizadas, editadasPuladas: r.editadas, error: msgErro(error) };
    atualizadas++;
  }

  // registro: reescrever a fila de 260 pessoas sem deixar rastro seria pior que o bug
  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "cadence_reapply_text",
    entity: "sequence",
    entity_id: sequenceId,
    qtd: atualizadas,
    detail:
      `Reaplicou o texto da cadência em ${atualizadas} tarefa(s) pendente(s)` +
      (r.editadas ? ` — ${r.editadas} editada(s) à mão foram preservadas` : "") +
      (incompleto ? " (volta parcial: orçamento de tempo)" : "") + ".",
    meta: { atualizadas, editadasPuladas: r.editadas, incompleto },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/cadencias");
  return { ok: true, atualizadas, editadasPuladas: r.editadas, incompleto };
}

// ============================================================
// AUTOPILOTO DA CADÊNCIA (0122)
//
// Liga: quem responder a esta cadência pelo WhatsApp cai no agente, sem clique.
//
// É o interruptor que faz o agente escalar — e, pela mesma razão, o que faz um playbook
// ruim escalar. Por isso ele confere, na hora de LIGAR, que existe agente ligado e
// playbook publicado: são as duas condições sem as quais o lead responde e encontra ou
// silêncio, ou um agente que não sabe o que vende.
//
// DESLIGAR nunca é barrado, e não pede confirmação: freio não faz pergunta. As conversas
// que já estão com o agente continuam com ele — desligar impede novas entregas, não
// arranca de volta o que já está andando. Para tirar uma conversa específica, o botão é
// "Assumir", em Conversas.
// ============================================================
export async function setAutopilotoCadencia(id: string, ligar: boolean) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!(await canUseSequence(supabase, user_id, id))) return { error: "Você não pode editar esta cadência." };

  if (ligar) {
    const { data: cfg } = await supabase
      .from("agent_config").select("ativo").eq("tenant_id", tenant_id).maybeSingle();
    if (!(cfg as any)?.ativo) {
      return { error: "O agente está desligado. Ligue em Agente antes — senão o lead responde e não encontra ninguém." };
    }
    const { count } = await supabase
      .from("agent_playbooks").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id).eq("ativo", true);
    if (!count) {
      return { error: "Nenhum playbook publicado. Sem ele o agente não sabe o que vende — publique um em Agente → Playbook." };
    }
  }

  const { error } = await supabase
    .from("sequences")
    .update({ agente_autopiloto: ligar })
    .eq("id", id)
    .eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };

  const { logAction } = await import("@/lib/actionLog");
  await logAction(supabase, {
    tenant_id, user_id,
    action: ligar ? "autopiloto_ligado" : "autopiloto_desligado",
    entity: "sequence", entity_id: id, qtd: 1,
    detail: ligar
      ? "Autopiloto LIGADO: quem responder a esta cadência passa para o agente automaticamente."
      : "Autopiloto desligado nesta cadência.",
  });

  revalidatePath("/dashboard/cadencias");
  return { ok: true };
}
