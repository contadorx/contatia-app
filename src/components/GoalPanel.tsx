"use client";

import { useState, useTransition } from "react";
import { setGoal } from "@/app/dashboard/metricas/goal-actions";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function Bar({ done, target, hue }: { done: number; target: number; hue: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <div>
      <div className="h-2.5 rounded-full bg-muted">
        <div className="h-2.5 rounded-full" style={{ width: `${pct}%`, background: hue }} />
      </div>
      <p className="mt-1 text-xs text-subtle">{target > 0 ? `${pct}% da meta` : "sem meta definida"}</p>
    </div>
  );
}

export default function GoalPanel({
  period,
  mrrTarget,
  touchTarget,
  wonMrr,
  touchesDone,
  targetUserId,
  targetName,
}: {
  period: string;
  mrrTarget: number;
  touchTarget: number;
  wonMrr: number;
  touchesDone: number;
  targetUserId?: string;
  targetName?: string;
}) {
  const [edit, setEdit] = useState(false);
  const [mrr, setMrr] = useState(String(mrrTarget || ""));
  const [touch, setTouch] = useState(String(touchTarget || ""));
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      await setGoal({ period, mrr_target: Number(mrr) || 0, touch_target: Number(touch) || 0, target_user_id: targetUserId });
      setEdit(false);
    });
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{targetName ? `Meta — ${targetName}` : "Minha meta"} · {period}</h2>
        <button className="text-xs text-subtle hover:text-brand" onClick={() => setEdit((e) => !e)}>
          {edit ? "fechar" : "definir meta"}
        </button>
      </div>

      {edit && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Meta de MRR fechado (R$)</label>
            <input type="number" className="input mt-1" value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder="5000" />
          </div>
          <div>
            <label className="label">Meta de toques</label>
            <input type="number" className="input mt-1" value={touch} onChange={(e) => setTouch(e.target.value)} placeholder="300" />
          </div>
          <div className="flex items-end">
            <button className="btn-brand" onClick={save} disabled={pending}>
              {pending ? "..." : "Salvar meta"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Receita fechada</span>
            <span className="text-sm text-subtle">{brl(wonMrr)} / {brl(mrrTarget)}</span>
          </div>
          <div className="mt-1"><Bar done={wonMrr} target={mrrTarget} hue="var(--tw-brand,#4A3AFF)" /></div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Toques no mês</span>
            <span className="text-sm text-subtle">{touchesDone} / {touchTarget || 0}</span>
          </div>
          <div className="mt-1"><Bar done={touchesDone} target={touchTarget} hue="#12B76A" /></div>
        </div>
      </div>
    </div>
  );
}
