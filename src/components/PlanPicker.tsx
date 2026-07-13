"use client";

import { useState, useTransition } from "react";
import { subscribePlan, validateCoupon } from "@/app/dashboard/planos/actions";

type Plan = { id: string; name: string; price_monthly: number; max_seats: number | null; sort: number };

export function PlanPicker({ plans, features, seats, currentPlanId, canSubscribe }: {
  plans: Plan[];
  features: Record<string, string[]>;
  seats: number;
  currentPlanId?: string;
  canSubscribe: boolean;
}) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<{ link?: string; planName?: string; value?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needDoc, setNeedDoc] = useState<string | null>(null); // planId aguardando CPF/CNPJ
  const [doc, setDoc] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const popular = plans.find((p) => p.name === "Profissional")?.id;

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
    start(async () => {
      const r = (await subscribePlan(planId, docNumber, coupon.trim() || undefined)) as any;
      setBusyId(null);
      if (r?.error === "need_doc") { setNeedDoc(planId); return; }
      if (r?.error === "coupon_invalid") { setCouponMsg({ t: "err", m: "Cupom inválido ou esgotado." }); return; }
      if (r?.error) setErr(r.error);
      else { setNeedDoc(null); setResult({ link: r.link, planName: r.planName, value: r.value }); }
    });
  }

  if (result) {
    return (
      <div className="card p-6 text-center">
        <p className="font-display text-lg font-bold text-signal">Assinatura criada!</p>
        <p className="mt-1 text-sm">Plano <b>{result.planName}</b> · {result.value != null ? brl(result.value) : ""}/mês para {seats} usuário(s).</p>
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

      {/* cupom (opcional) */}
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Cupom de desconto (opcional)</label>
          <input
            className="input mt-1 uppercase"
            value={coupon}
            onChange={(e) => { setCoupon(e.target.value.toUpperCase().replace(/\s/g, "")); setCouponMsg(null); }}
            placeholder="CÓDIGO"
            style={{ width: 200 }}
          />
        </div>
        <button className="btn-ghost py-2 text-sm" disabled={pending || !coupon.trim()} onClick={checkCoupon}>Validar</button>
        {couponMsg && <span className={`text-sm ${couponMsg.t === "ok" ? "text-signal" : "text-danger"}`}>{couponMsg.m}</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isPopular = p.id === popular;
          const isCurrent = p.id === currentPlanId;
          const total = Number(p.price_monthly) * seats;
          return (
            <div key={p.id} className={`card flex flex-col p-6 ${isPopular ? "ring-2 ring-brand" : ""}`}>
              {isPopular && <span className="mb-3 self-start rounded-full bg-brand px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Mais popular</span>}
              <p className="font-display text-lg font-bold">{p.name}</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold">{brl(Number(p.price_monthly))}</span>
                <span className="text-sm text-subtle">/usuário/mês</span>
              </div>
              <p className="mt-1 text-xs text-subtle">{p.max_seats ? `até ${p.max_seats} usuários` : "5+ usuários · preço decrescente"}</p>
              <p className="mt-2 text-sm font-medium text-brand-dark">≈ {brl(total)}/mês para {seats} usuário(s)</p>

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
                  className={`mt-5 justify-center ${isPopular ? "btn-brand" : "btn-dark"}`}
                  disabled={!canSubscribe || pending}
                  onClick={() => pick(p.id)}
                >
                  {busyId === p.id ? "Gerando..." : currentPlanId ? "Trocar para este" : "Assinar"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
