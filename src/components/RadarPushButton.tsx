"use client";

import { useState, useTransition } from "react";
import { enrichAndPush } from "@/app/dashboard/radar/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

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
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <span className="text-xs font-semibold text-signal">✓ nos leads</span>;

  function push() {
    setMsg(null);
    start(async () => {
      const res = (await enrichAndPush(radarId, seq || undefined)) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else setDone(true);
    });
  }

  if (!picking) {
    return (
      <div className="flex justify-end">
        <button className="btn-brand py-1 text-xs" onClick={() => setPicking(true)}>
          + Adicionar aos leads
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <SmartSelect
        className="max-w-[130px] py-1 text-xs"
        placeholder="Sem cadência"
        clearable
        value={seq}
        onValueChange={(v) => setSeq(v)}
        options={sequences.map((s): SmartOption => ({ value: s.id, label: s.name }))}
      />
      <button className="btn-brand py-1 text-xs" onClick={push} disabled={pending}>
        {pending ? "..." : "Adicionar"}
      </button>
      <button className="text-xs text-subtle hover:text-ink" onClick={() => setPicking(false)}>cancelar</button>
      {msg && <span className="text-xs text-danger">{msg}</span>}
    </div>
  );
}
