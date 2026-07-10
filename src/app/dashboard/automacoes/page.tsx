import { createClient } from "@/lib/supabase/server";
import AutomationBuilder from "@/components/AutomationBuilder";
import AutomationRow from "@/components/AutomationRow";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  doc_opened: "Abriu proposta",
  link_clicked: "Clicou no link",
  replied: "Respondeu",
  score_gte: "Score ≥",
  no_activity_days: "Sem atividade há",
};
const ACTION_LABEL: Record<string, string> = {
  enroll: "inscrever na cadência",
  pause_all: "pausar cadências",
  move_stage: "mover de estágio",
  mark_hot: "marcar quente",
};

export default async function Automacoes() {
  const supabase = createClient();

  const [{ data: automations }, { data: sequences }, { data: stages }, { data: logs }] = await Promise.all([
    supabase.from("automations").select("id, name, trigger_type, trigger_value, action_type, is_active, sequences(name), pipeline_stages(name)").order("created_at", { ascending: false }),
    supabase.from("sequences").select("id, name").eq("is_active", true),
    supabase.from("pipeline_stages").select("id, name").order("position", { ascending: true }),
    supabase.from("automation_logs").select("detail, created_at, contacts(name)").order("created_at", { ascending: false }).limit(15),
  ]);

  const rules = (automations as any[]) || [];
  const logList = (logs as any[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Automações</h1>
      <p className="mt-1 text-sm text-subtle">Regras &ldquo;quando isso acontecer, faça aquilo&rdquo; — o contato reage sozinho ao comportamento.</p>

      <div className="mt-6">
        <AutomationBuilder sequences={(sequences as any[]) || []} stages={(stages as any[]) || []} />
      </div>

      <div className="mt-6 space-y-2">
        {rules.length ? (
          rules.map((r) => (
            <div key={r.id} className="card flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-xs text-subtle">
                  Quando <b>{TRIGGER_LABEL[r.trigger_type] || r.trigger_type}{r.trigger_value ? ` ${r.trigger_value}${r.trigger_type === "no_activity_days" ? " dias" : ""}` : ""}</b>
                  {" → "}
                  {ACTION_LABEL[r.action_type] || r.action_type}
                  {r.sequences?.name ? ` "${r.sequences.name}"` : ""}
                  {r.pipeline_stages?.name ? ` "${r.pipeline_stages.name}"` : ""}
                </p>
              </div>
              <AutomationRow id={r.id} active={r.is_active} />
            </div>
          ))
        ) : (
          <div className="card p-8 text-center text-sm text-subtle">
            Nenhuma automação. Crie regras como &ldquo;abriu proposta → inscrever na cadência de aceleração&rdquo; ou &ldquo;120 dias sem atividade → cadência de recuperação&rdquo;.
          </div>
        )}
      </div>

      {logList.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Atividade recente</h2>
          <div className="card divide-y divide-line">
            {logList.map((l, i) => (
              <div key={i} className="flex items-center justify-between p-3 text-sm">
                <span>{l.contacts?.name || "Contato"} · <span className="text-subtle">{l.detail}</span></span>
                <span className="text-xs text-subtle">{new Date(l.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
