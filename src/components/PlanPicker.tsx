"use client";

import { useState, useTransition } from "react";
import { subscribePlan, validateCoupon } from "@/app/dashboard/planos/actions";

type Plan = { id: string; name: string; price_monthly: number; max_seats: number | null; min_seats?: number; sort: number; segment?: string };

export function PlanPicker({ plans, features, seats, currentPlanId, canSubscribe, hasDoc }: {
  plans: Plan[];
  features: Record<string, string[]>;
  seats: number;
  currentPlanId?: string;
  canSubscribe: boolean;
  hasDoc?: boolean;
}) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<{ link?: string; planName?: string; value?: number; billedSeats?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needDoc, setNeedDoc] = useState<string | null>(null); // planId aguardando CPF/CNPJ
  const [doc, setDoc] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const isTeamPlan = (p: Plan) => (p.segment || "equipe") === "equipe";

  // Mostra TODOS os planos ativos lado a lado (Individual e Equipes), ordenados —
  // fica mais fácil comparar do que alternando por um toggle.
  const allPlans = [...plans].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const gridCols = allPlans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2";

  // assentos que o dono quer contratar (só afeta o card de Equipes): default = maior
  // entre a equipe de hoje e o mínimo do plano de equipe.
  const teamMin = Math.max(1, ...allPlans.filter(isTeamPlan).map((p) => Number(p.min_seats) || 1));
  const [chosenSeats, setChosenSeats] = useState<number>(Math.max(seats, teamMin));
  // documento já no cadastro? então nem pedimos → assinar é 1 clique.
  const docReady = !!hasDoc;

  function checkCoupon() {
    setCouponMsg(null);
    if (!coupon.trim()) return;
    start(async () => {
      const r = (await validateCoupon(coupon)) as any;
      if (r?.error) setCouponMsg({ t: "err", m: r.error });
      else setCouponMsg({ t: "ok", m: `Cupom válido: -${r.percentOff}%${r.durationMonths ? ` pelos primeiros ${r.durationMonths} meses` : " permanente"}.` });
    });
  }

  function pick(planId: string, docNumber?: string) {
    setErr(null); setResult(null); setBusyId(planId);
    // usa o doc informado agora OU o campo superior (quando não há doc no cadastro)
    const useDoc = docNumber || (docReady ? undefined : doc || undefined);
    const plan = plans.find((p) => p.id === planId);
    const reqSeats = plan && isTeamPlan(plan) ? Math.max(chosenSeats, teamMin) : undefined;
    start(async () => {
      const r = (await subscribePlan(planId, useDoc, coupon.trim() || undefined, reqSeats)) as any;
      setBusyId(null);
      if (r?.error === "need_doc") { setNeedDoc(planId); return; }
      if (r?.error === "coupon_invalid") { setCouponMsg({ t: "err", m: "Cupom inválido ou esgotado." }); return; }
      if (r?.error) setErr(r.error);
      else { setNeedDoc(null); setResult({ link: r.link, planName: r.planName, value: r.value, billedSeats: r.billedSeats }); }
    });
  }

  if (result) {
    return (
      <div className="card p-6 text-center">
        <p className="font-display text-lg font-bold text-signal">Assinatura criada!</p>
        <p className="mt-1 text-sm">Plano <b>{result.planName}</b> · {result.value != null ? brl(result.value) : ""}/mês para {result.billedSeats ?? seats} usuário(s).</p>
        {result.link ? (
          <>
            <p className="mt-3 text-sm text-subtle">Falta só o pagamento para ativar. Você escolhe boleto, Pix ou cartão.</p>
            <a href={result.link} target="_blank" rel="noreferrer" className="btn-brand mt-4 inline-flex">Ir para o pagamento →</a>
          </>
        ) : (
          <p className="mt-3 text-sm text-subtle">A cobrança foi gerada. O link de pagamento chega no e-mail do workspace.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {err && <p className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{err}</p>}

      <p className="mb-4 text-sm text-subtle">
        Dois planos, tudo incluído nos dois (Radar, Automações, IA, WhatsApp). A diferença é a
        <b> gestão de equipe</b>: papéis, visão do dono/gestor, carteira por vendedor e rotação de envio.
      </p>

      {/* cupom (opcional) + CPF/CNPJ upfront → assinar em 1 clique */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Cupom de desconto (opcional)</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              className="input uppercase"
              value={coupon}
              onChange={(e) => { setCoupon(e.target.value.toUpperCase().replace(/\s/g, "")); setCouponMsg(null); }}
              placeholder="CÓDIGO"
              style={{ width: 160 }}
            />
            <button className="btn-ghost py-2 text-sm" disabled={pending || !coupon.trim()} onClick={checkCoupon}>Validar</button>
          </div>
          {couponMsg && <span className={`mt-1 block text-sm ${couponMsg.t === "ok" ? "text-signal" : "text-danger"}`}>{couponMsg.m}</span>}
        </div>
        {!docReady && (
          <div>
            <label className="label">CPF ou CNPJ do responsável pela cobrança</label>
            <input
              className="input mt-1"
              inputMode="numeric"
              placeholder="Só números"
              value={doc}
              onChange={(e) => setDoc(e.target.value.replace(/\D/g, "").slice(0, 14))}
              style={{ width: 220 }}
            />
            <p className="mt-1 text-[11px] text-subtle">Exigido pelo Asaas. Fica salvo — assim você assina em um clique.</p>
          </div>
        )}
      </div>

      <div className={`grid items-start gap-4 ${gridCols}`}>
        {allPlans.map((p) => {
          const team = isTeamPlan(p);
          const isCurrent = p.id === currentPlanId;
          const min = Math.max(1, Number(p.min_seats) || 1);
          const seatsForCard = team ? Math.max(chosenSeats, min) : 1;
          const total = Number(p.price_monthly) * seatsForCard;
          return (
            <div key={p.id} className={`card flex flex-col p-6 ${team ? "ring-2 ring-brand" : ""}`}>
              <span className={`mb-3 self-start rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide ${team ? "bg-brand text-white" : "bg-muted text-subtle"}`}>
                {team ? "Para times" : "Individual"}
              </span>
              <p className="font-display text-lg font-bold">{p.name}</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold">{brl(Number(p.price_monthly))}</span>
                <span className="text-sm text-subtle">{team ? "/usuário/mês" : "/mês"}</span>
              </div>
              <p className="mt-1 text-xs text-subtle">{team ? `cobrança por assento · mínimo ${min} usuários` : "1 usuário"}</p>

              {team && (
                <div className="mt-3 rounded-xl bg-muted p-3">
                  <label className="label">Quantos assentos contratar</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      className="input"
                      type="number"
                      min={min}
                      value={chosenSeats}
                      onChange={(e) => setChosenSeats(Math.max(min, Number(e.target.value) || min))}
                      style={{ width: 90 }}
                    />
                    <span className="text-xs text-subtle">mín. {min} · {seats} hoje</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-brand-dark">≈ {brl(total)}/mês para {seatsForCard} assento(s){chosenSeats <= min ? " (mínimo)" : ""}</p>
                </div>
              )}

              <ul className="mt-4 flex-1 space-y-2">
                {(features[p.name] || []).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-signal">✓</span><span>{f}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <span className="btn-ghost mt-5 justify-center opacity-60">Plano atual</span>
              ) : needDoc === p.id ? (
                <div className="mt-5">
                  <label className="text-xs font-medium text-subtle">CPF ou CNPJ do responsável pela cobrança</label>
                  <input
                    className="input mt-1"
                    inputMode="numeric"
                    placeholder="Só números"
                    value={doc}
                    onChange={(e) => setDoc(e.target.value.replace(/\D/g, "").slice(0, 14))}
                    autoFocus
                  />
                  <p className="mt-1 text-[11px] text-subtle">Exigido pelo Asaas para emitir a cobrança. Fica salvo no seu cadastro.</p>
                  <button
                    className="btn-brand mt-2 w-full justify-center"
                    disabled={pending || (doc.length !== 11 && doc.length !== 14)}
                    onClick={() => pick(p.id, doc)}
                  >
                    {busyId === p.id ? "Gerando..." : "Confirmar e assinar"}
                  </button>
                </div>
              ) : (
                <button
                  className={`mt-5 w-full justify-center ${team ? "btn-brand" : "btn-dark"}`}
                  disabled={!canSubscribe || pending || (!docReady && doc.length !== 11 && doc.length !== 14)}
                  onClick={() => pick(p.id)}
                >
                  {busyId === p.id
                    ? "Gerando..."
                    : !docReady && doc.length !== 11 && doc.length !== 14
                      ? "Informe o CPF/CNPJ acima"
                      : currentPlanId
                        ? "Trocar para este"
                        : "Assinar"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
