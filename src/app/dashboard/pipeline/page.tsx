import { createClient } from "@/lib/supabase/server";
import PipelineBoard from "@/components/PipelineBoard";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const supabase = createClient();

  const [{ data: stages }, { data: opps }, { data: contacts }] = await Promise.all([
    supabase.from("pipeline_stages").select("id, name, position, is_won, is_lost").order("position", { ascending: true }),
    supabase
      .from("opportunities")
      .select("id, title, value_mrr, stage_id, status, contacts:primary_contact_id(name)")
      .order("created_at", { ascending: false }),
    supabase.from("contacts").select("id, name").order("created_at", { ascending: false }).limit(500),
  ]);

  const opportunities = ((opps as any[]) || []).map((o) => ({
    id: o.id,
    title: o.title,
    value_mrr: Number(o.value_mrr) || 0,
    stage_id: o.stage_id,
    status: o.status,
    contact_name: o.contacts?.name ?? null,
  }));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Pipeline</h1>
      <p className="mt-1 text-sm text-subtle">Seus negócios, do primeiro toque ao fechado. Arraste o cartão entre os estágios.</p>

      <div className="mt-6">
        <PipelineBoard
          stages={(stages as any[]) || []}
          opportunities={opportunities}
          contacts={(contacts as { id: string; name: string }[]) || []}
        />
      </div>
    </div>
  );
}
