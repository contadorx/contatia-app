"use client";

import { useState, useTransition } from "react";
import { createDocument } from "@/app/dashboard/propostas/actions";

export default function ProposalForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("proposta");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await createDocument({ name, type, url });
      if (res?.error) setMsg(res.error);
      else {
        setName("");
        setUrl("");
        setType("proposta");
        setOpen(false);
      }
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
        <div>
          <label className="label">Link do documento *</label>
          <input className="input mt-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <p className="mt-2 text-xs text-subtle">Cole o link do PDF/deck (Drive, site, etc.). O Contatia gera um link rastreado por destinatário.</p>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
