"use client";

import { useTransition } from "react";
import { completeTask, skipTask, snoozeTask } from "@/app/dashboard/task-actions";
import { channelLabel, waLink, type Channel } from "@/lib/cadence";

type Task = {
  id: string;
  channel: Channel;
  title: string | null;
  generated_content: string | null;
  due_date: string;
  contacts: { name: string; company: string | null; phone: string | null; email: string | null } | null;
};

const chanStyle: Record<Channel, string> = {
  email: "bg-brand-soft text-brand-dark",
  whatsapp: "bg-signal/10 text-signal",
  call: "bg-warn/10 text-warn",
  linkedin: "bg-blue-50 text-blue-700",
};

export default function TaskQueue({ tasks }: { tasks: Task[] }) {
  const [pending, start] = useTransition();

  function act(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
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
      {tasks.map((t) => {
        const c = t.contacts;
        const content = t.generated_content || "";
        return (
          <div key={t.id} className="card flex items-center gap-3 p-4">
            <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${chanStyle[t.channel]}`}>
              {channelLabel[t.channel]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {c?.name || "Contato"} {c?.company ? <span className="font-normal text-subtle">· {c.company}</span> : null}
              </p>
              <p className="truncate text-xs text-subtle">{t.title || content || channelLabel[t.channel]}</p>
            </div>

            {/* ação por canal */}
            {t.channel === "whatsapp" && c?.phone && (
              <a
                className="btn-brand py-1.5 text-xs"
                href={waLink(c.phone, content)}
                target="_blank"
                rel="noreferrer"
                onClick={() => act(() => completeTask(t.id))}
              >
                Abrir WhatsApp
              </a>
            )}
            {t.channel === "email" && c?.email && (
              <a
                className="btn-ghost py-1.5 text-xs"
                href={`mailto:${c.email}?subject=${encodeURIComponent(t.title || "")}&body=${encodeURIComponent(content)}`}
                onClick={() => act(() => completeTask(t.id))}
              >
                Abrir e-mail
              </a>
            )}
            {t.channel === "linkedin" && (
              <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id))}>
                Feito
              </button>
            )}
            {t.channel === "call" && (
              <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => completeTask(t.id))}>
                Registrar
              </button>
            )}

            <button
              className="text-xs text-subtle hover:text-ink"
              disabled={pending}
              onClick={() => act(() => completeTask(t.id))}
              title="Concluir"
            >
              ✓
            </button>
            <button
              className="text-xs text-subtle hover:text-ink"
              disabled={pending}
              onClick={() => act(() => snoozeTask(t.id, 1))}
              title="Adiar 1 dia"
            >
              ↷
            </button>
            <button
              className="text-xs text-subtle hover:text-danger"
              disabled={pending}
              onClick={() => act(() => skipTask(t.id))}
              title="Pular"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
