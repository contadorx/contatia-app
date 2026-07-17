import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const KIND: Record<string, { l: string; c: string }> = {
  comunicacao: { l: "Ciclo de vida", c: "bg-brand-soft text-brand-dark" },
  cobranca: { l: "Cobrança", c: "bg-warn/10 text-warn" },
  suporte: { l: "Suporte", c: "bg-muted text-subtle" },
  vendas: { l: "Vendas", c: "bg-signal/10 text-signal" },
  outro: { l: "Outro", c: "bg-muted text-subtle" },
};

export default async function EmailsPage({ searchParams }: { searchParams: { kind?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) redirect("/dashboard");

  const kind = searchParams?.kind || "";
  let q = supabase
    .from("email_log")
    .select("id, to_email, subject, kind, status, error, created_at, tenant_id, tenants(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (kind) q = q.eq("kind", kind);
  const { data: rows } = await q;
  const list = (rows as any[]) || [];

  const filters = ["", "comunicacao", "cobranca", "suporte", "vendas"];

  return (
    <div className="max-w-4xl">
      <p className="mb-1 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link> · E-mails
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Central de E-mails</h1>
        <Link href="/dashboard/superadmin/comunicacao" className="btn-ghost text-sm">Editar réguas →</Link>
      </div>
      <p className="mt-1 text-sm text-subtle">Tudo o que a plataforma enviou automaticamente (réguas de comunicação e cobrança).</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f || "all"}
            href={f ? `/dashboard/superadmin/emails?kind=${f}` : "/dashboard/superadmin/emails"}
            className={`rounded-full px-3 py-1 text-xs font-medium ${kind === f ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}
          >
            {f ? KIND[f]?.l || f : "Todos"}
          </Link>
        ))}
      </div>

      <div className="mt-4 card divide-y divide-line">
        {!list.length && <p className="p-8 text-center text-sm text-subtle">Nenhum e-mail registrado ainda. (O log passa a gravar a partir desta versão.)</p>}
        {list.map((r) => {
          const k = KIND[r.kind] || KIND.outro;
          return (
            <div key={r.id} className="flex items-start gap-3 p-3">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${k.c}`}>{k.l}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.subject || "(sem assunto)"}</p>
                <p className="text-xs text-subtle">
                  {r.to_email} · {r.tenants?.name || "—"} · {new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
                {r.status === "error" && <p className="text-xs text-danger">falhou: {r.error}</p>}
              </div>
              {r.status === "sent" ? <span className="text-xs text-signal">✓</span> : <span className="text-xs text-danger">✕</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
