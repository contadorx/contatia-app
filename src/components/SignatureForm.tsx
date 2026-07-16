"use client";

import { useState, useRef, useTransition } from "react";
import { saveSignature } from "@/app/dashboard/config/actions";
import RichTextEditor, { type RichTextHandle } from "@/components/RichTextEditor";

const VARS = ["primeiro_nome", "empresa"];

const MODELO = `<table style="font-family:Arial,sans-serif;font-size:13px;color:#16172A"><tr>
<td style="padding-right:12px"><img src="https://SEU-DOMINIO/logo.png" alt="logo" width="48" height="48" style="border-radius:8px"></td>
<td><b>Seu Nome</b><br>Seu Cargo — {{empresa}}<br><a href="tel:+5511900000000">(11) 90000-0000</a><br><a href="https://seusite.com.br">seusite.com.br</a></td>
</tr></table>`;

export default function SignatureForm({ initial }: { initial: string }) {
  const [val, setVal] = useState(initial || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edRef = useRef<RichTextHandle>(null);

  function insertVar(v: string) {
    edRef.current?.insertText(`{{${v}}}`);
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveSignature(val);
      setMsg(res?.error ? res.error : "✓ Assinatura salva.");
    });
  }

  const preview = val
    .replace(/\{\{\s*primeiro_nome\s*\}\}/g, "João")
    .replace(/\{\{\s*empresa\s*\}\}/g, "Empresa X");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1">
        <span className="mr-1 text-xs text-subtle">Inserir:</span>
        {VARS.map((v) => (
          <button
            key={v}
            type="button"
            className="rounded-lg border border-line px-2 py-0.5 text-xs hover:bg-muted"
            onClick={() => insertVar(v)}
            title={v === "primeiro_nome" ? "Primeiro nome do contato" : "Nome da sua empresa"}
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>

      <RichTextEditor
        ref={edRef}
        value={val}
        onChange={setVal}
        minHeight={140}
        placeholder="Atenciosamente, Seu Nome — Seu Cargo — {{empresa}} — (11) 90000-0000"
      />

      {val.trim() && (
        <div className="mt-3">
          <p className="label">Prévia (como o lead vê)</p>
          <div className="mt-1 rounded-lg border border-line bg-white p-3 text-sm" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      )}

      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar assinatura"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" type="button" onClick={() => setVal(MODELO)}>
          Usar modelo com logo
        </button>
      </div>
      <p className="mt-2 text-xs text-subtle">
        Anexada automaticamente ao fim dos e-mails. Formate visualmente pelos botões, ou abra o
        <b> HTML</b> para colar/editar o código. Para logo/imagem, hospede o arquivo numa URL pública
        (seu site/CDN) — e-mail não aceita imagem do seu computador.
      </p>
    </div>
  );
}
