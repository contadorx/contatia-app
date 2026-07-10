"use client";

import { useState, useTransition } from "react";
import { createOpportunity, moveOpportunity } from "@/app/dashboard/pipeline/actions";

type Stage = { id: string; name: string; position: number; is_won: boolean; is_lost: boolean };
type Opp = {
  id: string;
  title: string;
  value_mrr: number;
  stage_id: string | null;
  status: string;
  contact_name: string | null;
};
type Contact = { id: string; name: string };
type Account = { id: string; name: string };

const brl = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function PipelineBoard({
  stages,
  opportunities,
  contacts,
  accounts,
}: {
  stages: Stage[];
  opportunities: Opp[];
  contacts: Contact[];
  accounts: Account[];
}) {
  const [opps, setOpps] = useState<Opp[]>(opportunities);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pending, start] = useTransition();

  // form
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactId, setContactId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function onDrop(stageId: string) {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setOpps((list) => list.map((o) => (o.id === id ? { ...o, stage_id: stageId } : o)));
    start(async () => {
      await moveOpportunity(id, stageId);
    });
  }

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await createOpportunity({
        title,
        value_mrr: Number(value) || 0,
        stage_id: stages[0]?.id ?? null,
        primary_contact_id: contactId || null,
        account_id: accountId || null,
      });
      if (res?.error) setMsg(res.error);
      else {
        setTitle("");
        setValue("");
        setContactId("");
        setAccountId("");
        setShowForm(false);
        // recarrega via revalidate (server) — otimista simples: adiciona local
        setOpps((l) => [
          {
            id: Math.random().toString(36),
            title,
            value_mrr: Number(value) || 0,
            stage_id: stages[0]?.id ?? null,
            status: "open",
            contact_name: contacts.find((c) => c.id === contactId)?.name ?? null,
          },
          ...l,
        ]);
      }
    });
  }

  if (!stages.length)
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nenhum estágio de pipeline. Rode o bloco SEED da migration para criar os estágios.
      </div>
    );

  const total = opps.filter((o) => o.status === "open").reduce((s, o) => s + Number(o.value_mrr || 0), 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-subtle">
          {opps.filter((o) => o.status === "open").length} negócios abertos ·{" "}
          <b className="text-ink">{brl(total)}/mês</b> em potencial
        </p>
        <button className="btn-brand" onClick={() => setShowForm((s) => !s)}>
          + Oportunidade
        </button>
      </div>

      {showForm && (
        <div className="card mb-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-1">
              <label className="label">Título *</label>
              <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assinatura — Escritório X" />
            </div>
            <div>
              <label className="label">Valor recorrente (R$/mês)</label>
              <input type="number" className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)} placeholder="179" />
            </div>
            <div>
              <label className="label">Empresa (opcional)</label>
              <select className="input mt-1" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Contato (opcional)</label>
              <select className="input mt-1" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">—</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
          <button className="btn-brand mt-3" onClick={submit} disabled={pending}>
            {pending ? "..." : "Criar"}
          </button>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(150px, 1fr))` }}>
        {stages.map((st) => {
          const colOpps = opps.filter((o) => o.stage_id === st.id);
          const colTotal = colOpps.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
          return (
            <div
              key={st.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(st.id)}
              className="rounded-xl bg-muted/60 p-2"
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className={`text-xs font-bold ${st.is_won ? "text-signal" : st.is_lost ? "text-subtle" : "text-ink"}`}>
                  {st.name}
                </span>
                <span className="text-xs text-subtle">{colOpps.length}</span>
              </div>
              {colOpps.map((o) => (
                <div
                  key={o.id}
                  draggable
                  onDragStart={() => setDragId(o.id)}
                  className="mb-2 cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-sm active:cursor-grabbing"
                >
                  <div
                    className="h-0.5 rounded"
                    style={{ background: st.is_won ? "var(--tw-signal,#12B76A)" : "#4A3AFF", marginBottom: 6 }}
                  />
                  <p className="text-xs font-semibold leading-tight">{o.title}</p>
                  {o.contact_name && <p className="mt-0.5 text-[11px] text-subtle">{o.contact_name}</p>}
                  <p className="mt-1 text-[11px] font-bold text-brand-dark">{brl(Number(o.value_mrr))}/mês</p>
                </div>
              ))}
              {colOpps.length > 0 && (
                <p className="px-1 pt-1 text-[10px] text-subtle">{brl(colTotal)}/mês</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
