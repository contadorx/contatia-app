"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/app/convite/[token]/actions";

export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function accept() {
    setMsg(null);
    start(async () => {
      const res = (await acceptInvite(token)) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else router.push("/dashboard");
    });
  }

  return (
    <div>
      <button className="btn-brand" onClick={accept} disabled={pending}>
        {pending ? "Entrando..." : "Aceitar convite e entrar"}
      </button>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
    </div>
  );
}
