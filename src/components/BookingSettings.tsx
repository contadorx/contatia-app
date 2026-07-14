"use client";

import { useState, useTransition } from "react";
import { saveBookingSettings } from "@/app/dashboard/config/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

const DURATION_OPTS: SmartOption[] = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
];

const DAYS = [["1", "Seg"], ["2", "Ter"], ["3", "Qua"], ["4", "Qui"], ["5", "Sex"], ["6", "Sáb"], ["0", "Dom"]];

export function BookingSettings({ token, initial }: {
  token: string | null;
  initial: { enabled: boolean; duration: number; days: string; startHour: number; endHour: number; title: string };
}) {
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const daySet = new Set((f.days || "").split(",").filter(Boolean));

  const toggleDay = (d: string) => {
    const s = new Set(daySet);
    if (s.has(d)) s.delete(d); else s.add(d);
    setF({ ...f, days: Array.from(s).join(",") });
  };

  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/agendar/${token}` : "";

  return (
    <div className="card p-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        Ativar link público de agendamento
      </label>

      {f.enabled && (
        <div className="mt-4 grid gap-4">
          <div>
            <label className="label">Dias disponíveis</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DAYS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => toggleDay(v)}
                  className={`rounded-lg border px-3 py-1 text-xs ${daySet.has(v) ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-subtle"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Início (h)</label><input className="input mt-1" type="number" min={0} max={23} value={f.startHour} onChange={(e) => setF({ ...f, startHour: Number(e.target.value) })} /></div>
            <div><label className="label">Fim (h)</label><input className="input mt-1" type="number" min={1} max={24} value={f.endHour} onChange={(e) => setF({ ...f, endHour: Number(e.target.value) })} /></div>
            <div>
              <label className="label">Duração</label>
              <div className="mt-1">
                <SmartSelect options={DURATION_OPTS} value={String(f.duration)} onValueChange={(v) => setF({ ...f, duration: Number(v) })} />
              </div>
            </div>
          </div>
          <div><label className="label">Título da reunião</label><input className="input mt-1" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Diagnóstico gratuito" /></div>
        </div>
      )}

      {msg && <p className={`mt-3 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <button className="btn-brand mt-4 py-1.5 text-sm" disabled={pending} onClick={() => {
        setMsg(null);
        start(async () => {
          const r = (await saveBookingSettings(f)) as any;
          setMsg(r?.error ? r.error : "✓ Configuração salva.");
        });
      }}>{pending ? "Salvando..." : "Salvar"}</button>

      {f.enabled && !token && (
        <p className="mt-4 rounded-lg bg-warn/10 p-3 text-xs text-warn">
          O link será gerado assim que você salvar. Se não aparecer, recarregue a página — o token de captação do workspace está sendo preparado.
        </p>
      )}

      {f.enabled && token && (
        <div className="mt-4 rounded-lg bg-muted p-3">
          <p className="text-xs font-semibold text-subtle">SEU LINK PÚBLICO</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-ink">{url}</code>
            <button className="btn-ghost py-1 text-xs" onClick={() => navigator.clipboard?.writeText(url)}>copiar</button>
          </div>
          <p className="mt-1 text-[11px] text-subtle">Coloque na sua assinatura de e-mail, bio ou proposta. Quem abrir escolhe o horário e cai direto na sua agenda.</p>
          <p className="mt-1 text-[11px] text-signal">✓ Com o Gmail conectado, os horários já ocupados na sua agenda do Google ficam indisponíveis automaticamente.</p>
        </div>
      )}
    </div>
  );
}
