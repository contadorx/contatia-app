import { createClient } from "@/lib/supabase/server";
import { KbCenter } from "@/components/KbCenter";

export const dynamic = "force-dynamic";

// Central de ajuda voltada ao usuário: os mesmos artigos que o superadmin publica
// (kb_articles) ficam navegáveis por tema e buscáveis. Sem tabela nova — reaproveita
// category (o tema), keywords (a busca) e body (o conteúdo).
export default async function Ajuda() {
  const supabase = createClient();
  const { data } = await supabase
    .from("kb_articles")
    .select("id, title, category, keywords, body")
    .eq("published", true)
    .order("category", { ascending: true })
    .order("position", { ascending: true });

  const articles = (data as any[]) || [];

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Central de ajuda</h1>
      <p className="mt-1 text-sm text-subtle">
        Respostas rápidas por tema. Busque direto ou navegue pelas seções. Se não achar, o botão de ajuda (?) no canto
        responde na hora e, se precisar, encaminha para o time.
      </p>

      <KbCenter articles={articles} />
    </div>
  );
}
