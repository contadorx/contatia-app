import { createClient } from "@/lib/supabase/server";
import { OpenTicketForm, ReplyBox, StatusBadge } from "@/components/SupportTools";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function Suporte() {
  const supabase = createClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("id, subject, status, priority, last_message_at, created_at")
    .order("last_message_at", { ascending: false });

  const list = (tickets as any[]) || [];

  // mensagens de todos os tickets do cliente (poucos, ok carregar junto)
  const ids = list.map((t) => t.id);
  const { data: messages } = ids.length
    ? await supabase.from("support_messages").select("id, ticket_id, from_staff, body, created_at").in("ticket_id", ids).order("created_at", { ascending: true })
    : { data: [] as any[] };
  const byTicket: Record<string, any[]> = {};
  for (const m of (messages as any[]) || []) (byTicket[m.ticket_id] ||= []).push(m);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Suporte</h1>
      <p className="mt-1 text-sm text-subtle">Abra um chamado e acompanhe as respostas aqui.</p>

      <div className="mt-6">
        <OpenTicketForm />
      </div>

      <div className="mt-6 space-y-4">
        {list.map((t) => (
          <div key={t.id} className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{t.subject}</p>
              <StatusBadge status={t.status} />
            </div>
            <p className="text-xs text-subtle">Aberto em {fmt(t.created_at)}{t.priority === "high" ? " · prioridade alta" : ""}</p>

            <div className="mt-3 space-y-2">
              {(byTicket[t.id] || []).map((m) => (
                <div key={m.id} className={`rounded-lg p-3 text-sm ${m.from_staff ? "bg-brand-soft" : "bg-muted"}`}>
                  <p className="mb-0.5 text-[11px] font-semibold text-subtle">{m.from_staff ? "Suporte Contatia" : "Você"} · {fmt(m.created_at)}</p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>

            {t.status !== "closed" && <ReplyBox ticketId={t.id} />}
          </div>
        ))}
        {!list.length && (
          <div className="card p-8 text-center text-sm text-subtle">
            Nenhum chamado ainda. Muitas dúvidas têm resposta rápida na Ajuda (botão no canto inferior direito) — se precisar de gente, abra um chamado acima.
          </div>
        )}
      </div>
    </div>
  );
}
