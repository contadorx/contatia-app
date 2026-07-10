import Link from "next/link";
import { RecordingField } from "@/components/RecordingField";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MeetingStatusButtons from "@/components/MeetingStatusButtons";
import MeetingOutcome from "@/components/MeetingOutcome";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { l: string; c: string }> = {
  agendada: { l: "Agendada", c: "bg-muted text-subtle" },
  confirmada: { l: "Confirmada", c: "bg-signal/10 text-signal" },
  realizada: { l: "Realizada", c: "bg-brand-soft text-brand-dark" },
  no_show: { l: "No-show", c: "bg-danger/10 text-danger" },
  remarcada: { l: "Remarcada", c: "bg-warn/10 text-warn" },
};

const OUTCOME: Record<string, string> = {
  fechou: "Fechou negócio 🎉",
  avancou: "Avançou",
  remarcar: "Remarcar",
  sem_interesse: "Sem interesse",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
}

export default async function ReuniaoDetalhe({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: m } = await supabase
    .from("meetings")
    .select("id, title, datetime, duration_min, location, notes, status, outcome, outcome_status, contact_id, opportunity_id, google_event_link, recording_url, confirmed_at, created_at, contacts(name, company, email, phone)")
    .eq("id", params.id)
    .maybeSingle();

  if (!m) notFound();
  const M = m as any;
  const st = STATUS[M.status] || STATUS.agendada;
  const isPast = new Date(M.datetime) < new Date();

  // eventos da timeline do contato relacionados a reunião
  const { data: evs } = M.contact_id
    ? await supabase.from("events").select("type, created_at, meta").eq("contact_id", M.contact_id).eq("type", "meeting").order("created_at", { ascending: false }).limit(10)
    : { data: [] as any[] };

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/reunioes" className="text-sm text-subtle hover:text-brand">← Reuniões</Link>

      <div className="mt-3 card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold">{M.title}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span>
            </div>
            <p className="mt-1 text-sm text-subtle">{fmt(M.datetime)} · {M.duration_min || 30} min</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="label">Contato</p>
            {M.contact_id ? (
              <Link href={`/dashboard/contatos/${M.contact_id}`} className="text-sm text-brand-dark hover:underline">{M.contacts?.name || "—"}</Link>
            ) : <p className="text-sm">—</p>}
            {M.contacts?.company && <p className="text-xs text-subtle">{M.contacts.company}</p>}
            {(M.contacts?.email || M.contacts?.phone) && <p className="text-xs text-subtle">{[M.contacts?.email, M.contacts?.phone].filter(Boolean).join(" · ")}</p>}
          </div>
          <div>
            <p className="label">Local / link</p>
            {M.location ? <p className="text-sm">{M.location}</p> : <p className="text-sm text-subtle">—</p>}
            {M.google_event_link && (
              <a href={M.google_event_link} target="_blank" rel="noreferrer" className="text-xs text-signal hover:underline">✓ no Google Calendar</a>
            )}
          </div>
        </div>

        <div className="mt-4">
          <p className="label">Gravação da reunião</p>
          <RecordingField meetingId={M.id} initial={M.recording_url || ""} />
        </div>

        {M.notes && (
          <div className="mt-4">
            <p className="label">Pauta / preparação</p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{M.notes}</p>
          </div>
        )}

        {/* Resultado */}
        <div className="mt-4">
          <p className="label">Resultado</p>
          {M.outcome_status ? (
            <div className="mt-1 rounded-lg bg-brand-soft p-3 text-sm">
              <p className="font-semibold text-brand-dark">{OUTCOME[M.outcome_status] || M.outcome_status}</p>
              {M.outcome && <p className="mt-1 whitespace-pre-wrap">{M.outcome}</p>}
            </div>
          ) : isPast && M.status !== "no_show" ? (
            <div className="mt-1">
              <p className="mb-2 text-sm text-subtle">Ainda sem resultado registrado.</p>
              <MeetingOutcome id={M.id} contactId={M.contact_id} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-subtle">—</p>
          )}
        </div>

        {/* Ações de status */}
        <div className="mt-6 border-t border-line pt-4">
          <p className="label mb-2">Status da reunião</p>
          <MeetingStatusButtons id={M.id} contactId={M.contact_id} status={M.status} />
        </div>
      </div>

      {/* Histórico de reuniões deste contato */}
      {((evs as any[]) || []).length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 font-display text-lg font-bold">Histórico de reuniões do contato</h2>
          <div className="card divide-y divide-line">
            {((evs as any[]) || []).map((e, i) => (
              <div key={i} className="p-3 text-sm">
                <span className="text-subtle">{new Date(e.created_at).toLocaleDateString("pt-BR")} · </span>
                {e.meta?.text || "Reunião"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
