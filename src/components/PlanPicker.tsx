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
  const popular = plans.find((p) => p.name === "Profissional")?.id;

  // segmento: começa no do plano atual (se houver), senão Individual
  const currentSeg = plans.find((p) => p.id === currentPlanId)?.segment;
  const [seg, setSeg] = useState<string>(currentSeg || "individual");
  const visiblePlans = plans.filter((p) => (p.segment || "equipe") === seg);
  const isTeam = seg === "equipe";
  const gridCols = visiblePlans.length >= 3 ? "md:grid-cols-3" : visiblePlans.length === 2 ? "md:grid-cols-2" : "max-w-md";

  // assentos que o dono quer contratar (Equipes): default = maior entre a equipe de
  // hoje e o mínimo do plano visível. Assim dá pra comprar 10 de uma vez.
  const teamMin = Math.max(1, ...visiblePlans.map((p) => Number(p.min_seats) || 1));
  const [chosenSeats, setChosenSeats] = useState<number>(Math.max(seats, teamMin));
  const billed = isTeam ? Math.max(chosenSeats, teamMin) : 1;
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
    const reqSeats = isTeam ? billed : undefined;
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

      {/* toggle Individual x Equipes */}
      <div className="mb-5 inline-flex rounded-xl border border-line bg-muted p-1">
        {[
          { v: "individual", l: "Individual" },
          { v: "equipe", l: "Equipes" },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => setSeg(s.v)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${seg === s.v ? "bg-surface text-ink shadow-sm" : "text-subtle hover:text-ink"}`}
          >
            {s.l}
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-subtle">
        {isTeam
          ? "Para times comerciais: cobrança por assento, gestão de equipe e recursos de escala."
          : "Para quem vende sozinho: um único usuário, sem gestão de equipe."}
      </p>

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

      {/* Assentos (Equipes) + CPF/CNPJ upfront → assinar em 1 clique */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        {isTeam && (
          <div>
            <label className="label">Quantos assentos contratar</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="input"
                type="number"
                min={teamMin}
                value={chosenSeats}
                onChange={(e) => setChosenSeats(Math.max(teamMin, Number(e.target.value) || teamMin))}
                style={{ width: 110 }}
              />
              <span className="text-xs text-subtle">mínimo {teamMin} · você tem {seats} hoje</span>
            </div>
          </div>
        )}
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

      <div className={`grid gap-4 ${gridCols}`}>
        {visiblePlans.map((p) => {
          const isPopular = p.id === popular;
          const isCurrent = p.id === currentPlanId;
          const min = Math.max(1, Number(p.min_seats) || 1);
          const seatsForCard = isTeam ? Math.max(chosenSeats, min) : 1;
          const total = Number(p.price_monthly) * seatsForCard;
          return (
            <div key={p.id} className={`card flex flex-col p-6 ${isPopular ? "ring-2 ring-brand" : ""}`}>
              {isPopular && <span className="mb-3 self-start rounded-full bg-brand px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Mais popular</span>}
              <p className="font-display text-lg font-bold">{p.name}</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold">{brl(Number(p.price_monthly))}</span>
                <span className="text-sm text-subtle">{isTeam ? "/usuário/mês" : "/mês"}</span>
              </div>
              <p className="mt-1 text-xs text-subtle">{isTeam ? `cobrança por assento · mínimo ${min} usuários` : "1 usuário"}</p>
              {isTeam && <p className="mt-2 text-sm font-medium text-brand-dark">≈ {brl(total)}/mês para {seatsForCard} assento(s){chosenSeats <= min ? " (mínimo)" : ""}</p>}

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
                  className={`mt-5 w-full justify-center ${isPopular ? "btn-brand" : "btn-dark"}`}
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
