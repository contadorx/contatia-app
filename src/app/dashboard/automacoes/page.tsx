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
  tag_added: "Recebeu tag",
  cadence_completed: "Terminou cadência +",
  opportunity_lost: "Oportunidade perdida +",
  opportunity_won: "Oportunidade ganha +",
};
// gatilhos cujo trigger_value é "X dias"
const DIAS_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won"];
const ACTION_LABEL: Record<string, string> = {
  enroll: "inscrever na cadência",
  pause_all: "pausar cadências",
  move_stage: "mover de estágio",
  mark_hot: "marcar quente",
  add_tag: "aplicar tag",
  suppress: "suprimir (parar definitivo)",
};

export default async function Automacoes() {
  // Automações incluídas em TODOS os planos (Individual e Equipes) — sem gate.
  const supabase = createClient();

  const [{ data: automations }, { data: sequences }, { data: stages }, { data: logs }, { data: tags }, { data: products }] = await Promise.all([
    supabase.from("automations").select("id, name, trigger_type, trigger_value, action_type, is_active, product_id, sequences(name), pipeline_stages(name), products(name)").order("created_at", { ascending: false }),
    supabase.from("sequences").select("id, name").eq("is_active", true),
    supabase.from("pipeline_stages").select("id, name").order("position", { ascending: true }),
    supabase.from("automation_logs").select("detail, created_at, contacts(name)").order("created_at", { ascending: false }).limit(15),
    supabase.from("tags").select("id, name").order("name", { ascending: true }),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);

  const rules = (automations as any[]) || [];
  const logList = (logs as any[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Automações</h1>
      <p className="mt-1 text-sm text-subtle">Regras &ldquo;quando isso acontecer, faça aquilo&rdquo; — o contato reage sozinho ao comportamento.</p>

      <div className="mt-6">
        <AutomationBuilder sequences={(sequences as any[]) || []} stages={(stages as any[]) || []} tags={(tags as any[]) || []} products={(products as any[]) || []} />
      </div>

      <div className="mt-6 space-y-2">
        {rules.length ? (
          rules.map((r) => (
            <div key={r.id} className="card flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-xs text-subtle">
                  Quando <b>{TRIGGER_LABEL[r.trigger_type] || r.trigger_type}{r.trigger_value ? ` ${r.trigger_value}${DIAS_TRIGGERS.includes(r.trigger_type) ? " dias" : ""}` : ""}</b>
                  {r.products?.name ? <> no produto <b>{r.products.name}</b></> : null}
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
