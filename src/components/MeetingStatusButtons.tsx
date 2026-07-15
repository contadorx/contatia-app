"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMeetingStatus, deleteMeeting } from "@/app/dashboard/reunioes/actions";

export default function MeetingStatusButtons({
  id,
  contactId,
  status,
}: {
  id: string;
  contactId: string | null;
  status: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (s: string) => start(async () => void (await setMeetingStatus(id, s, contactId ?? undefined)));
  const excluir = () => {
    if (!confirm("Excluir esta reunião? Isso não pode ser desfeito.")) return;
    start(async () => { await deleteMeeting(id); router.refresh(); });
  };
  const Del = () => (
    <button className="text-xs text-subtle hover:text-red-600" disabled={pending} title="Excluir reunião" onClick={excluir}>excluir</button>
  );

  if (status === "realizada") return <span className="flex items-center gap-2"><span className="text-xs font-semibold text-signal">✓ realizada</span><Del /></span>;
  if (status === "no_show") return <span className="flex items-center gap-2"><span className="text-xs font-semibold text-danger">faltou</span><Del /></span>;

  return (
    <div className="flex items-center gap-2">
      {status !== "confirmada" && (
        <button className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-muted" disabled={pending} onClick={() => set("confirmada")}>
          Confirmar
        </button>
      )}
      {status === "confirmada" && <span className="text-xs font-semibold text-brand-dark">confirmada</span>}
      <button className="rounded-lg border border-signal/40 px-2 py-1 text-xs text-signal hover:bg-signal/10" disabled={pending} onClick={() => set("realizada")}>
        Aconteceu
      </button>
      <button className="rounded-lg border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10" disabled={pending} onClick={() => set("no_show")}>
        Faltou
      </button>
      <Del />
    </div>
  );
}
