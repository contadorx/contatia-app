"use client";

// ============================================================
// REUNIÕES PASSADAS — com quem foi, de que empresa, e como filtrar
//
// A lista antiga mostrava título + nome do contato + data. Faltava o essencial para
// consultar o passado: a EMPRESA, o RESPONSÁVEL, e qualquer forma de filtrar. Com 30
// itens sem filtro, "com quem eu falei na Alfa Contabilidade?" não tinha resposta.
//
// A busca casa contra título, contato, empresa e o texto do resultado — de propósito:
// quem procura no histórico normalmente lembra de UMA dessas coisas, não sabe de qual.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import MeetingOutcome from "@/components/MeetingOutcome";
import NewOpportunityForContact from "@/components/NewOpportunityForContact";

export type ReuniaoPassada = {
  id: string;
  title: string;
  datetime: string;
  status: string;
  outcome: string | null;
  outcome_status: string | null;
  contact_id: string | null;
  assigned_to: string | null;
  contatoNome: string | null;
  empresa: string | null;
};

const STATUS_LABEL: Record<string, { l: string; c: string }> = {
  agendada: { l: "Agendada", c: "bg-brand-soft text-brand-dark" },
  confirmada: { l: "Confirmada", c: "bg-signal/15 text-signal" },
  realizada: { l: "Realizada", c: "bg-signal/15 text-signal" },
  no_show: { l: "Não compareceu", c: "bg-danger/10 text-danger" },
  cancelada: { l: "Cancelada", c: "bg-muted text-subtle" },
  remarcada: { l: "Remarcada", c: "bg-warn/10 text-warn" },
};

const FILTROS = [
  { k: "todas", txt: "Todas" },
  { k: "pendente", txt: "Sem resultado" },
  { k: "realizada", txt: "Realizadas" },
  { k: "no_show", txt: "Não compareceu" },
];

export default function ReunioesPassadas({
  reunioes,
  membros,
}: {
  reunioes: ReuniaoPassada[];
  membros: { id: string; nome: string }[];
}) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [dono, setDono] = useState("");

  const nomeDono = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of membros) m[p.id] = p.nome;
    return m;
  }, [membros]);

  const lista = useMemo(() => {
    const termo = q.trim().toLowerCase();
    return reunioes.filter((m) => {
      if (dono && m.assigned_to !== dono) return false;
      if (filtro === "pendente" && (m.status === "realizada" || m.status === "no_show")) return false;
      if (filtro === "realizada" && m.status !== "realizada") return false;
      if (filtro === "no_show" && m.status !== "no_show") return false;
      if (!termo) return true;
      return `${m.title} ${m.contatoNome || ""} ${m.empresa || ""} ${m.outcome || ""}`.toLowerCase().includes(termo);
    });
  }, [reunioes, q, filtro, dono]);

  if (!reunioes.length) return null;

  return (
    <>
      <h2 className="mb-3 mt-8 font-display text-lg font-bold">Passadas</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por contato, empresa, título ou resultado…"
          className="input min-w-[240px] flex-1 py-1.5 text-sm"
        />
        {membros.length > 1 && (
          <select className="input w-auto py-1.5 text-sm" value={dono} onChange={(e) => setDono(e.target.value)}>
            <option value="">Todos os responsáveis</option>
            {membros.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {FILTROS.map((f) => (
            <button
              key={f.k}
              type="button"
              onClick={() => setFiltro(f.k)}
              className={`rounded-full border px-3 py-1 font-semibold ${
                filtro === f.k ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-subtle hover:bg-muted"
              }`}
            >
              {f.txt}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-2 text-xs text-subtle">
        {lista.length} de {reunioes.length} reuni{reunioes.length === 1 ? "ão" : "ões"}.
      </p>

      <div className="space-y-2">
        {lista.length === 0 && (
          <div className="card p-6 text-sm text-subtle">Nenhuma reunião bate com esse filtro.</div>
        )}
        {lista.map((m) => {
          const st = STATUS_LABEL[m.status] || STATUS_LABEL.agendada;
          const needsOutcome = m.status !== "realizada" && m.status !== "no_show";
          return (
            <div key={m.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    <Link href={`/dashboard/reunioes/${m.id}`} className="hover:text-brand-dark hover:underline">{m.title}</Link>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    {m.contact_id && m.contatoNome ? (
                      <Link href={`/dashboard/contatos/${m.contact_id}`} className="font-medium text-brand-dark hover:underline">
                        {m.contatoNome}
                      </Link>
                    ) : (
                      <span className="text-subtle">sem contato vinculado</span>
                    )}
                    {m.empresa && <span className="text-subtle">· {m.empresa}</span>}
                    <span className="text-subtle">
                      · {new Date(m.datetime).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    {m.assigned_to && nomeDono[m.assigned_to] && (
                      <span className="text-subtle">· {nomeDono[m.assigned_to]}</span>
                    )}
                  </p>
                  {m.outcome && <p className="mt-1 text-xs text-ink/70">↳ {m.outcome}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* A reunião acontecida é o momento mais óbvio de abrir negócio — e
                      era o único lugar da jornada onde isso não existia. */}
                  {m.contact_id && m.status === "realizada" && (
                    <NewOpportunityForContact
                      contactId={m.contact_id}
                      defaultTitle={`${m.empresa || m.contatoNome || "Negócio"} — pós-reunião`}
                      compacto
                    />
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span>
                </div>
              </div>
              {needsOutcome && <MeetingOutcome id={m.id} contactId={m.contact_id} />}
            </div>
          );
        })}
      </div>
    </>
  );
}
