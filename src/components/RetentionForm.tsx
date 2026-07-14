"use client";

import { useState, useTransition } from "react";
import { saveRetention } from "@/app/dashboard/config/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

const RETENTION_OPTS: SmartOption[] = [
  { value: "0", label: "Nunca expurgar" },
  { value: "3", label: "3 meses" },
  { value: "6", label: "6 meses" },
  { value: "12", label: "12 meses" },
  { value: "24", label: "24 meses" },
];

export default function RetentionForm({ initial }: { initial: number }) {
  const [months, setMonths] = useState(String(initial ?? 6));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div style={{ width: 200 }}>
        <SmartSelect className="py-1.5 text-sm" options={RETENTION_OPTS} value={months} onValueChange={(v) => setMonths(v)} />
      </div>
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
