"use client";

import { useState, type ReactNode } from "react";

// Alterna entre a visão de LISTA (agenda por dia + passadas) e o CALENDÁRIO,
// em vez de empilhar as duas. Mantém ambas montadas (esconde com 'hidden') para
// preservar o estado do calendário ao trocar.
export default function MeetingsTabs({ calendar, list }: { calendar: ReactNode; list: ReactNode }) {
  const [view, setView] = useState<"lista" | "calendario">("lista");

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1">
        {([["lista", "Lista"], ["calendario", "Calendário"]] as const).map(([v, l]) => (
          <button
            key={v}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${view === v ? "bg-brand text-white" : "text-subtle hover:text-ink"}`}
            onClick={() => setView(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className={view === "calendario" ? "" : "hidden"}>{calendar}</div>
      <div className={view === "lista" ? "" : "hidden"}>{list}</div>
    </div>
  );
}
