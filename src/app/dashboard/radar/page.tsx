import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Radar() {
  const supabase = createClient();
  const { count } = await supabase
    .from("radar_leads")
    .select("id", { count: "exact", head: true });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Radar</h1>
      <p className="mt-1 text-sm text-subtle">
        Sua base de prospecção (Receita, scored T1–T4). Filtra e joga direto no pipeline.
      </p>

      <div className="card mt-6 p-6">
        <span className="label">Leads carregados</span>
        <p className="mt-2 font-display text-3xl font-bold">{count ?? 0}</p>
        <p className="mt-4 text-sm text-subtle">
          Fase 1: importador da base scored + filtros por CNAE, região, porte e tier,
          com um clique para converter em contato e iniciar a cadência.
        </p>
      </div>
    </div>
  );
}
