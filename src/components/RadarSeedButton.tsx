"use client";

import { useState, useTransition } from "react";
import { seedRadarDemo } from "@/app/dashboard/radar/actions";

export default function RadarSeedButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="btn-ghost py-1.5 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = (await seedRadarDemo()) as { count?: number; error?: string };
            setMsg(res?.error ? res.error : `✓ ${res.count} leads de teste adicionados.`);
          })
        }
      >
        {pending ? "Gerando..." : "Gerar dados de teste"}
      </button>
      {msg && <span className={`text-xs ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</span>}
    </span>
  );
}
