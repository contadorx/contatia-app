"use client";

import { useState, useTransition } from "react";
import { saveSmtpAccount } from "@/app/dashboard/config/actions";

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
  const [pending, start] = useTransition();

  function up(k: string, v: string | number | boolean) {
    setF((s) => ({ ...s, [k]: v }));
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
      <div className="mt-4 flex gap-2">
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
