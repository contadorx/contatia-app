"use client";

import { useTransition, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { completeTask, skipTask, snoozeTask, sendEmailTask, markReplied, sendWhatsAppTask, sendAllEmailTasks, completeTasks, skipTasks, deleteTasks } from "@/app/dashboard/task-actions";
import { channelLabel, waLink, type Channel } from "@/lib/cadence";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import RichTextEditor from "@/components/RichTextEditor";

type Task = {
  id: string;
  channel: Channel;
  title: string | null;
  generated_content: string | null;
  due_date: string;
  contact_id: string | null;
  cadence?: string | null;
  tags?: { id: string; name: string; color: string }[];
  is_future?: boolean;
  hot_now?: { type: string; created_at: string } | null;
  contacts: { name: string; company: string | null; phone: string | null; email: string | null; score: number | null } | null;
};
type LastActivity = Record<string, { type: string; created_at: string; text?: string }>;
type Tag = { id: string; name: string; color: string };

const chanStyle: Record<Channel, string> = {
  email: "bg-brand-soft text-brand-dark",
  whatsapp: "bg-signal/10 text-signal",
  call: "bg-warn/10 text-warn",
  linkedin: "bg-blue-50 text-blue-700",
};

const EVENT_LABEL: Record<string, string> = {
  note: "Nota",
  task_done: "Toque enviado",
  email_sent: "E-mail enviado",
  whatsapp_sent: "WhatsApp enviado",
  replied: "Respondeu",
  doc_opened: "Abriu a proposta",
  email_opened: "Abriu o e-mail",
  link_clicked: "Clicou no link",
  meeting: "Reunião marcada",
};

function rel(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "agora";
  if (d < 3600) return `${Math.floor(d / 60)}min`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export default function TaskQueue({
  tasks: allTasks,
  hotThreshold,
  lastActivity = {},
  allTags = [],
  waMode = "assistido",
}: {
  tasks: Task[];
  hotThreshold: number;
  lastActivity?: LastActivity;
  allTags?: Tag[];
  waMode?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<Record<string, { subject: string; body: string }>>({});
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // seleção em lote (checkbox por linha) — vazio = nada selecionado
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);

  // filtros
  const [periodo, setPeriodo] = useState<"hoje" | "3dias" | "todos">("hoje");
  const [canalFilters, setCanalFilters] = useState<string[]>([]); // vazio = todos os canais
  const [busca, setBusca] = useState("");                        // busca por contato/empresa
  const [tagFilters, setTagFilters] = useState<string[]>([]);   // filtro por VÁRIAS tags

  const cadences = Array.from(new Set(allTasks.map((t) => t.cadence).filter(Boolean))) as string[];
  const [cadFilters, setCadFilters] = useState<string[]>([]);   // filtro por VÁRIAS cadências

  const tasks = allTasks.filter((t) => {
    if (periodo === "hoje" && t.is_future) return false;
    if (canalFilters.length && !canalFilters.includes(t.channel)) return false;
    if (tagFilters.length && !(t.tags || []).some((tg) => tagFilters.includes(tg.id))) return false;
    if (cadFilters.length && !cadFilters.includes(t.cadence || "")) return false;
    if (busca) {
      const q = busca.toLowerCase();
      const hay = `${t.contacts?.name || ""} ${t.contacts?.company || ""} ${t.contacts?.email || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pendingEmails = tasks.filter((t) => t.channel === "email").length;

  useEffect(() => {
    if (focus > tasks.length - 1) setFocus(Math.max(0, tasks.length - 1));
  }, [tasks.length, focus]);

  // ---------- seleção em lote ----------
  const idsVisiveis = tasks.map((t) => t.id);
  const selVisiveis = idsVisiveis.filter((id) => sel.has(id));
  const todosMarcados = idsVisiveis.length > 0 && selVisiveis.length === idsVisiveis.length;

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTodos() {
    setSel((s) => {
      const n = new Set(s);
      if (todosMarcados) idsVisiveis.forEach((id) => n.delete(id));
      else idsVisiveis.forEach((id) => n.add(id));
      return n;
    });
  }
  function limparSel() { setSel(new Set()); setConfirmando(false); }

  // Roda a ação em lote sobre o que está SELECIONADO E VISÍVEL — nunca sobre algo que
  // saiu da visão por filtro (evita apagar o que o operador não está vendo).
  function emLote(fn: (ids: string[]) => Promise<any>, sucesso: (n: number) => string) {
    setErr(null); setBulkMsg(null);
    const ids = selVisiveis;
    if (!ids.length) return;
    start(async () => {
      const res = (await fn(ids)) as { count?: number; done?: number; error?: string };
      if (res?.error) { setErr(res.error); return; }
      const n = res.count ?? res.done ?? ids.length;
      setBulkMsg(sucesso(n));
      limparSel();
      router.refresh();
    });
  }

  function sendAll() {
    setErr(null);
    setBulkMsg(null);
    start(async () => {
      const res = (await sendAllEmailTasks()) as { sent?: number; failed?: number; error?: string };
      if (res?.error) setErr(res.error);
      else setBulkMsg(`✓ ${res.sent} e-mails enviados${res.failed ? `, ${res.failed} falharam (cap diário/sem caixa)` : ""}.`);
    });
  }
  // conclui todos os toques visíveis (fila sequencial por tipo)
  function completeVisible() {
    setErr(null);
    setBulkMsg(null);
    const ids = tasks.filter((t) => t.channel !== "email").map((t) => t.id);
    if (!ids.length) return;
    start(async () => {
      const res = (await completeTasks(ids)) as { done?: number; error?: string };
      if (res?.error) setErr(res.error);
      else { setBulkMsg(`✓ ${res.done} toque(s) marcados como feitos.`); router.refresh(); }
    });
  }
  // rótulo do botão "marcar todos como feitos" quando há filtro de canal sem e-mail
  const canaisSemEmail = canalFilters.filter((c) => c !== "email");
  const mostrarConcluirVisiveis =
    canalFilters.length > 0 && !canalFilters.includes("email") && tasks.length > 0;
  function act(fn: () => Promise<unknown>) {
    start(async () => { await fn(); });
  }
  function send(id: string, override?: { subject?: string; body?: string }) {
    setErr(null);
    start(async () => {
      const res = (await sendEmailTask(id, override)) as { error?: string; aviso?: string } | undefined;
      if (res?.error) { setErr(res.error); return; }
      // `aviso` = o e-mail SAIU, mas algo secundário falhou (hoje: a cópia em
      // "Enviados"). Não pode virar erro vermelho — quem lê "falhou" manda de novo,
      // e o cliente receberia duas vezes.
      setErr(res?.aviso || null);
      setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
    });
  }
  function sendWa(id: string, body?: string) {
    setErr(null);
    start(async () => {
      const res = (await sendWhatsAppTask(id, body)) as { error?: string } | undefined;
      if (res?.error) setErr(res.error);
      else setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
    });
  }

  // ação primária por canal (Enter)
  function primary(t: Task) {
    if (t.channel === "email" && t.contacts?.email) send(t.id, editing[t.id] ? { subject: editing[t.id].subject, body: editing[t.id].body } : undefined);
    // WhatsApp automático (Evolution) → envia pela instância; modo assistido → concluir (o envio é manual pelo link)
    else if (t.channel === "whatsapp" && t.contacts?.phone && waMode === "evolution") sendWa(t.id, editing[t.id] ? editing[t.id].body : undefined);
    else act(() => completeTask(t.id, t.contact_id ?? undefined));
  }

  // navegação por teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // O corpo do e-mail é um editor contentEditable (div), não um <textarea>: sem
      // esta linha, digitar espaço no e-mail marcava/desmarcava a linha em vez de
      // escrever. Botão/link em foco também mantêm o comportamento nativo do teclado.
      if (el?.isContentEditable || tag === "BUTTON" || tag === "A") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!tasks.length) return;
      const t = tasks[focus];
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setFocus((f) => Math.min(tasks.length - 1, f + 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (e.key === "Enter") { if (t) { e.preventDefault(); primary(t); } }
      else if (e.key === "r") { if (t?.contact_id) { e.preventDefault(); act(() => markReplied(t.contact_id as string)); } }
      else if (e.key === "z") { if (t) { e.preventDefault(); act(() => snoozeTask(t.id, 1)); } }
      else if (e.key === "x") { if (t) { e.preventDefault(); act(() => skipTask(t.id)); } }
      // Espaço marca/desmarca a linha em foco — é como se seleciona em lote sem mouse.
      else if (e.key === " ") { if (t) { e.preventDefault(); toggleSel(t.id); } }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tasks, focus, editing]);

  // mantém o foco dentro do intervalo quando a lista muda (uso sequencial)
  useEffect(() => {
    setFocus((f) => Math.min(f, Math.max(0, tasks.length - 1)));
  }, [tasks.length]);

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  if (!allTasks.length)
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        <p className="font-medium text-ink">Nada na fila hoje.</p>
        <p className="mt-1">Reabasteça: traga novos leads ou resgate quem esfriou — e inscreva numa cadência.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <a href="/dashboard/contatos?view=prontos" className="btn-brand py-1.5 text-xs">Inscrever contatos</a>
          <a href="/dashboard/radar" className="btn-ghost py-1.5 text-xs">Buscar no Radar</a>
          <a href="/dashboard/contatos?view=resgatar" className="btn-ghost py-1.5 text-xs">Resgatar frios</a>
          <a href="/dashboard/cadencias" className="btn-ghost py-1.5 text-xs">Criar cadência</a>
        </div>
      </div>
    );

  return (
    <div className="space-y-2">
      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
        <div className="flex gap-1">
          {(["hoje", "3dias", "todos"] as const).map((p) => (
            <button
              key={p}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${periodo === p ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}
              onClick={() => setPeriodo(p)}
            >
              {p === "hoje" ? "Hoje + atrasados" : p === "3dias" ? "Próx. 3 dias" : "Todos"}
            </button>
          ))}
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar contato/empresa…"
          className="input w-[190px] shrink-0 grow-0 py-1 text-xs"
        />
        <div className="w-[160px] shrink-0 grow-0">
          <SmartSelect
            multiple
            className="py-1 text-xs"
            placeholder="Todos os canais"
            values={canalFilters}
            onValuesChange={setCanalFilters}
            options={[
              { value: "email", label: "E-mail" },
              { value: "whatsapp", label: "WhatsApp" },
              { value: "call", label: "Ligação" },
              { value: "linkedin", label: "LinkedIn" },
            ]}
          />
        </div>
        {cadences.length > 0 && (
          <div className="w-[150px] shrink-0 grow-0">
            <SmartSelect
              multiple
              className="py-1 text-xs"
              placeholder="Todas as cadências"
              values={cadFilters}
              onValuesChange={setCadFilters}
              options={cadences.map((c): SmartOption => ({ value: c, label: c }))}
            />
          </div>
        )}
        {allTags.length > 0 && (
          <div className="w-[130px] shrink-0 grow-0">
            <SmartSelect
              multiple
              className="py-1 text-xs"
              placeholder="Todas as tags"
              values={tagFilters}
              onValuesChange={setTagFilters}
              options={allTags.map((t): SmartOption => ({ value: t.id, label: t.name }))}
            />
          </div>
        )}
        {tasks.length > 0 && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-subtle">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={todosMarcados} onChange={toggleTodos} />
            Marcar todas
          </label>
        )}
        <span className="shrink-0 text-xs text-subtle">{tasks.length} na visão</span>
      </div>

      {tasks.length === 0 && (
        <div className="card p-8 text-center text-sm text-subtle">Nenhum toque nesta visão. Ajuste os filtros acima.</div>
      )}

      {/* ---------- barra de AÇÕES EM LOTE (só aparece com seleção) ---------- */}
      {selVisiveis.length > 0 && (
        <div className="sticky top-2 z-10 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-dark">
              {selVisiveis.length} tarefa(s) selecionada(s)
            </span>
            <button className="btn-ghost py-1 text-xs" onClick={limparSel} disabled={pending}>Limpar seleção</button>
            <span className="mx-1 h-4 w-px bg-line" />
            <button
              className="btn-ghost py-1 text-xs"
              disabled={pending}
              onClick={() => emLote(completeTasks, (n) => `✓ ${n} tarefa(s) concluída(s).`)}
            >
              Concluir
            </button>
            <button
              className="btn-ghost py-1 text-xs"
              disabled={pending}
              onClick={() => emLote(skipTasks, (n) => `✓ ${n} tarefa(s) pulada(s).`)}
            >
              Pular
            </button>
            {!confirmando ? (
              <button
                className="rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                disabled={pending}
                onClick={() => setConfirmando(true)}
              >
                Excluir…
              </button>
            ) : (
              <span className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-2 py-1">
                <span className="text-xs text-danger">
                  Excluir {selVisiveis.length} de vez? Não tem como desfazer.
                </span>
                <button
                  className="rounded-lg bg-danger px-2 py-0.5 text-xs font-semibold text-white"
                  disabled={pending}
                  onClick={() => emLote(deleteTasks, (n) => `✓ ${n} tarefa(s) excluída(s). Ficou registrado em Resultados → Registro.`)}
                >
                  {pending ? "Excluindo…" : "Sim, excluir"}
                </button>
                <button className="text-xs text-subtle underline" onClick={() => setConfirmando(false)} disabled={pending}>
                  cancelar
                </button>
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-subtle">
            <b>Concluir</b> marca como feito (pontua o contato). <b>Pular</b> dispensa o toque, mas mantém o histórico da
            cadência. <b>Excluir</b> apaga a tarefa do banco — tudo fica registrado em Resultados → Registro.
          </p>
        </div>
      )}

      {/* barra de atalhos + envio em lote */}
      <div className="flex flex-wrap items-center gap-3">
        {pendingEmails > 0 && (
          <button className="btn-brand py-1.5 text-sm" onClick={sendAll} disabled={pending}>
            {pending ? "Enviando..." : `Enviar todos os e-mails (${pendingEmails})`}
          </button>
        )}
        {mostrarConcluirVisiveis && (
          <button className="btn-ghost py-1.5 text-sm" onClick={completeVisible} disabled={pending}>
            Marcar como feitos os {canaisSemEmail.map((c) => channelLabel[c as Channel] || c).join(" / ")} ({tasks.length})
          </button>
        )}
        <span className="text-xs text-subtle">
          Teclado: <b>↑/↓</b> navegar · <b>Enter</b> enviar/concluir · <b>Espaço</b> marcar · <b>r</b> respondeu · <b>z</b> adiar · <b>x</b> pular
        </span>
        {bulkMsg && <span className="text-sm text-signal">{bulkMsg}</span>}
      </div>
      {err && <div className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{err}</div>}

      {tasks.map((t, i) => {
        const c = t.contacts;
        const content = t.generated_content || "";
        const score = c?.score ?? 0;
        const hot = score >= hotThreshold;
        const focused = i === focus;
        const la = t.contact_id ? lastActivity[t.contact_id] : undefined;
        const hotNowLabel = t.hot_now
          ? t.hot_now.type === "replied" ? "🔥 RESPONDEU"
          : t.hot_now.type === "doc_opened" ? "🔥 ABRIU PROPOSTA"
          : "🔥 ABRIU E-MAIL"
          : null;
        return (
          <div
            key={t.id}
            ref={(el) => { rowRefs.current[i] = el; }}
            onClick={() => setFocus(i)}
            className={`card p-4 transition ${t.hot_now ? "ring-2 ring-warn bg-warn/5" : hot ? "ring-1 ring-warn/40" : ""} ${focused ? "ring-2 ring-brand" : ""} ${sel.has(t.id) ? "bg-brand-soft/30" : ""}`}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-brand"
                checked={sel.has(t.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSel(t.id)}
                aria-label="Selecionar tarefa"
              />
              <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${chanStyle[t.channel]}`}>
                {channelLabel[t.channel]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold">
                  {c?.name || "Contato"}
                  {c?.company ? <span className="font-normal text-subtle">· {c.company}</span> : null}
                  {hotNowLabel && <span className="rounded-full bg-warn px-2 py-0.5 text-[10px] font-bold text-white">{hotNowLabel}</span>}
                  {!hotNowLabel && hot && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">QUENTE</span>}
                </p>
                <p className="truncate text-xs text-subtle">{t.title || content || channelLabel[t.channel]}</p>
              </div>

              {t.channel === "whatsapp" && c?.phone && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Editar"}
                  </button>
                  {waMode === "evolution" ? (
                    <>
                      {/* modo automático: envia pela instância + link como plano B */}
                      <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => sendWa(t.id, editing[t.id] ? editing[t.id].body : undefined)}>Enviar</button>
                      {waLink(c.phone, editing[t.id]?.body ?? content) && (
                        <a className="text-xs text-subtle hover:text-ink" href={waLink(c.phone, editing[t.id]?.body ?? content)} target="_blank" rel="noreferrer" title="Abrir no WhatsApp Web/app" onClick={(e) => e.stopPropagation()}>↗</a>
                      )}
                    </>
                  ) : (
                    <>
                      {/* modo assistido: abre o SEU WhatsApp com a mensagem pronta, depois marca como feito */}
                      {waLink(c.phone, editing[t.id]?.body ?? content) ? (
                        <a className="btn-brand py-1.5 text-xs" href={waLink(c.phone, editing[t.id]?.body ?? content)} target="_blank" rel="noreferrer" title="Abrir no seu WhatsApp com a mensagem pronta" onClick={(e) => e.stopPropagation()}>Abrir WhatsApp</a>
                      ) : (
                        <span className="text-xs text-subtle" title="Telefone inválido">sem nº válido</span>
                      )}
                      <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Feito</button>
                    </>
                  )}
                </>
              )}
              {t.channel === "email" && c?.email && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: t.title || "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Editar"}
                  </button>
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => send(t.id, editing[t.id] ? { subject: editing[t.id].subject, body: editing[t.id].body } : undefined)}>Enviar</button>
                  <a className="text-xs text-subtle hover:text-ink" href={`mailto:${c.email}?subject=${encodeURIComponent(t.title || "")}&body=${encodeURIComponent(content)}`} title="Abrir no seu cliente de e-mail" onClick={(e) => e.stopPropagation()}>✎</a>
                </>
              )}
              {t.channel === "linkedin" && (
                <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Feito</button>
              )}
              {t.channel === "call" && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Ver script"}
                  </button>
                  {c?.phone && (
                    <a className="btn-ghost py-1.5 text-xs" href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} onClick={(e) => e.stopPropagation()} title="Ligar">Ligar</a>
                  )}
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Registrar</button>
                </>
              )}

              {t.contact_id && (
                <button
                  className="rounded-lg border border-signal/40 px-2 py-1.5 text-xs font-semibold text-signal hover:bg-signal/10"
                  disabled={pending}
                  onClick={() => act(() => markReplied(t.contact_id as string))}
                  title="Marcar que respondeu — pausa a cadência"
                >
                  Respondeu
                </button>
              )}
              <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))} title="Concluir">✓</button>
              <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => snoozeTask(t.id, 1))} title="Adiar 1 dia">↷</button>
              <button className="text-xs text-subtle hover:text-danger" disabled={pending} onClick={() => act(() => skipTask(t.id))} title="Pular">✕</button>
            </div>

            {/* editor inline de e-mail / script de ligação */}
            {editing[t.id] && t.channel === "email" && (
              <div className="mt-3 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                <label className="label">Assunto</label>
                <input
                  className="input mt-1 text-sm"
                  value={editing[t.id].subject}
                  onChange={(e) => setEditing((s) => ({ ...s, [t.id]: { ...s[t.id], subject: e.target.value } }))}
                />
                <label className="label mt-2 block">Corpo</label>
                <div className="mt-1">
                  <RichTextEditor
                    value={editing[t.id].body}
                    onChange={(html) => setEditing((s) => ({ ...s, [t.id]: { ...s[t.id], body: html } }))}
                    minHeight={140}
                  />
                </div>
                <p className="mt-1 text-xs text-subtle">A assinatura do negócio é anexada automaticamente no envio. Variáveis como {"{{primeiro_nome}}"} são resolvidas.</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => send(t.id, { subject: editing[t.id].subject, body: editing[t.id].body })}>
                    {pending ? "Enviando..." : "Enviar editado"}
                  </button>
                  <button className="btn-ghost py-1.5 text-xs" onClick={() => setEditing((s) => { const n = { ...s }; delete n[t.id]; return n; })}>Cancelar</button>
                </div>
              </div>
            )}
            {editing[t.id] && t.channel === "whatsapp" && (
              <div className="mt-3 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                <label className="label">Mensagem do WhatsApp</label>
                <textarea
                  className="input mt-1 min-h-[100px] text-sm"
                  value={editing[t.id].body}
                  onChange={(e) => setEditing((s) => ({ ...s, [t.id]: { ...s[t.id], body: e.target.value } }))}
                />
                <p className="mt-1 text-xs text-subtle">Edite antes de enviar. Vale tanto para o envio pela instância quanto para o link &ldquo;↗&rdquo;.</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => sendWa(t.id, editing[t.id].body)}>
                    {pending ? "Enviando..." : "Enviar editado"}
                  </button>
                  <button className="btn-ghost py-1.5 text-xs" onClick={() => setEditing((s) => { const n = { ...s }; delete n[t.id]; return n; })}>Cancelar</button>
                </div>
              </div>
            )}
            {editing[t.id] && t.channel === "call" && (
              <div className="mt-3 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                <p className="label">Roteiro da ligação</p>
                <div className="mt-1 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{content || "Sem roteiro definido para este passo."}</div>
              </div>
            )}

            {/* contexto inline: última atividade do contato */}
            {la && (
              <p className="mt-2 truncate border-t border-line pt-2 text-xs text-subtle">
                <span className={la.type === "replied" || la.type === "doc_opened" ? "font-semibold text-signal" : ""}>
                  {EVENT_LABEL[la.type] || la.type}
                </span>
                {la.text ? <span className="text-ink/70"> — {la.text}</span> : null}
                <span className="text-subtle"> · {rel(la.created_at)} atrás</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
