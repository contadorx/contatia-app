import { MeetingsCalendar } from "@/components/MeetingsCalendar";
import { createClient } from "@/lib/supabase/server";
import MeetingForm from "@/components/MeetingForm";
import MeetingStatusButtons from "@/components/MeetingStatusButtons";
import MeetingOutcome from "@/components/MeetingOutcome";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { l: string; c: string }> = {
  agendada: { l: "Agendada", c: "bg-muted text-subtle" },
  confirmada: { l: "Confirmada", c: "bg-signal/10 text-signal" },
  realizada: { l: "Realizada", c: "bg-brand-soft text-brand-dark" },
  no_show: { l: "No-show", c: "bg-danger/10 text-danger" },
  remarcada: { l: "Remarcada", c: "bg-warn/10 text-warn" },
};

function timeFmt(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === tomorrow.toDateString()) return "Amanhã";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
}

export default async function Reunioes() {
  const supabase = createClient();
  const nowISO = new Date().toISOString();

  const [{ data: contacts }, { data: upcoming }, { data: past }] = await Promise.all([
    supabase.from("contacts").select("id, name").order("score", { ascending: false }).limit(500),
    supabase
      .from("meetings")
      .select("id, title, datetime, duration_min, location, notes, status, contact_id, google_event_link, contacts(name, company)")
      .gte("datetime", nowISO)
      .order("datetime", { ascending: true }),
    supabase
      .from("meetings")
      .select("id, title, datetime, status, outcome, outcome_status, contact_id, contacts(name, company)")
      .lt("datetime", nowISO)
      .order("datetime", { ascending: false })
      .limit(30),
  ]);

  const up = (upcoming as any[]) || [];
  const pastList = (past as any[]) || [];

  // ---- Calendário: time, permissões de agenda e reuniões do período ----
  const { data: { user } } = await supabase.auth.getUser();
  const meuId = user?.id || "";
  const { data: meuPerfil } = await supabase.from("profiles").select("role, tenant_id").eq("id", meuId).maybeSingle();
  const souAdmin = (meuPerfil as any)?.role === "owner";

  const { data: time } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("tenant_id", (meuPerfil as any)?.tenant_id ?? "")
    .order("full_name", { ascending: true });

  // agendas que posso VER e em quais posso MARCAR
  const { data: perms } = await supabase
    .from("calendar_permissions")
    .select("seller_id, can_view, can_book")
    .eq("sdr_id", meuId);

  const permList = (perms as any[]) || [];
  const podeVer = new Set<string>([meuId, ...permList.filter((p) => p.can_view).map((p) => p.seller_id)]);
  const podeAgendarEm = permList.filter((p) => p.can_book).map((p) => p.seller_id);

  // o admin enxerga todas as agendas do time
  const timeList = ((time as any[]) || []).filter((p) => souAdmin || podeVer.has(p.id));
  const vendedores = timeList.map((p) => ({
    id: p.id,
    name: (p.full_name || p.email || "sem nome") + (p.id === meuId ? " (você)" : ""),
  }));

  // reuniões do time (para o calendário), agrupadas por dono da agenda
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
  const fimJanela = new Date(); fimJanela.setMonth(fimJanela.getMonth() + 3);

  const { data: doTime } = await supabase
    .from("meetings")
    .select("id, title, datetime, duration_min, status, assigned_to, contacts(name)")
    .gte("datetime", inicioMes.toISOString())
    .lte("datetime", fimJanela.toISOString())
    .order("datetime", { ascending: true });

  const meetingsPorDono: Record<string, any[]> = {};
  for (const m of ((doTime as any[]) || [])) {
    const dono = m.assigned_to || meuId;
    (meetingsPorDono[dono] ||= []).push({
      id: m.id, title: m.title, datetime: m.datetime,
      duration_min: m.duration_min, status: m.status,
      contact_name: m.contacts?.name || null,
    });
  }

  // janela de atendimento do workspace (a mesma do link público)
  const { data: t } = await supabase
    .from("tenants")
    .select("booking_start_hour, booking_end_hour, booking_duration_min, booking_days")
    .eq("id", (meuPerfil as any)?.tenant_id ?? "")
    .maybeSingle();

  const janela = {
    startHour: Number((t as any)?.booking_start_hour ?? 9),
    endHour: Number((t as any)?.booking_end_hour ?? 18),
    duration: Number((t as any)?.booking_duration_min ?? 30),
    days: String((t as any)?.booking_days || "1,2,3,4,5").split(",").map((d) => Number(d.trim())),
  };

  // agrupa próximas por dia (agenda)
  const byDay: { label: string; items: any[] }[] = [];
  for (const m of up) {
    const label = dayLabel(m.datetime);
    let group = byDay.find((g) => g.label === label);
    if (!group) { group = { label, items: [] }; byDay.push(group); }
    group.items.push(m);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Reuniões</h1>
      <p className="mt-1 text-sm text-subtle">Agenda, confirmação e resultado. Os lembretes viram toques na fila e reduzem o no-show.</p>

      <div className="mt-6">
        <MeetingsCalendar
          meetingsPorDono={meetingsPorDono}
          vendedores={vendedores}
          meuId={meuId}
          podeAgendarEm={podeAgendarEm}
          janela={janela}
        />
      </div>

      <div className="mt-8">
        <MeetingForm contacts={(contacts as { id: string; name: string }[]) || []} />
      </div>
      <p className="mt-2 text-xs text-subtle">
        Com o Gmail conectado em Config → E-mail, cada reunião agendada vira automaticamente um evento no seu Google Calendar, com convite para o contato. Se você conectou o Gmail antes desta atualização, reconecte uma vez para liberar o acesso à agenda.
      </p>

      {/* Agenda (próximas por dia) */}
      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Agenda</h2>
      {byDay.length ? (
        <div className="space-y-6">
          {byDay.map((g) => (
            <div key={g.label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{g.label}</p>
              <div className="space-y-2">
                {g.items.map((m) => {
                  const st = STATUS_LABEL[m.status] || STATUS_LABEL.agendada;
                  return (
                    <div key={m.id} className="card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-muted px-2.5 py-1 text-center">
                            <p className="font-display text-sm font-bold">{timeFmt(m.datetime)}</p>
                            <p className="text-[10px] text-subtle">{m.duration_min || 30}min</p>
                          </div>
                          <div>
                            <p className="text-sm font-semibold"><a href={`/dashboard/reunioes/${m.id}`} className="hover:text-brand-dark hover:underline">{m.title}</a> <span className="font-normal text-subtle">· {m.contacts?.name || "—"}</span></p>
                            {m.location && <p className="text-xs text-brand-dark">{m.location}</p>}
                            {m.notes && <p className="mt-0.5 text-xs text-subtle">{m.notes}</p>}
                            {m.google_event_link && (
                              <a href={m.google_event_link} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-xs text-signal hover:underline">
                                ✓ no Google Calendar
                              </a>
                            )}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span>
                      </div>
                      <div className="mt-3">
                        <MeetingStatusButtons id={m.id} contactId={m.contact_id} status={m.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-6 text-sm text-subtle">Nenhuma reunião agendada.</div>
      )}

      {/* Passadas — registrar resultado */}
      {pastList.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Passadas</h2>
          <div className="space-y-2">
            {pastList.map((m) => {
              const st = STATUS_LABEL[m.status] || STATUS_LABEL.agendada;
              const needsOutcome = m.status !== "realizada" && m.status !== "no_show";
              return (
                <div key={m.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold"><a href={`/dashboard/reunioes/${m.id}`} className="hover:text-brand-dark hover:underline">{m.title}</a> <span className="font-normal text-subtle">· {m.contacts?.name || "—"}</span></p>
                      <p className="text-xs text-subtle">{new Date(m.datetime).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                      {m.outcome && <p className="mt-1 text-xs text-ink/70">↳ {m.outcome}</p>}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span>
                  </div>
                  {needsOutcome && <MeetingOutcome id={m.id} contactId={m.contact_id} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
