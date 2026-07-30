"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AccountTags from "@/components/AccountTags";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { UltimoToque } from "@/lib/lastTouch";
import ExportarCsv from "@/components/ExportarCsv";
import { bulkTagAccounts, bulkAssignAccounts, bulkDeleteAccounts, createTagAccounts } from "@/app/dashboard/contas/actions";
import { contarEmpresasPorFiltro, excluirEmpresasPorFiltro, exportarEmpresasPorFiltro } from "@/app/dashboard/contas/filtro-actions";
import { useExclusaoLote } from "@/components/useExclusaoLote";

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

export default function AccountsCockpit({
  rows, allTags, members = [], filtro, filtroSoDaTela = false,
}: {
  rows: Row[];
  allTags: Tag[];
  members?: Member[];
  // filtros que o BANCO entende (busca e tag) — é por eles que a exclusão em massa vai
  filtro?: { q?: string; tag?: string[] };
  // produto/visão são aplicados na TELA depois de buscar 300; com um deles ativo, a
  // exclusão em massa não é oferecida (apagaria mais do que está sendo mostrado)
  filtroSoDaTela?: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState<Record<string, "contatos" | "oportunidades" | null>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [todasFiltro, setTodasFiltro] = useState<number | null>(null);
  const [semFiltroReal, setSemFiltroReal] = useState(false);
  const [contando, setContando] = useState(false);
  // exclusão em voltas, com progresso e botão de parar (ver useExclusaoLote)
  const { rodando: apagando, feitos, alvo: alvoExclusao, parar, rodar } = useExclusaoLote();

  // trocar de filtro sem remontar o componente deixaria a contagem velha pendurada
  const filtroChave = JSON.stringify(filtro || {});
  useEffect(() => { setSel(new Set()); setTodasFiltro(null); setMsg(null); }, [filtroChave]);

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = sel.size > 0 && sel.size === rows.length;
  const paginaCheia = rows.length >= 300;   // a lista busca 300 por vez
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
    // desmarcar UMA linha desarma o "todas do filtro" — senão o botão continuaria
    // prometendo apagar tudo, incluindo a que a pessoa acabou de tirar.
    desarmar();
    setMsg(null);
  }
  function desarmar() { setTodasFiltro(null); }
  function toggleAll() {
    desarmar();
    setSel((s) => (s.size === rows.length ? new Set() : new Set(allIds)));
    setMsg(null);
  }
  function clear() {
    setSel(new Set());
    desarmar();
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
    // com "todas do filtro" armado, quem manda é o filtro — não a lista de ids da tela
    if (todasFiltro !== null) { void excluirTodasDoFiltro(); return; }
    if (!confirm(`Excluir ${sel.size} empresa(s)? Os contatos ligados a elas NÃO são apagados (ficam sem empresa). Isso não pode ser desfeito.`)) return;
    setMsg(null);
    start(async () => {
      try {
        const res = (await bulkDeleteAccounts([...sel])) as { count?: number; error?: string };
        if (res?.error) setMsg(res.error);
        else { setMsg(`✓ ${res.count} empresa(s) excluída(s).`); clear(); router.refresh(); }
      } catch (e: any) {
        setMsg(`A exclusão falhou (${e?.message || "conexão"}). Recarregue com Ctrl+Shift+R e tente de novo.`);
      }
    });
  }

  function selecionarTodasDoFiltro() {
    setMsg(null); setContando(true);
    start(async () => {
      try {
        const r = (await contarEmpresasPorFiltro(filtro || {})) as { total?: number; semFiltro?: boolean; error?: string };
        if (r?.error) { setMsg(r.error); return; }
        setTodasFiltro(r.total ?? 0);
        setSemFiltroReal(!!r.semFiltro);
      } catch (e: any) {
        setMsg(`Não consegui contar: ${e?.message || "falha de conexão"}. Recarregue a página (Ctrl+Shift+R).`);
      } finally { setContando(false); }
    });
  }

  // Em VOLTAS: o servidor sai aos ~40s devolvendo o que sobrou e este laço chama de
  // novo até zerar. Antes, uma base grande parava no que coubesse em 60s (~4.000).
  async function excluirTodasDoFiltro() {
    const n = todasFiltro ?? 0;
    if (!n || apagando) return;
    const alvoTxt = semFiltroReal ? `TODAS as ${n} empresas da sua base` : `as ${n} empresas que batem com o filtro atual`;
    if (!confirm(`Excluir ${alvoTxt}?\n\nOs contatos ligados a elas NÃO são apagados — ficam sem empresa. Não tem como desfazer.`)) return;
    if (semFiltroReal && !confirm(`Confirma de novo: nenhum filtro em vigor, então isso zera o seu cadastro de empresas (${n}). Continuar?`)) return;

    setMsg(null);
    const r = await rodar(n, async (confirmar) => {
      const x = (await excluirEmpresasPorFiltro(filtro || {}, { total: confirmar })) as
        { excluidas?: number; restam?: number; error?: string; aviso?: string };
      return { excluidos: x?.excluidas ?? 0, restam: x?.restam ?? 0, error: x?.error, aviso: x?.aviso };
    });

    setMsg(
      (r.erro ? `${r.total > 0 ? `✓ ${r.total} excluída(s) antes de parar. ` : ""}${r.erro}` :
        `✓ ${r.total} empresa(s) excluída(s).` +
        (r.aviso ? ` ${r.aviso}` : "") +
        (r.parado ? ` Você interrompeu — ainda restam ${r.restam}.` :
          r.restam > 0 ? ` Ainda restam ${r.restam}; clique de novo para continuar.` : ""))
    );
    clear(); router.refresh();
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
      {!filtroSoDaTela && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ExportarCsv
            nomeBase="empresas"
            rotulo={(filtro?.q || filtro?.tag?.length) ? "Exportar CSV (filtro atual)" : "Exportar CSV (todas)"}
            exportar={() => exportarEmpresasPorFiltro(filtro || {})}
          />
        </div>
      )}

      {/* Barra de ações em lote */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 shadow-sm backdrop-blur">
          {/* Progresso da exclusão em voltas — sem isto, apagar 78 mil parece travado */}
          {apagando && (
            <div className="mb-2 rounded-lg border border-red-200 bg-white/80 px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-red-700">
                  Excluindo… {feitos.toLocaleString("pt-BR")} de {alvoExclusao.toLocaleString("pt-BR")}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-red-100">
                  <div
                    className="h-full bg-red-500 transition-all"
                    style={{ width: `${alvoExclusao ? Math.min(100, (feitos / alvoExclusao) * 100) : 0}%` }}
                  />
                </div>
                <button className="text-xs font-medium text-subtle underline hover:text-ink" onClick={parar}>
                  parar
                </button>
              </div>
              <p className="mt-1 text-[11px] text-subtle">
                Vai em voltas de até 40 segundos e continua sozinho. Não feche a aba — o que já saiu está no registro.
              </p>
            </div>
          )}

          {allChecked && paginaCheia && !filtroSoDaTela && (
            <div className="mb-2 rounded-lg border border-brand/20 bg-white/70 px-3 py-2 text-sm">
              {todasFiltro === null ? (
                <>
                  <span className="text-subtle">
                    As <b>{rows.length}</b> desta página estão marcadas — a lista mostra só as primeiras.
                  </span>{" "}
                  <button
                    className="font-semibold text-brand-dark underline disabled:opacity-50"
                    onClick={selecionarTodasDoFiltro}
                    disabled={pending || contando || apagando}
                  >
                    {contando ? "contando…" : (filtro?.q || filtro?.tag?.length) ? "Selecionar todas que batem com o filtro" : "Selecionar todas as empresas"}
                  </button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-brand-dark">
                    {todasFiltro} empresa(s) selecionada(s) — {semFiltroReal ? "o cadastro inteiro" : "todas as que batem com o filtro"}.
                  </span>{" "}
                  <button className="text-subtle underline disabled:opacity-50" onClick={() => setTodasFiltro(null)} disabled={pending || apagando}>
                    voltar para as {rows.length} desta página
                  </button>
                </>
              )}
            </div>
          )}
          {allChecked && paginaCheia && filtroSoDaTela && (
            <div className="mb-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
              Com filtro de <b>produto</b> ou <b>visão</b> ativo, a exclusão em massa fica indisponível: esses dois são
              aplicados na tela, não no banco — apagar por eles pegaria empresas que você não está vendo. Limpe esses
              filtros (pode deixar busca e tag) para liberar.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
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
              <button className="btn-ghost py-1.5 text-sm" onClick={doTag} disabled={pending || apagando || !tagIds.length}>Aplicar</button>
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
              <button className="btn-ghost py-1.5 text-sm" onClick={doAssign} disabled={pending || apagando || !assignTo}>Atribuir</button>
            </div>
          )}

          <button
            className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            onClick={doDelete}
            disabled={pending || apagando}
          >
            {apagando ? "Excluindo…" : todasFiltro !== null ? `Excluir as ${todasFiltro}` : "Excluir"}
          </button>
          <ExportarCsv
            nomeBase="empresas"
            rotulo={todasFiltro !== null ? `Exportar as ${todasFiltro}` : `Exportar ${sel.size}`}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
            exportar={() =>
              todasFiltro !== null
                ? exportarEmpresasPorFiltro(filtro || {})
                : exportarEmpresasPorFiltro(filtro || {}, { ids: [...sel] })
            }
          />
          <button className="text-xs text-subtle hover:text-ink" onClick={clear}>limpar seleção</button>
          </div>

          {todasFiltro !== null && (
            <p className="mt-2 text-[11px] text-subtle">
              Aplicar tag e atribuir responsável continuam valendo para as <b>{sel.size}</b> desta página. Só a{" "}
              <b>exclusão</b> vale para as {todasFiltro}.
            </p>
          )}
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
