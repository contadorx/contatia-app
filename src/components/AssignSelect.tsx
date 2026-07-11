"use client";

import { useTransition } from "react";
import { assignContact } from "@/app/dashboard/equipe/actions";

type Member = { id: string; full_name: string | null; email: string };

export default function AssignSelect({
  contactId,
  current,
  members,
}: {
  contactId: string;
  current: string | null;
  members: Member[];
}) {
  const [pending, start] = useTransition();
  return (
    <select
      className="input max-w-[150px] py-1 text-xs"
      defaultValue={current || ""}
      disabled={pending}
      onChange={(e) => start(async () => void (await assignContact(contactId, e.target.value || null)))}
    >
      <option value="">Sem dono</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.full_name || m.email}
        </option>
      ))}
    </select>
  );
}
