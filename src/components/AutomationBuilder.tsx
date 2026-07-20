"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAutomation } from "@/app/dashboard/automacoes/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type Seq = { id: string; name: string };
type Stage = { id: string; name: string };
type Tag = { id: string; name: string };
type Product = { id: string; name: string };

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
  { v: "mark_state", l: "Marcar estado (ex.: dormente)" },
  { v: "suppress", l: "Suprimir (parar definitivo)" },
];

// gatilhos cujo valor é "quantidade de dias"
const DIAS_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won", "state_days"];
// gatilhos que fazem sentido escopar por produto
const PRODUTO_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won"];

type Template = { id: string; name: string; description?: string | null; category: string; config: any; is_global: boolean };

const CATEGORY_LABEL: Record<string, string> = {
  sinais: "Sinais quentes",
  reciclagem: "Reciclagem / reengajamento",
  posvenda: "Pós-venda / expansão",
  higiene: "Higiene",
  geral: "Outros",
};

export default function AutomationBuilder({
  sequences,
  stages,
  tags,
  products,
  templates = [],
}: {
  sequences: Seq[];
  stages: Stage[];
  tags?: Tag[];
  products?: Product[];
  templates?: Template[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: "",
    trigger_type: "doc_opened",
    trigger_value: "",
    action_type: "enroll",
    action_seq: "",
    action_stage: "",
    action_tag: "",
    product_id: "",
    source_seq: "",
    priority: "100",
    set_state: "",
    cond_state: "",
  });
  const [stopOnMatch, setStopOnMatch] = useState(false);
  const [endCurrent, setEndCurrent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function up(k: string, v: string) {
    setF((s) => ({ ...s, [k]: v }));
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await createAutomation({
        ...f,
        priority: Number(f.priority) || 100,
        stop_on_match: stopOnMatch,
        end_current: endCurrent,
      });
      if (res?.error) setMsg(res.error);
      else {
        setF({ name: "", trigger_type: "doc_opened", trigger_value: "", action_type: "enroll", action_seq: "", action_stage: "", action_tag: "", product_id: "", source_seq: "", priority: "100", set_state: "", cond_state: "" });
        setStopOnMatch(false); setEndCurrent(false);
        setOpen(false);
        router.refresh(); // garante que a nova automação aparece na lista na hora
      }
    });
  }

  if (!open)
    return (
      <button className="btn-brand" onClick={() => setOpen(true)}>
        + Nova automação
      </button>
    );

  const isDias = DIAS_TRIGGERS.includes(f.trigger_type);
  const isScore = f.trigger_type === "score_gte";
  const podeProduto = PRODUTO_TRIGGERS.includes(f.trigger_type) && (products || []).length > 0;
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
          {podeProduto && (
            <>
              <SmartSelect
                className="mt-2"
                placeholder="Qualquer produto"
                clearable
                value={f.product_id}
                onValueChange={(v) => up("product_id", v)}
                options={(products || []).map((p): SmartOption => ({ value: p.id, label: p.name }))}
              />
              <p className="mt-1 text-[11px] text-subtle">
                Com um produto escolhido, &ldquo;sem atividade&rdquo; e &ldquo;terminou a cadência&rdquo; olham só para aquele produto — o mesmo lead pode ser trabalhado em outros produtos sem disparar a regra.
              </p>
            </>
          )}
        </div>

        <div className="rounded-xl bg-muted p-4">
          <p className="label">Então (ação)</p>
          <SmartSelect
            className="mt-1"
            value={f.action_type}
            onValueChange={(v) => up("action_type", v)}
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

      {/* Avançado: ordem de avaliação e estado (máquina de estados) */}
      <div className="mt-3 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3">
        <div>
          <label className="label">Prioridade</label>
          <input className="input mt-1" type="number" value={f.priority} onChange={(e) => up("priority", e.target.value)} placeholder="100" />
          <p className="mt-1 text-[11px] text-subtle">Menor = avaliada antes.</p>
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

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Criar automação"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      <p className="mt-3 text-xs text-subtle">
        Gatilhos de evento (abriu, clicou, respondeu) disparam na hora. Os de tempo (&ldquo;sem atividade&rdquo;, &ldquo;terminou a cadência&rdquo;, &ldquo;oportunidade perdida/ganha&rdquo;) são verificados uma vez por dia.
      </p>
    </div>
  );
}
