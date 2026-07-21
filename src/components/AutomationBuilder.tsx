"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAutomation, updateAutomation } from "@/app/dashboard/automacoes/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type Seq = { id: string; name: string };
type Stage = { id: string; name: string };
type Tag = { id: string; name: string };
type Product = { id: string; name: string };
type Member = { id: string; full_name?: string | null; email: string };

const TRIGGERS = [
  { v: "doc_opened", l: "Abriu uma proposta" },
  { v: "link_clicked", l: "Clicou num link" },
  { v: "replied", l: "Respondeu" },
  { v: "tag_added", l: "Recebeu uma tag" },
  { v: "score_gte", l: "Score atingiu (nº)" },
  { v: "no_activity_days", l: "Sem atividade há X dias" },
  { v: "cadence_completed", l: "Terminou uma cadência (+ X dias)" },
  { v: "opportunity_lost", l: "Oportunidade perdida (+ X dias)" },
  { v: "opportunity_won", l: "Oportunidade ganha (+ X dias)" },
  { v: "state_days", l: "Está num estado há X dias" },
  { v: "date_reached", l: "Chegou a data de retomada" },
];
const ACTIONS = [
  { v: "enroll", l: "Inscrever numa cadência" },
  { v: "pause_all", l: "Pausar cadências ativas" },
  { v: "move_stage", l: "Mover para um estágio" },
  { v: "mark_hot", l: "Marcar como quente" },
  { v: "add_tag", l: "Aplicar uma tag" },
  { v: "assign_owner", l: "Trocar o responsável (dono)" },
  { v: "set_product", l: "Trocar o produto da oportunidade" },
  { v: "mark_state", l: "Marcar estado (ex.: dormente)" },
  { v: "suppress", l: "Suprimir (parar definitivo)" },
];

// gatilhos cujo valor é "quantidade de dias"
const DIAS_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won", "state_days"];
// gatilhos que fazem sentido escopar por produto

export type AutoForm = {
  name: string; trigger_type: string; trigger_value: string; action_type: string;
  action_seq: string; action_stage: string; action_tag: string; product_id: string;
  source_seq: string; priority: string; set_state: string; cond_state: string;
  cond_owner_id: string; cond_has_tag: string; cond_not_tag: string;
  action_owner: string; action_product: string; stop_on_match: boolean; end_current: boolean;
};
export const BLANK_FORM: AutoForm = {
  name: "", trigger_type: "doc_opened", trigger_value: "", action_type: "enroll",
  action_seq: "", action_stage: "", action_tag: "", product_id: "", source_seq: "",
  priority: "100", set_state: "", cond_state: "", cond_owner_id: "", cond_has_tag: "",
  cond_not_tag: "", action_owner: "", action_product: "", stop_on_match: false, end_current: false,
};

