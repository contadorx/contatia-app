"use client";

import { useState, useRef, useTransition } from "react";
import { saveBoxSignature } from "@/app/dashboard/config/actions";
import RichTextEditor, { type RichTextHandle } from "@/components/RichTextEditor";

// Assinatura de UMA caixa. Colapsada por padrão. Vazia = usa a assinatura geral.
export default function BoxSignatureForm({ accountId, initial }: { accountId: string; initial: string }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(initial || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edRef = useRef<RichTextHandle>(null);

  const temPropria = (initial || "").trim().length > 0;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveBoxSignature(accountId, val);
      setMsg(res?.error ? res.error : "✓ Assinatura desta caixa salva.");
    });
  }

  if (!open) {
    return (
      <button className="mt-1 text-xs font-medium text-subtle hover:text-brand" onClick={() => setOpen(true)}>
        ✎ Assinatura desta caixa {temPropria ? "(própria)" : "(usa a geral)"}
      </button>
    );
  }

  const preview = val.replace(/\{\{\s*primeiro_nome\s*\}\}/g, "João").replace(/\{\{\s*empresa\s*\}\}/g, "Empresa X");

  return (
    <div className="mt-2 rounded-xl border border-line p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="label">Assinatura desta caixa</p>
        <div className="flex gap-1">
          <button type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs hover:bg-muted" onClick={() => edRef.current?.insertText("{{primeiro_nome}}")}>{`{{primeiro_nome}}`}</button>
          <button type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs hover:bg-muted" onClick={() => edRef.current?.insertText("{{empresa}}")}>{`{{empresa}}`}</button>
        </div>
      </div>
      <RichTextEditor ref={edRef} value={val} onChange={setVal} minHeight={110} placeholder="Assinatura só desta caixa. Deixe em branco para usar a assinatura geral do workspace." />
      {val.trim() && (
        <div className="mt-2">
          <p className="label">Prévia</p>
          <div className="mt-1 rounded-lg border border-line bg-white p-3 text-sm" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn-brand py-1 text-xs" onClick={save} disabled={pending}>{pending ? "Salvando..." : "Salvar"}</button>
        <button className="btn-ghost py-1 text-xs" type="button" onClick={() => setOpen(false)}>Fechar</button>
        {temPropria && (
          <button className="text-xs text-subtle hover:text-danger" type="button" onClick={() => { setVal(""); }}>
            limpar (voltar a usar a geral)
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-subtle">Se ficar em branco, os e-mails desta caixa usam a assinatura geral do workspace.</p>
    </div>
  );
}
