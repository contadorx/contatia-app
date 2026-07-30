"use server";

import { msgErro } from "@/lib/erros";
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

// Remove o evento do Google Calendar vinculado à reunião (se houver) e limpa os campos.
async function removeGoogleEvent(supabase: any, meetingId: string) {
  try {
    const { data: m } = await supabase.from("meetings").select("google_event_id").eq("id", meetingId).maybeSingle();
    const eventId = (m as any)?.google_event_id as string | undefined;
    if (!eventId) return;
    const { data: acct } = await supabase
      .from("email_accounts")
      .select("oauth_refresh_token")
      .eq("provider", "gmail")
      .eq("is_active", true)
      .not("oauth_refresh_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const refresh = (acct as any)?.oauth_refresh_token as string | undefined;
    if (refresh) {
      const { deleteCalendarEvent } = await import("@/lib/gcal");
      await deleteCalendarEvent(refresh, eventId);
    }
    await supabase.from("meetings").update({ google_event_id: null, google_event_link: null }).eq("id", meetingId);
  } catch {
    /* falha no Google não deve bloquear a ação */
  }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function scheduleMeeting(input: {
  contact_id?: string;            // retrocompatível (1 contato)
  contact_ids?: string[];         // vários contatos
  guest_emails?: string[];        // convidados avulsos (sem contato cadastrado)
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
  if (!input.datetime) return { error: "Defina data e hora." };

  // junta os contatos (contact_id único + lista) e os convidados avulsos por e-mail
  const contactIds = Array.from(new Set([
    ...(input.contact_id ? [input.contact_id] : []),
    ...((input.contact_ids || []).filter(Boolean)),
  ]));
  const guestEmails = Array.from(new Set(
    (input.guest_emails || []).map((e) => (e || "").trim().toLowerCase()).filter((e) => emailRe.test(e))
  ));

  let contatos: any[] = [];
  if (contactIds.length) {
    const { data } = await supabase
      .from("contacts")
      .select("id, name, company, phone, email, assigned_to")
      .in("id", contactIds);
    contatos = (data as any[]) || [];
  }
  if (!contatos.length && !guestEmails.length) {
    return { error: "Escolha ao menos um contato ou informe o e-mail de um convidado." };
  }

  const when = new Date(input.datetime);
  const primary = contatos[0] || null;                    // contato principal (pode ser nulo: só convidado avulso)
  const assigned = (primary?.assigned_to as string) || user_id;
  const titulo = input.title?.trim() || "Reunião";

  // lista de convidados (com e-mail) para o convite: contatos + avulsos
  const convidados = [
    ...contatos.filter((c) => c.email).map((c) => ({ email: String(c.email).toLowerCase(), name: c.name as string })),
    ...guestEmails.map((e) => ({ email: e, name: null as string | null })),
  ];
  const emailsConvite = Array.from(new Set(convidados.map((c) => c.email)));

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      tenant_id,
      contact_id: primary?.id || null,   // meetings.contact_id é opcional → permite convidado avulso
      assigned_to: assigned,
      title: titulo,
      datetime: when.toISOString(),
      duration_min: Number(input.duration_min) || 30,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "agendada",
      reminder_config: {
        "24h": input.remind_24h, "1h": input.remind_1h, canais: input.channels,
        // guarda todos os convidados (o meetings só tem 1 contact_id)
        convidados,
        contact_ids: contatos.map((c) => c.id),
      },
    })
    .select()
    .single();
  if (error) return { error: msgErro(error) };

  // LEMBRETES: uma tarefa por contato cadastrado (o avulso não tem ficha para virar tarefa)
  const dayBefore = new Date(when);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const todayISO = new Date().toISOString().slice(0, 10);
  const dt = when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const tasks: any[] = [];
  for (const c of contatos) {
    const body = renderTemplate(
      `Olá {{primeiro_nome}}, confirmando nossa reunião em ${dt}. Responda SIM para confirmar. Qualquer coisa, me avise para remarcar.`,
      c
    );
    for (const canal of input.channels) {
      if (input.remind_24h) {
        const due = dayBefore.toISOString().slice(0, 10);
        tasks.push({ tenant_id, contact_id: c.id, assigned_to: assigned, channel: canal,
          title: `Lembrete 24h — ${titulo}`, generated_content: body, due_date: due < todayISO ? todayISO : due, status: "pending" });
      }
      if (input.remind_1h) {
        tasks.push({ tenant_id, contact_id: c.id, assigned_to: assigned, channel: canal,
          title: `Lembrete 1h — ${titulo}`, generated_content: body, due_date: when.toISOString().slice(0, 10), status: "pending" });
      }
    }
  }
  if (tasks.length) await supabase.from("tasks").insert(tasks);

  for (const c of contatos) {
    await scoreEvent(supabase, { tenant_id, contact_id: c.id, type: "meeting", meta: { meeting_id: meeting.id } });
  }

  // ============================================================
  // CONVITE DE CALENDÁRIO (.ics) — trava a agenda do outro lado, com ou sem Google.
  // Envia UM e-mail com o convite para todos os convidados, pela caixa ativa do workspace.
  // ============================================================
  let conviteEnviado = false;
  let conviteErro: string | null = null;
  if (emailsConvite.length) {
    try {
      const { data: box } = await supabase
        .from("email_accounts")
        .select("provider, from_email, display_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, oauth_refresh_token")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!box) {
        conviteErro = "Convite não enviado: conecte uma caixa de e-mail em Config para mandar o convite de agenda.";
      } else {
        const { buildIcs } = await import("@/lib/ics");
        const { sendEmail } = await import("@/lib/mailer");
        const organizer = { email: (box as any).from_email as string, name: (box as any).display_name as string | null };
        const ics = buildIcs({
          uid: `${meeting.id}@contatia`,
          summary: titulo,
          startISO: when.toISOString(),
          durationMin: Number(input.duration_min) || 30,
          organizer,
          attendees: convidados,
          location: input.location?.trim() || null,
          description: input.notes?.trim() || null,
        });
        const linha = input.location?.trim() ? `\nLocal/link: ${input.location.trim()}` : "";
        const texto = `Você foi convidado para: ${titulo}\nQuando: ${dt} (${Number(input.duration_min) || 30} min)${linha}\n\nO convite está anexado — aceite para bloquear na sua agenda.`;
        await sendEmail(box as any, {
          to: emailsConvite.join(", "),
          subject: `Convite: ${titulo} — ${dt}`,
          text: texto,
          icalEvent: { method: "REQUEST", content: ics, filename: "convite.ics" },
        });
        conviteEnviado = true;
      }
    } catch (e: any) {
      conviteErro = `Convite não enviado: ${msgErro(e)}`;
    }
  }

  // Google Calendar: se houver conta Google conectada, cria o evento com todos os convidados
  try {
    const { data: acct } = await supabase
      .from("email_accounts")
      .select("oauth_refresh_token")
      .eq("provider", "gmail")
      .eq("is_active", true)
      .not("oauth_refresh_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const refresh = (acct as any)?.oauth_refresh_token as string | undefined;
    if (refresh) {
      const { createCalendarEvent } = await import("@/lib/gcal");
      const ev = await createCalendarEvent(refresh, {
        summary: titulo,
        startISO: when.toISOString(),
        durationMin: Number(input.duration_min) || 30,
        attendeeEmails: emailsConvite,
        location: input.location?.trim() || null,
        description: input.notes?.trim() || null,
      });
      if (ev.id) {
        await supabase.from("meetings").update({ google_event_id: ev.id, google_event_link: ev.link || null }).eq("id", meeting.id);
      }
    }
  } catch {
    /* falha no calendar não deve impedir o agendamento */
  }

  revalidatePath("/dashboard/reunioes");
  revalidatePath("/dashboard");
  return { ok: true, conviteEnviado, conviteErro, convidados: emailsConvite.length };
}

export async function saveRecording(id: string, url: string) {
  const { supabase } = await ctx();
  const clean = (url || "").trim();
  if (clean && !/^https?:\/\//i.test(clean)) return { error: "Cole um link válido (começa com http)." };
  const { error } = await supabase.from("meetings").update({ recording_url: clean || null }).eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath(`/dashboard/reunioes/${id}`);
  return { ok: true };
}

export async function setMeetingStatus(id: string, status: string, contactId?: string) {
  const { supabase, tenant_id } = await ctx();
  const patch: Record<string, unknown> = { status };
  if (status === "confirmada") patch.confirmed_at = new Date().toISOString();
  const { error } = await supabase.from("meetings").update(patch).eq("id", id);
  if (error) return { error: msgErro(error) };

  // remarcada/no-show: o evento naquele horário não vale mais → remove do Google Calendar
  if (status === "no_show" || status === "remarcada") {
    await removeGoogleEvent(supabase, id);
  }

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
  const status =
    input.outcome_status === "remarcar" ? "remarcada" :
    input.outcome_status === "no_show" ? "no_show" :
    "realizada";
  const { error } = await supabase
    .from("meetings")
    .update({ status, outcome_status: input.outcome_status, outcome: input.outcome?.trim() || null })
    .eq("id", input.id);
  if (error) return { error: msgErro(error) };

  // remarcar/sem interesse/faltou: a reunião naquele horário não vale mais → remove do Google Calendar
  if (["remarcar", "sem_interesse", "no_show"].includes(input.outcome_status)) {
    await removeGoogleEvent(supabase, input.id);
  }

  // faltou → cadência de resgate (um toque de retomada), igual ao botão da agenda
  if (input.outcome_status === "no_show" && input.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, name, company, phone, email, assigned_to")
      .eq("id", input.contact_id)
      .single();
    if (contact) {
      await supabase.from("tasks").insert({
        tenant_id,
        contact_id: input.contact_id,
        assigned_to: (contact.assigned_to as string) || null,
        channel: "whatsapp",
        title: "Resgate — não compareceu",
        generated_content: renderTemplate(
          "Olá {{primeiro_nome}}, senti sua falta na nossa reunião. Quer que eu remarque para um horário melhor?",
          contact
        ),
      });
    }
  }

  // registra na timeline do contato
  if (input.contact_id) {
    const label =
      input.outcome_status === "fechou" ? "Reunião: fechou negócio" :
      input.outcome_status === "avancou" ? "Reunião: avançou" :
      input.outcome_status === "sem_interesse" ? "Reunião: sem interesse" :
      input.outcome_status === "no_show" ? "Reunião: não compareceu" : "Reunião: remarcar";
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

// Exclui uma reunião.
export async function deleteMeeting(id: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("meetings").delete().eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/reunioes");
  return { ok: true };
}
