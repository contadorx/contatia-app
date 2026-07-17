"use client";

import { useState, useTransition } from "react";
import { saveBusinessMessage } from "@/app/dashboard/superadmin/comunicacao/actions";

type Msg = {
  key: string;
  track: "comunicacao" | "cobranca";
  label: string;
  enabled: boolean;
  trigger_days: number;
  subject: string;
  body: string;
};

export default function ReguaEditor({ messages }: { messages: Msg[] }) {
  const [track, setTrack] = useState<"comunicacao" | "cobranca">("comunicacao");
  const list = messages.filter((m) => m.track === track);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(["comunicacao", "cobranca"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTrack(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${track === t ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}
          >
            {t === "comunicacao" ? "Ciclo de vida" : "Cobrança (vencidos)"}
          </button>
        ))}
      </div>

      {track === "cobranca" && (
        <p className="mb-3 rounded-lg bg-warn/10 p-3 text-xs text-warn">
          Régua pró-ativa por fatura: avisa a <b>criação da fatura</b>, manda <b>preventivos antes de vencer</b> (D-3, D-1)
          e cobra <b>após o vencimento</b> (D+1, D+5, D+10). Na última etapa a conta é <b>suspensa automaticamente</b>.
          Use os tokens <code>{"{{link}}"}</code> (pagamento), <code>{"{{valor}}"}</code> e <code>{"{{venc}}"}</code>.
        </p>
      )}

      <div className="space-y-3">
        {list.map((m) => (
          <MsgCard key={m.key} m={m} />
        ))}
      </div>
    </div>
  );
}

function quando(track: string, key: string, n: number): string {
  if (track !== "cobranca") return `a partir de ${n} dia(s)`;
  if (key === "bill_created") return "ao criar a fatura";
  if (n < 0) return `${-n} dia(s) antes de vencer`;
  if (n === 0) return "no dia do vencimento";
  return `${n} dia(s) de atraso`;
}

function MsgCard({ m }: { m: Msg }) {
  const [enabled, setEnabled] = useState(m.enabled);
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [days, setDays] = useState(String(m.trigger_days));
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const r = (await saveBusinessMessage(m.key, {
        enabled,
        subject,
        body,
        trigger_days: Number(days) || 0,
      })) as any;
      setMsg(r?.error ? r.error : "✓ Salvo.");
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{m.label}</p>
          <p className="text-xs text-subtle">
            {quando(m.track, m.key, Number(days) || 0)} ·{" "}
            <span className={enabled ? "text-signal" : "text-subtle"}>{enabled ? "ativa" : "desligada"}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              disabled={pending}
              onChange={(e) => {
                const v = e.target.checked;
                setEnabled(v);
                start(async () => { const r = (await saveBusinessMessage(m.key, { enabled: v })) as any; setMsg(r?.error ? r.error : null); });
              }}
            /> ativa
          </label>
          <button className="text-xs text-brand hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? "fechar" : "editar"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <label className="label">
              {m.track === "cobranca" ? "Gatilho (negativo = antes de vencer; positivo = após)" : "A partir de (dias)"}
            </label>
            <input className="input w-24 text-sm" type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          {m.track === "cobranca" && m.key !== "bill_created" && (
            <p className="text-[11px] text-subtle">Ex.: <b>-3</b> = 3 dias antes de vencer · <b>1</b> = 1 dia após vencer.</p>
          )}
          <div>
            <label className="label block">Assunto</label>
            <input className="input mt-1 text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="label block">Texto do e-mail</label>
            <textarea className="input mt-1 min-h-[180px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button>
            {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
