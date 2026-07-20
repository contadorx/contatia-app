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
  state_days: "No estado há",
  date_reached: "Chegou a data de retomada",
};
// gatilhos cujo trigger_value é "X dias"
const DIAS_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won", "state_days"];
const ACTION_LABEL: Record<string, string> = {
  enroll: "inscrever na cadência",
  pause_all: "pausar cadências",
  move_stage: "mover de estágio",
  mark_hot: "marcar quente",
  add_tag: "aplicar tag",
  mark_state: "marcar estado",
  suppress: "suprimir (parar definitivo)",
};

export default async function Automacoes() {
  // Automações incluídas em TODOS os planos (Individual e Equipes) — sem gate.
  const supabase = createClient();

  const [{ data: automations }, { data: sequences }, { data: allSeqs }, { data: stages }, { data: logs }, { data: tags }, { data: products }, { data: allProducts }] = await Promise.all([
    // SEM embeds: automations tem DUAS FKs para sequences (action_seq e source_seq), o que
    // torna qualquer embed "sequences(...)" ambíguo e quebra a consulta inteira (lista vazia).
    // Buscamos só as colunas cruas e resolvemos os nomes com os mapas abaixo — à prova de embed.
    supabase.from("automations").select("id, name, trigger_type, trigger_value, action_type, is_active, product_id, cond_state, set_state, action_seq, action_stage, source_seq, action_tag").order("created_at", { ascending: false }),
    supabase.from("sequences").select("id, name").eq("is_active", true),
    supabase.from("sequences").select("id, name"),
    supabase.from("pipeline_stages").select("id, name").order("position", { ascending: true }),
    supabase.from("automation_logs").select("detail, created_at, contacts(name)").order("created_at", { ascending: false }).limit(15),
    supabase.from("tags").select("id, name").order("name", { ascending: true }),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
    supabase.from("products").select("id, name"),
  ]);

  const rules = (automations as any[]) || [];
  const logList = (logs as any[]) || [];

  // mapas id → nome (resolvem os nomes sem embed)
  const seqName = new Map(((allSeqs as any[]) || []).map((s) => [s.id, s.name]));
  const stageName = new Map(((stages as any[]) || []).map((s) => [s.id, s.name]));
  const prodName = new Map(((allProducts as any[]) || []).map((p) => [p.id, p.name]));

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
                  Quando <b>{TRIGGER_LABEL[r.trigger_type] || r.trigger_type}{r.cond_state ? ` "${r.cond_state}"` : ""}{r.trigger_value ? ` ${r.trigger_value}${DIAS_TRIGGERS.includes(r.trigger_type) ? " dias" : ""}` : ""}</b>
                  {r.source_seq && seqName.get(r.source_seq) ? <> na cadência <b>{seqName.get(r.source_seq)}</b></> : null}
                  {r.product_id && prodName.get(r.product_id) ? <> no produto <b>{prodName.get(r.product_id)}</b></> : null}
                  {" → "}
                  {ACTION_LABEL[r.action_type] || r.action_type}
                  {r.action_seq && seqName.get(r.action_seq) ? ` "${seqName.get(r.action_seq)}"` : ""}
                  {r.action_stage && stageName.get(r.action_stage) ? ` "${stageName.get(r.action_stage)}"` : ""}
                  {r.action_type === "mark_state" && r.set_state ? ` "${r.set_state}"` : ""}
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
