"use client";

import { useTransition } from "react";
import { toggleAccount, deleteAccount } from "@/app/dashboard/config/actions";

export default function AccountRowActions({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      <button
        className="text-xs text-subtle hover:text-ink"
        disabled={pending}
        onClick={() => start(async () => void (await toggleAccount(id, !active)))}
      >
        {active ? "Desativar" : "Ativar"}
      </button>
      <button
        className="text-xs text-subtle hover:text-danger"
        disabled={pending}
        onClick={() => start(async () => void (await deleteAccount(id)))}
      >
        Remover
      </button>
    </div>
  );
}
