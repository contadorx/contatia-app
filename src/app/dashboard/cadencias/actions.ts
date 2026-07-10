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
    .select("position, channel, delay_days, subject, body_template")
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
    return {
      tenant_id,
      enrollment_id: enr.id,
      contact_id: contactId,
      assigned_to: assigned,
      channel: s.channel,
      title: s.subject || channelLabel[s.channel as Channel],
      generated_content: renderTemplate(s.body_template, contact),
      due_date: addDaysISO(today, offset),
      status: "pending",
    };
  });
  const { error: e2 } = await supabase.from("tasks").insert(tasks);
  if (e2) return { error: e2.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: tasks.length };
}

// Gera uma cadência com IA a partir de um briefing (a IA rascunha; humano aprova).
export async function generateSequenceAI(brief: { market: string; product: string; icp: string; tone?: string }) {
  if (!brief.market?.trim() || !brief.product?.trim()) {
    return { error: "Descreva ao menos o mercado e o produto." };
  }
  // config de IA do workspace (fallback pro ambiente dentro do helper)
  const supabase = createClient();
  const { data: tenant } = await supabase.from("tenants").select("ai_model, ai_api_key").maybeSingle();
  const { generateSequence } = await import("@/lib/anthropic");
  return await generateSequence(brief, {
    apiKey: (tenant as any)?.ai_api_key || undefined,
    model: (tenant as any)?.ai_model || undefined,
  });
}
