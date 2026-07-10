"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { renderTemplate, addDaysISO, channelLabel, type Channel } from "@/lib/cadence";

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
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!input.name.trim()) return { error: "Dê um nome à sequência." };
  if (!input.steps.length) return { error: "Adicione ao menos um passo." };

  const { data: seq, error } = await supabase
    .from("sequences")
    .insert({ tenant_id, name: input.name.trim(), audience: input.audience || null, created_by: user_id })
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

// Inscreve um contato numa sequência e GERA as tarefas (a fila).
export async function enrollContact(contactId: string, sequenceId: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, company, phone, assigned_to")
    .eq("id", contactId)
    .single();
  if (!contact) return { error: "Contato não encontrado." };

  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("position, channel, delay_days, subject, subject_b, body_template")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });
  if (!steps?.length) return { error: "Sequência sem passos." };

  const assigned = (contact.assigned_to as string) || user_id;

  const { data: enr, error } = await supabase
    .from("enrollments")
    .insert({ tenant_id, contact_id: contactId, sequence_id: sequenceId, assigned_to: assigned, status: "active" })
    .select()
    .single();
  if (error) return { error: error.message };

  const today = new Date();
  let offset = 0;
  const tasks = steps.map((s) => {
    offset += Number(s.delay_days) || 0;
    // A/B de assunto: se o passo tem variante B, sorteia qual usar nesta inscrição
    const hasB = s.channel === "email" && s.subject_b && String(s.subject_b).trim();
    const variant = hasB ? (Math.random() < 0.5 ? "a" : "b") : null;
    const chosenSubject = variant === "b" ? s.subject_b : s.subject;
    return {
      tenant_id,
      enrollment_id: enr.id,
      contact_id: contactId,
      assigned_to: assigned,
      channel: s.channel,
      title: chosenSubject || channelLabel[s.channel as Channel],
      generated_content: renderTemplate(s.body_template, contact),
      due_date: addDaysISO(today, offset),
      status: "pending",
      step_position: s.position,
      subject_variant: variant,
    };
  });
  const { error: e2 } = await supabase.from("tasks").insert(tasks);
  if (e2) return { error: e2.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: tasks.length };
}

// Gera uma cadência com IA a partir de um briefing rico (a IA rascunha; humano aprova).
export async function generateSequenceAI(brief: {
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
}) {
  if (!brief.market?.trim() || !brief.product?.trim()) {
    return { error: "Descreva ao menos o mercado e o produto." };
  }
  const supabase = createClient();
  const { data: tenant } = await supabase.from("tenants").select("ai_model, ai_api_key").maybeSingle();
  const { generateSequence } = await import("@/lib/anthropic");
  return await generateSequence(brief, {
    apiKey: (tenant as any)?.ai_api_key || undefined,
    model: (tenant as any)?.ai_model || undefined,
  });
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
