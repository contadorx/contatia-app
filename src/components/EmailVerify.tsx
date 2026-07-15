"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyContactEmail, suggestDecisorEmails, aplicarEmailContato, testarEmailAvulso } from "@/app/dashboard/contatos/verify-actions";

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

type Tentativa = { email: string; status: string; reason?: string };
type DecisorRes = {
  ok?: boolean;
  verificado?: boolean;
  domain?: string;
  email?: string | null;
  status?: string;
  tentativas?: Tentativa[];
  candidates?: string[];
  domainValid?: boolean;
  error?: string;
} | null;

// selo de status de cada palpite verificado
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    valid: { label: "existe ✓", cls: "bg-green-100 text-green-700" },
    invalid: { label: "não existe ✕", cls: "bg-red-100 text-red-700" },
    not_found: { label: "não existe ✕", cls: "bg-red-100 text-red-700" },
    uncertain: { label: "incerto ?", cls: "bg-amber-100 text-amber-700" },
    blocked: { label: "bloqueado", cls: "bg-amber-100 text-amber-700" },
  };
  const m = map[status] || { label: status, cls: "bg-muted text-subtle" };
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
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
      <button className="text-xs text-brand-dark hover:underline" onClick={() => setOpen(true)}>
        Testar um e-mail específico
      </button>
    );

  const info = res && res.status ? MAPA[res.status] || MAPA.error : null;

  return (
    <div className="mt-2 rounded-lg border border-line bg-muted p-3">
      <p className="text-xs font-semibold">Testar um e-mail específico</p>
      <p className="mt-0.5 text-[11px] text-subtle">Confirma se a caixa existe (ex.: contabil@empresa.com.br, contato@…). Bom pra e-mails que não seguem o nome da pessoa.</p>
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

export function DecisorFinder({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [res, setRes] = useState<DecisorRes>(null);

  function usar(email: string) {
    startSave(async () => {
      const r: any = await aplicarEmailContato(contactId, email);
      if (!r?.error) { setOpen(false); router.refresh(); }
    });
  }

  if (!open)
    return (
      <button
        className="text-xs text-brand-dark hover:underline"
        onClick={() => { setOpen(true); start(async () => setRes((await suggestDecisorEmails(contactId)) as any)); }}
      >
        Encontrar e-mail do decisor
      </button>
    );

  return (
    <div className="mt-2 rounded-lg border border-line bg-muted p-3">
      <p className="text-xs font-semibold">E-mail do decisor {res?.domain ? <span className="text-subtle">· {res.domain}</span> : ""}</p>
      {pending && <p className="mt-1 text-xs text-subtle">Testando as caixas… (a verificação SMTP leva alguns segundos)</p>}
      {res?.error && <p className="mt-1 text-xs text-danger">{res.error}</p>}

      {/* worker ligado: resultados JÁ verificados */}
      {res?.verificado && !pending && (
        <>
          {res.email ? (
            <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-2">
              <p className="text-[11px] text-green-700">Caixa confirmada por SMTP:</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="text-sm font-semibold text-ink">{res.email}</code>
                <button className="btn-brand py-1 text-[11px]" disabled={saving} onClick={() => usar(res.email!)}>
                  {saving ? "…" : "Usar como e-mail"}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-subtle">Nenhuma caixa foi confirmada para os padrões testados.</p>
          )}

          {res.tentativas && res.tentativas.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {res.tentativas.map((t) => (
                <li key={t.email} className="flex items-center justify-between gap-2 text-xs">
                  <code className="truncate text-ink">{t.email}</code>
                  <span className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={t.status} />
                    {t.status === "valid" && (
                      <button className="text-subtle hover:text-brand-dark" disabled={saving} onClick={() => usar(t.email)}>usar</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* worker desligado: padrões (não confirmam caixa) */}
      {res && res.verificado === false && !pending && (
        <>
          <p className="mt-1 text-[11px] text-subtle">
            Verificação de caixa (SMTP) indisponível — mostrando padrões comuns. Domínio{" "}
            {res.domainValid ? <span className="text-signal">recebe e-mail ✓</span> : <span className="text-danger">sem MX ✕</span>}.
          </p>
          <ul className="mt-1 space-y-0.5">
            {(res.candidates || []).map((e) => (
              <li key={e} className="flex items-center justify-between gap-2 text-xs">
                <code className="text-ink">{e}</code>
                <span className="flex shrink-0 gap-2">
                  <button className="text-subtle hover:text-brand-dark" disabled={saving} onClick={() => usar(e)}>usar</button>
                  <button className="text-subtle hover:text-brand-dark" onClick={() => navigator.clipboard?.writeText(e)}>copiar</button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-subtle">Dica: ative o worker de verificação (WORKER_URL) para confirmar a caixa antes de usar.</p>
        </>
      )}

      <button className="mt-2 text-xs text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
    </div>
  );
}
