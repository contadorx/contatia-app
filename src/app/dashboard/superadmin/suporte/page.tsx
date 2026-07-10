import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { ReplyBox, StatusBadge, StatusControl } from "@/components/SupportTools";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function SuporteAdmin({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) {
    return <div className="card mx-auto max-w-lg p-8 text-center"><p className="font-display text-lg font-bold">Acesso restrito</p></div>;
  }

  const admin = createAdminClient();
  const db = admin || supabase;

  const filter = searchParams.status || "abertos";
  let q = db.from("support_tickets").select("id, subject, status, priority, last_message_at, created_at, tenant_id, tenants(name, legal_name)").order("last_message_at", { ascending: false });
  if (filter === "abertos") q = q.in("status", ["open", "pending"]);
  else if (filter !== "todos") q = q.eq("status", filter);

  const { data: tickets } = await q;
  const list = (tickets as any[]) || [];

  const ids = list.map((t) => t.id);
  const { data: messages } = ids.length
    ? await db.from("support_messages").select("id, ticket_id, from_staff, body, created_at").in("ticket_id", ids).order("created_at", { ascending: true })
    : { data: [] as any[] };
  const byTicket: Record<string, any[]> = {};
  for (const m of (messages as any[]) || []) (byTicket[m.ticket_id] ||= []).push(m);

  const openCount = list.filter((t) => t.status === "open").length;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link>
        <span>/</span>
        <span className="text-ink">Suporte</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold">Suporte — todos os clientes</h1>
      <p className="mt-1 text-sm text-subtle">{openCount} chamado(s) aguardando resposta.</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {[["abertos", "Abertos"], ["open", "Novos"], ["pending", "Respondidos"], ["resolved", "Resolvidos"], ["todos", "Todos"]].map(([v, l]) => (
          <Link key={v} href={`/dashboard/superadmin/suporte?status=${v}`} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === v ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}>{l}</Link>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {list.map((t) => (
          <div key={t.id} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{t.subject}</p>
                <p className="text-xs text-subtle">{t.tenants?.name || t.tenants?.legal_name || "—"} · aberto {fmt(t.created_at)}{t.priority === "high" ? " · ALTA" : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={t.status} />
                <StatusControl ticketId={t.id} status={t.status} />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {(byTicket[t.id] || []).map((m) => (
                <div key={m.id} className={`rounded-lg p-3 text-sm ${m.from_staff ? "bg-brand-soft" : "bg-muted"}`}>
                  <p className="mb-0.5 text-[11px] font-semibold text-subtle">{m.from_staff ? "Suporte (você)" : "Cliente"} · {fmt(m.created_at)}</p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>

            {t.status !== "closed" && <ReplyBox ticketId={t.id} staff />}
          </div>
        ))}
        {!list.length && <div className="card p-8 text-center text-sm text-subtle">Nenhum chamado nesta visão.</div>}
      </div>
    </div>
  );
}
