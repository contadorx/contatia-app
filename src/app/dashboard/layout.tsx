import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/dashboard", label: "Hoje" },
  { href: "/dashboard/pipeline", label: "Pipeline" },
  { href: "/dashboard/reunioes", label: "Reuniões" },
  { href: "/dashboard/cadencias", label: "Cadências" },
  { href: "/dashboard/contatos", label: "Contatos" },
  { href: "/dashboard/contas", label: "Empresas" },
  { href: "/dashboard/radar", label: "Radar" },
  { href: "/dashboard/config", label: "Config" },
];

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
    .select("full_name, role, tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const noTenant = !profile?.tenant_id;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 flex-col border-r border-line bg-surface p-5 md:flex">
        <p className="font-display text-xl font-bold">
          Contat<span className="text-brand">ia</span>
        </p>
        <nav className="mt-8 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded-xl px-3 py-2 text-sm font-medium text-ink hover:bg-muted"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-line pt-4">
          <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
          <p className="mb-2 text-xs text-subtle">{profile?.role === "owner" ? "Owner" : "Parceiro"}</p>
          <SignOut />
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-10">
        {noTenant ? (
          <div className="card mx-auto max-w-lg p-8 text-center">
            <p className="font-display text-lg font-bold">Conta ainda sem workspace</p>
            <p className="mt-2 text-sm text-subtle">
              Seu login foi criado. Rode o bloco SEED da migration para atribuir seu
              tenant e o papel de owner — depois recarregue. (Passo único de bootstrap.)
            </p>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
