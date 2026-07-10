"use client";

import { useTransition } from "react";
import { setTeamRole } from "@/app/dashboard/equipe/actions";

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

  return (
    <select
      className="input py-1 text-xs"
      value={current || "vendedor"}
      disabled={pending}
      onChange={(e) => start(async () => void (await setTeamRole(memberId, e.target.value)))}
    >
      {ROLES.map((r) => (
        <option key={r.v} value={r.v}>{r.l}</option>
      ))}
    </select>
  );
}
