"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AutomationBuilder, { BLANK_FORM, type AutoForm } from "@/components/AutomationBuilder";
import { toggleAutomation, deleteAutomation, duplicateAutomation } from "@/app/dashboard/automacoes/actions";

type Opt = { id: string; name: string };
type Member = { id: string; full_name?: string | null; email: string };
type Rule = any;

const TRIGGER_LABEL: Record<string, string> = {
  doc_opened: "Abriu proposta", link_clicked: "Clicou no link", replied: "Respondeu",
  score_gte: "Score ≥", no_activity_days: "Sem atividade há", tag_added: "Recebeu tag",
  cadence_completed: "Terminou cadência +", opportunity_lost: "Oportunidade perdida +",
  opportunity_won: "Oportunidade ganha +", state_days: "No estado há", date_reached: "Chegou a data de retomada",
};
const ACTION_LABEL: Record<string, string> = {
  enroll: "inscrever na cadência", pause_all: "pausar cadências", move_stage: "mover de estágio",
  mark_hot: "marcar quente", add_tag: "aplicar tag", assign_owner: "trocar responsável",
  set_product: "trocar produto", mark_state: "marcar estado", suppress: "suprimir (parar definitivo)",
};
const DIAS_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won", "state_days"];

const CATEGORY_LABEL: Record<string, string> = {
  sinais: "Sinais quentes", reciclagem: "Reciclagem / reengajamento",
  posvenda: "Pós-venda / expansão", higiene: "Higiene",
};

// Exemplos (os 4 grupos combinados). "needs" = o que o usuário escolhe ao instalar.
const EXAMPLES: { cat: string; name: string; desc: string; needs?: string; form: Partial<AutoForm> }[] = [
  // A) Sinais quentes
  { cat: "sinais", name: "Abriu a proposta → marcar quente", desc: "Quem abre a proposta demonstra intenção.", form: { trigger_type: "doc_opened", action_type: "mark_hot" } },
  { cat: "sinais", name: "Clicou no link → marcar quente", desc: "Clique é sinal.", form: { trigger_type: "link_clicked", action_type: "mark_hot" } },
  { cat: "sinais", name: "Score atingiu 25 → mover no funil", desc: "Engajamento cruzou 25.", needs: "escolha o estágio", form: { trigger_type: "score_gte", trigger_value: "25", action_type: "move_stage" } },
  { cat: "sinais", name: "Recebeu tag → acelerar", desc: "Ao receber a tag, entra numa cadência de aceleração.", needs: "escolha a tag e a cadência", form: { trigger_type: "tag_added", action_type: "enroll", end_current: true } },
  // B) Reciclagem
  { cat: "reciclagem", name: "Fim de cadência → dormente", desc: "Terminou sem resposta → marca dormente.", form: { trigger_type: "cadence_completed", trigger_value: "0", action_type: "mark_state", set_state: "dormente", priority: "50" } },
  { cat: "reciclagem", name: "Dormente 90 dias → reengajar", desc: "Dormente há 90 dias entra na retomada.", needs: "escolha a cadência de reengajamento", form: { trigger_type: "state_days", cond_state: "dormente", trigger_value: "90", action_type: "enroll", end_current: true, set_state: "em_E" } },
  { cat: "reciclagem", name: "Sem atividade 120 dias → reengajar", desc: "Versão simples por inatividade.", needs: "escolha a cadência", form: { trigger_type: "no_activity_days", trigger_value: "120", action_type: "enroll", end_current: true } },
  { cat: "reciclagem", name: "Chegou a data de retomada → retomar", desc: "Na data anotada na triagem.", needs: "escolha a cadência de retomada", form: { trigger_type: "date_reached", action_type: "enroll", end_current: true } },
  // C) Pós-venda
  { cat: "posvenda", name: "Oportunidade perdida +30 dias → recuperação", desc: "30 dias após a perda.", needs: "escolha a cadência", form: { trigger_type: "opportunity_lost", trigger_value: "30", action_type: "enroll" } },
  { cat: "posvenda", name: "Oportunidade ganha +15 dias → cross-sell", desc: "15 dias após ganhar.", needs: "escolha a cadência de outro produto", form: { trigger_type: "opportunity_won", trigger_value: "15", action_type: "enroll" } },
  { cat: "posvenda", name: "Ganhou → marcar como Cliente", desc: "Aplica a tag de cliente ao ganhar.", needs: "escolha a tag", form: { trigger_type: "opportunity_won", trigger_value: "0", action_type: "add_tag" } },
  // D) Higiene
  { cat: "higiene", name: "Fim da retomada (E) → suprimir", desc: "Quem ignorou a retomada sai de vez.", needs: "escolha a cadência de origem (E)", form: { trigger_type: "cadence_completed", trigger_value: "0", action_type: "suppress", priority: "40", stop_on_match: true } },
];

