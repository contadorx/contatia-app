"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { INTENT_LABEL, type ReplyIntent } from "@/lib/replyIntent";
import { triageSuppress, triageEnroll, triageRetomada, triageDismiss } from "@/app/dashboard/triagem/actions";

type Item = { id: string; contactId: string; channel: string; text: string; intent: ReplyIntent; createdAt: string; name: string };
type Seq = { id: string; name: string };

const INTENT_STYLE: Record<string, string> = {
  parar: "bg-danger/10 text-danger",
  adiar: "bg-warn/15 text-warn",
  interesse: "bg-signal/15 text-signal",
  outro: "bg-muted text-subtle",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function TriageInbox({ items, sequences }: { items: Item[]; sequences: Seq[] }) {
  const router = useRouter();
  const [seqBy, setSeqBy] = useState<Record<string, string>>({});
  const [dateBy, setDateBy] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const seqOpts: SmartOption[] = sequences.map((s) => ({ value: s.id, label: s.name }));

  function run(id: string, fn: () => Promise<any>) {
    setErr(null);
    setBusy(id);
    start(async () => {
      const res = await fn();
      setBusy(null);
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  if (!items.length) {
    return <div className="card p-10 text-center text-sm text-subtle">Nada na fila. Quando um contato responder, a resposta aparece aqui classificada para você decidir.</div>;
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-sm text-danger">{err}</p>}
      {items.map((it) => {
        const seq = seqBy[it.id] || "";
        const date = dateBy[it.id] || "";
        const isBusy = pending && busy === it.id;
        return (
          <div key={it.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${it.channel === "email" ? "bg-brand-soft text-brand-dark" : "bg-signal/15 text-signal"}`}>
                  {it.channel === "email" ? "E-MAIL" : "WA"}
                </span>
                <Link href={`/dashboard/contatos/${it.contactId}`} className="font-semibold text-brand-dark hover:underline">{it.name}</Link>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INTENT_STYLE[it.intent] || INTENT_STYLE.outro}`}>
                  {INTENT_LABEL[it.intent]}
                </span>
              </div>
              <span className="text-xs text-subtle">{fmt(it.createdAt)}</span>
            </div>

            {it.text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-2 text-sm text-ink/80">&ldquo;{it.text}&rdquo;</p>}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              {/* Suprimir */}
              <button
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${it.intent === "parar" ? "bg-danger text-white" : "border border-danger/40 text-danger hover:bg-danger/10"}`}
                disabled={isBusy}
                onClick={() => { if (confirm(`Suprimir ${it.name}? Encerra tudo e o contato para de receber qualquer automação (definitivo).`)) run(it.id, () => triageSuppress(it.id)); }}
              >
                Suprimir
              </button>

              {/* Cadência (para inscrever/adiar) */}
              <div style={{ minWidth: 190 }}>
                <SmartSelect className="py-1.5 text-sm" options={seqOpts} value={seq} onValueChange={(v) => setSeqBy((s) => ({ ...s, [it.id]: v }))} placeholder="Escolha a cadência…" clearable />
              </div>

              {/* Aprofundar / inscrever (transição limpa) */}
              <button
                className="rounded-lg border border-brand/40 px-3 py-1.5 text-sm font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-40"
                disabled={isBusy || !seq}
                onClick={() => run(it.id, () => triageEnroll(it.id, seq, { endCurrent: true, setState: "em_A" }))}
                title="Encerra a cadência atual e inscreve na escolhida"
              >
                Inscrever
              </button>

              {/* Adiar: data + anotar retomada */}
              <input
                type="date"
                className="input py-1.5 text-sm"
                style={{ width: 150 }}
                value={date}
                onChange={(e) => setDateBy((s) => ({ ...s, [it.id]: e.target.value }))}
              />
              <button
                className="rounded-lg border border-warn/50 px-3 py-1.5 text-sm font-semibold text-warn hover:bg-warn/10 disabled:opacity-40"
                disabled={isBusy || !seq || !date}
                onClick={() => run(it.id, () => triageRetomada(it.id, seq, date))}
                title="Anota a data de retomada, encerra a atual e inscreve na cadência escolhida"
              >
                Anotar retomada
              </button>

              {/* Ignorar */}
              <button className="ml-auto text-xs text-subtle hover:text-ink" disabled={isBusy} onClick={() => run(it.id, () => triageDismiss(it.id))}>
                ignorar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
