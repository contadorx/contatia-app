import { createClient } from "@/lib/supabase/server";
import { BatchReview } from "@/components/BatchReview";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LotePage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: batch } = await supabase
    .from("capture_batches")
    .select("id, source, items, status, created_at")
    .eq("id", params.id)
    .maybeSingle();

  if (!batch) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="font-display text-lg font-bold">Lote não encontrado</p>
        <p className="mt-2 text-sm text-subtle">Este lote não existe ou pertence a outro workspace.</p>
        <Link href="/dashboard/contatos" className="btn-ghost mt-4 inline-flex">Voltar aos contatos</Link>
      </div>
    );
  }

  const { data: cadences } = await supabase
    .from("sequences")
    .select("id, name")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const items = ((batch as any).items as any[]) || [];
  const importado = (batch as any).status === "imported";

  const origem: Record<string, string> = {
    sales_navigator: "Sales Navigator",
    linkedin: "LinkedIn",
    site: "Site da empresa",
  };

  return (
    <div className="max-w-5xl">
      <Link href="/dashboard/contatos" className="text-sm text-subtle hover:text-ink">← Contatos</Link>
      <h1 className="mt-2 font-display text-2xl font-bold">Revisão do lote</h1>
      <p className="mt-1 text-sm text-subtle">
        {items.length} leads capturados de <b>{origem[(batch as any).source] || (batch as any).source}</b>.
        Cruze com a base da Receita para trazer CNPJ e domínio — o domínio é o que
        permite descobrir o e-mail do decisor. Sem ele, o lead segue por WhatsApp.
      </p>

      <div className="mt-6">
        <BatchReview
          batchId={params.id}
          items={items}
          cadences={(cadences as any[]) || []}
          jaImportado={importado}
        />
      </div>
    </div>
  );
}
