import { createClient } from "@/lib/supabase/server";
import AccountTools from "@/components/AccountTools";
import AccountImport from "@/components/AccountImport";
import AccountsCockpit from "@/components/AccountsCockpit";
import AccountsFilterBar from "@/components/AccountsFilterBar";
import { produtosPorContatos } from "@/lib/produtos";

export const dynamic = "force-dynamic";

export default async function Contas({ searchParams }: { searchParams: { tag?: string; q?: string; produto?: string; view?: string } }) {
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

  const [{ data: allTags }, { data: produtos }, { data: members }] = await Promise.all([
    supabase.from("tags").select("id, name, color").order("name", { ascending: true }),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);
  const produtoList = (produtos as { id: string; name: string }[]) || [];
  const memberList = (members as { id: string; full_name: string | null; email: string }[]) || [];

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

  // Visões rápidas (in-memory) — o "trabalho do dia" em Empresas
  const view = searchParams.view || "";
  if (view === "sem_contato") rows = rows.filter((a) => a.contacts.length === 0);
  else if (view === "sem_opp") rows = rows.filter((a) => a.opps.length === 0);
  else if (view === "com_opp") rows = rows.filter((a) => a.opps.some((o: any) => o.status === "open"));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Empresas</h1>
      <p className="mt-1 text-sm text-subtle">As contas B2B: cada empresa reúne seus contatos e oportunidades.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <AccountTools />
        <AccountImport />
      </div>

      <AccountsFilterBar
        view={view}
        q={q}
        tag={tagFilter}
        produto={produtoFilter}
        tags={(allTags as { id: string; name: string }[]) || []}
        produtos={produtoList}
      />

      <div className="mt-6">
        <AccountsCockpit rows={rows} allTags={(allTags as any[]) || []} members={memberList} />
      </div>
    </div>
  );
}
