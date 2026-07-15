import { createClient } from "@/lib/supabase/server";
import PipelineBoard from "@/components/PipelineBoard";
import { isManager } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Pipeline({ searchParams }: { searchParams: { opp?: string } }) {
  const supabase = createClient();

  // Visibilidade por papel: Dono/Admin/Gestor veem o pipeline de toda a equipe;
  // Vendedor/SDR veem só os próprios negócios (owner_id = você).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const gerente = isManager((me as any)?.role, (me as any)?.team_role);

  let oppsQuery = supabase
    .from("opportunities")
    .select("id, title, value_mrr, stage_id, status, primary_contact_id, account_id, product_id, contacts:primary_contact_id(name, score, last_activity_at)")
    .order("created_at", { ascending: false });
  if (!gerente) oppsQuery = oppsQuery.eq("owner_id", user?.id ?? "");

  const [{ data: stages }, { data: opps }, { data: contacts }, { data: accounts }, { data: products }] = await Promise.all([
    supabase.from("pipeline_stages").select("id, name, position, is_won, is_lost").order("position", { ascending: true }),
    oppsQuery,
    supabase.from("contacts").select("id, name").order("created_at", { ascending: false }).limit(500),
    supabase.from("accounts").select("id, name").order("created_at", { ascending: false }).limit(500),
    supabase.from("products").select("id, name, kind, billing, price").eq("active", true).order("name", { ascending: true }),
  ]);

  const oppList = (opps as any[]) || [];
  const contactIds = Array.from(new Set(oppList.map((o) => o.primary_contact_id).filter(Boolean)));

  // última atividade + cadência ativa + tags por contato (o "momento" do negócio)
  const lastActivity: Record<string, { type: string; created_at: string }> = {};
  const activeCadence: Record<string, string> = {};
  const tagsByContact: Record<string, { id: string; name: string; color: string }[]> = {};
  if (contactIds.length) {
    const [{ data: evs }, { data: enrs }, { data: cts }] = await Promise.all([
      supabase.from("events").select("contact_id, type, created_at").in("contact_id", contactIds as string[]).order("created_at", { ascending: false }).limit(800),
      supabase.from("enrollments").select("contact_id, status, sequences(name)").in("contact_id", contactIds as string[]).eq("status", "active"),
      supabase.from("contact_tags").select("contact_id, tags(id, name, color)").in("contact_id", contactIds as string[]),
    ]);
    for (const e of (evs as any[]) || []) {
      if (!lastActivity[e.contact_id]) lastActivity[e.contact_id] = { type: e.type, created_at: e.created_at };
    }
    for (const en of (enrs as any[]) || []) {
      if (!activeCadence[en.contact_id]) activeCadence[en.contact_id] = en.sequences?.name || "";
    }
    for (const ct of (cts as any[]) || []) {
      if (ct.tags) (tagsByContact[ct.contact_id] ||= []).push(ct.tags);
    }
  }

  const EVENT_LABEL: Record<string, string> = {
    note: "Nota", task_done: "Toque", email_sent: "E-mail enviado", whatsapp_sent: "WhatsApp enviado",
    replied: "Respondeu", doc_opened: "Abriu proposta", link_clicked: "Clicou no link", meeting: "Reunião",
  };
  function rel(iso: string) {
    const d = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (d < 1) return "hoje";
    return `${Math.floor(d)}d`;
  }

  const opportunities = oppList.map((o) => {
    const cid = o.primary_contact_id as string | null;
    const la = cid ? lastActivity[cid] : undefined;
    return {
      id: o.id,
      title: o.title,
      value_mrr: Number(o.value_mrr) || 0,
      stage_id: o.stage_id,
      status: o.status,
      account_id: o.account_id ?? null,
      product_id: o.product_id ?? null,
      contact_id: cid,
      contact_name: o.contacts?.name ?? null,
      contact_score: o.contacts?.score ?? 0,
      contact_last_at: o.contacts?.last_activity_at ?? null,
      last_activity: la ? `${EVENT_LABEL[la.type] || la.type} · ${rel(la.created_at)}` : null,
      active_cadence: cid ? activeCadence[cid] || null : null,
      tags: cid ? tagsByContact[cid] || [] : [],
    };
  });

  const { data: allTags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Pipeline</h1>
      <p className="mt-1 text-sm text-subtle">Seus negócios, do primeiro toque ao fechado. Arraste o cartão entre os estágios.</p>

      <div className="mt-6">
        <PipelineBoard
          stages={(stages as any[]) || []}
          opportunities={opportunities}
          contacts={(contacts as { id: string; name: string }[]) || []}
          accounts={(accounts as { id: string; name: string }[]) || []}
          products={(products as any[]) || []}
          allTags={(allTags as any[]) || []}
          openOppId={searchParams.opp}
        />
      </div>
    </div>
  );
}
