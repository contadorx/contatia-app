"use client";

import { useState, useTransition } from "react";
import { createOpportunity, moveOpportunity, updateOpportunity, deleteOpportunity } from "@/app/dashboard/pipeline/actions";

type Stage = { id: string; name: string; position: number; is_won: boolean; is_lost: boolean };
type Opp = {
  id: string;
  title: string;
  value_mrr: number;
  stage_id: string | null;
  status: string;
  contact_name: string | null;
  contact_id?: string | null;
  account_id?: string | null;
  contact_score?: number;
  last_activity?: string | null;
  active_cadence?: string | null;
  product_id?: string | null;
  tags?: { id: string; name: string; color: string }[];
};
type Contact = { id: string; name: string };
type Account = { id: string; name: string };
type Product = { id: string; name: string; kind: string; billing: string; price: number };

const brl = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function PipelineBoard({
  stages,
  opportunities,
  contacts,
  accounts,
  products = [],
  allTags = [],
}: {
  stages: Stage[];
  opportunities: Opp[];
  contacts: Contact[];
  accounts: Account[];
  products?: Product[];
  allTags?: { id: string; name: string; color: string }[];
}) {
  const [opps, setOpps] = useState<Opp[]>(opportunities);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editOpp, setEditOpp] = useState<{ id: string; title: string; value_mrr: string; contact_id: string; account_id: string; product_id: string } | null>(null);
  const [pending, start] = useTransition();

  // filtros
  const [fTag, setFTag] = useState("");
  const [fCad, setFCad] = useState<"todos" | "com" | "sem">("todos");
  const [fBusca, setFBusca] = useState("");
  const [fProduct, setFProduct] = useState("");
  const cadences = Array.from(new Set(opps.map((o) => o.active_cadence).filter(Boolean))) as string[];
  const [fCadName, setFCadName] = useState("");

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

  // aplica filtros
  const filtered = opps.filter((o) => {
    if (fTag && !(o.tags || []).some((t) => t.id === fTag)) return false;
    if (fCad === "com" && !o.active_cadence) return false;
    if (fCad === "sem" && o.active_cadence) return false;
    if (fCadName && o.active_cadence !== fCadName) return false;
    if (fProduct && (o as any).product_id !== fProduct) return false;
    if (fBusca) {
      const q = fBusca.toLowerCase();
      const hay = `${o.title} ${o.contact_name || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const hasFilter = !!(fTag || fCad !== "todos" || fCadName || fBusca || fProduct);

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

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
        <input className="input py-1 text-xs" style={{ width: 160, flex: "0 0 auto" }} value={fBusca} onChange={(e) => setFBusca(e.target.value)} placeholder="Buscar negócio/contato" />
        <div className="flex shrink-0 gap-1">
          {(["todos", "com", "sem"] as const).map((v) => (
            <button key={v} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${fCad === v ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`} onClick={() => setFCad(v)}>
              {v === "todos" ? "Todos" : v === "com" ? "Em cadência" : "Sem cadência"}
            </button>
          ))}
        </div>
        {cadences.length > 0 && (
          <select className="input py-1 text-xs" style={{ width: 150, flex: "0 0 auto" }} value={fCadName} onChange={(e) => setFCadName(e.target.value)}>
            <option value="">Qualquer cadência</option>
            {cadences.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {allTags.length > 0 && (
          <select className="input py-1 text-xs" style={{ width: 130, flex: "0 0 auto" }} value={fTag} onChange={(e) => setFTag(e.target.value)}>
            <option value="">Todas as tags</option>
            {allTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {products.length > 0 && (
          <select className="input py-1 text-xs" style={{ width: 160, flex: "0 0 auto" }} value={fProduct} onChange={(e) => setFProduct(e.target.value)}>
            <option value="">Todos os produtos</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {hasFilter && (
          <button className="shrink-0 text-xs text-subtle hover:text-ink" onClick={() => { setFTag(""); setFCad("todos"); setFCadName(""); setFBusca(""); setFProduct(""); }}>limpar</button>
        )}
        <span className="shrink-0 text-xs text-subtle">{filtered.length} de {opps.length}</span>
      </div>

      <div className="overflow-x-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(150px, 1fr))`, minWidth: stages.length > 4 ? stages.length * 160 : undefined }}>
        {stages.map((st) => {
          const colOpps = filtered.filter((o) => o.stage_id === st.id);
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
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold leading-tight">{o.title}</p>
                    <button
                      className="shrink-0 text-[11px] text-subtle hover:text-brand-dark"
                      title="Editar"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setEditOpp({ id: o.id, title: o.title, value_mrr: String(o.value_mrr || ""), contact_id: o.contact_id || "", account_id: (o as any).account_id || "", product_id: (o as any).product_id || "" }); }}
                    >✎</button>
                  </div>
                  {editOpp?.id === o.id && (
                    <div className="mt-2 rounded-lg border border-line bg-muted p-2" onMouseDown={(e) => e.stopPropagation()} draggable={false}>
                      <input className="input py-1 text-xs" value={editOpp.title} onChange={(e) => setEditOpp({ ...editOpp, title: e.target.value })} placeholder="Título" />
                      <input className="input mt-1 py-1 text-xs" type="number" value={editOpp.value_mrr} onChange={(e) => setEditOpp({ ...editOpp, value_mrr: e.target.value })} placeholder="Valor/mês" />
                      <select className="input mt-1 py-1 text-xs" value={editOpp.contact_id} onChange={(e) => setEditOpp({ ...editOpp, contact_id: e.target.value })}>
                        <option value="">— sem contato</option>
                        {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <select className="input mt-1 py-1 text-xs" value={editOpp.account_id} onChange={(e) => setEditOpp({ ...editOpp, account_id: e.target.value })}>
                        <option value="">— sem empresa</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      {products.length > 0 && (
                        <select className="input mt-1 py-1 text-xs" value={editOpp.product_id} onChange={(e) => setEditOpp({ ...editOpp, product_id: e.target.value })}>
                          <option value="">— produto/serviço</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <button className="btn-brand py-1 text-[11px]" disabled={pending} onClick={() => start(async () => {
                          await updateOpportunity(o.id, { title: editOpp.title, value_mrr: Number(editOpp.value_mrr), primary_contact_id: editOpp.contact_id || null, account_id: editOpp.account_id || null, product_id: editOpp.product_id || null });
                          setOpps((prev) => prev.map((x) => x.id === o.id ? { ...x, title: editOpp.title, value_mrr: Number(editOpp.value_mrr) || 0, contact_id: editOpp.contact_id || null, product_id: editOpp.product_id || null } as any : x));
                          setEditOpp(null);
                        })}>Salvar</button>
                        <button className="text-[11px] text-subtle hover:text-ink" onClick={() => setEditOpp(null)}>cancelar</button>
                        <button className="ml-auto text-[11px] text-subtle hover:text-danger" onClick={() => start(async () => {
                          if (confirm("Excluir esta oportunidade?")) { await deleteOpportunity(o.id); setOpps((prev) => prev.filter((x) => x.id !== o.id)); setEditOpp(null); }
                        })}>excluir</button>
                      </div>
                    </div>
                  )}
                  {o.contact_name && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-subtle">
                      {o.contact_id ? (
                        <a href={`/dashboard/contatos/${o.contact_id}`} className="text-brand-dark hover:underline" onMouseDown={(e) => e.stopPropagation()} draggable={false}>
                          {o.contact_name}
                        </a>
                      ) : (
                        o.contact_name
                      )}
                      {(o.contact_score ?? 0) >= 25 && <span className="rounded-full bg-warn/15 px-1 py-0.5 text-[9px] font-bold text-warn">QUENTE</span>}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-bold text-brand-dark">{brl(Number(o.value_mrr))}/mês</p>
                  {(o.last_activity || o.active_cadence) && (
                    <div className="mt-1.5 border-t border-line pt-1.5">
                      {o.last_activity && <p className="text-[10px] text-subtle">↳ {o.last_activity}</p>}
                      {o.active_cadence && (
                        <p className="mt-0.5 truncate text-[10px]">
                          <span className="rounded bg-brand-soft px-1 py-0.5 text-brand-dark">em cadência: {o.active_cadence}</span>
                        </p>
                      )}
                    </div>
                  )}
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
    </div>
  );
}
