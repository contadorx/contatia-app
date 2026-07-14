"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { createSequence, updateSequence, generateSequenceAI, loadAiContext, saveAiContext, opusRemaining, type StepInput } from "@/app/dashboard/cadencias/actions";
import type { Channel } from "@/lib/cadence";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

const CHANNELS: { v: Channel; l: string }[] = [
  { v: "email", l: "E-mail" },
  { v: "whatsapp", l: "WhatsApp" },
  { v: "call", l: "Ligação" },
  { v: "linkedin", l: "LinkedIn" },
];

const emptyStep = (): StepInput => ({ channel: "email", delay_days: 0, subject: "", body: "" });

type ProductOpt = { id: string; name: string };
type AccountOpt = { id: string; from_email: string; display_name?: string | null };

export default function SequenceBuilder({
  autoOpen = false,
  autoAi = false,
  onDone,
  editId,
  initialName,
  initialAudience,
  initialSteps,
  products = [],
  accounts = [],
  initialProductId,
  initialEmailAccountId,
}: {
  autoOpen?: boolean;
  autoAi?: boolean;
  onDone?: () => void;
  editId?: string;
  initialName?: string;
  initialAudience?: string;
  initialSteps?: StepInput[];
  products?: ProductOpt[];
  accounts?: AccountOpt[];
  initialProductId?: string;
  initialEmailAccountId?: string;
} = {}) {
  const [open, setOpen] = useState(autoOpen);
  const [name, setName] = useState(initialName ?? "");
  const [audience, setAudience] = useState(initialAudience ?? "");
  const [productId, setProductId] = useState(initialProductId ?? "");
  const [emailAccountId, setEmailAccountId] = useState(initialEmailAccountId ?? "");
  const [steps, setSteps] = useState<StepInput[]>(initialSteps?.length ? initialSteps : [emptyStep()]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // IA — briefing rico
  const [aiOpen, setAiOpen] = useState(autoAi);
  const [brief, setBrief] = useState({
    market: "", product: "", icp: "", tone: "", pain: "", proof: "", goal: "", cta: "", avoid: "", steps: 5,
    channels: ["email", "whatsapp", "linkedin"] as string[],
  });
  const [ctxLoaded, setCtxLoaded] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();
  const [premium, setPremium] = useState(false);
  const [useRapport, setUseRapport] = useState(false);
  const [opus, setOpus] = useState<{ used: number; quota: number } | null>(null);
  const [showMoreCtx, setShowMoreCtx] = useState(false);
  const [showAdvIa, setShowAdvIa] = useState(false);
  const [abOpen, setAbOpen] = useState<Set<number>>(new Set());

  const isAbOpen = (i: number) => abOpen.has(i) || !!steps[i]?.subject_b?.trim();
  function openAb(i: number) { setAbOpen((s) => new Set(s).add(i)); }
  function removeAb(i: number) {
    update(i, { subject_b: "" });
    setAbOpen((s) => { const n = new Set(s); n.delete(i); return n; });
  }

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
      opusRemaining().then((r: any) => setOpus(r)).catch(() => {});
    }
  }, [aiOpen, ctxLoaded]);

  const opusLeft = opus ? Math.max(0, opus.quota - opus.used) : null;

  function generateAI() {
    setAiMsg(null);
    startAi(async () => {
      const res = (await generateSequenceAI(brief, { premium, rapport: useRapport })) as { steps?: StepInput[]; error?: string };
      if (res?.error) setAiMsg(res.error);
      else if (res?.steps?.length) {
        setSteps(res.steps);
        if (!name && brief.market) setName(`Cadência — ${brief.market}`.slice(0, 60));
        if (premium) opusRemaining().then((r: any) => setOpus(r)).catch(() => {});
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
      const res = editId
        ? await updateSequence(editId, { name, audience, steps, product_id: productId || null, email_account_id: emailAccountId || null })
        : await createSequence({ name, audience, steps, product_id: productId || null, email_account_id: emailAccountId || null });
      if (res?.error) setMsg(res.error);
      else {
        if (!editId) {
          setName("");
          setAudience("");
          setSteps([emptyStep()]);
        }
        setOpen(false);
        onDone?.();
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
              <input className="input" value={brief.market} onChange={(e) => bf("market", e.target.value)} placeholder="Mercado-alvo (ex.: clínicas particulares em SP)" />
              <input className="input" value={brief.product} onChange={(e) => bf("product", e.target.value)} placeholder="Seu produto/serviço" />
              <input className="input" value={brief.icp} onChange={(e) => bf("icp", e.target.value)} placeholder="Cliente ideal (cargo, porte)" />
            </div>
            <div className="mt-3">
              <label className="label">Dor que você resolve</label>
              <textarea className="input mt-1 min-h-[90px] leading-relaxed" value={brief.pain} onChange={(e) => bf("pain", e.target.value)} placeholder="O problema concreto do cliente e por que dói. Quanto mais específico, melhor a cadência." />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="input" value={brief.goal} onChange={(e) => bf("goal", e.target.value)} placeholder="Objetivo (ex.: agendar diagnóstico)" />
              <input className="input" value={brief.cta} onChange={(e) => bf("cta", e.target.value)} placeholder="CTA preferido (ex.: 15 min esta semana)" />
            </div>

            <button type="button" className="mt-3 text-xs font-medium text-brand hover:underline" onClick={() => setShowMoreCtx((s) => !s)}>
              {showMoreCtx ? "− Menos contexto" : "+ Mais contexto (prova, tom, o que evitar)"}
            </button>
            {showMoreCtx && (
              <div className="mt-2 space-y-3">
                <div>
                  <label className="label">Prova / diferencial</label>
                  <textarea className="input mt-1 min-h-[80px] leading-relaxed" value={brief.proof} onChange={(e) => bf("proof", e.target.value)} placeholder="Resultado, número ou case real que sustenta sua promessa (sem exagerar)." />
                </div>
                <input className="input" value={brief.tone} onChange={(e) => bf("tone", e.target.value)} placeholder="Tom de voz (ex.: consultivo, direto)" />
                <div>
                  <label className="label">Nunca dizer / evitar</label>
                  <textarea className="input mt-1 min-h-[70px] leading-relaxed" value={brief.avoid} onChange={(e) => bf("avoid", e.target.value)} placeholder="Promessas proibidas, termos a evitar, restrições de compliance." />
                </div>
              </div>
            )}

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

            {/* Opções avançadas — rapport + qualidade máxima */}
            <button type="button" className="mt-3 text-xs font-medium text-brand hover:underline" onClick={() => setShowAdvIa((s) => !s)}>
              {showAdvIa ? "− Opções avançadas" : "+ Opções avançadas (rapport, qualidade máxima)"}
            </button>
            {showAdvIa && (
              <div className="mt-2 space-y-3">
                {/* Considerar rapport na cadência */}
                <label className="flex items-start gap-2 rounded-xl border border-line bg-muted/40 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={useRapport} onChange={(e) => setUseRapport(e.target.checked)} />
                  <span>
                    <b>Considerar dados de rapport</b> — a IA costura ganchos de {`{{interesses}}`} e {`{{contexto}}`} no texto
                    (trocados por contato, sem custo extra). <span className="text-subtle">Use quando seus contatos têm esses campos preenchidos.</span>
                  </span>
                </label>

                {/* Qualidade máxima (pacote Opus) */}
                <label className="flex items-start gap-2 rounded-xl border border-brand/30 bg-brand-soft/40 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={premium}
                    onChange={(e) => setPremium(e.target.checked)}
                    disabled={opusLeft === 0}
                  />
                  <span>
                    <b>Qualidade máxima</b> — o modelo topo, para a cadência que você quer impecável.
                    {opus ? (
                      <span className={`ml-1 ${opusLeft === 0 ? "text-danger" : "text-subtle"}`}>
                        {opusLeft === 0 ? "Pacote do mês esgotado." : `${opusLeft} de ${opus.quota} no pacote deste mês.`}
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>
            )}

            {aiMsg && <p className={`mt-2 text-sm ${aiMsg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{aiMsg}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-brand py-1.5 text-sm" onClick={generateAI} disabled={aiPending}>
                {aiPending ? "Gerando..." : premium ? "Gerar no Opus" : "Gerar rascunho"}
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
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Prospecção — Q3" />
        </div>
        <div>
          <label className="label">Público-alvo</label>
          <input className="input mt-1" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Ex.: Diretores de operações" />
        </div>
      </div>

      {(products.length > 0 || accounts.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Produto</label>
            <SmartSelect
              className="mt-1"
              placeholder={products.length ? "Nenhum (rodízio de caixas)" : "Nenhum produto cadastrado"}
              clearable
              disabled={!products.length}
              value={productId}
              onValueChange={(v) => setProductId(v)}
              options={products.map((p): SmartOption => ({ value: p.id, label: p.name }))}
            />
            <p className="mt-1 text-[11px] text-subtle">A cadência envia pela caixa deste produto.</p>
          </div>
          <div>
            <label className="label">Caixa de envio (sobrescrever)</label>
            <SmartSelect
              className="mt-1"
              placeholder={accounts.length ? "Usar a do produto" : "Nenhuma caixa conectada"}
              clearable
              disabled={!accounts.length}
              value={emailAccountId}
              onValueChange={(v) => setEmailAccountId(v)}
              options={accounts.map((a): SmartOption => ({ value: a.id, label: a.display_name ? `${a.display_name} <${a.from_email}>` : a.from_email }))}
            />
            <p className="mt-1 text-[11px] text-subtle">Opcional. Força uma caixa específica, ignorando a do produto.</p>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl border border-line p-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-brand">Passo {i + 1}</span>
              <div className="w-[140px] shrink-0">
                <SmartSelect
                  className="py-1"
                  value={s.channel}
                  onValueChange={(v) => update(i, { channel: v as Channel })}
                  options={CHANNELS.map((c): SmartOption => ({ value: c.v, label: c.l }))}
                />
              </div>
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
              <>
                <input
                  className="input mt-3"
                  value={s.subject}
                  onChange={(e) => update(i, { subject: e.target.value })}
                  placeholder="Assunto do e-mail"
                />
                {isAbOpen(i) ? (
                  <>
                    <input
                      className="input mt-2"
                      value={s.subject_b || ""}
                      onChange={(e) => update(i, { subject_b: e.target.value })}
                      placeholder="Assunto alternativo (variante B)"
                    />
                    <p className="mt-1 text-[11px] text-subtle">
                      Teste A/B: cada contato recebe A ou B (sorteio 50/50). O relatório mostra qual converte mais.{" "}
                      <button type="button" className="text-brand hover:underline" onClick={() => removeAb(i)}>remover teste</button>
                    </p>
                  </>
                ) : (
                  <button type="button" className="mt-2 text-xs font-medium text-brand hover:underline" onClick={() => openAb(i)}>
                    + Testar outro assunto (A/B)
                  </button>
                )}
              </>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-subtle">Inserir dado do contato:</span>
              {[
                { v: "primeiro_nome", l: "Primeiro nome" },
                { v: "empresa", l: "Empresa" },
                { v: "cargo", l: "Cargo" },
                { v: "cidade", l: "Cidade" },
                { v: "cnae", l: "Atividade" },
              ].map((c) => (
                <button key={c.v} type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs hover:bg-muted" onClick={() => insertVar(i, c.v)} title={`Insere o campo ${c.l}, trocado pelo dado de cada contato ao enviar`}>
                  {c.l}
                </button>
              ))}
              <span className="text-subtle">·</span>
              {[
                { v: "interesses", l: "Interesses" },
                { v: "contexto", l: "Contexto" },
              ].map((c) => (
                <button key={c.v} type="button" className="rounded-lg border border-brand/30 bg-brand-soft/40 px-2 py-0.5 text-xs text-brand-dark hover:bg-brand-soft" onClick={() => insertVar(i, c.v)} title="Rapport — personaliza por contato, sem custo de IA">
                  {c.l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-subtle">
              Cada campo vira o dado do contato ao enviar. Os de <b>rapport</b> (Interesses, Contexto) personalizam sem custo de IA — use numa frase que também leia bem se estiver vazia.
            </p>
            <textarea
              ref={(el) => { bodyRefs.current[i] = el; }}
              className="input mt-1 min-h-[150px] leading-relaxed"
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
          {pending ? "Salvando..." : editId ? "Salvar alterações" : "Salvar sequência"}
        </button>
        <button className="btn-ghost" onClick={() => { setOpen(false); onDone?.(); }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
