"use client";

import { useState, useTransition } from "react";
import { markReplied } from "@/app/dashboard/task-actions";

export default function ContactReplyButton({ contactId }: { contactId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  if (done) return <span className="text-xs font-semibold text-signal">✓ marcado como respondeu</span>;

  return (
    <button
      className="rounded-lg border border-signal/40 px-3 py-1.5 text-sm font-semibold text-signal hover:bg-signal/10"
      disabled={pending}
      onClick={() => start(async () => {
        await markReplied(contactId);
        setDone(true);
      })}
    >
      Marcar: respondeu
    </button>
  );
}
