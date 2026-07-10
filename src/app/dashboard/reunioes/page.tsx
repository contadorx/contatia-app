import { createClient } from "@/lib/supabase/server";
import MeetingForm from "@/components/MeetingForm";
import MeetingStatusButtons from "@/components/MeetingStatusButtons";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function Reunioes() {
  const supabase = createClient();
  const nowISO = new Date().toISOString();

  const [{ data: contacts }, { data: upcoming }, { data: past }] = await Promise.all([
    supabase.from("contacts").select("id, name").order("score", { ascending: false }).limit(500),
    supabase
      .from("meetings")
      .select("id, title, datetime, status, contact_id, contacts(name, company)")
      .gte("datetime", nowISO)
      .order("datetime", { ascending: true }),
    supabase
      .from("meetings")
      .select("id, title, datetime, status, contact_id, contacts(name, company)")
      .lt("datetime", nowISO)
      .order("datetime", { ascending: false })
      .limit(30),
  ]);

  const up = (upcoming as any[]) || [];
  const pastList = (past as any[]) || [];

  const Row = ({ m }: { m: any }) => (
    <div className="card flex items-center justify-between p-4">
      <div>
        <p className="text-sm font-semibold">
          {m.title} <span className="font-normal text-subtle">· {m.contacts?.name || "—"}</span>
        </p>
        <p className="text-xs text-subtle">{fmt(m.datetime)}</p>
      </div>
      <MeetingStatusButtons id={m.id} contactId={m.contact_id} status={m.status} />
    </div>
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Reuniões</h1>
      <p className="mt-1 text-sm text-subtle">Agende e confirme reuniões — os lembretes viram toques na sua fila e reduzem o no-show.</p>

      <div className="mt-6">
        <MeetingForm contacts={(contacts as { id: string; name: string }[]) || []} />
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Próximas ({up.length})</h2>
      <div className="space-y-2">
        {up.length ? up.map((m) => <Row key={m.id} m={m} />) : <div className="card p-6 text-sm text-subtle">Nenhuma reunião agendada.</div>}
      </div>

      {pastList.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Passadas</h2>
          <div className="space-y-2">{pastList.map((m) => <Row key={m.id} m={m} />)}</div>
        </>
      )}
    </div>
  );
}
