"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import AccountTags from "@/components/AccountTags";
import { UltimoToque } from "@/lib/lastTouch";

type Tag = { id: string; name: string; color: string };
type Contact = { id: string; name: string; role_title?: string | null; email?: string | null };
type Opp = { id: string; title: string; value_mrr: number; status: string };
type Row = {
  id: string;
  name: string;
  domain?: string | null;
  cnpj?: string | null;
  uf?: string | null;
  municipio?: string | null;
  contacts: Contact[];
  opps: Opp[];
  ultimo?: string | null;
  tags: Tag[];
};

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function AccountsCockpit({ rows, allTags }: { rows: Row[]; allTags: Tag[] }) {
  const [aberto, setAberto] = useState<Record<string, "contatos" | "oportunidades" | null>>({});

  function toggle(id: string, aba: "contatos" | "oportunidades") {
    setAberto((s) => ({ ...s, [id]: s[id] === aba ? null : aba }));
  }

  if (!rows.length) {
    return <div className="card p-10 text-center text-sm text-subtle">Nenhuma empresa ainda. Crie a primeira acima ou traga do Radar.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-subtle">
          <tr>
            <th className="px-4 py-3 font-medium">Empresa</th>
            <th className="px-4 py-3 font-medium">Local</th>
            <th className="px-4 py-3 font-medium" title="Última atividade em algum contato desta empresa.">Último toque</th>
            <th className="px-4 py-3 font-medium">Tags</th>
            <th className="px-4 py-3 font-medium text-center">Contatos</th>
            <th className="px-4 py-3 font-medium text-center">Oportunidades</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const totalOpp = a.opps.reduce((s, o) => s + (Number(o.value_mrr) || 0), 0);
            const ab = aberto[a.id] || null;
            return (
              <Fragment key={a.id}>
                <tr className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contas/${a.id}`} className="font-medium text-brand-dark hover:underline">{a.name}</Link>
                    <p className="text-xs text-subtle">{[a.cnpj, a.domain].filter(Boolean).join(" · ") || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-subtle">{[a.municipio, a.uf].filter(Boolean).join("/") || "—"}</td>
                  <td className="px-4 py-3"><UltimoToque at={a.ultimo} titulo="Última atividade em algum contato desta empresa." /></td>
                  <td className="px-4 py-3">
                    <AccountTags accountId={a.id} tags={a.tags} allTags={allTags} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ab === "contatos" ? "bg-brand text-white" : "bg-muted text-ink hover:bg-brand-soft"}`}
                      onClick={() => toggle(a.id, "contatos")}
                      title="Ver contatos"
                    >
                      {a.contacts.length} {a.contacts.length ? "▾" : ""}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ab === "oportunidades" ? "bg-brand text-white" : "bg-muted text-ink hover:bg-brand-soft"}`}
                      onClick={() => toggle(a.id, "oportunidades")}
                      title="Ver oportunidades"
                    >
                      {a.opps.length}{totalOpp ? ` · ${brl(totalOpp)}` : ""} {a.opps.length ? "▾" : ""}
                    </button>
                  </td>
                </tr>

                {ab === "contatos" && (
                  <tr className="border-b border-line bg-muted/40">
                    <td colSpan={6} className="px-4 py-3">
                      {a.contacts.length ? (
                        <div className="flex flex-wrap gap-2">
                          {a.contacts.map((c) => (
                            <Link key={c.id} href={`/dashboard/contatos/${c.id}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs hover:border-brand">
                              <span className="font-medium text-ink">{c.name}</span>
                              {(c.role_title || c.email) && <span className="text-subtle"> · {c.role_title || c.email}</span>}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-subtle">Nenhum contato. <Link href={`/dashboard/contas/${a.id}`} className="text-brand-dark hover:underline">abrir a empresa para adicionar →</Link></p>
                      )}
                    </td>
                  </tr>
                )}

                {ab === "oportunidades" && (
                  <tr className="border-b border-line bg-muted/40">
                    <td colSpan={6} className="px-4 py-3">
                      {a.opps.length ? (
                        <div className="flex flex-wrap gap-2">
                          {a.opps.map((o) => (
                            <Link key={o.id} href={`/dashboard/pipeline?opp=${o.id}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs hover:border-brand">
                              <span className="font-medium text-ink">{o.title}</span>
                              <span className="text-subtle"> · {brl(o.value_mrr)}/mês · {o.status}</span>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-subtle">Nenhuma oportunidade. <Link href={`/dashboard/contas/${a.id}`} className="text-brand-dark hover:underline">abrir a empresa para criar →</Link></p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
