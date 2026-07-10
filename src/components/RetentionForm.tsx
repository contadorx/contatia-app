"use client";

import { useState, useTransition } from "react";
import { saveRetention } from "@/app/dashboard/config/actions";

export default function RetentionForm({ initial }: { initial: number }) {
  const [months, setMonths] = useState(String(initial ?? 6));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input py-1.5 text-sm" style={{ width: 200 }} value={months} onChange={(e) => setMonths(e.target.value)}>
        <option value="0">Nunca expurgar</option>
        <option value="3">3 meses</option>
        <option value="6">6 meses</option>
        <option value="12">12 meses</option>
        <option value="24">24 meses</option>
      </select>
      <button
        className="btn-brand py-1.5 text-sm"
        disabled={pending}
        onClick={() => start(async () => {
          const res = (await saveRetention(Number(months))) as { ok?: boolean; error?: string };
          setMsg(res?.error ? res.error : "✓ Retenção salva.");
        })}
      >
        {pending ? "Salvando..." : "Salvar"}
      </button>
      {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</span>}
    </div>
  );
}
