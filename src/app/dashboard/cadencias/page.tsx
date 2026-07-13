import { createClient } from "@/lib/supabase/server";
import SequenceBuilder from "@/components/SequenceBuilder";
import { TemplateGallery, SaveAsTemplateButton } from "@/components/TemplateGallery";
import { CadenceReport } from "@/components/CadenceReport";
import { listTemplates } from "@/app/dashboard/cadencias/actions";
import { channelLabel, type Channel } from "@/lib/cadence";

export const dynamic = "force-dynamic";

export default async function Cadencias() {
  const supabase = createClient();

  const [{ data: sequences }, { templates }] = await Promise.all([
    supabase
      .from("sequences")
      .select("id, name, audience, is_active, created_at, sequence_steps(channel, position)")
      .order("created_at", { ascending: false }),
    listTemplates(),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Cadências</h1>
      <p className="mt-1 text-sm text-subtle">
        <b>Cadência</b> é a sua sequência de follow-ups multicanal (e-mail, WhatsApp, ligação, LinkedIn) — os toques
        entram sozinhos na fila do &ldquo;Hoje&rdquo;, no ritmo que você definir.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <SequenceBuilder />
        <TemplateGallery templates={(templates as any[]) || []} />
      </div>

      <div className="mt-6 space-y-3">
        {!sequences?.length ? (
          <div className="card p-10 text-center text-sm text-subtle">
            Nenhuma sequência ainda. Crie a primeira acima — do zero, com IA, ou a partir de um template.
          </div>
        ) : (
          sequences.map((s) => {
            const steps = (s.sequence_steps as { channel: string; position: number }[]) || [];
            return (
              <div key={s.id} className="card flex items-center justify-between p-5">
                <div>
                  <p className="font-display text-base font-bold">{s.name}</p>
                  <p className="mt-1 text-sm text-subtle">
                    {s.audience ? `${s.audience} · ` : ""}
                    {steps.length} passo(s):{" "}
                    {steps
                      .sort((a, b) => a.position - b.position)
                      .map((st) => channelLabel[st.channel as Channel])
                      .join(" → ")}
                  </p>
                  <div className="mt-2">
                    <SaveAsTemplateButton sequenceId={s.id} />
                  </div>
                  <CadenceReport sequenceId={s.id} />
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    s.is_active ? "bg-signal/10 text-signal" : "bg-muted text-subtle"
                  }`}
                >
                  {s.is_active ? "Ativa" : "Inativa"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
