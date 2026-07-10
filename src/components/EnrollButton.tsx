"use client";

import { useState, useTransition } from "react";
import { enrollContact } from "@/app/dashboard/cadencias/actions";

type Seq = { id: string; name: string };

export default function EnrollButton({ contactId, sequences }: { contactId: string; sequences: Seq[] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (!sequences.length) return <span className="text-xs text-subtle">—</span>;
  if (done) return <span className="text-xs text-signal">✓ inscrito</span>;

  function enroll(seqId: string) {
    start(async () => {
      const res = await enrollContact(contactId, seqId);
      if (!res?.error) setDone(true);
      setOpen(false);
    });
  }

  return (
    <div className="relative inline-block">
      <button className="btn-ghost py-1 text-xs" onClick={() => setOpen((o) => !o)} disabled={pending}>
        {pending ? "..." : "▶ Cadência"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-52 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {sequences.map((s) => (
            <button
              key={s.id}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => enroll(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
