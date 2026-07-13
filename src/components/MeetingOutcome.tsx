"use client";

import { useState, useTransition } from "react";
import { recordOutcome } from "@/app/dashboard/reunioes/actions";

const OUTCOMES = [
  { v: "fechou", l: "Fechou 🎉", c: "bg-signal/10 text-signal" },
  { v: "avancou", l: "Avançou", c: "bg-brand-soft text-brand-dark" },
  { v: "remarcar", l: "Remarcar", c: "bg-warn/10 text-warn" },
  { v: "sem_interesse", l: "Sem interesse", c: "bg-muted text-subtle" },
];

export default function MeetingOutcome({ id, contactId }: { id: string; contactId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("avancou");
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  if (!open)
    return (
      <button className="btn-ghost py-1.5 text-xs" onClick={() => setOpen(true)}>
        Como foi?
      </button>
    );

  return (
    <div className="mt-2 w-full rounded-lg border border-line bg-muted p-3">
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map((o) => (
          <button
            key={o.v}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === o.v ? o.c + " ring-1 ring-brand/40" : "bg-surface text-subtle"}`}
            onClick={() => setStatus(o.v)}
          >
            {o.l}
          </button>
        ))}
      </div>
      <textarea className="input mt-2 min-h-[50px] text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Anotações da reunião, próximo passo…" />
      <div className="mt-2 flex gap-2">
        <button
          className="btn-brand py-1 text-xs"
          disabled={pending}
          onClick={() => start(async () => { await recordOutcome({ id, contact_id: contactId || undefined, outcome_status: status, outcome: text }); setOpen(false); })}
        >
          {pending ? "Salvando..." : "Salvar resultado"}
        </button>
        <button className="btn-ghost py-1 text-xs" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}
