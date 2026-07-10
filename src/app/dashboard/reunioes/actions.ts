"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";
import { renderTemplate, addDaysISO } from "@/lib/cadence";

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

export async function scheduleMeeting(input: {
  contact_id: string;
  title: string;
  datetime: string; // ISO local do input datetime-local
  duration_min?: number;
  location?: string;
  notes?: string;
  remind_24h: boolean;
  remind_1h: boolean;
  channels: ("email" | "whatsapp")[];
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.contact_id) return { error: "Escolha o contato." };
  if (!input.datetime) return { error: "Defina data e hora." };

  const when = new Date(input.datetime);
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, company, phone, email, assigned_to")
    .eq("id", input.contact_id)
    .single();
  if (!contact) return { error: "Contato não encontrado." };
  const assigned = (contact.assigned_to as string) || user_id;

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      tenant_id,
      contact_id: input.contact_id,
      assigned_to: assigned,
      title: input.title?.trim() || "Reunião",
      datetime: when.toISOString(),
      duration_min: Number(input.duration_min) || 30,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "agendada",
      reminder_config: { "24h": input.remind_24h, "1h": input.remind_1h, canais: input.channels },
    })
    .select()
    .single();
  if (error) return { error: error.message };

  // gera as tarefas de lembrete como toques na fila (reusa o motor de cadência)
  const reminders: { channel: string; due: string; label: string }[] = [];
  const dayBefore = new Date(when);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const todayISO = new Date().toISOString().slice(0, 10);

  for (const canal of input.channels) {
    if (input.remind_24h) {
      const due = dayBefore.toISOString().slice(0, 10);
      reminders.push({ channel: canal, due: due < todayISO ? todayISO : due, label: "Lembrete 24h" });
    }
    if (input.remind_1h) {
      // 1h antes cai no mesmo dia da reunião
      reminders.push({ channel: canal, due: when.toISOString().slice(0, 10), label: "Lembrete 1h" });
    }
  }

  if (reminders.length) {
    const dt = when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const body = renderTemplate(
      `Olá {{primeiro_nome}}, confirmando nossa reunião em ${dt}. Responda SIM para confirmar. Qualquer coisa, me avise para remarcar.`,
      contact
    );
    const tasks = reminders.map((r) => ({
      tenant_id,
      contact_id: input.contact_id,
      assigned_to: assigned,
      channel: r.channel,
      title: `${r.label} — ${input.title || "Reunião"}`,
      generated_content: body,
      due_date: r.due,
      status: "pending",
    }));
    await supabase.from("tasks").insert(tasks);
  }

  await scoreEvent(supabase, { tenant_id, contact_id: input.contact_id, type: "meeting", meta: { meeting_id: meeting.id } });
  revalidatePath("/dashboard/reunioes");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function setMeetingStatus(id: string, status: string, contactId?: string) {
  const { supabase, tenant_id } = await ctx();
  const patch: Record<string, unknown> = { status };
  if (status === "confirmada") patch.confirmed_at = new Date().toISOString();
  const { error } = await supabase.from("meetings").update(patch).eq("id", id);
  if (error) return { error: error.message };

  // no-show → cadência de resgate automática (um toque de retomada em 1 dia)
  if (status === "no_show" && tenant_id && contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, name, company, phone, email, assigned_to")
      .eq("id", contactId)
      .single();
    if (contact) {
      await supabase.from("tasks").insert({
        tenant_id,
        contact_id: contactId,
        assigned_to: (contact.assigned_to as string) || null,
        channel: "whatsapp",
        title: "Resgate — não compareceu",
        generated_content: renderTemplate(
          "Olá {{primeiro_nome}}, senti sua falta na nossa reunião. Quer que eu remarque para um horário melhor?",
          contact
        ),
        due_date: addDaysISO(new Date(), 1),
        status: "pending",
      });
    }
  }
  revalidatePath("/dashboard/reunioes");
  return { ok: true };
}

// Registra o resultado da reunião (pós-call): marca realizada + guarda outcome.
export async function recordOutcome(input: {
  id: string;
  contact_id?: string;
  outcome_status: string;   // avancou | sem_interesse | remarcar | fechou
  outcome?: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const status = input.outcome_status === "remarcar" ? "remarcada" : "realizada";
  const { error } = await supabase
    .from("meetings")
    .update({ status, outcome_status: input.outcome_status, outcome: input.outcome?.trim() || null })
    .eq("id", input.id);
  if (error) return { error: error.message };

  // registra na timeline do contato
  if (input.contact_id) {
    const label =
      input.outcome_status === "fechou" ? "Reunião: fechou negócio" :
      input.outcome_status === "avancou" ? "Reunião: avançou" :
      input.outcome_status === "sem_interesse" ? "Reunião: sem interesse" : "Reunião: remarcar";
    await supabase.from("events").insert({
      tenant_id,
      contact_id: input.contact_id,
      type: "meeting",
      meta: { text: input.outcome ? `${label} — ${input.outcome}` : label },
    });
  }
  revalidatePath("/dashboard/reunioes");
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}
