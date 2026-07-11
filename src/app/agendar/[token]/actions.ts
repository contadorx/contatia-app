"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Resolve o tenant + config via RPC pública (não depende de SERVICE_ROLE_KEY).
async function resolveTenant(token: string) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_booking_config", { p_token: token });
  const tenant = Array.isArray(data) ? data[0] : data;
  return { supabase, tenant: (tenant as any) || null };
}

// Gera os horários livres dos próximos N dias, respeitando dias/horário e reuniões já marcadas.
export async function getBookingSlots(token: string) {
  const { tenant } = await resolveTenant(token);
  if (!tenant) return { error: "Agenda não encontrada ou desativada." };

  const dur = Number(tenant.booking_duration_min) || 30;
  const days = String(tenant.booking_days || "1,2,3,4,5").split(",").map((d) => Number(d.trim()));
  const startH = Number(tenant.booking_start_hour ?? 9);
  const endH = Number(tenant.booking_end_hour ?? 18);

  // admin client (opcional): usado só para ler reuniões e free/busy do Google.
  // Se não houver SERVICE_ROLE_KEY, a página ainda funciona (sem esses bloqueios).
  const admin = createAdminClient();
  const nowISO = new Date().toISOString();
  let busy: number[] = [];
  const googleBusy: { start: number; end: number }[] = [];

  if (admin) {
    const { data: booked } = await admin
      .from("meetings")
      .select("datetime, duration_min")
      .eq("tenant_id", tenant.id)
      .gte("datetime", nowISO)
      .in("status", ["agendada", "confirmada"]);
    busy = ((booked as any[]) || []).map((b) => new Date(b.datetime).getTime());

    try {
      const { data: gacct } = await admin
        .from("email_accounts")
        .select("oauth_refresh_token")
        .eq("tenant_id", tenant.id)
        .eq("provider", "gmail")
        .eq("is_active", true)
        .not("oauth_refresh_token", "is", null)
        .limit(1)
        .maybeSingle();
      const refresh = (gacct as any)?.oauth_refresh_token;
      if (refresh) {
        const { getBusyBlocks } = await import("@/lib/gcal");
        const timeMax = new Date(Date.now() + 15 * 86400000).toISOString();
        const blocks = await getBusyBlocks(refresh, nowISO, timeMax);
        googleBusy.push(...blocks);
      }
    } catch { /* free/busy é best-effort; não quebra o agendamento */ }
  }

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
        // ocupado se colide com reunião do Contatia
        const collide = busy.some((b) => Math.abs(b - slot.getTime()) < dur * 60000);
        if (collide) continue;
        // ocupado se o intervalo do slot cai dentro de um bloco ocupado do Google
        const slotStart = slot.getTime();
        const slotEnd = slotStart + dur * 60000;
        const googleCollide = googleBusy.some((b) => slotStart < b.end && slotEnd > b.start);
        if (googleCollide) continue;
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
  const { supabase, tenant } = await resolveTenant(token);
  if (!tenant) return { error: "Agenda não encontrada ou desativada." };

  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (!name || !email) return { error: "Informe nome e e-mail." };
  if (!input.datetime) return { error: "Escolha um horário." };
  const when = new Date(input.datetime);
  if (isNaN(when.getTime()) || when.getTime() < Date.now()) return { error: "Horário inválido." };

  const dur = Number(tenant.booking_duration_min) || 30;

  // cria o agendamento via RPC (funciona sem SERVICE_ROLE_KEY; valida token+horário no banco)
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_token: token,
    p_name: name,
    p_email: email,
    p_phone: input.phone || null,
    p_company: input.company || null,
    p_datetime: when.toISOString(),
    p_note: input.note || null,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error) return { error: error.message };
  if (!row || !row.ok) return { error: (row && row.msg) || "Não foi possível agendar. Tente outro horário." };
  const meetingId = row.meeting_id as string;

  // bônus: cria o evento no Google Calendar (só se o admin client estiver disponível)
  try {
    const admin = createAdminClient();
    if (admin && meetingId) {
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
        const title = tenant.booking_title || `Reunião com ${name}`;
        const { createCalendarEvent } = await import("@/lib/gcal");
        const ev = await createCalendarEvent(refresh, {
          summary: title,
          description: input.note || "Agendado pelo link público da Contatia.",
          startISO: when.toISOString(),
          durationMin: dur,
          attendeeEmail: email,
        });
        if (ev?.id) {
          await admin.from("meetings").update({ google_event_id: ev.id, google_event_link: ev.link || null }).eq("id", meetingId);
        }
      }
    }
  } catch { /* falha no Google não impede o agendamento */ }

  return { ok: true, whenLabel: when.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }) };
}
