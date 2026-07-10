import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { PartnerForm, PartnerToggle, ReferralForm, ReferralStatus } from "@/components/PartnerTools";

export const dynamic = "force-dynamic";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function Parceiros() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) {
    return <div className="card mx-auto max-w-lg p-8 text-center"><p className="font-display text-lg font-bold">Acesso restrito</p></div>;
  }

  const admin = createAdminClient();
  const db = admin || supabase; // superadmin passa na RLS; service role é fallback

  const [{ data: partners }, { data: referrals }, { data: tenants }] = await Promise.all([
    db.from("platform_partners").select("id, name, email, ref_code, commission_rate, pix_key, is_active, created_at").order("created_at", { ascending: false }),
    db.from("platform_referrals").select("id, partner_id, tenant_id, label, mrr, status, created_at, tenants(name)").order("created_at", { ascending: false }),
    db.from("tenants").select("id, name, legal_name").order("created_at", { ascending: false }),
  ]);

  const pList = (partners as any[]) || [];
  const rList = (referrals as any[]) || [];
  const tList = ((tenants as any[]) || []).map((t) => ({ id: t.id, name: t.name || t.legal_name || "(sem nome)" }));

  // comissão mensal por parceiro = soma(mrr das indicações ATIVAS) * rate
  const byPartner: Record<string, { activeMrr: number; count: number }> = {};
  for (const r of rList) {
    const b = (byPartner[r.partner_id] ||= { activeMrr: 0, count: 0 });
    b.count++;
    if (r.status === "active") b.activeMrr += Number(r.mrr) || 0;
  }
  const rows = pList.map((p) => {
    const b = byPartner[p.id] || { activeMrr: 0, count: 0 };
    return { ...p, referrals: b.count, activeMrr: b.activeMrr, commission: b.activeMrr * Number(p.commission_rate || 0) };
  });

  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const totalReferralMrr = rows.reduce((s, r) => s + r.activeMrr, 0);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link>
        <span>/</span>
        <span className="text-ink">Parceiros</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold">Parceiros & comissões</h1>
      <p className="mt-1 text-sm text-subtle">Quem indica novos workspaces e recebe comissão recorrente. Espelha o programa do Quotaria.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs text-subtle">Parceiros ativos</p><p className="mt-1 font-display text-2xl font-bold">{rows.filter((r) => r.is_active).length}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">MRR indicado (ativo)</p><p className="mt-1 font-display text-2xl font-bold">{brl(totalReferralMrr)}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">Comissão mensal a pagar</p><p className="mt-1 font-display text-2xl font-bold text-brand-dark">{brl(totalCommission)}</p></div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <PartnerForm />
        <ReferralForm partners={rows.map((r) => ({ id: r.id, name: r.name }))} tenants={tList} />
      </div>

      {/* Relatório por parceiro */}
      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Relatório de comissão</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">Parceiro</th>
              <th className="px-4 py-3 font-medium">Link</th>
              <th className="px-4 py-3 font-medium">Indicações</th>
              <th className="px-4 py-3 font-medium">MRR ativo</th>
              <th className="px-4 py-3 font-medium">%</th>
              <th className="px-4 py-3 font-medium">Comissão/mês</th>
              <th className="px-4 py-3 font-medium">PIX</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium">{r.name}{r.email && <span className="block text-xs text-subtle">{r.email}</span>}</td>
                <td className="px-4 py-3 text-xs text-subtle">{appUrl ? `${appUrl}/r/${r.ref_code}` : `/r/${r.ref_code}`}</td>
                <td className="px-4 py-3">{r.referrals}</td>
                <td className="px-4 py-3">{brl(r.activeMrr)}</td>
                <td className="px-4 py-3">{Math.round(Number(r.commission_rate) * 100)}%</td>
                <td className="px-4 py-3 font-semibold text-brand-dark">{brl(r.commission)}</td>
                <td className="px-4 py-3 text-xs text-subtle">{r.pix_key || "—"}</td>
                <td className="px-4 py-3"><PartnerToggle id={r.id} active={r.is_active} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-subtle">Nenhum parceiro ainda. Cadastre o primeiro acima.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Indicações */}
      {rList.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Indicações</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th className="px-4 py-3 font-medium">Indicado</th>
                  <th className="px-4 py-3 font-medium">Parceiro</th>
                  <th className="px-4 py-3 font-medium">MRR</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Desde</th>
                </tr>
              </thead>
              <tbody>
                {rList.map((r) => {
                  const partner = pList.find((p) => p.id === r.partner_id);
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-medium">{r.tenants?.name || r.label || "—"}</td>
                      <td className="px-4 py-3 text-subtle">{partner?.name || "—"}</td>
                      <td className="px-4 py-3">{brl(Number(r.mrr))}</td>
                      <td className="px-4 py-3"><ReferralStatus id={r.id} status={r.status} /></td>
                      <td className="px-4 py-3 text-xs text-subtle">{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-subtle">
        A comissão é o MRR ativo × o % do parceiro. Hoje o MRR do indicado é informado manualmente; quando o billing (Asaas) entrar, ele passa a vir da assinatura automaticamente.
      </p>
    </div>
  );
}
