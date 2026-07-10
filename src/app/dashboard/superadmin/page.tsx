import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function Superadmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();

  if (!(me as any)?.is_superadmin) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="font-display text-lg font-bold">Acesso restrito</p>
        <p className="mt-2 text-sm text-subtle">Esta área é do dono da plataforma. Se é você, marque seu perfil como superadmin (ver migration 0019).</p>
      </div>
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return (
      <div className="rounded-xl bg-warn/10 p-4 text-sm text-warn">
        Configure <b>SUPABASE_SERVICE_ROLE_KEY</b> no ambiente para a visão de plataforma ler todos os tenants.
      </div>
    );
  }

  // todos os tenants + métricas por tenant (via service role — leitura de plataforma)
  const { data: tenants } = await admin.from("tenants").select("id, name, legal_name, segment, created_at, mrr, subscription_status").order("created_at", { ascending: false });
  const tList = (tenants as any[]) || [];

  const subscriptionMrr = tList.filter((t) => t.subscription_status === "active").reduce((s, t) => s + Number(t.mrr || 0), 0);

  // --- Engajamento: workspaces com atividade recente (eventos ou tarefas) ---
  const now = Date.now();
  const d7 = new Date(now - 7 * 86400000).toISOString();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const [{ data: ev7 }, { data: ev30 }] = await Promise.all([
    admin.from("events").select("tenant_id").gte("created_at", d7).limit(5000),
    admin.from("events").select("tenant_id").gte("created_at", d30).limit(5000),
  ]);
  const active7 = new Set(((ev7 as any[]) || []).map((e) => e.tenant_id)).size;
  const active30 = new Set(((ev30 as any[]) || []).map((e) => e.tenant_id)).size;

  // --- Crescimento: novos workspaces por mês (últimos 6 meses) ---
  const months: { label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date();
    dt.setMonth(dt.getMonth() - i, 1);
    const label = dt.toLocaleDateString("pt-BR", { month: "short" });
    const y = dt.getFullYear();
    const m = dt.getMonth();
    const count = tList.filter((t) => {
      const c = new Date(t.created_at);
      return c.getFullYear() === y && c.getMonth() === m;
    }).length;
    months.push({ label, count });
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.count));
  const new30 = tList.filter((t) => new Date(t.created_at).toISOString() >= d30).length;

  const rows = await Promise.all(
    tList.map(async (t) => {
      const [users, contacts, oppsOpen, mrr] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", t.id),
        admin.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id),
        admin.from("opportunities").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).eq("status", "open"),
        admin.from("opportunities").select("value_mrr").eq("tenant_id", t.id).eq("status", "open"),
      ]);
      const mrrSum = ((mrr.data as any[]) || []).reduce((s, o) => s + Number(o.value_mrr || 0), 0);
      return {
        id: t.id,
        name: t.name || t.legal_name || "(sem nome)",
        segment: t.segment || "—",
        created_at: t.created_at,
        users: users.count ?? 0,
        contacts: contacts.count ?? 0,
        oppsOpen: oppsOpen.count ?? 0,
        mrr: mrrSum,
      };
    })
  );

  const totalTenants = rows.length;
  const totalUsers = rows.reduce((s, r) => s + r.users, 0);
  const totalContacts = rows.reduce((s, r) => s + r.contacts, 0);
  const totalMrr = rows.reduce((s, r) => s + r.mrr, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Plataforma</h1>
          <p className="mt-1 text-sm text-subtle">Visão do dono do Contatia sobre todos os workspaces. Leitura apenas.</p>
          <p className="mt-1 text-xs text-signal">✓ Régua de ciclo de vida ativa: boas-vindas, onboarding (D+1/D+3) e reengajamento (D+14) enviados automaticamente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard/superadmin/suporte" className="btn-ghost">Suporte →</a>
          <a href="/dashboard/superadmin/cobranca" className="btn-ghost">Cobrança →</a>
          <a href="/dashboard/superadmin/parceiros" className="btn-ghost">Parceiros & comissões →</a>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          { l: "Workspaces", v: String(totalTenants) },
          { l: "Usuários", v: String(totalUsers) },
          { l: "Contatos", v: totalContacts.toLocaleString("pt-BR") },
          { l: "MRR de assinatura", v: brl(subscriptionMrr) },
        ].map((k) => (
          <div key={k.l} className="card p-5">
            <p className="text-xs text-subtle">{k.l}</p>
            <p className="mt-1 font-display text-2xl font-bold">{k.v}</p>
          </div>
        ))}
      </div>

      {/* Resultados: crescimento + engajamento */}
      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Resultados</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <p className="text-sm font-semibold">Crescimento — novos workspaces por mês</p>
          <div className="mt-4 flex items-end gap-3" style={{ height: 120 }}>
            {months.map((m, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold text-ink">{m.count}</span>
                <div className="w-full rounded-t bg-brand" style={{ height: `${(m.count / maxMonth) * 90}px`, minHeight: m.count ? 4 : 0 }} />
                <span className="text-[11px] text-subtle">{m.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-subtle">{new30} novo(s) nos últimos 30 dias.</p>
        </div>

        <div className="card p-5">
          <p className="text-sm font-semibold">Engajamento — workspaces ativos</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs text-subtle">Ativos (7 dias)</p>
              <p className="mt-1 font-display text-2xl font-bold text-signal">{active7}</p>
              <p className="text-xs text-subtle">de {totalTenants} · {totalTenants ? Math.round((active7 / totalTenants) * 100) : 0}%</p>
            </div>
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs text-subtle">Ativos (30 dias)</p>
              <p className="mt-1 font-display text-2xl font-bold">{active30}</p>
              <p className="text-xs text-subtle">de {totalTenants} · {totalTenants ? Math.round((active30 / totalTenants) * 100) : 0}%</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-subtle">Ativo = registrou eventos (envios, aberturas, respostas) no período. É o proxy de uso real — o sinal de churn antes do churn.</p>
        </div>
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Workspaces</h2>

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">Workspace</th>
              <th className="px-4 py-3 font-medium">Segmento</th>
              <th className="px-4 py-3 font-medium">Usuários</th>
              <th className="px-4 py-3 font-medium">Contatos</th>
              <th className="px-4 py-3 font-medium">Negócios abertos</th>
              <th className="px-4 py-3 font-medium">MRR pipeline</th>
              <th className="px-4 py-3 font-medium">Desde</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3 text-subtle">{r.segment}</td>
                <td className="px-4 py-3">{r.users}</td>
                <td className="px-4 py-3">{r.contacts.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">{r.oppsOpen}</td>
                <td className="px-4 py-3 font-semibold text-brand-dark">{brl(r.mrr)}</td>
                <td className="px-4 py-3 text-xs text-subtle">{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-subtle">Nenhum workspace ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-subtle">
        Métricas por workspace são somadas sob demanda. Com muitos tenants, o próximo passo é um resumo materializado (view/RPC agregada).
      </p>
    </div>
  );
}
