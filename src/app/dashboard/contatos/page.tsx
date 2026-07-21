import { createClient } from "@/lib/supabase/server";
import ContactTools from "@/components/ContactTools";
import ContactsTable from "@/components/ContactsTable";
import Link from "next/link";
import { isManager } from "@/lib/permissions";
import { produtosPorContatos, contatoIdsPorProduto } from "@/lib/produtos";

export const dynamic = "force-dynamic";

const NENHUM = "00000000-0000-0000-0000-000000000000";

export default async function Contatos({ searchParams }: { searchParams: { tag?: string; q?: string; frio?: string; produto?: string; cadencia?: string } }) {
  const supabase = createClient();
  const tagFilter = searchParams.tag;
  const produtoFilter = searchParams.produto || "";
  const cadenciaFilter = searchParams.cadencia || "";
  const frio = searchParams.frio || ""; // "15" | "30" | "nunca"
  const q = (searchParams.q || "").trim();
  // sanitiza para o filtro .or() do PostgREST (vírgula/parênteses/% têm significado)
  const qSafe = q.slice(0, 80).replace(/[,()%*]/g, " ").trim();

  // Visibilidade por papel: Dono/Admin/Gestor veem os contatos de toda a equipe;
  // Vendedor/SDR veem só os seus (assigned_to = você).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const gerente = isManager((me as any)?.role, (me as any)?.team_role);

  const { data: tags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  const { count: suggestionCount } = await supabase.from("contact_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");

  // Filtros que restringem por lista de IDs (tag e produto). Intersectamos.
  const idConstraints: string[][] = [];
  if (tagFilter) {
    const { data: ct } = await supabase.from("contact_tags").select("contact_id").eq("tag_id", tagFilter);
    idConstraints.push(((ct as any[]) || []).map((r) => r.contact_id));
  }
  if (produtoFilter) {
    idConstraints.push(await contatoIdsPorProduto(supabase, produtoFilter));
  }
  if (cadenciaFilter) {
    // contatos ativos/pausados nesta cadência
    const { data: en } = await supabase
      .from("enrollments")
      .select("contact_id")
      .eq("sequence_id", cadenciaFilter)
      .in("status", ["active", "paused"]);
    idConstraints.push(((en as any[]) || []).map((r) => r.contact_id));
  }
  let idsFiltro: string[] | null = null;
  if (idConstraints.length) {
    idsFiltro = idConstraints.reduce((acc, cur) => acc.filter((id) => cur.includes(id)));
  }

  let contactsQuery = supabase
    .from("contacts")
    .select("id, name, email, phone, company, origin, status, score, assigned_to, created_at, last_activity_at, contact_tags(tag_id, tags(id, name, color))")
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (idsFiltro) contactsQuery = contactsQuery.in("id", idsFiltro.length ? idsFiltro : [NENHUM]);
  if (!gerente) contactsQuery = contactsQuery.eq("assigned_to", user?.id ?? "");
  // busca por nome, e-mail ou empresa
  if (qSafe) contactsQuery = contactsQuery.or(`name.ilike.%${qSafe}%,email.ilike.%${qSafe}%,company.ilike.%${qSafe}%`);
  // filtro de "frios": sem toque há N dias (ou nunca tocados)
  if (frio === "nunca") {
    contactsQuery = contactsQuery.is("last_activity_at", null);
  } else if (frio === "15" || frio === "30") {
    const corte = new Date();
    corte.setDate(corte.getDate() - Number(frio));
    contactsQuery = contactsQuery.or(`last_activity_at.is.null,last_activity_at.lt.${corte.toISOString()}`);
  }

  const [{ data: contacts }, { data: sequences }, { data: members }, { data: produtos }] = await Promise.all([
    contactsQuery,
    supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);

  const seqs = (sequences as { id: string; name: string }[]) || [];
  const memberList = (members as { id: string; full_name: string | null; email: string }[]) || [];
  const tagList = (tags as { id: string; name: string; color: string }[]) || [];
  const produtoList = (produtos as { id: string; name: string }[]) || [];

  // produtos por contato (para as etiquetas na lista) — 2 queries, não N
  const contatoIds = ((contacts as any[]) || []).map((c) => c.id);
  const produtosPorId = await produtosPorContatos(supabase, contatoIds);
  const produtosContato: Record<string, { id: string; name: string }[]> = {};
  for (const [cid, arr] of Object.entries(produtosPorId)) produtosContato[cid] = arr.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Contatos</h1>
          <p className="mt-1 text-sm text-subtle">Sua base de prospecção e relacionamento. Selecione vários para inscrever, atribuir ou taguear em lote.</p>
        </div>
        {(suggestionCount ?? 0) > 0 && (
          <a href="/dashboard/contatos/sugestoes" className="shrink-0 rounded-lg bg-warn/10 px-3 py-2 text-sm font-semibold text-warn hover:bg-warn/20">
            {suggestionCount} {suggestionCount === 1 ? "sugestão" : "sugestões"} →
          </a>
        )}
      </div>

      <div className="mt-6">
        <ContactTools />
      </div>

      {/* Busca por nome / e-mail / empresa */}
      <form className="mt-4 flex flex-wrap items-center gap-2">
        {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
        <input
          name="q"
          defaultValue={q}
          className="input max-w-xs py-1.5 text-sm"
          placeholder="Buscar por nome, e-mail ou empresa…"
        />
        <button className="btn-ghost py-1.5 text-sm" type="submit">Buscar</button>
        {q && (
          <a href={tagFilter ? `/dashboard/contatos?tag=${tagFilter}` : "/dashboard/contatos"} className="text-xs text-subtle hover:text-ink">
            limpar busca
          </a>
        )}
        {q && <span className="text-xs text-subtle">Resultados para “{q}”</span>}
      </form>

      {/* Filtro por tag */}
      {tagList.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Filtrar por tag:</span>
          <Link href={q ? `/dashboard/contatos?q=${encodeURIComponent(q)}` : "/dashboard/contatos"} className={`rounded-full px-3 py-1 text-xs ${!tagFilter ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}>
            Todos
          </Link>
          {tagList.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/contatos?tag=${t.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs ${tagFilter === t.id ? "text-white" : "text-ink hover:opacity-80"}`}
              style={{ background: tagFilter === t.id ? t.color : `${t.color}22` }}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      {/* Filtro por produto */}
      {produtoList.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Produto:</span>
          {[{ id: "", name: "Todos" }, ...produtoList].map((p) => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (tagFilter) params.set("tag", tagFilter);
            if (frio) params.set("frio", frio);
            if (cadenciaFilter) params.set("cadencia", cadenciaFilter);
            if (p.id) params.set("produto", p.id);
            const href = `/dashboard/contatos${params.toString() ? `?${params.toString()}` : ""}`;
            const ativo = produtoFilter === p.id;
            return (
              <Link key={p.id || "todos"} href={href} className={`rounded-full px-3 py-1 text-xs ${ativo ? "bg-brand text-white" : "border border-brand/25 bg-brand/5 text-brand-dark hover:bg-brand/10"}`}>
                {p.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* Filtro por cadência inscrita */}
      {seqs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Cadência:</span>
          {[{ id: "", name: "Todas" }, ...seqs].map((s) => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (tagFilter) params.set("tag", tagFilter);
            if (produtoFilter) params.set("produto", produtoFilter);
            if (frio) params.set("frio", frio);
            if (s.id) params.set("cadencia", s.id);
            const href = `/dashboard/contatos${params.toString() ? `?${params.toString()}` : ""}`;
            const ativo = cadenciaFilter === s.id;
            return (
              <Link key={s.id || "todas"} href={href} className={`rounded-full px-3 py-1 text-xs ${ativo ? "bg-brand text-white" : "border border-brand/25 bg-brand/5 text-brand-dark hover:bg-brand/10"}`}>
                {s.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* Filtro por último toque (carteira fria) */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">Último toque:</span>
        {[
          { k: "", label: "Todos" },
          { k: "15", label: "Frios +15d" },
          { k: "30", label: "Frios +30d" },
          { k: "nunca", label: "Nunca tocados" },
        ].map((o) => {
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (tagFilter) params.set("tag", tagFilter);
          if (produtoFilter) params.set("produto", produtoFilter);
          if (cadenciaFilter) params.set("cadencia", cadenciaFilter);
          if (o.k) params.set("frio", o.k);
          const href = `/dashboard/contatos${params.toString() ? `?${params.toString()}` : ""}`;
          const ativo = frio === o.k;
          return (
            <Link key={o.k || "todos"} href={href} className={`rounded-full px-3 py-1 text-xs ${ativo ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}>
              {o.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-4">
        <ContactsTable contacts={(contacts as any[]) || []} sequences={seqs} members={memberList} tags={tagList} products={produtosContato} />
      </div>
    </div>
  );
}
