import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SuggestionTools } from "@/components/SuggestionTools";

export const dynamic = "force-dynamic";

export default async function Sugestoes() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("contact_suggestions")
    .select("id, email, name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  const list = (rows as any[]) || [];

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-subtle">
        <Link href="/dashboard/contatos" className="hover:text-ink">Contatos</Link>
        <span>/</span>
        <span className="text-ink">Sugestões</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold">Sugestões de contato</h1>
      <p className="mt-1 text-sm text-subtle">Pessoas que enviaram e-mail para você mas ainda não estão na base. Adicione com um clique para não perder o lead — ou descarte se não interessa.</p>

      <div className="mt-6">
        <SuggestionTools rows={list} />
      </div>
    </div>
  );
}
