"use client";

import { useState, useTransition } from "react";
import { approveSuggestion, dismissSuggestion } from "@/app/dashboard/contatos/sugestoes/actions";

type Row = { id: string; email: string; name: string | null; created_at: string };

export function SuggestionTools({ rows }: { rows: Row[] }) {
  const [list, setList] = useState(rows);

  if (!list.length) {
    return <div className="card p-8 text-center text-sm text-subtle">Nenhuma sugestão no momento. Quando alguém que não está na base te responder por e-mail, aparece aqui.</div>;
  }

  return (
    <div className="space-y-2">
      {list.map((r) => (
        <SuggestionRow key={r.id} row={r} onDone={(id) => setList((l) => l.filter((x) => x.id !== id))} />
      ))}
    </div>
  );
}

function SuggestionRow({ row, onDone }: { row: Row; onDone: (id: string) => void }) {
  const [name, setName] = useState(row.name || row.email.split("@")[0]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <input className="input py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
        <p className="mt-0.5 truncate text-xs text-subtle">{row.email}</p>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
      <div className="flex gap-2">
        <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => start(async () => {
          const r = (await approveSuggestion(row.id, name)) as any;
          if (r?.error) setErr(r.error); else onDone(row.id);
        })}>+ Adicionar</button>
        <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={() => start(async () => {
          await dismissSuggestion(row.id); onDone(row.id);
        })}>descartar</button>
      </div>
    </div>
  );
}
