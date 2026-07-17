"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AccountTags from "@/components/AccountTags";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { UltimoToque } from "@/lib/lastTouch";
import { bulkTagAccounts, bulkAssignAccounts, bulkDeleteAccounts, createTagAccounts } from "@/app/dashboard/contas/actions";

type Tag = { id: string; name: string; color: string };
type Member = { id: string; full_name: string | null; email: string };
type Contact = { id: string; name: string; role_title?: string | null; email?: string | null };
type Opp = { id: string; title: string; value_mrr: number; status: string };
type Produto = { id: string; name: string };
type Row = {
  id: string;
  name: string;
  domain?: string | null;
  cnpj?: string | null;
  uf?: string | null;
  municipio?: string | null;
  contacts: Contact[];
  opps: Opp[];
  produtos?: Produto[];
  ultimo?: string | null;
  tags: Tag[];
};

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function AccountsCockpit({ rows, allTags, members = [] }: { rows: Row[]; allTags: Tag[]; members?: Member[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState<Record<string, "contatos" | "oportunidades" | null>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = sel.size > 0 && sel.size === rows.length;
  const tagOpts: SmartOption[] = allTags.map((t) => ({ value: t.id, label: t.name }));
  const assignOpts: SmartOption[] = [
    { value: "__none__", label: "Sem responsável" },
    ...members.map((m) => ({ value: m.id, label: m.full_name || m.email })),
  ];

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setMsg(null);
  }
  function toggleAll() {
    setSel((s) => (s.size === rows.length ? new Set() : new Set(allIds)));
    setMsg(null);
  }
  function clear() {
    setSel(new Set());
    setMsg(null);
  }
  function toggleAba(id: string, aba: "contatos" | "oportunidades") {
    setAberto((s) => ({ ...s, [id]: s[id] === aba ? null : aba }));
  }

  function doTag() {
    if (!tagIds.length) return setMsg("Escolha ao menos uma tag.");
    setMsg(null);
    start(async () => {
      const res = (await bulkTagAccounts([...sel], tagIds)) as { count?: number; tags?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setMsg(`✓ ${res.tags && res.tags > 1 ? `${res.tags} tags aplicadas` : "tag aplicada"} a ${res.count} empresa(s).`);
        clear();
        setTagIds([]);
        router.refresh();
      }
    });
  }
  function doAssign() {
    if (!assignTo) return;
    setMsg(null);
    start(async () => {
      const res = (await bulkAssignAccounts([...sel], assignTo === "__none__" ? null : assignTo || null)) as { count?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else { setMsg(`✓ ${res.count} empresa(s) atribuída(s).`); clear(); setAssignTo(""); router.refresh(); }
    });
  }
  function doDelete() {
    if (!confirm(`Excluir ${sel.size} empresa(s)? Os contatos ligados a elas NÃO são apagados (ficam sem empresa). Isso não pode ser desfeito.`)) return;
    setMsg(null);
    start(async () => {
      const res = (await bulkDeleteAccounts([...sel])) as { count?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else { setMsg(`✓ ${res.count} empresa(s) excluída(s).`); clear(); router.refresh(); }
    });
  }
  function doCreateTag() {
    if (!newTag.trim()) return;
    start(async () => {
      const res = (await createTagAccounts(newTag)) as { tag?: Tag; error?: string };
      if (res?.error) setMsg(res.error);
      else { setNewTag(""); setShowNewTag(false); setMsg("✓ Tag criada."); router.refresh(); }
    });
  }

  if (!rows.length) {
    return <div className="card p-10 text-center text-sm text-subtle">Nenhuma empresa ainda. Crie a primeira acima ou traga do Radar.</div>;
  }

  return (
    <div>
      {/* Barra de ações em lote */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 shadow-sm backdrop-blur">
          <span className="text-sm font-semibold">{sel.size} selecionada{sel.size > 1 ? "s" : ""}</span>

          {allTags.length > 0 && (
            <div className="flex items-center gap-1">
              <SmartSelect
                multiple
                className="py-1.5 text-sm"
                options={tagOpts}
                values={tagIds}
                onValuesChange={setTagIds}
                placeholder="Aplicar tags…"
              />
              <button className="btn-ghost py-1.5 text-sm" onClick={doTag} disabled={pending || !tagIds.length}>Aplicar</button>
            </div>
          )}

          {members.length > 0 && (
            <div className="flex items-center gap-1">
              <SmartSelect
                className="py-1.5 text-sm"
                options={assignOpts}
                value={assignTo}
                onValueChange={(v) => setAssignTo(v)}
                placeholder="Atribuir a…"
                clearable
              />
              <button className="btn-ghost py-1.5 text-sm" onClick={doAssign} disabled={pending || !assignTo}>Atribuir</button>
            </div>
          )}

          <button
            className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            onClick={doDelete}
            disabled={pending}
          >
            Excluir
          </button>
          <button className="text-xs text-subtle hover:text-ink" onClick={clear}>limpar seleção</button>
        </div>
      )}
      {msg && <p className="mb-3 text-sm text-signal">{msg}</p>}

      {/* Criar tag — compacto */}
      <div className="mb-3">
        {!showNewTag ? (
          <button className="text-xs font-medium text-subtle hover:text-brand" onClick={() => setShowNewTag(true)}>
            ＋ Nova tag
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[220px] py-1.5 text-sm"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Nome da tag (ex.: Cliente, Prospect, VIP)"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") doCreateTag(); }}
            />
            <button className="btn-brand py-1.5 text-sm" onClick={doCreateTag} disabled={pending || !newTag.trim()}>Criar</button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => { setShowNewTag(false); setNewTag(""); }}>cancelar</button>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-3 py-3">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Selecionar todas" />
              </th>
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
              const checked = sel.has(a.id);
              return (
                <Fragment key={a.id}>
                  <tr className={`border-b border-line last:border-0 align-top ${checked ? "bg-brand-soft/40" : ""}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={checked} onChange={() => toggle(a.id)} aria-label={`Selecionar ${a.name}`} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/contas/${a.id}`} className="font-medium text-brand-dark hover:underline">{a.name}</Link>
                      <p className="text-xs text-subtle">{[a.cnpj, a.domain].filter(Boolean).join(" · ") || "—"}</p>
                      {(a.produtos?.length ?? 0) > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.produtos!.map((p) => (
                            <span key={p.id} className="rounded-full border border-brand/25 bg-brand/5 px-1.5 py-0.5 text-[10px] font-medium text-brand-dark">
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-subtle">{[a.municipio, a.uf].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-4 py-3"><UltimoToque at={a.ultimo} titulo="Última atividade em algum contato desta empresa." /></td>
                    <td className="px-4 py-3">
                      <AccountTags accountId={a.id} tags={a.tags} allTags={allTags} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ab === "contatos" ? "bg-brand text-white" : "bg-muted text-ink hover:bg-brand-soft"}`}
                        onClick={() => toggleAba(a.id, "contatos")}
                        title="Ver contatos"
                      >
                        {a.contacts.length} {a.contacts.length ? "▾" : ""}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ab === "oportunidades" ? "bg-brand text-white" : "bg-muted text-ink hover:bg-brand-soft"}`}
                        onClick={() => toggleAba(a.id, "oportunidades")}
                        title="Ver oportunidades"
                      >
                        {a.opps.length}{totalOpp ? ` · ${brl(totalOpp)}` : ""} {a.opps.length ? "▾" : ""}
                      </button>
                    </td>
                  </tr>

                  {ab === "contatos" && (
                    <tr className="border-b border-line bg-muted/40">
                      <td colSpan={7} className="px-4 py-3">
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
                      <td colSpan={7} className="px-4 py-3">
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
    </div>
  );
}
