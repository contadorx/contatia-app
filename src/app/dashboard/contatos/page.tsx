import { createClient } from "@/lib/supabase/server";
import ContactTools from "@/components/ContactTools";
import ContactsTable from "@/components/ContactsTable";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Contatos({ searchParams }: { searchParams: { tag?: string } }) {
  const supabase = createClient();
  const tagFilter = searchParams.tag;

  const { data: tags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  const { count: suggestionCount } = await supabase.from("contact_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");

  // se filtrando por tag, pega os contact_ids com aquela tag
  let idsWithTag: string[] | null = null;
  if (tagFilter) {
    const { data: ct } = await supabase.from("contact_tags").select("contact_id").eq("tag_id", tagFilter);
    idsWithTag = ((ct as any[]) || []).map((r) => r.contact_id);
  }

  let contactsQuery = supabase
    .from("contacts")
    .select("id, name, email, phone, company, origin, status, score, assigned_to, created_at, contact_tags(tag_id, tags(id, name, color))")
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (idsWithTag) contactsQuery = contactsQuery.in("id", idsWithTag.length ? idsWithTag : ["00000000-0000-0000-0000-000000000000"]);

  const [{ data: contacts }, { data: sequences }, { data: members }] = await Promise.all([
    contactsQuery,
    supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);

  const seqs = (sequences as { id: string; name: string }[]) || [];
  const memberList = (members as { id: string; full_name: string | null; email: string }[]) || [];
  const tagList = (tags as { id: string; name: string; color: string }[]) || [];

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

      {/* Filtro por tag */}
      {tagList.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Filtrar por tag:</span>
          <Link href="/dashboard/contatos" className={`rounded-full px-3 py-1 text-xs ${!tagFilter ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}>
            Todos
          </Link>
          {tagList.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/contatos?tag=${t.id}`}
              className={`rounded-full px-3 py-1 text-xs ${tagFilter === t.id ? "text-white" : "text-ink hover:opacity-80"}`}
              style={{ background: tagFilter === t.id ? t.color : `${t.color}22` }}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4">
        <ContactsTable contacts={(contacts as any[]) || []} sequences={seqs} members={memberList} tags={tagList} />
      </div>
    </div>
  );
}
