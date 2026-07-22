import { createClient } from "@/lib/supabase/server";
import ContactTools from "@/components/ContactTools";
import ContactsTable from "@/components/ContactsTable";
import ContactsFilterBar from "@/components/ContactsFilterBar";
import { isManager } from "@/lib/permissions";
import { HOT_THRESHOLD } from "@/lib/scoring";
import { produtosPorContatos, contatoIdsPorProduto } from "@/lib/produtos";

export const dynamic = "force-dynamic";
// A captura no site raspa vários domínios por ação (HTTP); 60s cobre o lote inline.
export const maxDuration = 60;

const NENHUM = "00000000-0000-0000-0000-000000000000";

export default async function Contatos({ searchParams }: { searchParams: { tag?: string; q?: string; frio?: string; produto?: string; cadencia?: string; semcontato?: string; view?: string } }) {
  const supabase = createClient();
  const tagFilter = searchParams.tag || "";
  const produtoFilter = searchParams.produto || "";
  const cadenciaFilter = searchParams.cadencia || "";
  const frio = searchParams.frio || ""; // "15" | "30" | "nunca"
  // visão rápida: completar | prontos | resgatar | quentes (vazio = todos). semcontato=1 vira "completar".
  const view = searchParams.view || (searchParams.semcontato === "1" ? "completar" : "");
  const q = (searchParams.q || "").trim();
  const qSafe = q.slice(0, 80).replace(/[,()%*]/g, " ").trim();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const gerente = isManager((me as any)?.role, (me as any)?.team_role);

  const { data: tags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  const { count: suggestionCount } = await supabase.from("contact_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");

  // Filtros detalhados que restringem por lista de IDs (tag, produto, cadência). Intersectamos.
  const idConstraints: string[][] = [];
  if (tagFilter) {
    const { data: ct } = await supabase.from("contact_tags").select("contact_id").eq("tag_id", tagFilter);
    idConstraints.push(((ct as any[]) || []).map((r) => r.contact_id));
  }
  if (produtoFilter) {
    idConstraints.push(await contatoIdsPorProduto(supabase, produtoFilter));
  }
  if (cadenciaFilter) {
    const { data: en } = await supabase.from("enrollments").select("contact_id").eq("sequence_id", cadenciaFilter).in("status", ["active", "paused"]);
    idConstraints.push(((en as any[]) || []).map((r) => r.contact_id));
  }
  let idsFiltro: string[] | null = null;
  if (idConstraints.length) {
    idsFiltro = idConstraints.reduce((acc, cur) => acc.filter((id) => cur.includes(id)));
  }

  // Visões "prontos" e "resgatar" excluem quem já está numa cadência ativa.
  let emCadencia: string[] = [];
  if (view === "prontos" || view === "resgatar") {
    const { data: en } = await supabase.from("enrollments").select("contact_id").in("status", ["active", "paused"]);
    emCadencia = Array.from(new Set(((en as any[]) || []).map((r) => r.contact_id).filter(Boolean)));
  }

  let contactsQuery = supabase
    .from("contacts")
    .select("id, name, email, phone, company, origin, status, score, assigned_to, created_at, last_activity_at, wa_status, contact_tags(tag_id, tags(id, name, color))")
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (idsFiltro) contactsQuery = contactsQuery.in("id", idsFiltro.length ? idsFiltro : [NENHUM]);
  if (!gerente) contactsQuery = contactsQuery.eq("assigned_to", user?.id ?? "");
  if (qSafe) contactsQuery = contactsQuery.or(`name.ilike.%${qSafe}%,email.ilike.%${qSafe}%,company.ilike.%${qSafe}%`);

  // ---- VISÕES RÁPIDAS ----
  if (view === "completar") {
    // sem e-mail E sem telefone (null ou vazio)
    contactsQuery = contactsQuery.or("email.is.null,email.eq.").or("phone.is.null,phone.eq.");
  } else if (view === "quentes") {
    contactsQuery = contactsQuery.gte("score", HOT_THRESHOLD);
  } else if (view === "com_wa") {
    // números confirmados no WhatsApp — prontos para uma cadência de WhatsApp
    contactsQuery = contactsQuery.eq("wa_status", "valid");
  } else if (view === "prontos") {
    // tem e-mail OU telefone, e fora de cadência ativa
    contactsQuery = contactsQuery.or("email.neq.,phone.neq.");
    if (emCadencia.length) contactsQuery = contactsQuery.not("id", "in", `(${emCadencia.join(",")})`);
  } else if (view === "resgatar") {
    // frio (sem toque há +30d ou nunca) e fora de cadência ativa
    const corte = new Date(); corte.setDate(corte.getDate() - 30);
    contactsQuery = contactsQuery.or(`last_activity_at.is.null,last_activity_at.lt.${corte.toISOString()}`);
    if (emCadencia.length) contactsQuery = contactsQuery.not("id", "in", `(${emCadencia.join(",")})`);
  }

  // ---- FILTRO DETALHADO: último toque (independente das visões) ----
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
          <p className="mt-1 text-sm text-subtle">Sua base de prospecção e relacionamento. Comece pela <b>Visão</b> e afunile nos filtros quando precisar.</p>
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

      <ContactsFilterBar
        view={view}
        q={q}
        tag={tagFilter}
        produto={produtoFilter}
        cadencia={cadenciaFilter}
        frio={frio}
        tags={tagList}
        produtos={produtoList}
        cadencias={seqs}
      />

      <div className="mt-4">
        <ContactsTable contacts={(contacts as any[]) || []} sequences={seqs} members={memberList} tags={tagList} products={produtosContato} />
      </div>
    </div>
  );
}
