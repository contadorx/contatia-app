import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AccountTools from "@/components/AccountTools";
import AccountImport from "@/components/AccountImport";

export const dynamic = "force-dynamic";

export default async function Contas({ searchParams }: { searchParams: { tag?: string; q?: string } }) {
  const supabase = createClient();
  const q = (searchParams.q || "").trim();
  const qSafe = q.slice(0, 80).replace(/[,()%*]/g, " ").trim();

  let accountsQuery = supabase
    .from("accounts")
    .select("id, name, uf, cnpj, domain, contacts(count), opportunities(count), account_tags(tags(id, name, color))")
    .order("created_at", { ascending: false })
    .limit(300);
  // busca por nome, CNPJ ou domínio
  if (qSafe) accountsQuery = accountsQuery.or(`name.ilike.%${qSafe}%,cnpj.ilike.%${qSafe}%,domain.ilike.%${qSafe}%`);
  const { data: accounts } = await accountsQuery;

  const { data: allTags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });

  let rows = ((accounts as any[]) || []).map((a) => ({
    ...a,
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

      <div className="card mt-6 overflow-hidden">
        {!rows.length ? (
          <div className="p-10 text-center text-sm text-subtle">{tagFilter ? "Nenhuma empresa com essa tag." : "Nenhuma empresa ainda. Crie a primeira acima."}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Tags</th>
                <th className="px-4 py-3 font-medium">UF</th>
                <th className="px-4 py-3 font-medium">Contatos</th>
                <th className="px-4 py-3 font-medium">Oportunidades</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0 hover:bg-muted">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/contas/${a.id}`} className="text-brand-dark hover:underline">
                      {a.name}
                    </Link>
                    {a.domain && <span className="ml-2 text-xs text-subtle">{a.domain}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {a.tags.map((t: any) => (
                        <span key={t.id} className="rounded-full px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `${t.color}20`, color: t.color }}>{t.name}</span>
                      ))}
                      {!a.tags.length && <span className="text-xs text-subtle">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-subtle">{a.uf || "—"}</td>
                  <td className="px-4 py-3 text-subtle">{a.contacts?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3 text-subtle">{a.opportunities?.[0]?.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
