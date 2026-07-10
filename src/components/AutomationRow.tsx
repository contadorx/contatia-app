"use client";

import { useTransition } from "react";
import { toggleAutomation, deleteAutomation } from "@/app/dashboard/automacoes/actions";

export default function AutomationRow({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      <button
        className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-signal/10 text-signal" : "bg-muted text-subtle"}`}
        disabled={pending}
        onClick={() => start(async () => void (await toggleAutomation(id, !active)))}
      >
        {active ? "Ativa" : "Inativa"}
      </button>
      <button className="text-xs text-subtle hover:text-danger" disabled={pending} onClick={() => start(async () => void (await deleteAutomation(id)))}>
        remover
      </button>
    </div>
  );
}
