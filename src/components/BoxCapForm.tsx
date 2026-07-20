"use client";

import { useState, useTransition } from "react";
import { saveDailyCap } from "@/app/dashboard/config/actions";

const PRESETS = [40, 80, 120, 200];

// Ajuste do limite diário alvo + aquecimento, por caixa. O envio sobe gradual até o alvo.
export default function BoxCapForm({ accountId, initialCap, initialWarmup }: { accountId: string; initialCap: number; initialWarmup: boolean }) {
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState(String(initialCap || 40));
  const [warmup, setWarmup] = useState(initialWarmup);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveDailyCap(accountId, Number(cap) || 40, warmup);
      setMsg(res?.error ? res.error : "✓ Limite salvo.");
    });
  }

  if (!open) {
    return (
      <button className="mt-1 ml-3 text-xs font-medium text-subtle hover:text-brand" onClick={() => setOpen(true)}>
        ⚙ Limite diário: {initialCap || 40}/dia
      </button>
    );
  }

  const n = Number(cap) || 0;
  const alerta = n > 120; // acima disso, prospecção fria fica arriscada numa caixa só

  return (
    <div className="mt-2 rounded-xl border border-line p-3">
      <p className="label">Limite diário desta caixa (alvo)</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setCap(String(p))}
            className={`rounded-lg border px-2.5 py-1 text-xs ${String(p) === cap ? "border-brand bg-brand text-white" : "border-line hover:bg-muted"}`}>
            {p}/dia
          </button>
        ))}
        <input className="input w-24 py-1 text-sm" type="number" min={10} max={500} value={cap} onChange={(e) => setCap(e.target.value)} />
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} />
        Aquecimento gradual ligado (recomendado)
      </label>
      <p className="mt-1 text-[11px] text-subtle">
        Com o aquecimento, a caixa sobe sozinha (≈10 → … → alvo em ~14 dias). Para prospecção fria,
        o seguro é <b>50–100/dia por caixa</b>; para volume maior, prefira <b>mais caixas no rodízio</b> a
        forçar uma só.
      </p>
      {alerta && (
        <p className="mt-1 text-[11px] text-warn">⚠ Acima de 120/dia numa caixa só, o risco de cair em spam sobe — considere dividir entre caixas.</p>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <div className="mt-2 flex gap-2">
        <button className="btn-brand py-1 text-xs" onClick={save} disabled={pending}>{pending ? "Salvando..." : "Salvar"}</button>
        <button className="btn-ghost py-1 text-xs" type="button" onClick={() => setOpen(false)}>Fechar</button>
      </div>
    </div>
  );
}
