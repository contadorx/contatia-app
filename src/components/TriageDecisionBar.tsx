"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { INTENT_LABEL, type ReplyIntent } from "@/lib/replyIntent";
import { triageSuppress, triageEnroll, triageRetomada, triageDismiss } from "@/app/dashboard/triagem/actions";

type Item = { id: string; intent: ReplyIntent };
type Seq = { id: string; name: string };

const INTENT_STYLE: Record<string, string> = {
  parar: "bg-danger/10 text-danger",
  adiar: "bg-warn/15 text-warn",
  interesse: "bg-signal/15 text-signal",
  outro: "bg-muted text-subtle",
};

// Barra de decisão da triagem, embutida na conversa (Respostas). Mesma lógica da
// antiga tela de Triagem: suprimir · inscrever (encerra a atual) · anotar retomada · ignorar.
export default function TriageDecisionBar({ item, sequences, name }: { item: Item; sequences: Seq[]; name: string }) {
  const router = useRouter();
  const [seq, setSeq] = useState("");
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seqOpts: SmartOption[] = sequences.map((s) => ({ value: s.id, label: s.name }));

  function run(fn: () => Promise<any>) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="border-b border-warn/30 bg-warn/5 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-warn">Precisa de decisão</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INTENT_STYLE[item.intent] || INTENT_STYLE.outro}`}>
          {INTENT_LABEL[item.intent]}
        </span>
        <span className="text-[11px] text-subtle">a palavra-chave sugere — a decisão é sua</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <button
          className="rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
          disabled={pending}
          onClick={() => { if (confirm(`Suprimir ${name}? Encerra tudo e o contato para de receber automações (definitivo).`)) run(() => triageSuppress(item.id)); }}
        >
          Suprimir
        </button>
        <div style={{ minWidth: 170 }}>
          <SmartSelect className="py-1 text-xs" options={seqOpts} value={seq} onValueChange={setSeq} placeholder="Cadência…" clearable />
        </div>
        <button
          className="rounded-lg border border-brand/40 px-2.5 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-40"
          disabled={pending || !seq}
          onClick={() => run(() => triageEnroll(item.id, seq, { endCurrent: true, setState: "em_A" }))}
          title="Encerra a cadência atual e inscreve na escolhida"
        >
          Inscrever
        </button>
        <input type="date" className="input py-1 text-xs" style={{ width: 140 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          className="rounded-lg border border-warn/50 px-2.5 py-1 text-xs font-semibold text-warn hover:bg-warn/10 disabled:opacity-40"
          disabled={pending || !seq || !date}
          onClick={() => run(() => triageRetomada(item.id, seq, date))}
          title="Anota a retomada, encerra a atual e inscreve na cadência escolhida"
        >
          Anotar retomada
        </button>
        <button className="ml-auto text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => run(() => triageDismiss(item.id))}>
          ignorar
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}
