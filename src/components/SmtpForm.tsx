"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveSmtpAccount, updateEmailAccount, testSmtp, detectProvider } from "@/app/dashboard/config/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type EditAccount = {
  id: string;
  from_email?: string | null;
  display_name?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean | null;
  smtp_user?: string | null;
  detect_replies?: boolean | null;
  imap_host?: string | null;
};

type Detected = { provider: string; label: string; smtp_host: string; smtp_port: number; smtp_secure: boolean; imap_host: string; hint: string; known: boolean };

const PRESETS: { id: string; label: string; host: string; port: number; secure: boolean; hint: string }[] = [
  { id: "brevo", label: "Brevo (recomendado)", host: "smtp-relay.brevo.com", port: 587, secure: false, hint: "Usuário = e-mail de login do Brevo. Senha = chave SMTP (painel: SMTP & API → SMTP → Generate a new SMTP key). Remetente precisa ser um domínio verificado." },
  { id: "gmail_smtp", label: "Gmail (senha de app)", host: "smtp.gmail.com", port: 587, secure: false, hint: "Exige verificação em 2 etapas. Senha = senha de app (não a senha normal)." },
  { id: "outlook", label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, secure: false, hint: "Usuário = seu e-mail completo. Pode exigir SMTP AUTH habilitado no admin." },
  { id: "hostgator", label: "HostGator / cPanel", host: "mail.SEUDOMINIO.com.br", port: 465, secure: true, hint: "Troque SEUDOMINIO. Reputação/limite baixos — evite para cadência em volume; prefira o Brevo." },
];

const PRESET_OPTS: SmartOption[] = PRESETS.map((p) => ({ value: p.id, label: p.label }));

