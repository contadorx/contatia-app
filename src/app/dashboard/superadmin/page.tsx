import { ImpersonateButton } from "@/components/ImpersonateButton";
import { SubscriptionButton } from "@/components/SubscriptionButton";
import DeleteWorkspaceButton from "@/components/DeleteWorkspaceButton";
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

  // Fonte dos dados de plataforma: usa a service role se existir; senão, cai na RPC
  // superadmin_list_tenants() (SECURITY DEFINER, checa is_superadmin no servidor).
  // Assim o painel funciona mesmo sem SUPABASE_SERVICE_ROLE_KEY no ambiente.
  const admin = createAdminClient();

  let tList: any[] = [];
  let rpcFallback = false;

  if (admin) {
    // Pede só o essencial. Se alguma coluna opcional não existir no banco, a query
    // inteira falharia — por isso as extras vêm numa segunda tentativa tolerante.
    const base = await admin
      .from("tenants")
      .select("id, name, created_at")
      .order("created_at", { ascending: false });

    if (base.error) {
      return (
        <div className="rounded-xl bg-danger/10 p-4 text-sm text-danger">
          <p className="font-semibold">Não consegui ler os workspaces.</p>
          <p className="mt-1">Erro do banco: {base.error.message}</p>
        </div>
      );
    }

    tList = (base.data as any[]) || [];

    // enriquece com as colunas opcionais (se existirem)
    const extra = await admin
      .from("tenants")
      .select("id, legal_name, segment, mrr, subscription_status");
    if (!extra.error && extra.data) {
      const by: Record<string, any> = {};
      for (const e of extra.data as any[]) by[e.id] = e;
      tList = tList.map((t) => ({ ...t, ...(by[t.id] || {}) }));
    }
  } else {
    rpcFallback = true;
    const { data: rows, error: rpcErr } = await supabase.rpc("superadmin_list_tenants");
    if (rpcErr) {
      return (
        <div className="rounded-xl bg-warn/10 p-4 text-sm text-warn">
          Não consegui carregar os workspaces: {rpcErr.message}. Rode a migration
          <b> 0047</b> no Supabase (ou configure SUPABASE_SERVICE_ROLE_KEY no ambiente).
        </div>
      );
    }
    tList = ((rows as any[]) || []).map((r) => ({
      id: r.id,
      name: r.name,
      legal_name: r.legal_name,
      segment: r.segment,
      created_at: r.created_at,
      mrr: r.mrr,
      subscription_status: r.subscription_status,
      _users: Number(r.users_count || 0),
      _contacts: Number(r.contacts_count || 0),
      _opps: Number(r.opps_open || 0),
    }));
  }

  const subscriptionMrr = tList.filter((t) => t.subscription_status === "active").reduce((s, t) => s + Number(t.mrr || 0), 0);

  // planos disponíveis (para o modal de assinatura)
  const { data: planos } = await supabase
    .from("platform_plans")
    .select("id, name, price_monthly")
    .eq("is_active", true)
    .order("sort", { ascending: true });

  // escalonamentos da IA ainda não tratados (badge)
  const { count: iaPend } = await supabase
    .from("ai_conversations")
    .select("id", { count: "exact", head: true })
    .eq("status", "escalated")
    .eq("handled", false);

  // --- Engajamento: workspaces com atividade recente (exige service role) ---
  const now = Date.now();
  const d7 = new Date(now - 7 * 86400000).toISOString();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  let active7 = 0;
  let active30 = 0;
  if (admin) {
    const [{ data: ev7 }, { data: ev30 }] = await Promise.all([
      admin.from("events").select("tenant_id").gte("created_at", d7).limit(5000),
      admin.from("events").select("tenant_id").gte("created_at", d30).limit(5000),
    ]);
    active7 = new Set(((ev7 as any[]) || []).map((e) => e.tenant_id)).size;
    active30 = new Set(((ev30 as any[]) || []).map((e) => e.tenant_id)).size;
  }

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
      // sem service role: as contagens já vieram da RPC
      if (!admin) {
        return {
          id: t.id,
          name: t.name || t.legal_name || "(sem nome)",
          segment: t.segment || "—",
          created_at: t.created_at,
          users: t._users ?? 0,
          contacts: t._contacts ?? 0,
          oppsOpen: t._opps ?? 0,
          mrr: Number(t.mrr || 0),
        };
      }
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
      {rpcFallback && (
        <div className="mb-4 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          Lendo os workspaces sem <b>SUPABASE_SERVICE_ROLE_KEY</b>. A lista funciona normalmente;
          apenas as métricas de engajamento (ativos em 7/30 dias) ficam zeradas. Para habilitá-las,
          adicione a variável no ambiente do Vercel.
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Plataforma</h1>
          <p className="mt-1 text-sm text-subtle">Visão do dono do Contatia sobre todos os workspaces. Leitura apenas.</p>
          <p className="mt-1 text-xs text-signal">✓ Régua de ciclo de vida ativa: boas-vindas, onboarding (D+1/D+3) e reengajamento (D+14) enviados automaticamente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard/superadmin/ia" className="btn-ghost">
            IA de atendimento →
            {iaPend ? <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{iaPend}</span> : null}
          </a>
          <a href="/dashboard/superadmin/suporte" className="btn-ghost">Suporte →</a>
          <a href="/dashboard/superadmin/comunicacao" className="btn-ghost">Comunicação →</a>
          <a href="/dashboard/superadmin/cobranca" className="btn-ghost">Cobrança →</a>
          <a href="/dashboard/superadmin/emails" className="btn-ghost">E-mails →</a>
          <a href="/dashboard/superadmin/feedbacks" className="btn-ghost">Feedbacks →</a>
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
              <th className="px-4 py-3 font-medium">Suporte</th>
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
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <ImpersonateButton tenantId={r.id} name={r.name} />
                    <SubscriptionButton tenantId={r.id} name={r.name} plans={(planos as any[]) || []} />
                    <DeleteWorkspaceButton tenantId={r.id} name={r.name} />
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-subtle">
                  <p className="font-semibold text-ink">Nenhum workspace retornado.</p>
                  <p className="mt-1 text-xs">
                    A consulta funcionou, mas veio vazia. Fonte dos dados:{" "}
                    <b>{rpcFallback ? "função do banco (sem service role)" : "service role"}</b>.
                    {rpcFallback
                      ? " Se você tem workspaces, rode a migration 0047 no Supabase."
                      : " Se você tem workspaces, verifique se a SUPABASE_SERVICE_ROLE_KEY do Vercel aponta para o projeto certo."}
                  </p>
                </td>
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
