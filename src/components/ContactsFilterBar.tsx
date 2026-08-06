"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import SmartSelect from "@/components/SmartSelect";
import { paraUrl, contarFacetas, SEM_DONO } from "@/lib/filtros";

type Opt = { id: string; name: string };

// Visões rápidas = o "trabalho do dia" em 1 clique. Cada uma seta o param ?view=.
const VIEWS: { v: string; label: string; tone?: "danger" | "warn" }[] = [
  { v: "", label: "Todos" },
  { v: "completar", label: "A completar", tone: "danger" },
  { v: "prontos", label: "Prontos p/ cadência" },
  { v: "resgatar", label: "Frios a resgatar", tone: "warn" },
  { v: "quentes", label: "Quentes", tone: "warn" },
  { v: "com_wa", label: "Com WhatsApp" },
];

export default function ContactsFilterBar({
  view, q, tag, produto, cadencia, frio, responsavel, email,
  tags, produtos, cadencias, membros,
}: {
  // tag/produto/cadencia/responsavel são MULTI (arrays); frio e e-mail seguem single
  // (um contato tem UM veredito de e-mail; marcar dois não quer dizer nada).
  view: string; q: string; tag: string[]; produto: string[]; cadencia: string[]; frio: string;
  responsavel: string[]; email: string;
  tags: Opt[]; produtos: Opt[]; cadencias: Opt[]; membros: Opt[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busca, setBusca] = useState(q);
  // responsavel entra na contagem: sem isso o "Filtros (2)" mentiria e o operador
  // não veria que há um filtro de dono ativo dentro do painel recolhido.
  const detailedCount = contarFacetas(tag, produto, cadencia, frio, responsavel, email);
  const [open, setOpen] = useState(detailedCount > 0);

  // Escreve a URL com listas separadas por vírgula (?tag=a,b) — a página lê com
  // comoLista(), que também aceita o formato antigo de valor único.
  //
  // A BASE é a URL ATUAL, não as props: marcar duas caixas em sequência (antes do
  // servidor responder a primeira) chegava com props velhas e apagava o filtro
  // anterior. searchParams reflete o que já foi para a URL.
  function go(next: Record<string, string>) {
    const p = new URLSearchParams(searchParams?.toString() || "");
    const base: Record<string, string> = { q: busca.trim(), view, ...next };
    for (const [k, v] of Object.entries(base)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`/dashboard/contatos${p.toString() ? `?${p}` : ""}`);
  }

  return (
    <div className="mt-4 space-y-3">
      {/* Busca */}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); go({ q: busca.trim() }); }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} className="input max-w-xs py-1.5 text-sm" placeholder="Buscar por nome, e-mail ou empresa…" />
        <button className="btn-ghost py-1.5 text-sm" type="submit">Buscar</button>
        {q && <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => { setBusca(""); go({ q: "" }); }}>limpar busca</button>}
        {q && <span className="text-xs text-subtle">Resultados para “{q}”</span>}
      </form>

      {/* Visões rápidas */}
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
            <button key={x.v || "todos"} onClick={() => go({ view: x.v })} className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
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

      {/* Filtros detalhados — recolhidos por padrão */}
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
          <Field label="Cadência">
            <div className="w-[200px]">
              <SmartSelect
                multiple
                placeholder="Todas"
                className="py-1.5 text-sm"
                values={cadencia}
                onValuesChange={(v) => go({ cadencia: paraUrl(v) })}
                options={cadencias.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          </Field>
          {/* Responsável: a coluna sempre existiu e dava para atribuir em lote — faltava
              justamente FILTRAR, que é o passo anterior a agir sobre um conjunto.
              "Sem dono" é uma opção de verdade aqui, não a ausência de escolha. */}
          <Field label="Responsável">
            <div className="w-[200px]">
              <SmartSelect
                multiple
                placeholder="Todos"
                className="py-1.5 text-sm"
                values={responsavel}
                onValuesChange={(v) => go({ responsavel: paraUrl(v) })}
                options={[{ value: SEM_DONO, label: "— sem dono —" }, ...membros.map((m) => ({ value: m.id, label: m.name }))]}
              />
            </div>
          </Field>
          {/* O VEREDITO DO E-MAIL — o mesmo rótulo que a lista mostra embaixo do nome.
              É o filtro que separa "já está bom, é só aceitar" de "ainda dá trabalho",
              que é a decisão que se toma varrendo a lista. */}
          <Field label="E-mail">
            <div className="w-[190px]">
              <SmartSelect
                clearable
                placeholder="Todos"
                className="py-1.5 text-sm"
                value={email}
                onValueChange={(v) => go({ email: v })}
                options={[
                  { value: "bate", label: "Bate com o nome" },
                  { value: "caixa", label: "Caixa geral" },
                  { value: "outro", label: "Outro nome" },
                  { value: "sem", label: "Sem e-mail" },
                ]}
              />
            </div>
          </Field>
          <Field label="Último toque">
            <div className="w-[160px]">
              <SmartSelect
                clearable
                placeholder="Todos"
                className="py-1.5 text-sm"
                value={frio}
                onValueChange={(v) => go({ frio: v })}
                options={[
                  { value: "15", label: "Frios +15d" },
                  { value: "30", label: "Frios +30d" },
                  { value: "nunca", label: "Nunca tocados" },
                ]}
              />
            </div>
          </Field>
          <p className="w-full text-[11px] text-subtle">
            Marcar vários numa mesma caixa é <b>ou</b> (tag A ou B); caixas diferentes se somam (<b>e</b>).
            {email && email !== "sem" && " O filtro de e-mail lê endereço por endereço — em base grande a lista demora alguns segundos."}
          </p>
          {detailedCount > 0 && (
            <button type="button" className="pb-1.5 text-xs text-subtle hover:text-danger" onClick={() => go({ tag: "", produto: "", cadencia: "", frio: "", responsavel: "", email: "" })}>
              limpar filtros
            </button>
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
