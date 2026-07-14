"use client";

import { useState, useTransition } from "react";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { createInvite, revokeInvite } from "@/app/dashboard/equipe/actions";

type Invite = { id: string; email: string; token: string; expires_at: string };

const ROLE_OPTS: { v: string; l: string; d: string }[] = [
  { v: "vendedor", l: "Vendedor", d: "trabalha a própria carteira; vê só o que é dele" },
  { v: "sdr", l: "SDR", d: "prospecção e primeiros toques; vê só o que é dele" },
  { v: "gestor", l: "Gestor", d: "lidera a operação; vê o pipeline e as cadências de todos" },
  { v: "admin", l: "Admin", d: "administra workspace e equipe (menos cobrança)" },
];

export default function InviteTools({ pending }: { pending: Invite[] }) {
  const [email, setEmail] = useState("");
  const [teamRole, setTeamRole] = useState("vendedor");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingTx, start] = useTransition();

  function gerar() {
    setMsg(null);
    setLink(null);
    start(async () => {
      const res = (await createInvite(email, teamRole)) as { token?: string; error?: string };
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
      <p className="text-sm font-semibold">Convidar pessoa</p>
      <p className="mt-1 text-xs text-subtle">Gera um link (válido 14 dias) — mande por WhatsApp/e-mail. A pessoa cria a conta, abre o link e entra no seu workspace com o papel que você escolher.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">E-mail</label>
          <input className="input mt-1 max-w-xs" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colega@empresa.com.br" />
        </div>
        <div>
          <label className="label">Papel</label>
          <div style={{ minWidth: 150 }}>
            <SmartSelect className="mt-1" options={ROLE_OPTS.map((o): SmartOption => ({ value: o.v, label: o.l }))} value={teamRole} onValueChange={(v) => setTeamRole(v)} />
          </div>
        </div>
        <button className="btn-brand py-2 text-sm" onClick={gerar} disabled={pendingTx || !email}>
          {pendingTx ? "..." : "Gerar convite"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-subtle">{ROLE_OPTS.find((o) => o.v === teamRole)?.d}</p>
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
