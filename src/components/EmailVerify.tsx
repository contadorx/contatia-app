"use client";

import { useState, useTransition } from "react";
import { verifyContactEmail, suggestDecisorEmails } from "@/app/dashboard/contatos/verify-actions";

type Check = { valid?: boolean; syntax?: boolean; disposable?: boolean; hasMx?: boolean; reason?: string; checked_at?: string } | null;

export function EmailVerifyBadge({ contactId, hasEmail, initial }: { contactId: string; hasEmail: boolean; initial: Check }) {
  const [check, setCheck] = useState<Check>(initial);
  const [pending, start] = useTransition();

  if (!hasEmail) return <span className="text-xs text-subtle">sem e-mail</span>;

  const badge = check ? (
    check.valid ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-signal/10 px-2 py-0.5 text-xs font-semibold text-signal">✓ SMTP validado</span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger" title={check.reason || ""}>✕ {check.reason || "inválido"}</span>
    )
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">não verificado</span>
  );

  return (
    <span className="inline-flex items-center gap-2">
      {badge}
      <button
        className="text-xs text-brand-dark hover:underline disabled:opacity-50"
        disabled={pending}
        onClick={() => start(async () => {
          const res = (await verifyContactEmail(contactId)) as any;
          if (res?.result) setCheck({ ...res.result, checked_at: new Date().toISOString() });
        })}
      >
        {pending ? "verificando…" : check ? "reverificar" : "verificar"}
      </button>
    </span>
  );
}

export function DecisorFinder({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ candidates?: string[]; domainValid?: boolean; error?: string } | null>(null);

  if (!open) return <button className="text-xs text-brand-dark hover:underline" onClick={() => { setOpen(true); start(async () => setRes((await suggestDecisorEmails(contactId)) as any)); }}>Encontrar e-mail do decisor</button>;

  return (
    <div className="mt-2 rounded-lg border border-line bg-muted p-3">
      <p className="text-xs font-semibold">Palpites de e-mail do decisor</p>
      {pending && <p className="mt-1 text-xs text-subtle">Gerando…</p>}
      {res?.error && <p className="mt-1 text-xs text-danger">{res.error}</p>}
      {res?.candidates && (
        <>
          <p className="mt-1 text-[11px] text-subtle">Domínio {res.domainValid ? <span className="text-signal">recebe e-mail ✓</span> : <span className="text-danger">sem MX ✕</span>}. Padrões comuns (valide antes de usar):</p>
          <ul className="mt-1 space-y-0.5">
            {res.candidates.map((e) => (
              <li key={e} className="flex items-center justify-between text-xs">
                <code className="text-ink">{e}</code>
                <button className="text-subtle hover:text-brand-dark" onClick={() => navigator.clipboard?.writeText(e)}>copiar</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="mt-2 text-xs text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
    </div>
  );
}
