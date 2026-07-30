"use client";

import { useState, useTransition } from "react";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { scheduleMeeting } from "@/app/dashboard/reunioes/actions";

type Contact = { id: string; name: string };

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function MeetingForm({ contacts }: { contacts: Contact[] }) {
  const [open, setOpen] = useState(false);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [guests, setGuests] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState("");
  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [r24, setR24] = useState(true);
  const [r1, setR1] = useState(true);
  const [chEmail, setChEmail] = useState(true);
  const [chWa, setChWa] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nameById = new Map(contacts.map((c) => [c.id, c.name]));
  const disponiveis = contacts.filter((c) => !contactIds.includes(c.id));

  function addContact(id: string) {
    if (id && !contactIds.includes(id)) setContactIds((v) => [...v, id]);
  }
  function addGuest() {
    const e = guestInput.trim().toLowerCase();
    if (!e) return;
    if (!emailRe.test(e)) { setMsg("E-mail de convidado inválido."); return; }
    if (!guests.includes(e)) setGuests((v) => [...v, e]);
    setGuestInput("");
    setMsg(null);
  }

  function save() {
    setMsg(null); setOk(null);
    if (!contactIds.length && !guests.length) { setMsg("Escolha ao menos um contato ou informe um convidado por e-mail."); return; }
    if (!datetime) { setMsg("Defina data e hora."); return; }
    const channels: ("email" | "whatsapp")[] = [];
    if (chEmail) channels.push("email");
    if (chWa) channels.push("whatsapp");
    start(async () => {
      const res: any = await scheduleMeeting({
        contact_ids: contactIds,
        guest_emails: guests,
        title, datetime,
        duration_min: Number(duration),
        location, notes,
        remind_24h: r24, remind_1h: r1, channels,
      });
      if (res?.error) { setMsg(res.error); return; }
      // sucesso: feedback sobre o convite
      if (res?.conviteEnviado) setOk(`Reunião agendada e convite de agenda enviado para ${res.convidados} convidado(s).`);
      else if (res?.conviteErro) setOk(`Reunião agendada. ${res.conviteErro}`);
      else setOk("Reunião agendada.");
      setContactIds([]); setGuests([]); setGuestInput("");
      setTitle(""); setDatetime(""); setLocation(""); setNotes("");
      setOpen(false);
    });
  }

  if (!open)
    return (
      <div>
        <button className="btn-brand" onClick={() => { setOpen(true); setOk(null); }}>+ Agendar reunião</button>
        {ok && <p className="mt-2 text-sm text-signal">{ok}</p>}
      </div>
    );

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Convidados *</label>
          {/* chips dos escolhidos */}
          {(contactIds.length > 0 || guests.length > 0) && (
            <div className="mt-1 mb-2 flex flex-wrap gap-1.5">
              {contactIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">
                  {nameById.get(id) || "Contato"}
                  <button type="button" onClick={() => setContactIds((v) => v.filter((x) => x !== id))} aria-label="remover">×</button>
                </span>
              ))}
              {guests.map((e) => (
                <span key={e} className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">
                  {e}
                  <button type="button" onClick={() => setGuests((v) => v.filter((x) => x !== e))} aria-label="remover">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <SmartSelect
              placeholder="Adicionar contato…"
              value=""
              onValueChange={addContact}
              options={disponiveis.map((c): SmartOption => ({ value: c.id, label: c.name }))}
            />
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={guestInput}
                onChange={(e) => setGuestInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGuest(); } }}
                placeholder="convidado@email.com"
                type="email"
              />
              <button type="button" className="btn-ghost whitespace-nowrap" onClick={addGuest}>+ Convidado</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-subtle">Adicione quantos quiser. O convidado por e-mail não precisa estar cadastrado.</p>
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
          <label className="label">Duração</label>
          <SmartSelect
            className="mt-1"
            value={duration}
            onValueChange={setDuration}
            options={[
              { value: "15", label: "15 min" },
              { value: "30", label: "30 min" },
              { value: "45", label: "45 min" },
              { value: "60", label: "1 hora" },
            ]}
          />
        </div>
        <div>
          <label className="label">Local / link</label>
          <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Google Meet, Zoom, endereço…" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Pauta / preparação (opcional)</label>
          <textarea className="input mt-1 min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="O que levar, objeções esperadas, próximo passo desejado…" />
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
          {pending ? "Agendando..." : "Agendar + enviar convite"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      <p className="mt-3 text-xs text-subtle">O convite vai por e-mail com anexo de agenda (.ics) — o convidado aceita e trava na agenda dele. Os lembretes viram tarefas na sua fila do &ldquo;Hoje&rdquo;.</p>
    </div>
  );
}
