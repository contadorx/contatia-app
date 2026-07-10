"use client";

import { useState, useTransition } from "react";
import { addNote } from "@/app/dashboard/contatos/note-actions";

export default function NoteComposer({ contactId }: { contactId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    if (!text.trim()) return;
    const t = text;
    start(async () => {
      const res = (await addNote(contactId, t)) as { error?: string } | undefined;
      if (!res?.error) setText("");
    });
  }

  return (
    <div className="mb-4">
      <textarea
        className="input min-h-[60px] text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Registrar uma nota (resultado da ligação, contexto, próximo passo)…"
      />
      <div className="mt-2 flex justify-end">
        <button className="btn-brand py-1.5 text-sm" onClick={submit} disabled={pending || !text.trim()}>
          {pending ? "..." : "Adicionar nota"}
        </button>
      </div>
    </div>
  );
}
