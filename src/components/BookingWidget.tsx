"use client";

import { useState, useTransition } from "react";
import { createBooking } from "@/app/agendar/[token]/actions";

type Slots = { date: string; times: { iso: string; label: string }[] }[];

export function BookingWidget({ token, slots }: { token: string; slots: Slots }) {
  const [picked, setPicked] = useState<{ iso: string; label: string; date: string } | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", note: "" });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (done) {
    return (
      <div className="rounded-xl bg-signal/10 p-6 text-center">
        <p className="font-display text-lg font-bold text-signal">✓ Reunião agendada!</p>
        <p className="mt-1 text-sm text-ink">{done}</p>
        <p className="mt-2 text-xs text-subtle">Você recebe os detalhes por e-mail. Até lá!</p>
      </div>
    );
  }

  if (!slots.length) {
    return <p className="rounded-lg bg-muted p-4 text-center text-sm text-subtle">Nenhum horário disponível nos próximos dias. Tente novamente mais tarde.</p>;
  }

  // passo 2: dados
  if (picked) {
    return (
      <div>
        <button className="text-xs text-brand-dark hover:underline" onClick={() => setPicked(null)}>← trocar horário</button>
        <div className="mt-2 rounded-lg bg-brand-soft p-3 text-sm">
          <p className="font-semibold text-brand-dark capitalize">{picked.date}</p>
          <p className="text-brand-dark">às {picked.label}</p>
        </div>
        <div className="mt-4 grid gap-3">
          <div><label className="label">Seu nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} /></div>
          <div><label className="label">Seu e-mail *</label><input className="input mt-1" type="email" value={f.email} onChange={(e) => up("email", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Telefone</label><input className="input mt-1" value={f.phone} onChange={(e) => up("phone", e.target.value)} /></div>
            <div><label className="label">Empresa</label><input className="input mt-1" value={f.company} onChange={(e) => up("company", e.target.value)} /></div>
          </div>
          <div><label className="label">Assunto (opcional)</label><textarea className="input mt-1 min-h-[70px]" value={f.note} onChange={(e) => up("note", e.target.value)} placeholder="Sobre o que você quer conversar?" /></div>
        </div>
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        <button className="btn-brand mt-4 w-full" disabled={pending} onClick={() => {
          setErr(null);
          start(async () => {
            const r = (await createBooking(token, { ...f, datetime: picked.iso })) as any;
            if (r?.error) setErr(r.error);
            else setDone(r.whenLabel);
          });
        }}>{pending ? "Agendando..." : "Confirmar agendamento"}</button>
      </div>
    );
  }

  // passo 1: escolher horário
  return (
    <div className="space-y-4">
      {slots.map((day) => (
        <div key={day.date}>
          <p className="mb-1.5 text-sm font-semibold capitalize">{day.date}</p>
          <div className="flex flex-wrap gap-2">
            {day.times.map((t) => (
              <button
                key={t.iso}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-brand hover:bg-brand-soft"
                onClick={() => setPicked({ iso: t.iso, label: t.label, date: day.date })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
