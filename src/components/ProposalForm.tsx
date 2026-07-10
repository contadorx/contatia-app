"use client";

import { useState, useRef, useTransition } from "react";
import { createDocument, uploadDocument } from "@/app/dashboard/propostas/actions";

export default function ProposalForm() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [name, setName] = useState("");
  const [type, setType] = useState("proposta");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName(""); setUrl(""); setType("proposta");
    if (fileRef.current) fileRef.current.value = "";
  }

  function saveLink() {
    setMsg(null);
    start(async () => {
      const res = await createDocument({ name, type, url });
      if (res?.error) setMsg(res.error);
      else { reset(); setOpen(false); }
    });
  }
  function saveUpload() {
    setMsg(null);
    const file = fileRef.current?.files?.[0];
    if (!name.trim()) return setMsg("Dê um nome ao documento.");
    if (!file) return setMsg("Selecione um arquivo PDF.");
    const fd = new FormData();
    fd.append("name", name);
    fd.append("type", type);
    fd.append("file", file);
    start(async () => {
      const res = await uploadDocument(fd);
      if (res?.error) setMsg(res.error);
      else { reset(); setOpen(false); }
    });
  }

  if (!open)
    return (
      <button className="btn-brand" onClick={() => setOpen(true)}>
        + Documento
      </button>
    );

  return (
    <div className="card p-5">
      <div className="mb-4 flex gap-2">
        <button className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "upload" ? "bg-brand text-white" : "bg-muted text-subtle"}`} onClick={() => setMode("upload")}>
          Subir PDF
        </button>
        <button className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "link" ? "bg-brand text-white" : "bg-muted text-subtle"}`} onClick={() => setMode("link")}>
          Usar link
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Nome *</label>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Proposta — Escritório X" />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="proposta">Proposta</option>
            <option value="deck">Apresentação</option>
            <option value="one-pager">One-pager</option>
            <option value="case">Case</option>
          </select>
        </div>
        {mode === "upload" ? (
          <div>
            <label className="label">Arquivo PDF *</label>
            <input ref={fileRef} type="file" accept="application/pdf" className="input mt-1 py-1.5 text-sm" />
          </div>
        ) : (
          <div>
            <label className="label">Link do documento *</label>
            <input className="input mt-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-subtle">
        {mode === "upload"
          ? "Suba o PDF (máx. 15 MB). Ele fica privado; o Contatia gera um link rastreado por destinatário que abre o arquivo."
          : "Cole o link do PDF/deck (Drive, site, etc.). O Contatia gera um link rastreado por destinatário."}
      </p>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" onClick={mode === "upload" ? saveUpload : saveLink} disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}
