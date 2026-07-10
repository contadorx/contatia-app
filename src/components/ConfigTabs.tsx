"use client";

import { Children, useState, type ReactNode } from "react";

export default function ConfigTabs({ tabs, children }: { tabs: string[]; children: ReactNode }) {
  const [active, setActive] = useState(0);
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
