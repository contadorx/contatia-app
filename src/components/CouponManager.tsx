"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCoupon, toggleCoupon } from "@/app/dashboard/superadmin/cupons/actions";

type Coupon = {
  id: string;
  code: string;
  percent_off: number;
  duration_months: number | null;
  max_redemptions: number | null;
  redeemed_count: number;
  is_active: boolean;
  expires_at: string | null;
};

export default function CouponManager({ coupons }: { coupons: Coupon[] }) {
  const router = useRouter();
  const [f, setF] = useState({ code: "", percentOff: "", durationMonths: "", maxRedemptions: "", expiresAt: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  function create() {
    setMsg(null);
    start(async () => {
      const res = (await createCoupon({
        code: f.code,
        percentOff: Number(f.percentOff),
        durationMonths: f.durationMonths ? Number(f.durationMonths) : null,
        maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null,
        expiresAt: f.expiresAt || null,
      })) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else { setF({ code: "", percentOff: "", durationMonths: "", maxRedemptions: "", expiresAt: "" }); router.refresh(); }
    });
  }
  function toggle(id: string, active: boolean) {
    start(async () => { await toggleCoupon(id, active); router.refresh(); });
  }

  return (
    <div>
      <div className="card p-5">
        <p className="font-display font-bold">Novo cupom</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label">Código</label>
            <input className="input mt-1 uppercase" value={f.code} onChange={(e) => up("code", e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="PARCEIRO20" />
          </div>
          <div>
            <label className="label">Desconto %</label>
            <input className="input mt-1" inputMode="numeric" value={f.percentOff} onChange={(e) => up("percentOff", e.target.value.replace(/\D/g, ""))} placeholder="20" />
          </div>
          <div>
            <label className="label">Meses (reverte)</label>
            <input className="input mt-1" inputMode="numeric" value={f.durationMonths} onChange={(e) => up("durationMonths", e.target.value.replace(/\D/g, ""))} placeholder="vazio = sempre" />
          </div>
          <div>
            <label className="label">Máx. usos</label>
            <input className="input mt-1" inputMode="numeric" value={f.maxRedemptions} onChange={(e) => up("maxRedemptions", e.target.value.replace(/\D/g, ""))} placeholder="vazio = ∞" />
          </div>
          <div>
            <label className="label">Expira em</label>
            <input className="input mt-1" type="date" value={f.expiresAt} onChange={(e) => up("expiresAt", e.target.value)} />
          </div>
        </div>
        {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
        <button className="btn-brand mt-3 py-1.5 text-sm" disabled={pending} onClick={create}>{pending ? "…" : "Criar cupom"}</button>
        <p className="mt-2 text-[11px] text-subtle">“Meses” = por quantos meses o desconto vale antes de reverter ao preço cheio. Vazio = permanente.</p>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-4 py-2 font-semibold">Código</th>
              <th className="px-4 py-2 font-semibold">Desconto</th>
              <th className="px-4 py-2 font-semibold">Reverte</th>
              <th className="px-4 py-2 font-semibold">Usos</th>
              <th className="px-4 py-2 font-semibold">Expira</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {coupons.length ? coupons.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono font-semibold">{c.code}</td>
                <td className="px-4 py-2">{c.percent_off}%</td>
                <td className="px-4 py-2">{c.duration_months ? `${c.duration_months} meses` : "permanente"}</td>
                <td className="px-4 py-2">{c.redeemed_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ""}</td>
                <td className="px-4 py-2">{c.expires_at ? new Date(c.expires_at).toLocaleDateString("pt-BR") : "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.is_active ? "bg-signal/10 text-signal" : "bg-muted text-subtle"}`}>
                    {c.is_active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => toggle(c.id, !c.is_active)}>
                    {c.is_active ? "Desativar" : "Ativar"}
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-subtle">Nenhum cupom criado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
