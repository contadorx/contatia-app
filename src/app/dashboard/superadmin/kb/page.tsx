import { createClient } from "@/lib/supabase/server";
import { KbManager } from "@/components/KbManager";

export const dynamic = "force-dynamic";

export default async function KbAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(prof as any)?.is_superadmin) {
    return <div className="card p-8 text-center text-sm text-subtle">Acesso restrito à administração da plataforma.</div>;
  }

  const { data: rows } = await supabase
    .from("kb_articles")
    .select("id, title, category, body, keywords, position, published")
    .order("category", { ascending: true })
    .order("position", { ascending: true });

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Base de conhecimento</h1>
      <p className="mt-1 text-sm text-subtle">Artigos que os clientes navegam por tema na <b>Central de ajuda</b> (/dashboard/ajuda), buscam e também alimentam o botão de ajuda (?). Agrupe por tema, escreva simples e direto. Dica de formatação: <code>## Título</code> vira subtítulo, <code>- item</code> vira lista, <code>**texto**</code> fica em negrito.</p>
      <div className="mt-6">
        <KbManager rows={(rows as any[]) || []} />
      </div>
    </div>
  );
}
