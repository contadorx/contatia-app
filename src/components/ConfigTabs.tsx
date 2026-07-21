"use client";

import { Children, useState, type ReactNode } from "react";

export default function ConfigTabs({ tabs, children, initial = 0 }: { tabs: string[]; children: ReactNode; initial?: number }) {
  const [active, setActive] = useState(Math.min(Math.max(initial, 0), tabs.length - 1));
  const panels = Children.toArray(children);

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-line">
        {tabs.map((t, i) => (
          <button
            key={t}
            onClick={() => setActive(i)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              active === i ? "border-brand text-brand" : "border-transparent text-subtle hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">{panels[active]}</div>
    </div>
  );
}
