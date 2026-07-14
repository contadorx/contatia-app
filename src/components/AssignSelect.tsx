"use client";

import { useTransition } from "react";
import { assignContact } from "@/app/dashboard/equipe/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

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
  const opts: SmartOption[] = members.map((m) => ({ value: m.id, label: m.full_name || m.email }));
  return (
    <SmartSelect
      className="max-w-[150px] py-1 text-xs"
      options={opts}
      defaultValue={current || ""}
      disabled={pending}
      placeholder="Sem dono"
      clearable
      onValueChange={(v) => start(async () => void (await assignContact(contactId, v || null)))}
    />
  );
}
