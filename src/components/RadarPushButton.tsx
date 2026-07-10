"use client";

import { useState, useTransition } from "react";
import { enrichAndPush } from "@/app/dashboard/radar/actions";

export default function RadarPushButton({
  radarId,
  sequences,
  converted,
}: {
  radarId: string;
  sequences: { id: string; name: string }[];
  converted: boolean;
}) {
  const [seq, setSeq] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(converted);
  const [pending, start] = useTransition();

  if (done) return <span className="text-xs font-semibold text-signal">✓ no pipeline</span>;

  function push() {
    setMsg(null);
    start(async () => {
      const res = (await enrichAndPush(radarId, seq || undefined)) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else setDone(true);
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <select className="input max-w-[130px] py-1 text-xs" value={seq} onChange={(e) => setSeq(e.target.value)}>
        <option value="">Sem cadência</option>
        {sequences.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="btn-brand py-1 text-xs" onClick={push} disabled={pending}>
        {pending ? "..." : "Enriquecer + pipeline"}
      </button>
      {msg && <span className="text-xs text-danger">{msg}</span>}
    </div>
  );
}
