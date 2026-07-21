"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyContactEmail, aplicarEmailContato, testarEmailAvulso } from "@/app/dashboard/contatos/verify-actions";

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

// Testa um e-mail específico digitado (ex.: contabil@empresa.com.br) e permite usá-lo.
export function TestEmailBox({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [res, setRes] = useState<{ status?: string; reason?: string; verificado?: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();

  function testar() {
    setRes(null);
    start(async () => setRes((await testarEmailAvulso(email)) as any));
  }
  function usar() {
    startSave(async () => {
      const r: any = await aplicarEmailContato(contactId, email);
      if (!r?.error) { setOpen(false); router.refresh(); }
    });
  }

  const MAPA: Record<string, { txt: string; cls: string }> = {
    valid: { txt: "✓ a caixa existe", cls: "text-green-700" },
    invalid: { txt: "✕ a caixa não existe", cls: "text-red-600" },
    uncertain: { txt: "? incerto (domínio catch-all ou provedor lento)", cls: "text-amber-700" },
    blocked: { txt: "🔒 o provedor bloqueia a verificação", cls: "text-amber-700" },
    mx_ok: { txt: "domínio recebe e-mail (não deu pra confirmar a caixa)", cls: "text-amber-700" },
    error: { txt: "não foi possível verificar agora", cls: "text-subtle" },
  };

  if (!open)
    return (
      <button
        className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-brand hover:text-brand-dark"
        onClick={() => setOpen(true)}
      >
        ✓ Testar um e-mail que já tenho
      </button>
    );

  const info = res && res.status ? MAPA[res.status] || MAPA.error : null;

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface p-3">
      <p className="text-xs font-semibold">✓ Testar um e-mail que já tenho</p>
      <p className="mt-0.5 text-[11px] text-subtle">Digite um endereço e confirmo se a caixa existe (ex.: contabil@empresa.com.br, contato@…). Bom pra e-mails por função, que não seguem o nome da pessoa.</p>
      <div className="mt-2 flex gap-2">
        <input
          className="input py-1 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@empresa.com.br"
          onKeyDown={(e) => { if (e.key === "Enter" && email.includes("@")) testar(); }}
        />
        <button className="btn-outline px-3 py-1 text-xs" onClick={testar} disabled={pending || !email.includes("@")}>
          {pending ? "…" : "Testar"}
        </button>
      </div>
      {pending && <p className="mt-2 text-xs text-subtle">Testando a caixa… (a checagem SMTP leva alguns segundos)</p>}
      {res?.error && <p className="mt-2 text-xs text-red-600">{res.error}</p>}
      {info && !pending && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className={`text-xs font-medium ${info.cls}`}>{info.txt}</p>
          {res?.status === "valid" && (
            <button className="btn-brand py-1 text-[11px]" disabled={saving} onClick={usar}>
              {saving ? "…" : "Usar como e-mail"}
            </button>
          )}
        </div>
      )}
      <button className="mt-2 text-xs text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
    </div>
  );
}
