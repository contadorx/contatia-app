import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AiAdmin from "@/components/AiAdmin";

export const dynamic = "force-dynamic";

export default async function IaAdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) redirect("/dashboard");

  const [{ data: assistants }, { data: conversations }] = await Promise.all([
    supabase.from("ai_assistants").select("kind, enabled, model, greeting, brain, notify_email"),
    supabase
      .from("ai_conversations")
      .select("id, kind, status, handled, source, visitor_name, visitor_email, visitor_phone, msg_count, ticket_id, created_at, last_at")
      .order("last_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <div className="max-w-4xl">
      <p className="mb-1 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link> · IA de atendimento
      </p>
      <h1 className="font-display text-2xl font-bold">IA de atendimento</h1>
      <p className="mt-1 text-sm text-subtle">
        As duas IAs de 1ª camada — Suporte (no app) e Vendas (no site). Veja as conversas, trate os
        escalonamentos e edite o comportamento de cada uma.
      </p>

      <div className="mt-6">
        <AiAdmin assistants={(assistants as any[]) || []} conversations={(conversations as any[]) || []} />
      </div>
    </div>
  );
}
