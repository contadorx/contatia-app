"use client";

import { useTransition, useState, useEffect, useRef, useCallback } from "react";
import { completeTask, skipTask, snoozeTask, sendEmailTask, markReplied, sendWhatsAppTask, sendAllEmailTasks } from "@/app/dashboard/task-actions";
import { channelLabel, waLink, type Channel } from "@/lib/cadence";

type Task = {
  id: string;
  channel: Channel;
  title: string | null;
  generated_content: string | null;
  due_date: string;
  contact_id: string | null;
  contacts: { name: string; company: string | null; phone: string | null; email: string | null; score: number | null } | null;
};
type LastActivity = Record<string, { type: string; created_at: string; text?: string }>;

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
  tasks,
  hotThreshold,
  lastActivity = {},
}: {
  tasks: Task[];
  hotThreshold: number;
  lastActivity?: LastActivity;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  function act(fn: () => Promise<unknown>) {
    start(async () => { await fn(); });
  }
  function send(id: string) {
    setErr(null);
    start(async () => {
      const res = (await sendEmailTask(id)) as { error?: string } | undefined;
      if (res?.error) setErr(res.error);
    });
  }
  function sendWa(id: string) {
    setErr(null);
    start(async () => {
      const res = (await sendWhatsAppTask(id)) as { error?: string } | undefined;
      if (res?.error) setErr(res.error);
    });
  }

  // ação primária por canal (Enter)
  const primary = useCallback((t: Task) => {
    if (t.channel === "email" && t.contacts?.email) send(t.id);
    else if (t.channel === "whatsapp" && t.contacts?.phone) sendWa(t.id);
    else act(() => completeTask(t.id, t.contact_id ?? undefined));
  }, []);

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
  }, [tasks, focus, primary]);

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  if (!tasks.length)
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nada na fila hoje. Inscreva contatos numa cadência para gerar toques.
      </div>
    );

  return (
    <div className="space-y-2">
      {/* barra de atalhos + envio em lote */}
      <div className="flex flex-wrap items-center gap-3">
        {pendingEmails > 0 && (
          <button className="btn-brand py-1.5 text-sm" onClick={sendAll} disabled={pending}>
            {pending ? "Enviando..." : `Enviar todos os e-mails (${pendingEmails})`}
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
        return (
          <div
            key={t.id}
            ref={(el) => { rowRefs.current[i] = el; }}
            onClick={() => setFocus(i)}
            className={`card p-4 transition ${hot ? "ring-1 ring-warn/40" : ""} ${focused ? "ring-2 ring-brand" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${chanStyle[t.channel]}`}>
                {channelLabel[t.channel]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold">
                  {c?.name || "Contato"}
                  {c?.company ? <span className="font-normal text-subtle">· {c.company}</span> : null}
                  {hot && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">QUENTE</span>}
                </p>
                <p className="truncate text-xs text-subtle">{t.title || content || channelLabel[t.channel]}</p>
              </div>

              {t.channel === "whatsapp" && c?.phone && (
                <>
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => sendWa(t.id)}>Enviar</button>
                  <a className="text-xs text-subtle hover:text-ink" href={waLink(c.phone, content)} target="_blank" rel="noreferrer" title="Abrir no WhatsApp Web/app">↗</a>
                </>
              )}
              {t.channel === "email" && c?.email && (
                <>
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => send(t.id)}>Enviar</button>
                  <a className="text-xs text-subtle hover:text-ink" href={`mailto:${c.email}?subject=${encodeURIComponent(t.title || "")}&body=${encodeURIComponent(content)}`} title="Abrir no seu cliente de e-mail">✎</a>
                </>
              )}
              {t.channel === "linkedin" && (
                <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Feito</button>
              )}
              {t.channel === "call" && (
                <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Registrar</button>
              )}

              {t.contact_id && (
                <button
                  className="rounded-lg border border-signal/40 px-2 py-1.5 text-xs font-semibold text-signal hover:bg-signal/10"
                  disabled={pending}
                  onClick={() => act(() => markReplied(t.contact_id as string))}
                  title="Marcar que respondeu — pausa a sequência"
                >
                  Respondeu
                </button>
              )}
              <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))} title="Concluir">✓</button>
              <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => snoozeTask(t.id, 1))} title="Adiar 1 dia">↷</button>
              <button className="text-xs text-subtle hover:text-danger" disabled={pending} onClick={() => act(() => skipTask(t.id))} title="Pular">✕</button>
            </div>

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
