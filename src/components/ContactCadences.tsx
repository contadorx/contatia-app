"use client";

import { useTransition } from "react";
import { pauseEnrollment, resumeEnrollment, stopEnrollment } from "@/app/dashboard/cadencias/actions";

type Enr = { id: string; status: string; sequences: { name: string } | null };

const STATUS: Record<string, { l: string; c: string }> = {
  active: { l: "Ativa", c: "bg-signal/10 text-signal" },
  paused: { l: "Pausada", c: "bg-warn/10 text-warn" },
  replied: { l: "Respondeu", c: "bg-brand-soft text-brand-dark" },
  completed: { l: "Concluída", c: "bg-muted text-subtle" },
  stopped: { l: "Parada", c: "bg-muted text-subtle" },
};

export default function ContactCadences({ enrollments }: { enrollments: Enr[] }) {
  const [pending, start] = useTransition();
  if (!enrollments.length) return <p className="text-sm text-subtle">Nenhuma cadência ainda. Use &ldquo;Inscrever&rdquo; acima.</p>;

  return (
    <div className="space-y-2">
      {enrollments.map((e) => {
        const st = STATUS[e.status] || STATUS.stopped;
        return (
          <div key={e.id} className="flex items-center justify-between rounded-lg border border-line p-2.5">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span>
              <span className="text-sm font-medium">{e.sequences?.name || "—"}</span>
            </div>
            <div className="flex items-center gap-3">
              {e.status === "active" && (
                <button className="text-xs text-subtle hover:text-warn" disabled={pending} onClick={() => start(async () => void (await pauseEnrollment(e.id)))}>
                  pausar
                </button>
              )}
              {e.status === "paused" && (
                <button className="text-xs text-subtle hover:text-signal" disabled={pending} onClick={() => start(async () => void (await resumeEnrollment(e.id)))}>
                  retomar
                </button>
              )}
              {(e.status === "active" || e.status === "paused") && (
                <button
                  className="text-xs text-subtle hover:text-danger"
                  disabled={pending}
                  onClick={() => { if (confirm("Remover este contato da cadência? As tarefas pendentes serão canceladas.")) start(async () => void (await stopEnrollment(e.id))); }}
                >
                  remover
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