export default function SmtpForm({ editAccount }: { editAccount?: EditAccount }) {
  const isEdit = !!editAccount;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    from_email: editAccount?.from_email || "",
    display_name: editAccount?.display_name || "",
    smtp_host: editAccount?.smtp_host || "",
    smtp_port: editAccount?.smtp_port || 587,
    smtp_secure: editAccount?.smtp_secure || false,
    smtp_user: editAccount?.smtp_user || "",
    smtp_pass: "",
    // IMAP ligado por padrão em caixa nova: pausa a cadência quando o lead responde e
    // alimenta a captura de bounce. Em edição, respeita o que já estava salvo.
    detect_replies: editAccount ? (editAccount.detect_replies ?? true) : true,
    imap_host: editAccount?.imap_host || "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [presetHint, setPresetHint] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok?: boolean; error?: string; hint?: string } | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(isEdit); // ao editar, mostra os valores reais
  const [pending, start] = useTransition();
  const [detecting, startDetect] = useTransition();

  const emptyForm = { from_email: "", display_name: "", smtp_host: "", smtp_port: 587, smtp_secure: false, smtp_user: "", smtp_pass: "", detect_replies: true, imap_host: "" };

  // Autodetecta o provedor pelo DOMÍNIO do e-mail e já preenche host/porta/SSL/IMAP.
  const lastDomain = useRef<string>(editAccount?.from_email?.split("@")[1]?.toLowerCase() || "");
  useEffect(() => {
    const email = f.from_email.trim();
    const domain = email.split("@")[1]?.toLowerCase() || "";
    if (!domain.includes(".") || domain === lastDomain.current) return;
    const t = setTimeout(() => {
      lastDomain.current = domain;
      startDetect(async () => {
        const r: any = await detectProvider(email);
        if (r?.ok && r.provider?.smtp_host) {
          const p = r.provider as Detected;
          setDetected(p);
          setF((s) => ({ ...s, smtp_host: p.smtp_host, smtp_port: p.smtp_port, smtp_secure: p.smtp_secure, imap_host: p.imap_host || s.imap_host, smtp_user: s.smtp_user || email }));
          setPresetHint(p.hint || null);
          setTest(null);
          if (!p.known) setShowAdvanced(true); // não reconhecido → pede confirmação
        }
      });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.from_email]);

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) { setPresetHint(null); return; }
    setF((s) => ({ ...s, smtp_host: p.host, smtp_port: p.port, smtp_secure: p.secure }));
    setPresetHint(p.hint);
    setDetected(null);
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
      const res = await testSmtp({ smtp_host: f.smtp_host, smtp_port: f.smtp_port, smtp_secure: f.smtp_secure, smtp_user: f.smtp_user || f.from_email, smtp_pass: f.smtp_pass });
      if (res?.ok) setTest({ ok: true });
      else {
        const err = res?.error || "";
        let hint: string | undefined;
        if (/wrong version number|SSL routines/i.test(err))
          hint = f.smtp_secure
            ? "Descasamento SSL/porta OU a porta 465 está bloqueada na saída (comum). Se for o SMTP do seu próprio domínio, o caminho confiável é o Brevo (587, sem SSL) — abra os ajustes manuais e escolha o preset Brevo."
            : "Descasamento SSL/porta: marque o SSL e use a porta 465.";
        else if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|EBUSY/i.test(err))
          hint = "Host não encontrado. Confira o endereço nos ajustes manuais.";
        else if (/auth|535|credential|username|password/i.test(err))
          hint = "Usuário ou senha recusados. No Gmail/Brevo use senha de app / chave SMTP, não a senha da conta.";
        else if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(err))
          hint = "Sem resposta na porta. Tente a outra porta (587 sem SSL ou 465 com SSL) nos ajustes manuais.";
        setTest({ error: err, hint });
        setShowAdvanced(true); // falhou → revela os campos para o usuário corrigir
      }
    });
  }

  function save() {
    setMsg(null);
    start(async () => {
      const payload = { ...f, smtp_user: f.smtp_user || f.from_email };
      const res = isEdit ? await updateEmailAccount(editAccount!.id, payload) : await saveSmtpAccount(payload);
      if (res?.error) setMsg(res.error);
      else {
        if (!isEdit) setF(emptyForm);
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className={isEdit ? "btn-ghost py-1 text-xs" : "btn-ghost"} onClick={() => setOpen(true)}>
        {isEdit ? "Editar" : "+ Conectar caixa de e-mail"}
      </button>
    );

  const knownDetected = detected?.known === true;

  return (
    <div className="card p-5">
      <p className="mb-3 text-sm font-semibold">Conectar caixa de e-mail</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">E-mail remetente *</label>
          <input className="input mt-1" value={f.from_email} onChange={(e) => up("from_email", e.target.value)} placeholder="voce@empresa.com.br" />
          {detecting && <p className="mt-1 text-xs text-subtle">detectando provedor…</p>}
          {!detecting && knownDetected && !showAdvanced && (
            <p className="mt-1 text-xs text-signal">✓ {detected!.label} detectado — configuramos host, porta e IMAP pra você.</p>
          )}
        </div>
        <div>
          <label className="label">Nome de exibição</label>
          <input className="input mt-1" value={f.display_name} onChange={(e) => up("display_name", e.target.value)} placeholder="Seu Nome" />
        </div>
        <div className={showAdvanced ? "" : "sm:col-span-2"}>
          <label className="label">Senha / senha de app</label>
          <input type="password" className="input mt-1" value={f.smtp_pass} onChange={(e) => up("smtp_pass", e.target.value)} placeholder={isEdit ? "deixe em branco para manter a atual" : ""} />
          {presetHint && !showAdvanced && <p className="mt-1 text-xs text-subtle">{presetHint}</p>}
        </div>
      </div>

      {/* Ajustes manuais — só aparecem para provedor desconhecido, ao editar, ou se você abrir. */}
      {showAdvanced && (
        <div className="mt-4 rounded-xl border border-line bg-muted/40 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Ajustes do servidor</p>
          <div className="mb-3">
            <label className="label">Preset (preenche host/porta/SSL)</label>
            <div className="mt-1">
              <SmartSelect options={PRESET_OPTS} defaultValue="" onValueChange={(v) => applyPreset(v)} placeholder="Escolher provedor…" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
              <label className="label">Usuário</label>
              <input className="input mt-1" value={f.smtp_user} onChange={(e) => up("smtp_user", e.target.value)} placeholder="em branco = o próprio e-mail" />
            </div>
          </div>
        </div>
      )}

      {/* Detecção de respostas (IMAP) */}
      <div className="mt-5 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Detecção de respostas (IMAP)</p>
            <p className="mt-0.5 text-xs text-subtle">
              Quando o lead responde, a Contatia detecta e <b>pausa a cadência</b> automaticamente — e captura bounces. Verifica a caixa uma vez por dia.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.detect_replies} onChange={(e) => up("detect_replies", e.target.checked)} />
            {f.detect_replies ? "Ativado" : "Ativar"}
          </label>
        </div>

        {f.detect_replies && (showAdvanced ? (
          <div className="mt-3 border-t border-line pt-3">
            <label className="label">Host IMAP</label>
            <input className="input mt-1" value={f.imap_host} onChange={(e) => up("imap_host", e.target.value)} placeholder="ex.: imap.empresa.com.br" />
            <p className="mt-1 text-xs text-subtle">Em branco, usa o host do SMTP na <b>porta 993 (SSL)</b> com o mesmo usuário e senha.</p>
            <div className="mt-2 rounded-lg bg-warn/10 p-2.5 text-xs text-warn">
              ⚠ Só funciona em caixas que <b>recebem</b> e-mail. Envio puro (ex.: Brevo) não tem IMAP — aponte para a caixa real que recebe as respostas.
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-subtle">Respostas verificadas em <b>{f.imap_host || "(host do e-mail)"}</b>.</p>
        ))}
      </div>

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

      {test?.ok && <div className="mt-3 rounded-lg bg-signal/10 p-3 text-sm text-signal">✓ Conexão bem-sucedida. Pode conectar.</div>}
      {test?.error && (
        <div className="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-danger">
          <p className="font-semibold">Falhou: {test.error}</p>
          {test.hint && <p className="mt-1 text-danger/90">→ {test.hint}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={runTest} disabled={pending}>{pending ? "Testando..." : "Testar conexão"}</button>
        <button className="btn-brand" onClick={save} disabled={pending}>{pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Conectar"}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
        {!showAdvanced && (
          <button type="button" className="ml-auto text-xs text-subtle hover:text-brand" onClick={() => setShowAdvanced(true)}>
            Ajustar host/porta manualmente
          </button>
        )}
      </div>
    </div>
  );
}
