import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AccountTools from "@/components/AccountTools";
import AccountImport from "@/components/AccountImport";
import AccountsCockpit from "@/components/AccountsCockpit";
import { produtosPorContatos } from "@/lib/produtos";

export const dynamic = "force-dynamic";

export default async function Contas({ searchParams }: { searchParams: { tag?: string; q?: string; produto?: string } }) {
  const supabase = createClient();
  const q = (searchParams.q || "").trim();
  const qSafe = q.slice(0, 80).replace(/[,()%*]/g, " ").trim();

  let accountsQuery = supabase
    .from("accounts")
    .select("id, name, uf, municipio, cnpj, domain, contacts(id, name, role_title, email, last_activity_at), opportunities(id, title, value_mrr, status, product_id, products(id, name)), account_tags(tags(id, name, color))")
    .order("created_at", { ascending: false })
    .limit(300);
  // busca por nome, CNPJ ou domínio
  if (qSafe) accountsQuery = accountsQuery.or(`name.ilike.%${qSafe}%,cnpj.ilike.%${qSafe}%,domain.ilike.%${qSafe}%`);
  const { data: accounts } = await accountsQuery;

  const [{ data: allTags }, { data: produtos }] = await Promise.all([
    supabase.from("tags").select("id, name, color").order("name", { ascending: true }),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);
  const produtoList = (produtos as { id: string; name: string }[]) || [];

  // produtos por contato (agregamos por empresa depois) — 2 queries no total
  const todosContatoIds = ((accounts as any[]) || []).flatMap((a) => ((a.contacts as any[]) || []).map((c) => c.id));
  const produtosPorId = await produtosPorContatos(supabase, todosContatoIds);

  let rows = ((accounts as any[]) || []).map((a) => {
    const contacts = (a.contacts as any[]) || [];
    const opps = (a.opportunities as any[]) || [];
    // produtos da empresa = união dos produtos dos contatos + produtos das oportunidades
    const map = new Map<string, { id: string; name: string }>();
    for (const c of contacts) for (const p of produtosPorId[c.id] || []) map.set(p.id, { id: p.id, name: p.name });
    for (const o of opps) if (o.products?.id) map.set(o.products.id, { id: o.products.id, name: o.products.name });
    return {
      id: a.id,
      name: a.name,
      domain: a.domain,
      cnpj: a.cnpj,
      uf: a.uf,
      municipio: a.municipio,
      contacts,
      opps,
      produtos: Array.from(map.values()).sort((x, y) => x.name.localeCompare(y.name, "pt-BR")),
      ultimo: (contacts
        .map((c) => c.last_activity_at)
        .filter(Boolean)
        .sort()
        .pop()) || null,
      tags: ((a.account_tags as any[]) || []).map((r) => r.tags).filter(Boolean),
    };
  });

  const tagFilter = searchParams.tag || "";
  if (tagFilter) rows = rows.filter((a) => a.tags.some((t: any) => t.id === tagFilter));
  const produtoFilter = searchParams.produto || "";
  if (produtoFilter) rows = rows.filter((a) => a.produtos.some((p) => p.id === produtoFilter));

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
              href={`/dashboard/contas?tag=${t.id}${q ? `&q=${encodeURIComponent(q)}` : ""}${produtoFilter ? `&produto=${produtoFilter}` : ""}`}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={tagFilter === t.id ? { background: t.color, color: "#fff" } : { background: `${t.color}20`, color: t.color }}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      {/* filtro por produto */}
      {produtoList.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">Produto:</span>
          {[{ id: "", name: "Todos" }, ...produtoList].map((p) => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (tagFilter) params.set("tag", tagFilter);
            if (p.id) params.set("produto", p.id);
            const href = `/dashboard/contas${params.toString() ? `?${params.toString()}` : ""}`;
            const ativo = produtoFilter === p.id;
            return (
              <Link key={p.id || "todos"} href={href} className={`rounded-full px-2 py-0.5 text-xs font-medium ${ativo ? "bg-brand text-white" : "border border-brand/25 bg-brand/5 text-brand-dark hover:bg-brand/10"}`}>
                {p.name}
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <AccountsCockpit rows={rows} allTags={(allTags as any[]) || []} />
      </div>
    </div>
  );
}
