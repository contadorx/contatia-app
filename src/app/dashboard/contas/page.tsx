import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AccountTools from "@/components/AccountTools";
import AccountImport from "@/components/AccountImport";
import AccountsCockpit from "@/components/AccountsCockpit";

export const dynamic = "force-dynamic";

export default async function Contas({ searchParams }: { searchParams: { tag?: string; q?: string } }) {
  const supabase = createClient();
  const q = (searchParams.q || "").trim();
  const qSafe = q.slice(0, 80).replace(/[,()%*]/g, " ").trim();

  let accountsQuery = supabase
    .from("accounts")
    .select("id, name, uf, municipio, cnpj, domain, contacts(id, name, role_title, email, last_activity_at), opportunities(id, title, value_mrr, status), account_tags(tags(id, name, color))")
    .order("created_at", { ascending: false })
    .limit(300);
  // busca por nome, CNPJ ou domínio
  if (qSafe) accountsQuery = accountsQuery.or(`name.ilike.%${qSafe}%,cnpj.ilike.%${qSafe}%,domain.ilike.%${qSafe}%`);
  const { data: accounts } = await accountsQuery;

  const { data: allTags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });

  let rows = ((accounts as any[]) || []).map((a) => ({
    id: a.id,
    name: a.name,
    domain: a.domain,
    cnpj: a.cnpj,
    uf: a.uf,
    municipio: a.municipio,
    contacts: (a.contacts as any[]) || [],
    opps: (a.opportunities as any[]) || [],
    ultimo: (((a.contacts as any[]) || [])
      .map((c) => c.last_activity_at)
      .filter(Boolean)
      .sort()
      .pop()) || null,
    tags: ((a.account_tags as any[]) || []).map((r) => r.tags).filter(Boolean),
  }));

  const tagFilter = searchParams.tag || "";
  if (tagFilter) rows = rows.filter((a) => a.tags.some((t: any) => t.id === tagFilter));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Empresas</h1>
      <p className="mt-1 text-sm text-subtle">As contas B2B: cada empresa reúne seus contatos e oportunidades.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <AccountTools />
        <AccountImport />
      </div>

      {/* busca por nome / CNPJ / domínio */}
      <form className="mt-4 flex flex-wrap items-center gap-2">
        {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
        <input
          name="q"
          defaultValue={q}
          className="input max-w-xs py-1.5 text-sm"
          placeholder="Buscar por nome, CNPJ ou domínio…"
        />
        <button className="btn-ghost py-1.5 text-sm" type="submit">Buscar</button>
        {q && (
          <a href={tagFilter ? `/dashboard/contas?tag=${tagFilter}` : "/dashboard/contas"} className="text-xs text-subtle hover:text-ink">limpar busca</a>
        )}
      </form>

      {/* filtro por tag */}
      {((allTags as any[]) || []).length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">Filtrar:</span>
          <Link href={q ? `/dashboard/contas?q=${encodeURIComponent(q)}` : "/dashboard/contas"} className={`rounded-full px-2 py-0.5 text-xs font-medium ${!tagFilter ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}>Todas</Link>
          {((allTags as any[]) || []).map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/contas?tag=${t.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={tagFilter === t.id ? { background: t.color, color: "#fff" } : { background: `${t.color}20`, color: t.color }}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6">
        <AccountsCockpit rows={rows} allTags={(allTags as any[]) || []} />
      </div>
    </div>
  );
}
