import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AcceptInviteButton from "@/components/AcceptInviteButton";

export const dynamic = "force-dynamic";

export default async function ConvitePage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="card w-full max-w-md p-8">
        <p className="font-display text-2xl font-bold text-ink">
          Contat<span className="text-brand">ia</span>
        </p>

        {!user ? (
          <>
            <p className="mt-4 text-sm text-subtle">
              Você recebeu um convite para entrar em um workspace. Entre ou crie sua conta para aceitar.
            </p>
            <Link href={`/login?next=/convite/${params.token}`} className="btn-brand mt-5 inline-block">
              Entrar ou criar conta
            </Link>
          </>
        ) : (
          <InviteBody token={params.token} />
        )}
      </div>
    </main>
  );
}

async function InviteBody({ token }: { token: string }) {
  const supabase = createClient();
  const { data } = await supabase.rpc("invite_info", { p_token: token });
  const info = Array.isArray(data) ? data[0] : data;

  if (!info || !info.valid) {
    return (
      <>
        <p className="mt-4 text-sm text-danger">Este convite é inválido ou expirou.</p>
        <Link href="/dashboard" className="btn-ghost mt-4 inline-block">
          Ir para o app
        </Link>
      </>
    );
  }

  return (
    <>
      <p className="mt-4 text-sm text-subtle">
        Você foi convidado para o workspace <b className="text-ink">{info.tenant_name}</b>.
      </p>
      <p className="mt-1 text-xs text-subtle">Ao aceitar, sua conta passa a fazer parte dessa equipe.</p>
      <div className="mt-5">
        <AcceptInviteButton token={token} />
      </div>
    </>
  );
}
