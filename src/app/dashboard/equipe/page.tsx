import { TeamManager } from "@/components/TeamManager";
import { createClient } from "@/lib/supabase/server";
import { HOT_THRESHOLD } from "@/lib/scoring";
import TeamTools from "@/components/TeamTools";
import InviteTools from "@/components/InviteTools";
import PermissionMatrix from "@/components/PermissionMatrix";
import { isManager as isMgr, effectiveRole, ROLE_LABEL, type Role } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function Equipe() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: meProfile } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const canManage = isMgr((meProfile as any)?.role, (meProfile as any)?.team_role);
  // B2: convidar é capability "team" = dono OU admin (gestor gerencia, mas não convida)
  const canInvite = (meProfile as any)?.role === "owner" || (meProfile as any)?.team_role === "admin";

  const [{ data: members }, { data: contacts }, { data: opps }, { count: unassignedCount }, { data: invites }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, team_role, is_active").order("full_name", { ascending: true }),
    supabase.from("contacts").select("assigned_to, score"),
    supabase.from("opportunities").select("owner_id, status, value_mrr"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).is("assigned_to", null),
    supabase.from("tenant_invites").select("id, email, token, expires_at").is("accepted_at", null).order("created_at", { ascending: false }),
  ]);

  const mem = (members as any[]) || [];
  const cts = (contacts as any[]) || [];
  const ops = (opps as any[]) || [];

  const rows = mem.map((m) => {
    const myContacts = cts.filter((c) => c.assigned_to === m.id);
    const hot = myContacts.filter((c) => (c.score ?? 0) >= HOT_THRESHOLD).length;
    const won = ops.filter((o) => o.owner_id === m.id && o.status === "won");
    const openOps = ops.filter((o) => o.owner_id === m.id && o.status === "open");
    return {
      id: m.id,
      name: m.full_name || m.email,
      eff: effectiveRole(m.role, m.team_role) as Role,
      active: m.is_active,
      contacts: myContacts.length,
      hot,
      openMrr: openOps.reduce((s, o) => s + Number(o.value_mrr || 0), 0),
      wonMrr: won.reduce((s, o) => s + Number(o.value_mrr || 0), 0),
    };
  });

  // --- papéis, permissões de agenda e teto do plano ---
  const { checkSeats } = await import("@/app/dashboard/equipe/team-actions");
  const seats = await checkSeats();

  const { data: permsData } = await supabase
    .from("calendar_permissions")
    .select("sdr_id, seller_id, can_book");

  const membrosList = ((members as any[]) || []).map((p) => ({
    id: p.id,
    name: p.full_name || p.email || "sem nome",
    email: p.email || "",
    role: p.role || "partner",
    team_role: p.team_role ?? null,
  }));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Equipe</h1>
      <p className="mt-1 text-sm text-subtle">
        Placar por vendedor e distribuição da carteira. {unassignedCount ?? 0} contato(s) sem dono.
      </p>

      {/* PLACAR — o que se olha no dia a dia */}
      <div className="card mt-6 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-lg font-bold">Placar da equipe</h2>
          <p className="text-xs text-subtle">Carteira, quentes e receita por pessoa. Placar leve, sem microgestão.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Vendedor</th>
                <th className="px-4 py-3 font-medium">Papel</th>
                <th className="px-4 py-3 font-medium">Contatos</th>
                <th className="px-4 py-3 font-medium">Quentes</th>
                <th className="px-4 py-3 font-medium">Negócios em aberto</th>
                <th className="px-4 py-3 font-medium">Receita fechada (mês)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {r.name}
                    {!r.active && <span className="ml-1 text-xs text-subtle">(inativo)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">{ROLE_LABEL[r.eff] || r.eff}</span>
                  </td>
                  <td className="px-4 py-3 text-subtle">{r.contacts}</td>
                  <td className="px-4 py-3">
                    <span className={r.hot > 0 ? "font-semibold text-warn" : "text-subtle"}>{r.hot}</span>
                  </td>
                  <td className="px-4 py-3 text-subtle">{brl(r.openMrr)}</td>
                  <td className="px-4 py-3 font-semibold text-signal">{brl(r.wonMrr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ORGANIZAR A CARTEIRA */}
      <div className="mt-6">
        <h2 className="font-display text-lg font-bold">Organizar a carteira</h2>
        <p className="mt-1 text-sm text-subtle">Divida os contatos sem dono e limpe duplicados de uma vez.</p>
        <div className="mt-3">
          <TeamTools />
        </div>
      </div>

      {/* GERENCIAR PESSOAS E PAPÉIS — só para quem gerencia (Dono/Admin/Gestor) */}
      {canManage && (
        <details className="card mt-6 p-5" open>
          <summary className="cursor-pointer select-none font-display text-lg font-bold">
            Gerenciar pessoas e papéis
          </summary>
          <p className="mt-1 text-sm text-subtle">Convide pessoas, defina o papel de cada uma e libere agendas para os SDRs.</p>

          {canInvite && (
            <div className="mt-4">
              <InviteTools pending={(invites as any[]) || []} />
            </div>
          )}

          <div className="mt-6">
            <TeamManager
              membros={membrosList}
              permissoes={(permsData as any[]) || []}
              meuId={user?.id || ""}
              souAdmin={(meProfile as any)?.role === "owner"}
              canManage={canManage}
              seats={seats}
            />
          </div>
        </details>
      )}

      {/* MATRIZ DE PERMISSÕES — referência, colapsável */}
      <details className="card mt-6 p-5">
        <summary className="cursor-pointer select-none font-display text-lg font-bold">
          O que cada papel faz
        </summary>
        <p className="mt-1 text-sm text-subtle">A referência de permissões de cada papel. Mudou o papel de alguém acima? Estas regras passam a valer para a pessoa.</p>
        <div className="mt-4">
          <PermissionMatrix />
        </div>
      </details>
    </div>
  );
}
