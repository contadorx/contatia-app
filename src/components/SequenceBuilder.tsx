"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { createSequence, generateSequenceAI, loadAiContext, saveAiContext, type StepInput } from "@/app/dashboard/cadencias/actions";
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

  // IA — briefing rico
  const [aiOpen, setAiOpen] = useState(false);
  const [brief, setBrief] = useState({
    market: "", product: "", icp: "", tone: "", pain: "", proof: "", goal: "", cta: "", avoid: "", steps: 5,
    channels: ["email", "whatsapp", "linkedin"] as string[],
  });
  const [ctxLoaded, setCtxLoaded] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();

  function bf(k: string, v: string | number | string[]) {
    setBrief((s) => ({ ...s, [k]: v }));
  }
  function toggleChannel(ch: string) {
    setBrief((s) => ({ ...s, channels: s.channels.includes(ch) ? s.channels.filter((c) => c !== ch) : [...s.channels, ch] }));
  }

  // ao abrir o painel, puxa o contexto salvo no negócio
  useEffect(() => {
    if (aiOpen && !ctxLoaded) {
      loadAiContext().then((res: any) => {
        const c = res?.context || {};
        setBrief((s) => ({ ...s, ...c, steps: c.steps || s.steps, channels: c.channels?.length ? c.channels : s.channels }));
        setCtxLoaded(true);
      });
    }
  }, [aiOpen, ctxLoaded]);

  function generateAI() {
    setAiMsg(null);
    startAi(async () => {
      const res = (await generateSequenceAI(brief)) as { steps?: StepInput[]; error?: string };
      if (res?.error) setAiMsg(res.error);
      else if (res?.steps?.length) {
        setSteps(res.steps);
        if (!name && brief.market) setName(`Cadência — ${brief.market}`.slice(0, 60));
        setAiOpen(false);
      }
    });
  }
  function saveContext() {
    setAiMsg(null);
    startAi(async () => {
      const res = (await saveAiContext(brief)) as { ok?: boolean; error?: string };
      setAiMsg(res?.error ? res.error : "✓ Contexto salvo no negócio (reusado nas próximas gerações).");
    });
  }

  function update(i: number, patch: Partial<StepInput>) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }

  // refs dos corpos + inserir variável no cursor
  const bodyRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  function insertVar(i: number, v: string) {
    const token = `{{${v}}}`;
    const el = bodyRefs.current[i];
    const cur = steps[i]?.body || "";
    if (!el) {
      update(i, { body: cur + token });
      return;
    }
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    update(i, { body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
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
            <p className="text-sm font-semibold">Contexto para a IA montar a cadência</p>
            <p className="mt-0.5 text-xs text-subtle">Quanto mais contexto, melhor a cadência. Puxamos o que já está salvo no seu negócio.</p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input className="input" value={brief.market} onChange={(e) => bf("market", e.target.value)} placeholder="Mercado-alvo (ex.: contadores SP)" />
              <input className="input" value={brief.product} onChange={(e) => bf("product", e.target.value)} placeholder="Seu produto/serviço" />
              <input className="input" value={brief.icp} onChange={(e) => bf("icp", e.target.value)} placeholder="Cliente ideal (cargo, porte)" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <textarea className="input min-h-[52px]" value={brief.pain} onChange={(e) => bf("pain", e.target.value)} placeholder="Dor que você resolve (o problema do cliente)" />
              <textarea className="input min-h-[52px]" value={brief.proof} onChange={(e) => bf("proof", e.target.value)} placeholder="Prova / diferencial (resultado, número, case real)" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input className="input" value={brief.tone} onChange={(e) => bf("tone", e.target.value)} placeholder="Tom de voz (ex.: consultivo, direto)" />
              <input className="input" value={brief.goal} onChange={(e) => bf("goal", e.target.value)} placeholder="Objetivo (ex.: agendar diagnóstico)" />
              <input className="input" value={brief.cta} onChange={(e) => bf("cta", e.target.value)} placeholder="CTA preferido (ex.: 15 min esta semana)" />
            </div>
            <div className="mt-3">
              <textarea className="input min-h-[44px]" value={brief.avoid} onChange={(e) => bf("avoid", e.target.value)} placeholder="Nunca dizer / evitar (ex.: promessas de resultado, termos proibidos)" />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-subtle">
                Passos
                <input type="number" min={3} max={8} className="input w-16 py-1" value={brief.steps} onChange={(e) => bf("steps", Number(e.target.value))} />
              </label>
              <div className="flex flex-wrap gap-3 text-xs">
                {["email", "whatsapp", "linkedin", "call"].map((ch) => (
                  <label key={ch} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={brief.channels.includes(ch)} onChange={() => toggleChannel(ch)} />
                    {ch === "call" ? "ligação" : ch}
                  </label>
                ))}
              </div>
            </div>

            {aiMsg && <p className={`mt-2 text-sm ${aiMsg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{aiMsg}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-brand py-1.5 text-sm" onClick={generateAI} disabled={aiPending}>
                {aiPending ? "Gerando..." : "Gerar rascunho"}
              </button>
              <button className="btn-ghost py-1.5 text-sm" onClick={saveContext} disabled={aiPending} title="Salva o contexto no negócio para reusar">
                Salvar contexto
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-subtle">Inserir:</span>
              {["primeiro_nome", "empresa"].map((v) => (
                <button key={v} type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs hover:bg-muted" onClick={() => insertVar(i, v)}>
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <textarea
              ref={(el) => { bodyRefs.current[i] = el; }}
              className="input mt-1 min-h-[70px]"
              value={s.body}
              onChange={(e) => update(i, { body: e.target.value })}
              placeholder="Mensagem. Use {{primeiro_nome}}, {{empresa}}..."
            />
            {s.body.trim() && (
              <p className="mt-1 text-xs text-subtle">
                Prévia: {s.body.replace(/\{\{\s*primeiro_nome\s*\}\}/g, "João").replace(/\{\{\s*empresa\s*\}\}/g, "Empresa X")}
              </p>
            )}
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
