import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOut from "@/components/SignOut";
import DashboardNav from "@/components/DashboardNav";
import { MobileNav } from "@/components/MobileNav";
import { stopImpersonation } from "@/app/dashboard/superadmin/impersonate-actions";
import { HelpWidget } from "@/components/HelpWidget";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, tenant_id, is_superadmin, impersonating_tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const noTenant = !profile?.tenant_id;
  const isSuperadmin = !!(profile as any)?.is_superadmin;

  // impersonação: superadmin dentro de um workspace para dar suporte
  const impersonatingId = (profile as any)?.impersonating_tenant_id as string | null;
  let impersonatingName: string | null = null;
  if (impersonatingId) {
    const { data: it } = await supabase.from("tenants").select("name").eq("id", impersonatingId).maybeSingle();
    impersonatingName = (it as any)?.name || "workspace";
  }

  // status de assinatura para o banner de conversão (só quando há workspace)
  let subStatus: string | undefined;
  if (profile?.tenant_id) {
    const { data: t } = await supabase.from("tenants").select("subscription_status").eq("id", profile.tenant_id).maybeSingle();
    subStatus = (t as any)?.subscription_status;
  }
  const showSubBanner = !isSuperadmin && (!subStatus || ["trialing", "pending", "past_due", "canceled"].includes(subStatus));
  const bannerText: Record<string, string> = {
    past_due: "Seu pagamento está em atraso. Regularize para não perder o acesso.",
    pending: "Falta o pagamento para ativar sua assinatura.",
    canceled: "Sua assinatura foi cancelada. Reative quando quiser.",
  };
  const bannerMsg = (subStatus && bannerText[subStatus]) || "Você está no período de teste. Escolha um plano para continuar sem interrupção.";

  return (
    <div className="flex min-h-screen flex-col">
      {impersonatingId && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-warn px-4 py-2 text-center text-sm font-semibold text-white">
          <span>⚠ Modo suporte — você está vendo o workspace <b>{impersonatingName}</b> como o cliente.</span>
          <form action={stopImpersonation}>
            <button className="rounded-md bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30">Sair do modo suporte</button>
          </form>
        </div>
      )}
      <MobileNav
        isSuperadmin={isSuperadmin}
        userLabel={profile?.full_name || user?.email || undefined}
        roleLabel={profile?.role === "owner" ? "Owner" : "Parceiro"}
      />
      <div className="flex flex-1">
        <aside className="hidden w-56 flex-col border-r border-line bg-surface p-5 md:flex">
          <p className="font-display text-xl font-bold">
            Contat<span className="text-brand">ia</span>
          </p>

          <DashboardNav isSuperadmin={isSuperadmin} />

          <div className="mt-auto border-t border-line pt-4">
            <Link
              href="/dashboard/config"
              className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink hover:bg-muted"
            >
              <span aria-hidden>⚙️</span> Configurações
            </Link>
            <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
            <p className="mb-2 text-xs text-subtle">{profile?.role === "owner" ? "Owner" : "Parceiro"}</p>
            <SignOut />
          </div>
        </aside>

        <main className="flex-1 p-6 md:p-10">
          {showSubBanner && !noTenant && (
            <a href="/dashboard/planos" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm hover:border-brand">
              <span className="font-medium text-brand-dark">{bannerMsg}</span>
              <span className="font-semibold text-brand">Ver planos →</span>
            </a>
          )}
        {noTenant ? (
          isSuperadmin ? (
            <div className="card mx-auto max-w-lg p-8 text-center">
              <p className="font-display text-lg font-bold">Painel do superadmin</p>
              <p className="mt-2 text-sm text-subtle">
                Sua conta é de plataforma e não pertence a um workspace. Para ver a
                configuração de Negócio, o pipeline ou dar suporte a um cliente, use o
                painel e entre no workspace pelo botão <b>Entrar</b>.
              </p>
              <Link href="/dashboard/superadmin" className="btn-brand mt-4 inline-flex">Abrir painel de workspaces →</Link>
            </div>
          ) : (
            <div className="card mx-auto max-w-lg p-8 text-center">
              <p className="font-display text-lg font-bold">Conta ainda sem workspace</p>
              <p className="mt-2 text-sm text-subtle">
                Seu login foi criado. Rode o bloco SEED da migration para atribuir seu
                tenant e o papel de owner — depois recarregue. (Passo único de bootstrap.)
              </p>
            </div>
          )
        ) : (
          children
        )}
      </main>
      </div>
      <HelpWidget />
    </div>
  );
}
