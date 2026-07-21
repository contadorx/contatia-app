"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type Opt = { id: string; name: string };

const VIEWS: { v: string; label: string; tone?: "danger" | "warn" }[] = [
  { v: "", label: "Todas" },
  { v: "sem_contato", label: "Sem contato", tone: "danger" },
  { v: "sem_opp", label: "Sem oportunidade", tone: "warn" },
  { v: "com_opp", label: "Com oportunidade aberta" },
];

export default function AccountsFilterBar({
  view, q, tag, produto, tags, produtos,
}: {
  view: string; q: string; tag: string; produto: string; tags: Opt[]; produtos: Opt[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState(q);
  const detailedCount = [tag, produto].filter(Boolean).length;
  const [open, setOpen] = useState(detailedCount > 0);

  function go(next: Record<string, string>) {
    const cur: Record<string, string> = { q: busca.trim(), view, tag, produto, ...next };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    router.push(`/dashboard/contas${p.toString() ? `?${p}` : ""}`);
  }

  return (
    <div className="mt-4 space-y-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); go({ q: busca.trim() }); }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} className="input max-w-xs py-1.5 text-sm" placeholder="Buscar por nome, CNPJ ou domínio…" />
        <button className="btn-ghost py-1.5 text-sm" type="submit">Buscar</button>
        {q && <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => { setBusca(""); go({ q: "" }); }}>limpar busca</button>}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">Visão:</span>
        {VIEWS.map((x) => {
          const active = view === x.v;
          const cls = active
            ? "bg-brand text-white"
            : x.tone === "danger"
            ? "border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
            : x.tone === "warn"
            ? "border border-warn/30 bg-warn/5 text-warn hover:bg-warn/10"
            : "bg-muted text-subtle hover:text-ink";
          return (
            <button key={x.v || "todas"} onClick={() => go({ view: x.v })} className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
              {x.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${detailedCount ? "bg-brand-soft text-brand-dark" : "bg-muted text-subtle hover:text-ink"}`}
        >
          Filtros{detailedCount ? ` (${detailedCount})` : ""} {open ? "▴" : "▾"}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
          <Field label="Tag">
            <select value={tag} onChange={(e) => go({ tag: e.target.value })} className="input py-1.5 text-sm">
              <option value="">Todas</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Produto">
            <select value={produto} onChange={(e) => go({ produto: e.target.value })} className="input py-1.5 text-sm">
              <option value="">Todos</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {detailedCount > 0 && (
            <button type="button" className="pb-1.5 text-xs text-subtle hover:text-danger" onClick={() => go({ tag: "", produto: "" })}>limpar filtros</button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-0.5 block text-[11px] text-subtle">{label}</span>
      {children}
    </div>
  );
}
