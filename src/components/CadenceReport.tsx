"use client";

import { useState, useTransition } from "react";
import { getCadenceReport, type StepReport } from "@/app/dashboard/cadencias/report-actions";

const channelLabel: Record<string, string> = { email: "E-mail", whatsapp: "WhatsApp", call: "Ligação", task: "Tarefa", linkedin: "LinkedIn" };

function pct(n: number, d: number) {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export function CadenceReport({ sequenceId }: { sequenceId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<StepReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!report) {
      start(async () => {
        const r = (await getCadenceReport(sequenceId)) as any;
        if (r?.error) setErr(r.error); else setReport(r.report);
      });
    }
  }

  return (
    <div className="mt-2">
      <button className="text-xs font-semibold text-brand-dark hover:underline" onClick={toggle}>
        {open ? "ocultar desempenho" : "ver desempenho por passo →"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-line p-3">
          {pending && <p className="text-xs text-subtle">Calculando...</p>}
          {err && <p className="text-xs text-danger">{err}</p>}
          {report && !report.length && <p className="text-xs text-subtle">Sem dados ainda.</p>}
          {report && report.length > 0 && (
            <div className="space-y-2">
              {report.map((s) => (
                <div key={s.position} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Passo {s.position + 1} · {channelLabel[s.channel] || s.channel}</span>
                    <span className="text-xs text-subtle">
                      {s.sent} enviados · {s.replied} respostas · <b className="text-ink">{pct(s.replied, s.sent)}</b> resposta
                    </span>
                  </div>
                  {s.subject && <p className="truncate text-xs text-subtle">"{s.subject}"</p>}
                  {s.ab && (
                    <div className="mt-1 grid grid-cols-2 gap-2 rounded bg-muted/60 p-2 text-xs">
                      <div>
                        <p className="font-semibold">A: <span className="font-normal text-subtle">"{s.subject}"</span></p>
                        <p>{s.ab.a.sent} env · {s.ab.a.replied} resp · <b>{pct(s.ab.a.replied, s.ab.a.sent)}</b></p>
                      </div>
                      <div>
                        <p className="font-semibold">B: <span className="font-normal text-subtle">"{s.subject_b}"</span></p>
                        <p>{s.ab.b.sent} env · {s.ab.b.replied} resp · <b>{pct(s.ab.b.replied, s.ab.b.sent)}</b></p>
                      </div>
                      {(() => {
                        const ra = s.ab.a.sent ? s.ab.a.replied / s.ab.a.sent : 0;
                        const rb = s.ab.b.sent ? s.ab.b.replied / s.ab.b.sent : 0;
                        if (s.ab.a.sent + s.ab.b.sent < 10) return <p className="col-span-2 text-[11px] text-subtle">Amostra pequena — resultados ganham confiança com mais envios.</p>;
                        if (ra === rb) return <p className="col-span-2 text-[11px] text-subtle">Empate técnico até agora.</p>;
                        return <p className="col-span-2 text-[11px] font-semibold text-signal">Vencendo: assunto {ra > rb ? "A" : "B"}.</p>;
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
