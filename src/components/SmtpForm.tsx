"use client";

import { useState, useTransition } from "react";
import { saveSmtpAccount, testSmtp } from "@/app/dashboard/config/actions";

const PRESETS: { id: string; label: string; host: string; port: number; secure: boolean; hint: string }[] = [
  { id: "brevo", label: "Brevo (recomendado)", host: "smtp-relay.brevo.com", port: 587, secure: false, hint: "Usuário = e-mail de login do Brevo. Senha = chave SMTP (painel: SMTP & API → SMTP → Generate a new SMTP key). Remetente precisa ser um domínio verificado." },
  { id: "gmail_smtp", label: "Gmail (senha de app)", host: "smtp.gmail.com", port: 587, secure: false, hint: "Exige verificação em 2 etapas. Senha = senha de app (não a senha normal)." },
  { id: "outlook", label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, secure: false, hint: "Usuário = seu e-mail completo. Pode exigir SMTP AUTH habilitado no admin." },
  { id: "hostgator", label: "HostGator / cPanel", host: "mail.SEUDOMINIO.com.br", port: 465, secure: true, hint: "Troque SEUDOMINIO. Reputação/limite baixos — evite para cadência em volume; prefira o Brevo." },
];

export default function SmtpForm() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    from_email: "",
    display_name: "",
    smtp_host: "",
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: "",
    smtp_pass: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [presetHint, setPresetHint] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok?: boolean; error?: string; hint?: string } | null>(null);
  const [pending, start] = useTransition();

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) {
      setPresetHint(null);
      return;
    }
    setF((s) => ({ ...s, smtp_host: p.host, smtp_port: p.port, smtp_secure: p.secure }));
    setPresetHint(p.hint);
    setTest(null);
  }

  function up(k: string, v: string | number | boolean) {
    setF((s) => ({ ...s, [k]: v }));
    setTest(null);
  }

  function runTest() {
    setTest(null);
    setMsg(null);
    start(async () => {
      const res = await testSmtp({
        smtp_host: f.smtp_host,
        smtp_port: f.smtp_port,
        smtp_secure: f.smtp_secure,
        smtp_user: f.smtp_user,
        smtp_pass: f.smtp_pass,
      });
      if (res?.ok) setTest({ ok: true });
      else {
        const err = res?.error || "";
        let hint: string | undefined;
        if (/wrong version number|SSL routines/i.test(err))
          hint = f.smtp_secure
            ? "Descasamento SSL/porta OU a porta 465 está bloqueada na saída (comum). Se for o SMTP do seu próprio domínio, o caminho confiável é o Brevo (587, sem SSL) — clique no preset Brevo acima."
            : "Descasamento SSL/porta: marque o SSL e use a porta 465.";
        else if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|EBUSY/i.test(err))
          hint = "Host não encontrado. Confira o endereço (HostGator costuma ser mail.SEUDOMINIO; Brevo é smtp-relay.brevo.com).";
        else if (/auth|535|credential|username|password/i.test(err))
          hint = "Usuário ou senha recusados. No Gmail/Brevo use senha de app / chave SMTP, não a senha da conta.";
        else if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(err))
          hint = "Sem resposta na porta. Tente a outra porta (587 sem SSL ou 465 com SSL).";
        setTest({ error: err, hint });
      }
    });
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveSmtpAccount(f);
      if (res?.error) setMsg(res.error);
      else {
        setF({ from_email: "", display_name: "", smtp_host: "", smtp_port: 587, smtp_secure: false, smtp_user: "", smtp_pass: "" });
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        + Conectar caixa SMTP (não-Google)
      </button>
    );

  return (
    <div className="card p-5">
      <p className="mb-3 text-sm font-semibold">Caixa SMTP — Outlook, servidor próprio, ou Gmail com senha de app</p>

      <div className="mb-4 rounded-xl bg-muted p-3">
        <label className="label">Preset (preenche host/porta/SSL)</label>
        <select className="input mt-1" defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Escolher provedor…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {presetHint && <p className="mt-2 text-xs text-subtle">{presetHint}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">E-mail remetente *</label>
          <input className="input mt-1" value={f.from_email} onChange={(e) => up("from_email", e.target.value)} placeholder="voce@empresa.com.br" />
        </div>
        <div>
          <label className="label">Nome de exibição</label>
          <input className="input mt-1" value={f.display_name} onChange={(e) => up("display_name", e.target.value)} placeholder="Seu Nome" />
        </div>
        <div>
          <label className="label">Host SMTP *</label>
          <input className="input mt-1" value={f.smtp_host} onChange={(e) => up("smtp_host", e.target.value)} placeholder="smtp.empresa.com.br" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Porta</label>
            <input type="number" className="input mt-1" value={f.smtp_port} onChange={(e) => up("smtp_port", Number(e.target.value))} />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.smtp_secure} onChange={(e) => up("smtp_secure", e.target.checked)} />
              SSL (porta 465)
            </label>
          </div>
        </div>
        <div>
          <label className="label">Usuário *</label>
          <input className="input mt-1" value={f.smtp_user} onChange={(e) => up("smtp_user", e.target.value)} placeholder="geralmente o próprio e-mail" />
        </div>
        <div>
          <label className="label">Senha / senha de app</label>
          <input type="password" className="input mt-1" value={f.smtp_pass} onChange={(e) => up("smtp_pass", e.target.value)} />
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

      {test?.ok && (
        <div className="mt-3 rounded-lg bg-signal/10 p-3 text-sm text-signal">
          ✓ Conexão bem-sucedida. Pode conectar.
        </div>
      )}
      {test?.error && (
        <div className="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-danger">
          <p className="font-semibold">Falhou: {test.error}</p>
          {test.hint && <p className="mt-1 text-danger/90">→ {test.hint}</p>}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn-ghost" onClick={runTest} disabled={pending}>
          {pending ? "Testando..." : "Testar conexão"}
        </button>
        <button className="btn-brand" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Conectar"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      <p className="mt-3 text-xs text-subtle">
        Dica: no Gmail, use porta 587 e uma <b>senha de app</b> (exige verificação em 2 etapas). Para outros provedores, use os dados do seu servidor.
      </p>
    </div>
  );
}
