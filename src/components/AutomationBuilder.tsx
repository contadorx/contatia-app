"use client";

import { useState, useTransition } from "react";
import { createAutomation } from "@/app/dashboard/automacoes/actions";

type Seq = { id: string; name: string };
type Stage = { id: string; name: string };

const TRIGGERS = [
  { v: "doc_opened", l: "Abriu uma proposta" },
  { v: "link_clicked", l: "Clicou num link" },
  { v: "replied", l: "Respondeu" },
  { v: "tag_added", l: "Recebeu uma tag" },
  { v: "score_gte", l: "Score atingiu (nº)" },
  { v: "no_activity_days", l: "Sem atividade há X dias" },
];
const ACTIONS = [
  { v: "enroll", l: "Inscrever numa cadência" },
  { v: "pause_all", l: "Pausar cadências ativas" },
  { v: "move_stage", l: "Mover para um estágio" },
  { v: "mark_hot", l: "Marcar como quente" },
];

export default function AutomationBuilder({ sequences, stages, tags }: { sequences: Seq[]; stages: Stage[]; tags?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", trigger_type: "doc_opened", trigger_value: "", action_type: "enroll", action_seq: "", action_stage: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function up(k: string, v: string) {
    setF((s) => ({ ...s, [k]: v }));
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await createAutomation(f);
      if (res?.error) setMsg(res.error);
      else {
        setF({ name: "", trigger_type: "doc_opened", trigger_value: "", action_type: "enroll", action_seq: "", action_stage: "" });
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className="btn-brand" onClick={() => setOpen(true)}>
        + Nova automação
      </button>
    );

  const needsValue = f.trigger_type === "score_gte" || f.trigger_type === "no_activity_days";

  return (
    <div className="card p-5">
      <input className="input" value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="Nome (ex.: Proposta aberta → acelerar)" />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-muted p-4">
          <p className="label">Quando (gatilho)</p>
          <select className="input mt-1" value={f.trigger_type} onChange={(e) => up("trigger_type", e.target.value)}>
            {TRIGGERS.map((t) => (
              <option key={t.v} value={t.v}>{t.l}</option>
            ))}
          </select>
          {needsValue && (
            <input
              className="input mt-2"
              type="number"
              value={f.trigger_value}
              onChange={(e) => up("trigger_value", e.target.value)}
              placeholder={f.trigger_type === "score_gte" ? "Score mínimo (ex.: 25)" : "Dias sem atividade (ex.: 120)"}
            />
          )}
          {f.trigger_type === "tag_added" && (
            <select className="input mt-2" value={f.trigger_value} onChange={(e) => up("trigger_value", e.target.value)}>
              <option value="">Qualquer tag</option>
              {(tags || []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="rounded-xl bg-muted p-4">
          <p className="label">Então (ação)</p>
          <select className="input mt-1" value={f.action_type} onChange={(e) => up("action_type", e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a.v} value={a.v}>{a.l}</option>
            ))}
          </select>
          {f.action_type === "enroll" && (
            <select className="input mt-2" value={f.action_seq} onChange={(e) => up("action_seq", e.target.value)}>
              <option value="">Escolha a cadência…</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {f.action_type === "move_stage" && (
            <select className="input mt-2" value={f.action_stage} onChange={(e) => up("action_stage", e.target.value)}>
              <option value="">Escolha o estágio…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
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
        Gatilhos de evento (abriu/clicou/respondeu/score) disparam na hora. &ldquo;Sem atividade há X dias&rdquo; roda no cron diário.
      </p>
    </div>
  );
}
