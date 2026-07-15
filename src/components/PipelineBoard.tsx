"use client";

import { useEffect, useState, useTransition } from "react";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { createOpportunity, moveOpportunity, updateOpportunity, deleteOpportunity } from "@/app/dashboard/pipeline/actions";
import { UltimoToque } from "@/lib/lastTouch";

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
  contact_last_at?: string | null;
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
  openOppId,
}: {
  stages: Stage[];
  opportunities: Opp[];
  contacts: Contact[];
  accounts: Account[];
  products?: Product[];
  allTags?: { id: string; name: string; color: string }[];
  openOppId?: string;
}) {
  const [opps, setOpps] = useState<Opp[]>(opportunities);
  const [dragId, setDragId] = useState<string | null>(null);

  // deep-link: chegou por /dashboard/pipeline?opp=<id> → abre o editor e rola até ele
  useEffect(() => {
    if (!openOppId) return;
    const o = opportunities.find((x) => x.id === openOppId);
    if (!o) return;
    setEditOpp({ id: o.id, title: o.title, value_mrr: String(o.value_mrr || ""), contact_id: (o as any).contact_id || "", account_id: (o as any).account_id || "", product_id: (o as any).product_id || "" });
    setTimeout(() => document.getElementById(`opp-${openOppId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOppId]);
  const [showForm, setShowForm] = useState(false);
  const [editOpp, setEditOpp] = useState<{ id: string; title: string; value_mrr: string; contact_id: string; account_id: string; product_id: string } | null>(null);
  const [pending, start] = useTransition();

  // filtros
  const [fTags, setFTags] = useState<string[]>([]);         // filtro por VÁRIAS tags
  const [fCad, setFCad] = useState<"todos" | "com" | "sem">("todos");
  const [fBusca, setFBusca] = useState("");
  const [fProducts, setFProducts] = useState<string[]>([]); // filtro por VÁRIOS produtos
  const cadences = Array.from(new Set(opps.map((o) => o.active_cadence).filter(Boolean))) as string[];
  const [fCadNames, setFCadNames] = useState<string[]>([]); // filtro por VÁRIAS cadências
  const [showFilters, setShowFilters] = useState(false);

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
        Nenhum estágio no seu funil ainda. Fale com o suporte para configurar os estágios do pipeline.
      </div>
    );

  const total = opps.filter((o) => o.status === "open").reduce((s, o) => s + Number(o.value_mrr || 0), 0);

  // aplica filtros
  const filtered = opps.filter((o) => {
    // filtros de MÚLTIPLA seleção: vazio = não filtra; com itens = OU entre eles
    if (fTags.length && !(o.tags || []).some((t) => fTags.includes(t.id))) return false;
    if (fCad === "com" && !o.active_cadence) return false;
    if (fCad === "sem" && o.active_cadence) return false;
    if (fCadNames.length && !fCadNames.includes(o.active_cadence || "")) return false;
    if (fProducts.length && !fProducts.includes((o as any).product_id)) return false;
    if (fBusca) {
      const q = fBusca.toLowerCase();
      const hay = `${o.title} ${o.contact_name || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const hasFilter = !!(fTags.length || fCad !== "todos" || fCadNames.length || fBusca || fProducts.length);
  const activeCount = [fTags.length > 0, fCad !== "todos", fCadNames.length > 0, fProducts.length > 0].filter(Boolean).length;
  function clearFilters() { setFTags([]); setFCad("todos"); setFCadNames([]); setFBusca(""); setFProducts([]); }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-subtle">
          {opps.filter((o) => o.status === "open").length} negócios abertos ·{" "}
          <b className="text-ink">{brl(total)}/mês</b> em potencial
        </p>
        <button className="btn-brand" onClick={() => setShowForm((s) => !s)}>
          + Negócio
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
              <SmartSelect
                className="mt-1"
                placeholder="—"
                clearable
                value={accountId}
                onValueChange={setAccountId}
                options={accounts.map((a): SmartOption => ({ value: a.id, label: a.name }))}
              />
            </div>
            <div>
              <label className="label">Contato (opcional)</label>
              <SmartSelect
                className="mt-1"
                placeholder="—"
                clearable
                value={contactId}
                onValueChange={setContactId}
                options={contacts.map((c): SmartOption => ({ value: c.id, label: c.name }))}
              />
            </div>
          </div>
          {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
          <button className="btn-brand mt-3" onClick={submit} disabled={pending}>
            {pending ? "..." : "Criar"}
          </button>
        </div>
      )}

      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input py-1.5 text-sm" style={{ width: 220, flex: "0 0 auto" }} value={fBusca} onChange={(e) => setFBusca(e.target.value)} placeholder="Buscar negócio ou contato" />
          <button
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${showFilters || activeCount ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            Filtros{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
          {hasFilter && (
            <button className="shrink-0 text-xs text-subtle hover:text-ink" onClick={clearFilters}>limpar</button>
          )}
          <span className="ml-auto shrink-0 text-xs text-subtle">{filtered.length} de {opps.length}</span>
        </div>

        {showFilters && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
            <div className="flex shrink-0 gap-1">
              {(["todos", "com", "sem"] as const).map((v) => (
                <button key={v} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${fCad === v ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`} onClick={() => setFCad(v)}>
                  {v === "todos" ? "Todos" : v === "com" ? "Em cadência" : "Sem cadência"}
                </button>
              ))}
            </div>
            {cadences.length > 0 && (
              <div style={{ width: 150, flex: "0 0 auto" }}>
                <SmartSelect
                  multiple
                  className="py-1 text-xs"
                  placeholder="Qualquer cadência"
                  values={fCadNames}
                  onValuesChange={setFCadNames}
                  options={cadences.map((c): SmartOption => ({ value: c, label: c }))}
                />
              </div>
            )}
            {allTags.length > 0 && (
              <div style={{ width: 130, flex: "0 0 auto" }}>
                <SmartSelect
                  multiple
                  className="py-1 text-xs"
                  placeholder="Todas as tags"
                  values={fTags}
                  onValuesChange={setFTags}
                  options={allTags.map((t): SmartOption => ({ value: t.id, label: t.name }))}
                />
              </div>
            )}
            {products.length > 0 && (
              <div style={{ width: 160, flex: "0 0 auto" }}>
                <SmartSelect
                  multiple
                  className="py-1 text-xs"
                  placeholder="Todos os produtos"
                  values={fProducts}
                  onValuesChange={setFProducts}
                  options={products.map((p): SmartOption => ({ value: p.id, label: p.name }))}
                />
              </div>
            )}
          </div>
        )}
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
                  id={`opp-${o.id}`}
                  draggable
                  onDragStart={() => setDragId(o.id)}
                  className={`group mb-2 cursor-grab rounded-lg border bg-surface p-2.5 shadow-sm active:cursor-grabbing ${openOppId === o.id ? "border-brand ring-2 ring-brand/30" : "border-line"}`}
                >
                  <div
                    className="h-0.5 rounded"
                    style={{ background: st.is_won ? "var(--tw-signal,#12B76A)" : "#4A3AFF", marginBottom: 6 }}
                  />
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-sm font-semibold leading-tight">{o.title}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <UltimoToque at={o.contact_last_at} titulo="Parado desde o último toque no contato do negócio." />
                      <button
                        className="text-[11px] text-subtle opacity-0 transition hover:text-brand-dark group-hover:opacity-100"
                        title="Editar"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setEditOpp({ id: o.id, title: o.title, value_mrr: String(o.value_mrr || ""), contact_id: o.contact_id || "", account_id: (o as any).account_id || "", product_id: (o as any).product_id || "" }); }}
                      >✎</button>
                    </div>
                  </div>
                  {editOpp?.id === o.id && (
                    <div className="mt-2 rounded-lg border border-line bg-muted p-2" onMouseDown={(e) => e.stopPropagation()} draggable={false}>
                      <input className="input py-1 text-xs" value={editOpp.title} onChange={(e) => setEditOpp({ ...editOpp, title: e.target.value })} placeholder="Título" />
                      <input className="input mt-1 py-1 text-xs" type="number" value={editOpp.value_mrr} onChange={(e) => setEditOpp({ ...editOpp, value_mrr: e.target.value })} placeholder="Valor/mês" />
                      <SmartSelect
                        className="mt-1 py-1 text-xs"
                        placeholder="— sem contato"
                        clearable
                        value={editOpp.contact_id}
                        onValueChange={(v) => setEditOpp({ ...editOpp, contact_id: v })}
                        options={contacts.map((c): SmartOption => ({ value: c.id, label: c.name }))}
                      />
                      <SmartSelect
                        className="mt-1 py-1 text-xs"
                        placeholder="— sem empresa"
                        clearable
                        value={editOpp.account_id}
                        onValueChange={(v) => setEditOpp({ ...editOpp, account_id: v })}
                        options={accounts.map((a): SmartOption => ({ value: a.id, label: a.name }))}
                      />
                      {products.length > 0 && (
                        <SmartSelect
                          className="mt-1 py-1 text-xs"
                          placeholder="— produto/serviço"
                          clearable
                          value={editOpp.product_id}
                          onValueChange={(v) => setEditOpp({ ...editOpp, product_id: v })}
                          options={products.map((p): SmartOption => ({ value: p.id, label: p.name }))}
                        />
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <button className="btn-brand py-1 text-[11px]" disabled={pending} onClick={() => start(async () => {
                          await updateOpportunity(o.id, { title: editOpp.title, value_mrr: Number(editOpp.value_mrr), primary_contact_id: editOpp.contact_id || null, account_id: editOpp.account_id || null, product_id: editOpp.product_id || null });
                          setOpps((prev) => prev.map((x) => x.id === o.id ? { ...x, title: editOpp.title, value_mrr: Number(editOpp.value_mrr) || 0, contact_id: editOpp.contact_id || null, product_id: editOpp.product_id || null } as any : x));
                          setEditOpp(null);
                        })}>Salvar</button>
                        <button className="text-[11px] text-subtle hover:text-ink" onClick={() => setEditOpp(null)}>cancelar</button>
                        <button className="ml-auto text-[11px] text-subtle hover:text-danger" onClick={() => start(async () => {
                          if (confirm("Excluir este negócio?")) { await deleteOpportunity(o.id); setOpps((prev) => prev.filter((x) => x.id !== o.id)); setEditOpp(null); }
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
                  <p className="mt-1 text-sm font-bold text-brand-dark">{brl(Number(o.value_mrr))}/mês</p>
                  {(o.last_activity || o.active_cadence) && (
                    <div className="mt-1.5 hidden border-t border-line pt-1.5 group-hover:block">
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