function ruleToForm(r: Rule): AutoForm {
  return {
    ...BLANK_FORM,
    name: r.name || "",
    trigger_type: r.trigger_type || "doc_opened",
    trigger_value: r.trigger_value != null ? String(r.trigger_value) : "",
    action_type: r.action_type || "enroll",
    action_seq: r.action_seq || "",
    action_stage: r.action_stage || "",
    action_tag: r.action_tag || "",
    product_id: r.product_id || "",
    source_seq: r.source_seq || "",
    priority: r.priority != null ? String(r.priority) : "100",
    set_state: r.set_state || "",
    cond_state: r.cond_state || "",
    cond_owner_id: r.cond_owner_id || "",
    cond_has_tag: r.cond_has_tag || "",
    cond_not_tag: r.cond_not_tag || "",
    action_owner: r.action_owner || "",
    action_product: r.action_product || "",
    stop_on_match: !!r.stop_on_match,
    end_current: !!r.end_current,
  };
}

export default function AutomationsPanel({
  rules, sequences, allSeqs, stages, tags, products, allProducts, members,
}: {
  rules: Rule[]; sequences: Opt[]; allSeqs: Opt[]; stages: Opt[]; tags: Opt[]; products: Opt[]; allProducts: Opt[]; members: Member[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initial, setInitial] = useState<Partial<AutoForm> | undefined>(undefined);
  const [showSug, setShowSug] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const seqName = useMemo(() => new Map(allSeqs.map((s) => [s.id, s.name])), [allSeqs]);
  const stageName = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages]);
  const prodName = useMemo(() => new Map(allProducts.map((p) => [p.id, p.name])), [allProducts]);
  const tagName = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.full_name || m.email])), [members]);

  function novo() { setEditingId(null); setInitial(BLANK_FORM); setOpen(true); }
  function editar(r: Rule) { setEditingId(r.id); setInitial(ruleToForm(r)); setOpen(true); }
  function usarExemplo(ex: typeof EXAMPLES[number]) { setEditingId(null); setInitial({ ...BLANK_FORM, ...ex.form, name: ex.name }); setOpen(true); setShowSug(false); }

  function act(id: string, fn: () => Promise<any>) {
    setBusy(id);
    start(async () => { await fn(); setBusy(null); router.refresh(); });
  }

  function guardText(r: Rule) {
    const parts: string[] = [];
    if (r.product_id && prodName.get(r.product_id)) parts.push(`produto ${prodName.get(r.product_id)}`);
    if (r.cond_owner_id && memberName.get(r.cond_owner_id)) parts.push(`dono ${memberName.get(r.cond_owner_id)}`);
    if (r.cond_has_tag && tagName.get(r.cond_has_tag)) parts.push(`tem "${tagName.get(r.cond_has_tag)}"`);
    if (r.cond_not_tag && tagName.get(r.cond_not_tag)) parts.push(`sem "${tagName.get(r.cond_not_tag)}"`);
    return parts.join(" · ");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {!open && <button className="btn-brand" onClick={novo}>+ Nova automação</button>}
        {!open && <button className="btn-ghost" onClick={() => setShowSug((s) => !s)}>{showSug ? "Fechar sugestões" : "Sugestões prontas"}</button>}
      </div>

      {/* Sugestões (exemplos) */}
      {showSug && !open && (
        <div className="mt-4 space-y-4">
          {["sinais", "reciclagem", "posvenda", "higiene"].map((cat) => (
            <div key={cat}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{CATEGORY_LABEL[cat]}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXAMPLES.filter((e) => e.cat === cat).map((ex) => (
                  <div key={ex.name} className="card flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{ex.name}</p>
                      <p className="text-xs text-subtle">{ex.desc}{ex.needs ? ` — ${ex.needs}` : ""}</p>
                    </div>
                    <button className="btn-ghost shrink-0 py-1 text-xs" onClick={() => usarExemplo(ex)}>Adicionar</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-subtle">Ao adicionar, o formulário abre pré-preenchido — você escolhe a cadência/estágio/tag do seu workspace e salva.</p>
        </div>
      )}

      {/* Formulário (criar/editar/sugestão) */}
      {open && (
        <div className="mt-4">
          <AutomationBuilder
            open={open}
            editingId={editingId}
            initial={initial}
            onClose={() => setOpen(false)}
            sequences={sequences}
            stages={stages}
            tags={tags}
            products={products}
            members={members}
          />
        </div>
      )}

      {/* Lista */}
      <div className="mt-6 space-y-2">
        {rules.length ? (
          rules.map((r) => (
            <div key={r.id} className={`card flex items-center justify-between gap-3 p-4 ${r.is_active ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{r.name}{!r.is_active && <span className="ml-1 text-xs text-subtle">(inativa)</span>}</p>
                <p className="text-xs text-subtle">
                  Quando <b>{TRIGGER_LABEL[r.trigger_type] || r.trigger_type}{r.cond_state ? ` "${r.cond_state}"` : ""}{r.trigger_value ? ` ${r.trigger_value}${DIAS_TRIGGERS.includes(r.trigger_type) ? " dias" : ""}` : ""}</b>
                  {r.source_seq && seqName.get(r.source_seq) ? <> na cadência <b>{seqName.get(r.source_seq)}</b></> : null}
                  {" → "}
                  {ACTION_LABEL[r.action_type] || r.action_type}
                  {r.action_seq && seqName.get(r.action_seq) ? ` "${seqName.get(r.action_seq)}"` : ""}
                  {r.action_stage && stageName.get(r.action_stage) ? ` "${stageName.get(r.action_stage)}"` : ""}
                  {r.action_type === "assign_owner" ? ` "${r.action_owner ? memberName.get(r.action_owner) || "—" : "sem dono"}"` : ""}
                  {r.action_type === "set_product" && r.action_product && prodName.get(r.action_product) ? ` "${prodName.get(r.action_product)}"` : ""}
                  {r.action_type === "mark_state" && r.set_state ? ` "${r.set_state}"` : ""}
                </p>
                {guardText(r) ? <p className="text-[11px] text-subtle">só se: {guardText(r)}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <button className="text-brand-dark hover:underline" disabled={pending} onClick={() => editar(r)}>editar</button>
                <button className="text-subtle hover:text-ink" disabled={pending} onClick={() => act(r.id, () => duplicateAutomation(r.id))}>duplicar</button>
                <button className="text-subtle hover:text-ink" disabled={pending} onClick={() => act(r.id, () => toggleAutomation(r.id, !r.is_active))}>{r.is_active ? "desativar" : "ativar"}</button>
                <button className="text-subtle hover:text-danger" disabled={pending} onClick={() => { if (confirm("Excluir esta automação?")) act(r.id, () => deleteAutomation(r.id)); }}>excluir</button>
              </div>
            </div>
          ))
        ) : (
          <div className="card p-8 text-center text-sm text-subtle">
            Nenhuma automação ainda. Crie uma nova ou use as <b>Sugestões prontas</b> acima.
          </div>
        )}
      </div>
    </div>
  );
}
