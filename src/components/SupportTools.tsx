"use client";

import { useState, useTransition } from "react";
import { openTicket, sendTicketMessage, setTicketStatus } from "@/app/dashboard/suporte/actions";

const ST: Record<string, { l: string; c: string }> = {
  open: { l: "Aberto", c: "bg-brand-soft text-brand-dark" },
  pending: { l: "Aguardando você", c: "bg-warn/10 text-warn" },
  resolved: { l: "Resolvido", c: "bg-signal/10 text-signal" },
  closed: { l: "Fechado", c: "bg-muted text-subtle" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = ST[status] || ST.open;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.c}`}>{s.l}</span>;
}

export function OpenTicketForm() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: "", body: "", priority: "normal" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (!open) return <button className="btn-brand" onClick={() => setOpen(true)}>+ Abrir chamado</button>;

  return (
    <div className="card p-5">
      <div className="grid gap-3">
        <div><label className="label">Assunto *</label><input className="input mt-1" value={f.subject} onChange={(e) => up("subject", e.target.value)} placeholder="Resumo do problema" /></div>
        <div>
          <label className="label">Prioridade</label>
          <select className="input mt-1" style={{ width: 160 }} value={f.priority} onChange={(e) => up("priority", e.target.value)}>
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
        </div>
        <div><label className="label">Mensagem *</label><textarea className="input mt-1 min-h-[120px]" value={f.body} onChange={(e) => up("body", e.target.value)} placeholder="Descreva o que está acontecendo, com o máximo de detalhe." /></div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" disabled={pending} onClick={() => start(async () => {
          const res = (await openTicket(f)) as { ok?: boolean; error?: string };
          if (res?.error) setMsg(res.error);
          else { setF({ subject: "", body: "", priority: "normal" }); setOpen(false); }
        })}>{pending ? "Enviando..." : "Abrir chamado"}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export function ReplyBox({ ticketId, staff }: { ticketId: string; staff?: boolean }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <textarea className="input min-h-[80px] text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder={staff ? "Responder ao cliente…" : "Escreva sua resposta…"} />
      <button
        className="btn-brand mt-2 py-1.5 text-sm"
        disabled={pending || !body.trim()}
        onClick={() => start(async () => { await sendTicketMessage(ticketId, body); setBody(""); })}
      >
        {pending ? "Enviando..." : "Enviar"}
      </button>
    </div>
  );
}

export function StatusControl({ ticketId, status }: { ticketId: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      className="input py-1 text-xs"
      style={{ width: 160 }}
      value={status}
      disabled={pending}
      onChange={(e) => start(async () => void (await setTicketStatus(ticketId, e.target.value)))}
    >
      <option value="open">Aberto</option>
      <option value="pending">Aguardando cliente</option>
      <option value="resolved">Resolvido</option>
      <option value="closed">Fechado</option>
    </select>
  );
}
