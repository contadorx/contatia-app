"use client";

import { useTransition, useState, useEffect, useRef } from "react";
import { completeTask, skipTask, snoozeTask, sendEmailTask, markReplied, sendWhatsAppTask, sendAllEmailTasks, completeTasks } from "@/app/dashboard/task-actions";
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
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<Record<string, { subject: string; body: string }>>({});
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // filtros
  const [periodo, setPeriodo] = useState<"hoje" | "3dias" | "todos">("hoje");
  const [canal, setCanal] = useState<string>("todos");
  const [busca, setBusca] = useState("");                        // busca por contato/empresa
  const [tagFilters, setTagFilters] = useState<string[]>([]);   // filtro por VÁRIAS tags

  const cadences = Array.from(new Set(allTasks.map((t) => t.cadence).filter(Boolean))) as string[];
  const [cadFilters, setCadFilters] = useState<string[]>([]);   // filtro por VÁRIAS cadências

  const tasks = allTasks.filter((t) => {
    if (periodo === "hoje" && t.is_future) return false;
    if (canal !== "todos" && t.channel !== canal) return false;
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
      else setBulkMsg(`✓ ${res.done} toque(s) marcados como feitos.`);
    });
  }
  function act(fn: () => Promise<unknown>) {
    start(async () => { await fn(); });
  }
  function send(id: string, override?: { subject?: string; body?: string }) {
    setErr(null);
    start(async () => {
      const res = (await sendEmailTask(id, override)) as { error?: string } | undefined;
      if (res?.error) setErr(res.error);
      else setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!tasks.length) return;
      const t = tasks[focus];
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setFocus((f) => Math.min(tasks.length - 1, f + 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (e.key === "Enter") { if (t) { e.preventDefault(); primary(t); } }
      else if (e.key === "r") { if (t?.contact_id) { e.preventDefault(); act(() => markReplied(t.contact_id as string)); } }
      else if (e.key === "z") { if (t) { e.preventDefault(); act(() => snoozeTask(t.id, 1)); } }
      else if (e.key === "x") { if (t) { e.preventDefault(); act(() => skipTask(t.id)); } }
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
        <p>Nada na fila hoje. Os toques aparecem aqui quando contatos entram numa cadência.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <a href="/dashboard/contatos" className="btn-brand py-1.5 text-xs">Inscrever contatos</a>
          <a href="/dashboard/cadencias" className="btn-ghost py-1.5 text-xs">Criar uma cadência</a>
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
        <div className="w-[150px] shrink-0 grow-0">
          <SmartSelect
            className="py-1 text-xs"
            value={canal}
            onValueChange={(v) => setCanal(v)}
            options={[
              { value: "todos", label: "Todos os canais" },
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
        <span className="shrink-0 text-xs text-subtle">{tasks.length} na visão</span>
      </div>

      {tasks.length === 0 && (
        <div className="card p-8 text-center text-sm text-subtle">Nenhum toque nesta visão. Ajuste os filtros acima.</div>
      )}

      {/* barra de atalhos + envio em lote */}
      <div className="flex flex-wrap items-center gap-3">
        {pendingEmails > 0 && (
          <button className="btn-brand py-1.5 text-sm" onClick={sendAll} disabled={pending}>
            {pending ? "Enviando..." : `Enviar todos os e-mails (${pendingEmails})`}
          </button>
        )}
        {canal !== "todos" && canal !== "email" && tasks.length > 0 && (
          <button className="btn-ghost py-1.5 text-sm" onClick={completeVisible} disabled={pending}>
            Marcar todos os {canal === "whatsapp" ? "WhatsApp" : canal === "call" ? "de ligação" : "de LinkedIn"} como feitos ({tasks.length})
          </button>
        )}
        <span className="text-xs text-subtle">
          Teclado: <b>↑/↓</b> navegar · <b>Enter</b> enviar/concluir · <b>r</b> respondeu · <b>z</b> adiar · <b>x</b> pular
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
            className={`card p-4 transition ${t.hot_now ? "ring-2 ring-warn bg-warn/5" : hot ? "ring-1 ring-warn/40" : ""} ${focused ? "ring-2 ring-brand" : ""}`}
          >
            <div className="flex items-center gap-3">
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
