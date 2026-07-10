import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Today() {
  const supabase = createClient();

  const [contacts, tasks, radar] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lte("due_date", new Date().toISOString().slice(0, 10)),
    supabase.from("radar_leads").select("id", { count: "exact", head: true }),
  ]);

  const cards = [
    { label: "Toques de hoje", value: tasks.count ?? 0, href: "/dashboard/contatos", live: true },
    { label: "Contatos", value: contacts.count ?? 0, href: "/dashboard/contatos" },
    { label: "Leads no radar", value: radar.count ?? 0, href: "/dashboard/radar" },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">O que precisa de você hoje</h1>
      <p className="mt-1 text-sm text-subtle">Sua fila de cadência e o pulso da carteira.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card p-5 transition hover:border-brand">
            <div className="flex items-center gap-2">
              {c.live && <span className="h-2 w-2 rounded-full bg-signal" />}
              <span className="label">{c.label}</span>
            </div>
            <p className="mt-2 font-display text-3xl font-bold">{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="card mt-6 p-6">
        <p className="text-sm text-subtle">
          Fase 0 no ar: base multi-tenant, contatos e importação. O motor de cadência
          (fila diária de e-mail/WhatsApp/ligação/LinkedIn) entra na Fase 1.
        </p>
      </div>
    </div>
  );
}
