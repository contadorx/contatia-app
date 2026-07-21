"use server";

import { canCreate, mensagemLimite } from "@/lib/plan";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { renderTemplate, addDaysISO, channelLabel, type Channel } from "@/lib/cadence";
import { isManager } from "@/lib/permissions";

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
};

export async function createSequence(input: {
  name: string;
  audience: string;
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

  const { data: seq, error } = await supabase
    .from("sequences")
    .insert({
      tenant_id,
      name: input.name.trim(),
      audience: input.audience || null,
      created_by: user_id,
      product_id: input.product_id || null,
      email_account_id: input.email_account_id || null,
    })
    .select()
    .single();
  if (error) return { error: error.message };

  const steps = input.steps.map((s, i) => ({
    sequence_id: seq.id,
    tenant_id,
    position: i,
    channel: s.channel,
    delay_days: Number(s.delay_days) || 0,
    subject: s.subject || null,
    subject_b: s.channel === "email" && s.subject_b?.trim() ? s.subject_b.trim() : null,
    body_template: s.body || null,
  }));
  const { error: e2 } = await supabase.from("sequence_steps").insert(steps);
  if (e2) return { error: e2.message };

  revalidatePath("/dashboard/cadencias");
  return { ok: true };
}

// Carrega uma cadência salva (com todos os passos) para edição.
export async function loadSequence(id: string) {
  const { supabase, user_id } = await ctx();
  if (!(await canUseSequence(supabase, user_id, id))) return { error: "Cadência não encontrada." };
  const { data: seq } = await supabase.from("sequences").select("id, name, audience, product_id, email_account_id").eq("id", id).maybeSingle();
  if (!seq) return { error: "Cadência não encontrada." };
  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("position, channel, delay_days, subject, subject_b, body_template")
    .eq("sequence_id", id)
    .order("position", { ascending: true });
  return {
    ok: true,
    name: (seq as any).name || "",
    audience: (seq as any).audience || "",
    product_id: (seq as any).product_id || "",
    email_account_id: (seq as any).email_account_id || "",
    steps: ((steps as any[]) || []).map((s) => ({
      channel: s.channel as Channel,
      delay_days: Number(s.delay_days) || 0,
      subject: s.subject || "",
      subject_b: s.subject_b || "",
      body: s.body_template || "",
    })) as StepInput[],
  };
}

// Atualiza uma cadência salva (nome/público + substitui os passos).
// As inscrições JÁ FEITAS não mudam — as tarefas delas foram geradas na inscrição
// (snapshot). A edição vale para as PRÓXIMAS inscrições.
export async function updateSequence(id: string, input: { name: string; audience: string; steps: StepInput[]; product_id?: string | null; email_account_id?: string | null }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!(await canUseSequence(supabase, user_id, id))) return { error: "Você não pode editar esta cadência." };
  if (!input.name.trim()) return { error: "Dê um nome à sequência." };
  if (!input.steps.length) return { error: "Adicione ao menos um passo." };

  const { error: e1 } = await supabase
    .from("sequences")
    .update({
      name: input.name.trim(),
      audience: input.audience || null,
      product_id: input.product_id || null,
      email_account_id: input.email_account_id || null,
    })
    .eq("id", id)
    .eq("tenant_id", tenant_id);
  if (e1) return { error: e1.message };

  // M2: delete + insert dos passos numa ÚNICA transação (RPC) — se algo falhar, os
  // passos antigos NÃO se perdem (antes o delete commitava antes do insert).
  const stepsJson = input.steps.map((s, i) => ({
    position: i,
    channel: s.channel,
    delay_days: Number(s.delay_days) || 0,
    subject: s.subject || null,
    subject_b: s.channel === "email" && s.subject_b?.trim() ? s.subject_b.trim() : null,
    body_template: s.body || null,
  }));
  const { error: e2 } = await supabase.rpc("replace_sequence_steps", {
    p_seq: id,
    p_tenant: tenant_id,
    p_steps: stepsJson,
  });
  if (e2) return { error: e2.message };

  revalidatePath("/dashboard/cadencias");
  return { ok: true };
}

// Inscreve um contato numa sequência e GERA as tarefas (a fila).
export async function enrollContact(contactId: string, sequenceId: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, company, phone, role_title, cnpj, custom, assigned_to, opted_out")
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
    .select("position, channel, delay_days, subject, subject_b, body_template")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });
  if (!steps?.length) return { error: "Sequência sem passos." };

  // GATE DE DADOS: o contato precisa TER o dado que cada canal exige. E-mail sem e-mail
  // e WhatsApp/ligação sem telefone não podem virar tarefa (era o bug: contato sem e-mail
  // entrava e "enviava"). Passos sem o dado são PULADOS; se sobrar zero, não inscreve.
  const hasEmail = !!(contact.email && String(contact.email).trim());
  const hasPhone = !!(contact.phone && String(contact.phone).trim());
  const podeCanal = (ch: string) =>
    ch === "email" ? hasEmail : ch === "whatsapp" || ch === "call" ? hasPhone : true;
  if (!steps.some((s) => podeCanal(s.channel))) {
    return {
      error: hasEmail || hasPhone
        ? "O contato não tem o dado necessário para nenhum passo desta cadência."
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
  if (error) return { error: error.message };

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
    tasks.push({
      tenant_id,
      enrollment_id: enr.id,
      contact_id: contactId,
      assigned_to: assigned,
      channel: s.channel,
      title: renderTemplate(chosenSubject, contact) || channelLabel[s.channel as Channel],
      generated_content: renderTemplate(s.body_template, contact),
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
  const { error: e2 } = await supabase.from("tasks").insert(tasks);
  if (e2) return { error: e2.message };

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
  if (error) return { error: error.message };
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
  if (error) return { error: error.message };
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
  if (error) return { error: error.message };
  revalidatePath("/dashboard/cadencias");
  revalidatePath("/dashboard");
  return { ok: true, removed: ativos };
}
