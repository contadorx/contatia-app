import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReguaEditor from "@/components/ReguaEditor";

export const dynamic = "force-dynamic";

export default async function ComunicacaoPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) redirect("/dashboard");

  const { data: msgs } = await supabase
    .from("business_messages")
    .select("key, track, label, enabled, trigger_days, subject, body, sort")
    .order("track", { ascending: true })
    .order("sort", { ascending: true });

  return (
    <div className="max-w-3xl">
      <p className="mb-1 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link> · Comunicação
      </p>
      <h1 className="font-display text-2xl font-bold">Réguas de comunicação</h1>
      <p className="mt-1 text-sm text-subtle">
        Os e-mails automáticos da plataforma. Edite o texto, ligue/desligue e ajuste o momento de cada um.
        Disparados pelo cron diário. Use <code>{"{{ola}}"}</code> (saudação) e <code>{"{{app}}"}</code> (link do app) nos textos.
      </p>

      <div className="mt-6">
        <ReguaEditor messages={(msgs as any[]) || []} />
      </div>
    </div>
  );
}
