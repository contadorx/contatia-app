"use client";

import { useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { scheduleMeeting } from "@/app/dashboard/reunioes/actions";

// Marcar reunião direto na ficha do contato (contato já fixo — sem re-selecionar).
export default function ScheduleMeetingForContact({ contactId, contactName }: { contactId: string; contactName: string }) {
  const [open, setOpen] = useState(false);
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
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    const channels: ("email" | "whatsapp")[] = [];
    if (chEmail) channels.push("email");
    if (chWa) channels.push("whatsapp");
    start(async () => {
      const res: any = await scheduleMeeting({
        contact_id: contactId,
        title,
        datetime,
        duration_min: Number(duration),
        location,
        notes,
        remind_24h: r24,
        remind_1h: r1,
        channels,
      });
      if (res?.error) setMsg(res.error);
      else { setOpen(false); setTitle(""); setDatetime(""); setLocation(""); setNotes(""); }
    });
  }

  return (
    <>
      <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(true)}>📅 Marcar reunião</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Marcar reunião — {contactName}</h3>
              <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
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
              <div className="sm:col-span-2">
                <label className="label">Local / link</label>
                <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Google Meet, Zoom, endereço…" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Pauta / preparação (opcional)</label>
                <textarea className="input mt-1 min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="O que levar, objeções esperadas, próximo passo…" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Lembretes</label>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={r24} onChange={(e) => setR24(e.target.checked)} /> 24h antes</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={r1} onChange={(e) => setR1(e.target.checked)} /> 1h antes</label>
                  <span className="text-subtle">·</span>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={chEmail} onChange={(e) => setChEmail(e.target.checked)} /> E-mail</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={chWa} onChange={(e) => setChWa(e.target.checked)} /> WhatsApp</label>
                </div>
              </div>
            </div>

            {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

            <div className="mt-4 flex gap-2">
              <button className="btn-brand" onClick={save} disabled={pending || !datetime}>
                {pending ? "Agendando…" : "Agendar + criar lembretes"}
              </button>
              <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            </div>
            <p className="mt-3 text-xs text-subtle">Os lembretes viram tarefas na sua fila do “Hoje”, pedindo confirmação (reduz faltas).</p>
          </div>
        </div>
      )}
    </>
  );
}