export default function AutomationBuilder({
  open,
  editingId = null,
  initial,
  onClose,
  onSaved,
  sequences,
  stages,
  tags,
  products,
  members = [],
}: {
  open: boolean;
  editingId?: string | null;
  initial?: Partial<AutoForm>;
  onClose: () => void;
  onSaved?: () => void;
  sequences: Seq[];
  stages: Stage[];
  tags?: Tag[];
  products?: Product[];
  members?: Member[];
}) {
  const router = useRouter();
  const [f, setF] = useState<AutoForm>(BLANK_FORM);
  const [stopOnMatch, setStopOnMatch] = useState(false);
  const [endCurrent, setEndCurrent] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ao abrir, carrega os valores iniciais (edição / duplicação / sugestão)
  useEffect(() => {
    if (!open) return;
    const merged = { ...BLANK_FORM, ...(initial || {}) };
    setF(merged);
    setStopOnMatch(!!merged.stop_on_match);
    setEndCurrent(!!merged.end_current);
    // abre o "Avançado" sozinho quando a regra já usa algum desses campos
    setShowAdv((Number(merged.priority) || 100) !== 100 || !!merged.stop_on_match || !!(merged.set_state && merged.set_state.trim()));
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId, initial]);

  function up(k: keyof AutoForm, v: string) {
    setF((s) => ({ ...s, [k]: v }));
  }
  function save() {
    setMsg(null);
    if (!f.name.trim()) { setMsg("Dê um nome à automação."); return; }
    start(async () => {
      try {
        const payload = { ...f, priority: Number(f.priority) || 100, stop_on_match: stopOnMatch, end_current: endCurrent };
        const res = editingId ? await updateAutomation(editingId, payload) : await createAutomation(payload);
        if (res?.error) { setMsg(res.error); return; }
        onSaved?.();
        onClose();
        router.refresh();
      } catch (e: any) {
        setMsg("Erro ao salvar: " + (e?.message || "falha desconhecida"));
      }
    });
  }

  if (!open) return null;

  const isDias = DIAS_TRIGGERS.includes(f.trigger_type);
  const isScore = f.trigger_type === "score_gte";
  const diasPlaceholder =
    f.trigger_type === "no_activity_days"
      ? "Dias sem atividade (ex.: 90)"
      : f.trigger_type === "cadence_completed"
      ? "Dias após terminar (ex.: 90)"
      : f.trigger_type === "state_days"
      ? "Dias no estado (ex.: 90)"
      : "Dias após (ex.: 30)";

  return (
    <div className="card p-5">
      <input className="input" value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="Nome (ex.: Fim da cadência → recuperação em 90 dias)" />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-muted p-4">
          <p className="label">Quando (gatilho)</p>
          <SmartSelect
            className="mt-1"
            value={f.trigger_type}
            onValueChange={(v) => up("trigger_type", v)}
            options={TRIGGERS.map((t): SmartOption => ({ value: t.v, label: t.l }))}
          />
          {(isScore || isDias) && (
            <input
              className="input mt-2"
              type="number"
              value={f.trigger_value}
              onChange={(e) => up("trigger_value", e.target.value)}
              placeholder={isScore ? "Score mínimo (ex.: 25)" : diasPlaceholder}
            />
          )}
          {f.trigger_type === "tag_added" && (
            <SmartSelect
              className="mt-2"
              placeholder="Qualquer tag"
              clearable
              value={f.trigger_value}
              onValueChange={(v) => up("trigger_value", v)}
              options={(tags || []).map((t): SmartOption => ({ value: t.id, label: t.name }))}
            />
          )}
          {f.trigger_type === "state_days" && (
            <input
              className="input mt-2"
              value={f.cond_state}
              onChange={(e) => up("cond_state", e.target.value)}
              placeholder="Estado (ex.: dormente)"
            />
          )}
          {f.trigger_type === "date_reached" && (
            <p className="mt-2 text-[11px] text-subtle">Dispara quando a data de retomada anotada (na triagem) chega. Combine com &ldquo;inscrever, encerrando a atual&rdquo; na cadência de retomada.</p>
          )}
          {f.trigger_type === "cadence_completed" && (
            <SmartSelect
              className="mt-2"
              placeholder="Qualquer cadência (origem)"
              clearable
              value={f.source_seq}
              onValueChange={(v) => up("source_seq", v)}
              options={sequences.map((s): SmartOption => ({ value: s.id, label: s.name }))}
            />
          )}
        </div>

        <div className="rounded-xl bg-muted p-4">
          <p className="label">Então (ação)</p>
          <SmartSelect
            className="mt-1"
            value={f.action_type}
            onValueChange={(v) => { up("action_type", v); if (v === "suppress") setStopOnMatch(true); }}
            options={ACTIONS.map((a): SmartOption => ({ value: a.v, label: a.l }))}
          />
          {f.action_type === "enroll" && (
            <SmartSelect
              className="mt-2"
              placeholder="Escolha a cadência…"
              value={f.action_seq}
              onValueChange={(v) => up("action_seq", v)}
              options={sequences.map((s): SmartOption => ({ value: s.id, label: s.name }))}
            />
          )}
          {f.action_type === "move_stage" && (
            <SmartSelect
              className="mt-2"
              placeholder="Escolha o estágio…"
              value={f.action_stage}
              onValueChange={(v) => up("action_stage", v)}
              options={stages.map((s): SmartOption => ({ value: s.id, label: s.name }))}
            />
          )}
          {f.action_type === "add_tag" && (
            <SmartSelect
              className="mt-2"
              placeholder="Escolha a tag…"
              value={f.action_tag}
              onValueChange={(v) => up("action_tag", v)}
              options={(tags || []).map((t): SmartOption => ({ value: t.id, label: t.name }))}
            />
          )}
          {f.action_type === "assign_owner" && (
            <SmartSelect
              className="mt-2"
              placeholder="Novo responsável…"
              clearable
              value={f.action_owner}
              onValueChange={(v) => up("action_owner", v)}
              options={members.map((m): SmartOption => ({ value: m.id, label: m.full_name || m.email }))}
            />
          )}
          {f.action_type === "set_product" && (
            <SmartSelect
              className="mt-2"
              placeholder="Produto de destino…"
              value={f.action_product}
              onValueChange={(v) => up("action_product", v)}
              options={(products || []).map((p): SmartOption => ({ value: p.id, label: p.name }))}
            />
          )}
          {f.action_type === "enroll" && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={endCurrent} onChange={(e) => setEndCurrent(e.target.checked)} />
              Encerrar a cadência atual antes (transição limpa)
            </label>
          )}
          {f.action_type === "suppress" && (
            <>
              <SmartSelect
                className="mt-2"
                placeholder="Tag ao suprimir (opcional)"
                clearable
                value={f.action_tag}
                onValueChange={(v) => up("action_tag", v)}
                options={(tags || []).map((t): SmartOption => ({ value: t.id, label: t.name }))}
              />
              <p className="mt-1 text-[11px] text-subtle">Encerra tudo e marca o contato como &ldquo;parar&rdquo; — nenhuma automação volta a tocá-lo.</p>
            </>
          )}
        </div>
      </div>

      {/* Condições (guardas): "só dispara se…" — chave para multi-produto */}
      <div className="mt-3 rounded-xl border border-line p-3">
        <p className="label">Só dispara se… (opcional)</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-[11px] text-subtle">É deste produto</span>
            <SmartSelect
              className="mt-1"
              placeholder="Qualquer produto"
              clearable
              value={f.product_id}
              onValueChange={(v) => up("product_id", v)}
              options={(products || []).map((p): SmartOption => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div>
            <span className="text-[11px] text-subtle">É deste responsável</span>
            <SmartSelect
              className="mt-1"
              placeholder="Qualquer dono"
              clearable
              value={f.cond_owner_id}
              onValueChange={(v) => up("cond_owner_id", v)}
              options={members.map((m): SmartOption => ({ value: m.id, label: m.full_name || m.email }))}
            />
          </div>
          <div>
            <span className="text-[11px] text-subtle">Tem a tag</span>
            <SmartSelect
              className="mt-1"
              placeholder="—"
              clearable
              value={f.cond_has_tag}
              onValueChange={(v) => up("cond_has_tag", v)}
              options={(tags || []).map((t): SmartOption => ({ value: t.id, label: t.name }))}
            />
          </div>
          <div>
            <span className="text-[11px] text-subtle">NÃO tem a tag</span>
            <SmartSelect
              className="mt-1"
              placeholder="—"
              clearable
              value={f.cond_not_tag}
              onValueChange={(v) => up("cond_not_tag", v)}
              options={(tags || []).map((t): SmartOption => ({ value: t.id, label: t.name }))}
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-subtle">
          &ldquo;É deste produto&rdquo; = o contato está ligado ao produto (por cadência ou oportunidade). Combine as condições: todas precisam bater para a regra disparar.
        </p>
      </div>

      {/* Avançado — colapsado por padrão. Defaults bons: prioridade 100 (ordem de criação);
          "parar nas demais" liga sozinho na ação suprimir; estado é para a máquina de estados. */}
      <div className="mt-3">
        <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setShowAdv((s) => !s)}>
          {showAdv ? "− Avançado" : "+ Avançado (ordem de avaliação, parar nas demais, estado)"}
        </button>
        {showAdv && (
          <div className="mt-2 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3">
            <div>
              <label className="label">Prioridade</label>
              <input className="input mt-1" type="number" value={f.priority} onChange={(e) => up("priority", e.target.value)} placeholder="100" />
              <p className="mt-1 text-[11px] text-subtle">Menor = avaliada antes. Padrão 100 (ordem de criação).</p>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={stopOnMatch} onChange={(e) => setStopOnMatch(e.target.checked)} />
              Parar nas demais regras se esta disparar
            </label>
            <div>
              <label className="label">Marcar estado (opcional)</label>
              <input className="input mt-1" value={f.set_state} onChange={(e) => up("set_state", e.target.value)} placeholder="ex.: em_A, dormente" />
            </div>
          </div>
        )}
      </div>

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : editingId ? "Salvar alterações" : "Criar automação"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={onClose}>Cancelar</button>
      </div>
      <p className="mt-3 text-xs text-subtle">
        Gatilhos de evento (abriu, clicou, respondeu) disparam na hora. Os de tempo (&ldquo;sem atividade&rdquo;, &ldquo;terminou a cadência&rdquo;, &ldquo;oportunidade perdida/ganha&rdquo;) são verificados uma vez por dia.
      </p>
    </div>
  );
}
