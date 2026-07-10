"use client";

import { useState, useRef, useTransition } from "react";
import { saveSignature } from "@/app/dashboard/config/actions";

const VARS = ["primeiro_nome", "empresa"];

export default function SignatureForm({ initial }: { initial: string }) {
  const [val, setVal] = useState(initial || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  function insertVar(v: string) {
    const el = ref.current;
    const token = `{{${v}}}`;
    if (!el) {
      setVal((s) => s + token);
      return;
    }
    const s = el.selectionStart ?? val.length;
    const e = el.selectionEnd ?? val.length;
    const next = val.slice(0, s) + token + val.slice(e);
    setVal(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + token.length;
    });
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveSignature(val);
      setMsg(res?.error ? res.error : "✓ Assinatura salva.");
    });
  }

  const preview = val.replace(/\{\{\s*primeiro_nome\s*\}\}/g, "João").replace(/\{\{\s*empresa\s*\}\}/g, "Empresa X");
  const isHtml = /<[a-z][\s\S]*>/i.test(val);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">Inserir:</span>
        {VARS.map((v) => (
          <button key={v} className="rounded-lg border border-line px-2 py-0.5 text-xs hover:bg-muted" onClick={() => insertVar(v)}>
            {`{{${v}}}`}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        className="input min-h-[120px] text-sm"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={"Atenciosamente,\nSeu Nome\nSeu Cargo — {{empresa}}\n(11) 90000-0000"}
      />
      {val.trim() && (
        <div className="mt-3">
          <p className="label">Prévia {isHtml && <span className="text-signal">(HTML)</span>}</p>
          {isHtml ? (
            <div className="mt-1 rounded-lg border border-line bg-white p-3 text-sm" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs text-ink/80">{preview}</pre>
          )}
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar assinatura"}
        </button>
        <button
          className="btn-ghost py-1.5 text-sm"
          onClick={() => setVal(`<table style="font-family:Arial,sans-serif;font-size:13px;color:#16172A"><tr>
<td style="padding-right:12px"><img src="https://SEU-DOMINIO/logo.png" alt="logo" width="48" height="48" style="border-radius:8px"></td>
<td><b>Seu Nome</b><br>Seu Cargo — {{empresa}}<br><a href="tel:+5511900000000">(11) 90000-0000</a><br><a href="https://seusite.com.br">seusite.com.br</a></td>
</tr></table>`)}
        >
          Inserir modelo HTML com logo
        </button>
      </div>
      <p className="mt-2 text-xs text-subtle">
        Anexada automaticamente ao fim dos e-mails. Aceita <b>HTML</b> — cole tags para logo/imagem (<code>&lt;img src=&quot;https://…&quot;&gt;</code>), links e formatação. Hospede a imagem numa URL pública (seu site/CDN). Se usar só texto, funciona normalmente.
      </p>
    </div>
  );
}
