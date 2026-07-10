"use client";

import { useState, useTransition } from "react";
import { createSequence, generateSequenceAI, type StepInput } from "@/app/dashboard/cadencias/actions";
import type { Channel } from "@/lib/cadence";

const CHANNELS: { v: Channel; l: string }[] = [
  { v: "email", l: "E-mail" },
  { v: "whatsapp", l: "WhatsApp" },
  { v: "call", l: "Ligação" },
  { v: "linkedin", l: "LinkedIn" },
];

const emptyStep = (): StepInput => ({ channel: "email", delay_days: 0, subject: "", body: "" });

export default function SequenceBuilder() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");
  const [steps, setSteps] = useState<StepInput[]>([emptyStep()]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // IA
  const [aiOpen, setAiOpen] = useState(false);
  const [market, setMarket] = useState("");
  const [product, setProduct] = useState("");
  const [icp, setIcp] = useState("");
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();

  function generateAI() {
    setAiMsg(null);
    startAi(async () => {
      const res = (await generateSequenceAI({ market, product, icp })) as { steps?: StepInput[]; error?: string };
      if (res?.error) setAiMsg(res.error);
      else if (res?.steps?.length) {
        setSteps(res.steps);
        if (!name && market) setName(`Cadência — ${market}`.slice(0, 60));
        setAiOpen(false);
      }
    });
  }

  function update(i: number, patch: Partial<StepInput>) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }
  function add() {
    setSteps((s) => [...s, { ...emptyStep(), delay_days: 2 }]);
  }
  function remove(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = await createSequence({ name, audience, steps });
      if (res?.error) setMsg(res.error);
      else {
        setName("");
        setAudience("");
        setSteps([emptyStep()]);
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className="btn-brand" onClick={() => setOpen(true)}>
        + Nova sequência
      </button>
    );

  return (
    <div className="card p-5">
      {/* Gerar com IA */}
      <div className="mb-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-4">
        {!aiOpen ? (
          <button className="btn-brand py-1.5 text-sm" onClick={() => setAiOpen(true)}>
            ✨ Gerar cadência com IA
          </button>
        ) : (
          <div>
            <p className="text-sm font-semibold">Descreva e a IA monta a cadência</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input className="input" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Mercado (ex.: contadores)" />
              <input className="input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Seu produto/serviço" />
              <input className="input" value={icp} onChange={(e) => setIcp(e.target.value)} placeholder="Cliente ideal (ICP)" />
            </div>
            {aiMsg && <p className="mt-2 text-sm text-danger">{aiMsg}</p>}
            <div className="mt-3 flex gap-2">
              <button className="btn-brand py-1.5 text-sm" onClick={generateAI} disabled={aiPending}>
                {aiPending ? "Gerando..." : "Gerar rascunho"}
              </button>
              <button className="btn-ghost py-1.5 text-sm" onClick={() => setAiOpen(false)}>
                Cancelar
              </button>
            </div>
            <p className="mt-2 text-xs text-subtle">A IA preenche os passos abaixo — você revisa e edita antes de salvar.</p>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Nome da sequência *</label>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prospecção — Reforma" />
        </div>
        <div>
          <label className="label">Público-alvo</label>
          <input className="input mt-1" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Contadores T1" />
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl border border-line p-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-brand">Passo {i + 1}</span>
              <select
                className="input max-w-[140px] py-1"
                value={s.channel}
                onChange={(e) => update(i, { channel: e.target.value as Channel })}
              >
                {CHANNELS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.l}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <span className="text-xs text-subtle">após</span>
                <input
                  type="number"
                  min={0}
                  className="input w-16 py-1"
                  value={s.delay_days}
                  onChange={(e) => update(i, { delay_days: Number(e.target.value) })}
                />
                <span className="text-xs text-subtle">dia(s)</span>
              </div>
              {steps.length > 1 && (
                <button className="ml-auto text-xs text-danger" onClick={() => remove(i)}>
                  remover
                </button>
              )}
            </div>
            {s.channel === "email" && (
              <input
                className="input mt-3"
                value={s.subject}
                onChange={(e) => update(i, { subject: e.target.value })}
                placeholder="Assunto do e-mail"
              />
            )}
            <textarea
              className="input mt-2 min-h-[70px]"
              value={s.body}
              onChange={(e) => update(i, { body: e.target.value })}
              placeholder="Mensagem. Use {{primeiro_nome}}, {{empresa}}..."
            />
          </div>
        ))}
        <button className="btn-ghost" onClick={add}>
          + Adicionar passo
        </button>
      </div>

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

      <div className="mt-5 flex gap-2">
        <button className="btn-brand" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar sequência"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
