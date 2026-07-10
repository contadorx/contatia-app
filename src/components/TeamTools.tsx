"use client";

import { useState, useTransition } from "react";
import { distributeUnassigned, dedupeByEmail } from "@/app/dashboard/equipe/actions";

export default function TeamTools() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function distribute() {
    setMsg(null);
    start(async () => {
      const res = (await distributeUnassigned()) as { distributed?: number; error?: string };
      setMsg(res?.error ? res.error : `Distribuídos ${res.distributed ?? 0} contatos sem dono.`);
    });
  }
  function dedupe() {
    setMsg(null);
    start(async () => {
      const res = (await dedupeByEmail()) as { marked?: number; error?: string };
      setMsg(res?.error ? res.error : `${res.marked ?? 0} duplicados marcados.`);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={distribute} disabled={pending}>
          Distribuir sem dono (round-robin)
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={dedupe} disabled={pending}>
          Marcar duplicados por e-mail
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-subtle">{msg}</p>}
    </div>
  );
}
