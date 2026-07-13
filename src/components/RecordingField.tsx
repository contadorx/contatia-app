"use client";

import { useState, useTransition } from "react";
import { saveRecording } from "@/app/dashboard/reunioes/actions";

export function RecordingField({ meetingId, initial }: { meetingId: string; initial: string }) {
  const [url, setUrl] = useState(initial);
  const [editing, setEditing] = useState(!initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing && url) {
    return (
      <div className="flex items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="text-sm text-signal hover:underline">▶ Ver gravação</a>
        <button className="text-xs text-subtle hover:text-ink" onClick={() => setEditing(true)}>editar</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <input className="input py-1.5 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Cole o link (Loom, Meet, Zoom...)" />
        <button className="btn-brand shrink-0 py-1.5 text-sm" disabled={pending} onClick={() => {
          setMsg(null);
          start(async () => {
            const r = (await saveRecording(meetingId, url)) as any;
            if (r?.error) setMsg(r.error);
            else { setEditing(false); setMsg(null); }
          });
        }}>Salvar</button>
      </div>
      {msg && <p className="mt-1 text-xs text-danger">{msg}</p>}
      <p className="mt-1 text-[11px] text-subtle">O Meet já é criado no convite do Google. Aqui você guarda a gravação depois da reunião.</p>
    </div>
  );
}
