"use client";

import { useTransition } from "react";
import { setTeamRole } from "@/app/dashboard/equipe/actions";
import SmartSelect from "@/components/SmartSelect";

const ROLES = [
  { v: "admin", l: "Admin" },
  { v: "gestor", l: "Gestor" },
  { v: "sdr", l: "SDR" },
  { v: "vendedor", l: "Vendedor" },
];

export default function TeamRoleSelect({ memberId, current, canManage }: { memberId: string; current: string | null; canManage: boolean }) {
  const [pending, start] = useTransition();

  if (!canManage) {
    const label = ROLES.find((r) => r.v === current)?.l || "—";
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">{label}</span>;
  }

  // single de propósito: um membro tem UM papel.
  return (
    <div className="w-[130px]">
      <SmartSelect
        className="py-1 text-xs"
        value={current || "vendedor"}
        disabled={pending}
        onValueChange={(v) => start(async () => void (await setTeamRole(memberId, v)))}
        options={ROLES.map((r) => ({ value: r.v, label: r.l }))}
      />
    </div>
  );
}
