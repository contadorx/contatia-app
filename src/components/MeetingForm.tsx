"use client";

import { useState, useTransition } from "react";
import { scheduleMeeting } from "@/app/dashboard/reunioes/actions";

type Contact = { id: string; name: string };

export default function MeetingForm({ contacts }: { contacts: Contact[] }) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [r24, setR24] = useState(true);
  const [r1, setR1] = useState(true);
  const [chEmail, setChEmail] = useState(true);
  const [chWa, setChWa] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    const channels: ("email" | "whatsapp")[] = [];
    if (chEmail) channels.push("email");
    if (chWa) channels.push("whatsapp");
    start(async () => {
      const res = await scheduleMeeting({
        contact_id: contactId,
        title,
        datetime,
        remind_24h: r24,
        remind_1h: r1,
        channels,
      });
      if (res?.error) setMsg(res.error);
      else {
        setContactId("");
        setTitle("");
        setDatetime("");
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className="btn-brand" onClick={() => setOpen(true)}>
        + Agendar reunião
      </button>
    );

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Contato *</label>
          <select className="input mt-1" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Selecione…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Título</label>
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Apresentação da proposta" />
        </div>
        <div>
          <label className="label">Data e hora *</label>
          <input type="datetime-local" className="input mt-1" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
        </div>
        <div>
          <label className="label">Lembretes</label>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={r24} onChange={(e) => setR24(e.target.checked)} /> 24h antes</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={r1} onChange={(e) => setR1(e.target.checked)} /> 1h antes</label>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={chEmail} onChange={(e) => setChEmail(e.target.checked)} /> E-mail</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={chWa} onChange={(e) => setChWa(e.target.checked)} /> WhatsApp</label>
          </div>
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" onClick={save} disabled={pending}>
          {pending ? "Agendando..." : "Agendar + criar lembretes"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      <p className="mt-3 text-xs text-subtle">Os lembretes viram toques na sua fila do &ldquo;Hoje&rdquo; nas datas certas, pedindo confirmação (reduz no-show).</p>
    </div>
  );
}
