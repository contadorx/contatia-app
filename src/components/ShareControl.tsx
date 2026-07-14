"use client";

import { useState, useTransition } from "react";
import { createShare } from "@/app/dashboard/propostas/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type Contact = { id: string; name: string };

export default function ShareControl({ documentId, contacts }: { documentId: string; contacts: Contact[] }) {
  const [contactId, setContactId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function generate() {
    setMsg(null);
    setLink(null);
    start(async () => {
      const res = (await createShare(documentId, contactId)) as { token?: string; error?: string };
      if (res?.error) setMsg(res.error);
      else if (res?.token) setLink(`${window.location.origin}/s/${res.token}`);
    });
  }
  function copy() {
    if (link) {
      navigator.clipboard?.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const selName = contacts.find((c) => c.id === contactId)?.name;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <SmartSelect
        className="max-w-[200px] py-1.5 text-sm"
        placeholder="Gerar link para…"
        value={contactId}
        onValueChange={(v) => setContactId(v)}
        options={contacts.map((c): SmartOption => ({ value: c.id, label: c.name }))}
      />
      <button className="btn-ghost py-1.5 text-sm" onClick={generate} disabled={pending || !contactId}>
        {pending ? "..." : selName ? `Gerar link para ${selName}` : "Gerar link"}
      </button>
      {link && (
        <div className="flex items-center gap-2">
          <input className="input w-64 py-1.5 text-xs" value={link} readOnly onFocus={(e) => e.target.select()} />
          <button className="btn-brand py-1.5 text-xs" onClick={copy}>
            {copied ? "Copiado!" : "Copiar"}
          </button>
        </div>
      )}
      {msg && <span className="text-xs text-danger">{msg}</span>}
      <p className="basis-full text-[11px] text-subtle">Cada contato recebe um link único; você é avisado quando ele abrir (o contato fica quente).</p>
    </div>
  );
}
