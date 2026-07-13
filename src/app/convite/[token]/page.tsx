import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import AcceptInviteButton from "@/components/AcceptInviteButton";
import JoinInviteForm from "@/components/JoinInviteForm";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";

export default async function ConvitePage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Lê o convite com o service client (o visitante pode estar SEM login, e a RLS
  // de tenant_invites só libera para o owner). Só expõe nome do workspace + e-mail.
  const admin = createAdminClient();
  const { data: inv } = admin
    ? await admin
        .from("tenant_invites")
        .select("email, expires_at, accepted_at, tenants(name)")
        .eq("token", params.token)
        .maybeSingle()
    : { data: null };

  const invEmail = (inv as any)?.email as string | undefined;
  const tenantsRel = (inv as any)?.tenants;
  const tenantName = (Array.isArray(tenantsRel) ? tenantsRel[0]?.name : tenantsRel?.name) || "workspace";
  const valid = !!inv && !(inv as any).accepted_at && new Date((inv as any).expires_at) > new Date();

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="card w-full max-w-md p-8">
        <p className="font-display text-2xl font-bold text-ink">
          Contat<span className="text-brand">ia</span>
        </p>

        {!valid ? (
          <>
            <p className="mt-4 text-sm text-danger">Este convite é inválido ou expirou.</p>
            <p className="mt-2 text-xs text-subtle">Peça um novo link para quem te convidou.</p>
          </>
        ) : !user ? (
          // Sem login → cria a senha e entra direto pelo convite
          <JoinInviteForm token={params.token} email={invEmail || ""} tenantName={tenantName} />
        ) : user.email?.toLowerCase() === (invEmail || "").toLowerCase() ? (
          // Logado com o e-mail do convite → aceitar
          <>
            <p className="mt-4 text-sm text-subtle">
              Você foi convidado para o workspace <b className="text-ink">{tenantName}</b>.
            </p>
            <p className="mt-1 text-xs text-subtle">Ao aceitar, sua conta passa a fazer parte dessa equipe.</p>
            <div className="mt-5">
              <AcceptInviteButton token={params.token} />
            </div>
          </>
        ) : (
          // Logado com OUTRO e-mail → precisa sair e entrar com o e-mail convidado
          <>
            <p className="mt-4 text-sm text-subtle">
              Este convite é para <b className="text-ink">{invEmail}</b>, mas você está conectado como{" "}
              <b className="text-ink">{user.email}</b>.
            </p>
            <p className="mt-1 text-xs text-subtle">Saia e abra o link novamente para entrar com o e-mail convidado.</p>
            <div className="mt-4"><SignOut /></div>
            <Link href="/dashboard" className="mt-3 inline-block text-xs text-subtle hover:text-brand">Ir para o meu workspace</Link>
          </>
        )}
      </div>
    </main>
  );
}
