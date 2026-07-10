"use client";

import { useState, useTransition } from "react";
import { createInvite, revokeInvite } from "@/app/dashboard/equipe/actions";

type Invite = { id: string; email: string; token: string; expires_at: string };

export default function InviteTools({ pending }: { pending: Invite[] }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingTx, start] = useTransition();

  function gerar() {
    setMsg(null);
    setLink(null);
    start(async () => {
      const res = (await createInvite(email)) as { token?: string; error?: string };
      if (res?.error) setMsg(res.error);
      else if (res?.token) {
        setLink(`${window.location.origin}/convite/${res.token}`);
        setEmail("");
      }
    });
  }
  function copy(v: string) {
    navigator.clipboard?.writeText(v);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function revoke(id: string) {
    start(async () => void (await revokeInvite(id)));
  }

  return (
    <div className="card p-5">
      <p className="text-sm font-semibold">Convidar vendedor</p>
      <p className="mt-1 text-xs text-subtle">Gera um link (válido 14 dias) — mande por WhatsApp/e-mail. A pessoa cria a conta, abre o link e entra no seu workspace.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colega@empresa.com.br" />
        <button className="btn-brand py-1.5 text-sm" onClick={gerar} disabled={pendingTx || !email}>
          {pendingTx ? "..." : "Gerar convite"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      {link && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className="input w-72 text-xs" value={link} readOnly onFocus={(e) => e.target.select()} />
          <button className="btn-ghost py-1.5 text-xs" onClick={() => copy(link)}>
            {copied ? "Copiado!" : "Copiar link"}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-5">
          <p className="label">Convites pendentes</p>
          <div className="mt-2 divide-y divide-line">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center justify-between py-2 text-sm">
                <span>{i.email}</span>
                <div className="flex items-center gap-3">
                  <button className="text-xs text-subtle hover:text-ink" onClick={() => copy(`${window.location.origin}/convite/${i.token}`)}>
                    copiar link
                  </button>
                  <button className="text-xs text-subtle hover:text-danger" onClick={() => revoke(i.id)}>
                    revogar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
