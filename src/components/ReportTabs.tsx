"use client";

import { useState } from "react";

// Abas dos relatórios: mostra só o relatório ativo (troca instantânea, sem recarregar).
export default function ReportTabs({ tabs }: { tabs: { id: string; label: string; node: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const atual = tabs.find((t) => t.id === active) || tabs[0];

  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              active === t.id ? "border-brand text-brand-dark" : "border-transparent text-subtle hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">{atual?.node}</div>
    </div>
  );
}
