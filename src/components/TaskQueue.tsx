"use client";

import { useTransition, useState } from "react";
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

const chanStyle: Record<Channel, string> = {
  email: "bg-brand-soft text-brand-dark",
  whatsapp: "bg-signal/10 text-signal",
  call: "bg-warn/10 text-warn",
  linkedin: "bg-blue-50 text-blue-700",
};

export default function TaskQueue({ tasks, hotThreshold }: { tasks: Task[]; hotThreshold: number }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const pendingEmails = tasks.filter((t) => t.channel === "email").length;

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
    start(async () => {
      await fn();
    });
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

  if (!tasks.length)
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nada na fila hoje. Inscreva contatos numa cadência para gerar toques.
      </div>
    );

  return (
    <div className="space-y-2">
      {pendingEmails > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/60 p-3">
          <span className="text-sm font-semibold">{pendingEmails} e-mail{pendingEmails > 1 ? "s" : ""} na fila</span>
          <button className="btn-brand py-1.5 text-sm" onClick={sendAll} disabled={pending}>
            {pending ? "Enviando..." : "Enviar todos os e-mails"}
          </button>
          {bulkMsg && <span className="text-sm text-signal">{bulkMsg}</span>}
        </div>
      )}
      {err && <div className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{err}</div>}
      {tasks.map((t) => {
        const c = t.contacts;
        const content = t.generated_content || "";
        const score = c?.score ?? 0;
        const hot = score >= hotThreshold;
        return (
          <div key={t.id} className={`card flex items-center gap-3 p-4 ${hot ? "ring-1 ring-warn/40" : ""}`}>
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

            {/* ação por canal */}
            {t.channel === "whatsapp" && c?.phone && (
              <>
                <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => sendWa(t.id)}>
                  Enviar
                </button>
                <a className="text-xs text-subtle hover:text-ink" href={waLink(c.phone, content)} target="_blank" rel="noreferrer" title="Abrir no WhatsApp Web/app">
                  ↗
                </a>
              </>
            )}
            {t.channel === "email" && c?.email && (
              <>
                <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => send(t.id)}>
                  Enviar
                </button>
                <a className="text-xs text-subtle hover:text-ink" href={`mailto:${c.email}?subject=${encodeURIComponent(t.title || "")}&body=${encodeURIComponent(content)}`} title="Abrir no seu cliente de e-mail">
                  ✎
                </a>
              </>
            )}
            {t.channel === "linkedin" && (
              <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>
                Feito
              </button>
            )}
            {t.channel === "call" && (
              <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>
                Registrar
              </button>
            )}

            {/* respondeu → pausa a sequência */}
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

            <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))} title="Concluir">
              ✓
            </button>
            <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => snoozeTask(t.id, 1))} title="Adiar 1 dia">
              ↷
            </button>
            <button className="text-xs text-subtle hover:text-danger" disabled={pending} onClick={() => act(() => skipTask(t.id))} title="Pular">
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
