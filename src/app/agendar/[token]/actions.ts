"use server";

import { createAdminClient } from "@/lib/supabaseAdmin";

// Resolve o tenant + config de agendamento pelo token público.
async function resolveTenant(token: string) {
  const admin = createAdminClient();
  if (!admin) return { admin: null, tenant: null };
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, booking_enabled, booking_duration_min, booking_days, booking_start_hour, booking_end_hour, booking_title")
    .eq("inbound_token", token)
    .maybeSingle();
  return { admin, tenant: tenant as any };
}

// Gera os horários livres dos próximos N dias, respeitando dias/horário e reuniões já marcadas.
export async function getBookingSlots(token: string) {
  const { admin, tenant } = await resolveTenant(token);
  if (!admin || !tenant) return { error: "Agenda não encontrada." };
  if (!tenant.booking_enabled) return { error: "Este link de agendamento está desativado." };

  const dur = Number(tenant.booking_duration_min) || 30;
  const days = String(tenant.booking_days || "1,2,3,4,5").split(",").map((d) => Number(d.trim()));
  const startH = Number(tenant.booking_start_hour ?? 9);
  const endH = Number(tenant.booking_end_hour ?? 18);

  // reuniões futuras já marcadas (para bloquear horários ocupados)
  const nowISO = new Date().toISOString();
  const { data: booked } = await admin
    .from("meetings")
    .select("datetime, duration_min")
    .eq("tenant_id", tenant.id)
    .gte("datetime", nowISO)
    .in("status", ["agendada", "confirmada"]);
  const busy = ((booked as any[]) || []).map((b) => new Date(b.datetime).getTime());

  const slots: { date: string; times: { iso: string; label: string }[] }[] = [];
  const now = new Date();
  // próximos 14 dias
  for (let d = 0; d < 14; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    if (!days.includes(day.getDay())) continue;
    const times: { iso: string; label: string }[] = [];
    for (let h = startH; h < endH; h++) {
      for (const min of [0, 30]) {
        if (min === 30 && dur >= 60) continue; // se durações de 1h, só de hora em hora
        const slot = new Date(day);
        slot.setHours(h, min, 0, 0);
        if (slot.getTime() <= now.getTime() + 3600000) continue; // pelo menos 1h de antecedência
        // ocupado se colide com alguma reunião
        const collide = busy.some((b) => Math.abs(b - slot.getTime()) < dur * 60000);
        if (collide) continue;
        times.push({ iso: slot.toISOString(), label: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` });
      }
    }
    if (times.length) {
      slots.push({
        date: day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }),
        times,
      });
    }
    if (slots.length >= 7) break; // no máx. 7 dias com horário
  }

  return { ok: true, tenantName: tenant.name, duration: dur, slots };
}

// Cria o agendamento: contato (se novo), reunião (source=booking) e evento no Google.
export async function createBooking(token: string, input: { name: string; email: string; phone?: string; company?: string; datetime: string; note?: string }) {
  const { admin, tenant } = await resolveTenant(token);
  if (!admin || !tenant) return { error: "Agenda não encontrada." };
  if (!tenant.booking_enabled) return { error: "Este link está desativado." };
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (!name || !email) return { error: "Informe nome e e-mail." };
  if (!input.datetime) return { error: "Escolha um horário." };

  const when = new Date(input.datetime);
  if (isNaN(when.getTime()) || when.getTime() < Date.now()) return { error: "Horário inválido." };

  // horário ainda livre?
  const dur = Number(tenant.booking_duration_min) || 30;
  const { data: booked } = await admin
    .from("meetings")
    .select("datetime")
    .eq("tenant_id", tenant.id)
    .gte("datetime", new Date(Date.now() - dur * 60000).toISOString())
    .in("status", ["agendada", "confirmada"]);
  const collide = ((booked as any[]) || []).some((b) => Math.abs(new Date(b.datetime).getTime() - when.getTime()) < dur * 60000);
  if (collide) return { error: "Esse horário acabou de ser reservado. Escolha outro." };

  // contato: acha por e-mail ou cria
  let contactId: string | null = null;
  const { data: existing } = await admin.from("contacts").select("id").eq("tenant_id", tenant.id).eq("email", email).limit(1).maybeSingle();
  if (existing) contactId = (existing as any).id;
  else {
    const { data: c } = await admin.from("contacts").insert({
      tenant_id: tenant.id, name, email, phone: input.phone?.trim() || null, company: input.company?.trim() || null,
      origin: "Agendamento", status: "new",
    }).select("id").maybeSingle();
    contactId = (c as any)?.id || null;
  }

  const title = tenant.booking_title || `Reunião com ${name}`;
  const { data: meeting, error } = await admin.from("meetings").insert({
    tenant_id: tenant.id,
    contact_id: contactId,
    title,
    datetime: when.toISOString(),
    duration_min: dur,
    status: "agendada",
    notes: input.note?.trim() || null,
    source: "booking",
  }).select("id").maybeSingle();
  if (error) return { error: error.message };

  // cria evento no Google Calendar se houver caixa Gmail conectada
  try {
    const { data: acct } = await admin
      .from("email_accounts")
      .select("oauth_refresh_token")
      .eq("tenant_id", tenant.id)
      .eq("provider", "gmail")
      .eq("is_active", true)
      .not("oauth_refresh_token", "is", null)
      .limit(1)
      .maybeSingle();
    const refresh = (acct as any)?.oauth_refresh_token;
    if (refresh) {
      const { createCalendarEvent } = await import("@/lib/gcal");
      const ev = await createCalendarEvent(refresh, {
        summary: title,
        description: input.note || "Agendado pelo link público da Contatia.",
        startISO: when.toISOString(),
        durationMin: dur,
        attendeeEmail: email,
      });
      if (ev?.id && meeting) {
        await admin.from("meetings").update({ google_event_id: ev.id, google_event_link: ev.link || null }).eq("id", (meeting as any).id);
      }
    }
  } catch {
    /* falha no Google não impede o agendamento */
  }

  return { ok: true, whenLabel: when.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }) };
}
