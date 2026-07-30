"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import SmartSelect from "@/components/SmartSelect";
import { paraUrl, contarFacetas } from "@/lib/filtros";

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
  // tag/produto são MULTI: dentro da caixa é OU, entre caixas é E.
  view: string; q: string; tag: string[]; produto: string[]; tags: Opt[]; produtos: Opt[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busca, setBusca] = useState(q);
  const detailedCount = contarFacetas(tag, produto);
  const [open, setOpen] = useState(detailedCount > 0);

  // base = URL atual (não as props): dois cliques rápidos em caixas diferentes não
  // podem apagar o filtro que acabou de entrar.
  function go(next: Record<string, string>) {
    const p = new URLSearchParams(searchParams?.toString() || "");
    const base: Record<string, string> = { q: busca.trim(), view, ...next };
    for (const [k, v] of Object.entries(base)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
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
            <div className="w-[200px]">
              <SmartSelect
                multiple
                placeholder="Todas"
                className="py-1.5 text-sm"
                values={tag}
                onValuesChange={(v) => go({ tag: paraUrl(v) })}
                options={tags.map((t) => ({ value: t.id, label: t.name }))}
              />
            </div>
          </Field>
          <Field label="Produto">
            <div className="w-[200px]">
              <SmartSelect
                multiple
                placeholder="Todos"
                className="py-1.5 text-sm"
                values={produto}
                onValuesChange={(v) => go({ produto: paraUrl(v) })}
                options={produtos.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>
          </Field>
          <p className="w-full text-[11px] text-subtle">
            Marcar vários numa mesma caixa é <b>ou</b>; caixas diferentes se somam (<b>e</b>).
          </p>
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
