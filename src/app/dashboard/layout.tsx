import { UsageLimits } from "@/components/UsageLimits";
import { getUsage } from "@/lib/plan";
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

  // Busca o profile. IMPORTANTE: capturamos o erro — se a query falhar (RLS, coluna
  // ausente, etc.), o app antes concluía "sem workspace" silenciosamente.
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role, tenant_id, is_superadmin, impersonating_tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  // Fallback: se a query falhou (ex.: coluna de impersonação ainda não migrada),
  // tenta de novo só com as colunas essenciais para não travar o app.
  if (profileError) {
    const retry = await supabase
      .from("profiles")
      .select("full_name, role, tenant_id")
      .eq("id", user?.id ?? "")
      .maybeSingle();
    if (!retry.error && retry.data) {
      profile = retry.data as any;
      profileError = null as any;
    }
  }

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

  // uso × limites (avisa a partir de 80%, bloqueia no limite)
  const usos = profile?.tenant_id && !isSuperadmin ? await getUsage() : [];

  // respostas de WhatsApp não lidas → badge no menu
  let unreadReplies = 0;
  if (profile?.tenant_id) {
    const { count } = await supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .is("read_at", null);
    unreadReplies = count ?? 0;
  }
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
        roleLabel={profile?.role === "owner" ? "Dono" : "Parceiro"}
        unreadReplies={unreadReplies}
      />
      <div className="flex flex-1">
        <aside className="hidden w-56 flex-col self-start sticky top-0 h-screen overflow-y-auto border-r border-line bg-surface p-5 md:flex">
          <p className="font-display text-xl font-bold">
            Contat<span className="text-brand">ia</span>
          </p>

          <DashboardNav isSuperadmin={isSuperadmin} unreadReplies={unreadReplies} />

          <div className="mt-auto border-t border-line pt-4">
            <Link
              href="/dashboard/config"
              className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink hover:bg-muted"
            >
              <span aria-hidden>⚙️</span> Configurações
            </Link>
            <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
            <p className="mb-2 text-xs text-subtle">{profile?.role === "owner" ? "Dono" : "Parceiro"}</p>
            <SignOut />
          </div>
        </aside>

        <main className="flex-1 p-6 md:p-10">
          {usos.length > 0 && <UsageLimits usos={usos} compacto />}
          {showSubBanner && !noTenant && (
            <a href="/dashboard/planos" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm hover:border-brand">
              <span className="font-medium text-brand-dark">{bannerMsg}</span>
              <span className="font-semibold text-brand">Ver planos →</span>
            </a>
          )}
        {noTenant ? (
          <div className="card mx-auto max-w-2xl p-8">
            <p className="font-display text-lg font-bold">Não consegui carregar seu workspace</p>
            <p className="mt-2 text-sm text-subtle">
              Seu login está ativo, mas o app não conseguiu ler o workspace vinculado à conta.
              O diagnóstico abaixo mostra exatamente o que o sistema enxergou:
            </p>

            <div className="mt-4 space-y-2 rounded-xl bg-muted p-4 font-mono text-xs">
              <p>usuário autenticado: <b>{user?.id ? "SIM" : "NÃO"}</b></p>
              <p>id da sessão: <b>{user?.id || "(vazio)"}</b></p>
              <p>e-mail da sessão: <b>{user?.email || "(vazio)"}</b></p>
              <p>perfil encontrado: <b>{profile ? "SIM" : "NÃO"}</b></p>
              <p>workspace no perfil: <b>{(profile as any)?.tenant_id || "(vazio)"}</b></p>
              <p className={profileError ? "text-danger" : ""}>
                erro na consulta: <b>{profileError ? (profileError as any).message : "nenhum"}</b>
              </p>
            </div>

            <p className="mt-4 text-sm text-subtle">
              {!profile
                ? "O perfil não foi encontrado para o id da sessão acima. Isso indica que o id do login não corresponde a nenhum registro de perfil."
                : "O perfil existe, mas está sem workspace vinculado."}
            </p>
            <p className="mt-2 text-xs text-subtle">Envie um print desta tela para o suporte — ela contém tudo o que é preciso para resolver.</p>
          </div>
        ) : (
          children
        )}
      </main>
      </div>
      <HelpWidget />
    </div>
  );
}
