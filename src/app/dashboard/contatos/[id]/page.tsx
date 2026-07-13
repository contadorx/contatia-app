import { EmailFinder } from "@/components/EmailFinder";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HOT_THRESHOLD } from "@/lib/scoring";
import EnrollButton from "@/components/EnrollButton";
import ContactReplyButton from "@/components/ContactReplyButton";
import NoteComposer from "@/components/NoteComposer";
import ContactCadences from "@/components/ContactCadences";
import EditContactButton from "@/components/EditContactButton";
import { EmailVerifyBadge, DecisorFinder } from "@/components/EmailVerify";
import { channelLabel, type Channel } from "@/lib/cadence";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  note: "Nota",
  task_done: "Toque executado",
  email_sent: "E-mail enviado",
  replied: "Respondeu",
  doc_opened: "Abriu a proposta",
  email_opened: "Abriu o e-mail",
  link_clicked: "Clicou no link",
  meeting: "Reunião marcada",
};
const EVENT_COLOR: Record<string, string> = {
  replied: "bg-signal",
  doc_opened: "bg-signal",
  meeting: "bg-brand",
  email_opened: "bg-brand",
  note: "bg-warn",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function ContatoDetalhe({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, phone, company, company_domain, email_discovery, role_title, cnpj, origin, status, score, account_id, custom, accounts(name, domain, website)")
    .eq("id", params.id)
    .maybeSingle();
  if (!contact) notFound();

  const [{ data: sequences }, { data: enrollments }, { data: tasks }, { data: events }, { data: meetings }] =
    await Promise.all([
      supabase.from("sequences").select("id, name").eq("is_active", true),
      supabase.from("enrollments").select("id, status, sequences(name)").eq("contact_id", params.id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, channel, title, due_date").eq("contact_id", params.id).eq("status", "pending").order("due_date", { ascending: true }),
      supabase.from("events").select("id, type, created_at, meta").eq("contact_id", params.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("meetings").select("id, title, datetime, status").eq("contact_id", params.id).order("datetime", { ascending: false }),
    ]);

  const c = contact as any;
  const score = c.score ?? 0;
  const hot = score >= HOT_THRESHOLD;
  const enr = (enrollments as any[]) || [];
  const activeEnr = enr.find((e) => e.status === "active");
  const pendingTasks = (tasks as any[]) || [];
  const evs = (events as any[]) || [];
  const mtgs = (meetings as any[]) || [];

  return (
    <div className="max-w-4xl">
      <Link href="/dashboard/contatos" className="text-sm text-subtle hover:text-brand">
        ← Contatos
      </Link>

      {/* Cabeçalho */}
      <div className="mt-3 card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold">{c.name}</h1>
              {hot && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">QUENTE</span>}
            </div>
            <p className="mt-1 text-sm text-subtle">
              {c.role_title ? `${c.role_title} · ` : ""}
              {c.accounts?.name ? (
                <Link href={`/dashboard/contas/${c.account_id}`} className="text-brand-dark hover:underline">
                  {c.accounts.name}
                </Link>
              ) : (
                c.company || "—"
              )}
            </p>
            <p className="mt-1 text-sm text-subtle">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</p>
            <div className="mt-2">
              <EmailVerifyBadge contactId={c.id} hasEmail={!!c.email} initial={(c as any).custom?.email_check ?? null} />
              <div className="mt-1"><DecisorFinder contactId={c.id} /></div>
            </div>
          </div>
          <div className="text-right">
            <p className="label">Score</p>
            <p className={`font-display text-3xl font-bold ${hot ? "text-warn" : ""}`}>{score}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <EnrollButton contactId={c.id} sequences={(sequences as { id: string; name: string }[]) || []} />
          <ContactReplyButton contactId={c.id} />
          <EditContactButton contact={c as any} />
        </div>

        {!c.email && (
          <EmailFinder
            contactId={c.id}
            contactName={c.name}
            companyDomain={(c as any).company_domain || (c as any).accounts?.domain || null}
            discovery={(c as any).email_discovery || null}
          />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Próximos toques + reuniões */}
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 font-display text-lg font-bold">Cadências</h2>
            <div className="card p-4">
              <ContactCadences enrollments={enr} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold">Próximos toques</h2>
            <div className="card divide-y divide-line">
              {pendingTasks.length ? (
                pendingTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-3">
                    <span className="text-sm">{t.title || channelLabel[t.channel as Channel]}</span>
                    <span className="text-xs text-subtle">{channelLabel[t.channel as Channel]} · {t.due_date}</span>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-subtle">Nenhum toque pendente.</p>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold">Reuniões</h2>
            <div className="card divide-y divide-line">
              {mtgs.length ? (
                mtgs.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3">
                    <span className="text-sm">{m.title}</span>
                    <span className="text-xs text-subtle">{fmt(m.datetime)} · {m.status}</span>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-subtle">Nenhuma reunião.</p>
              )}
            </div>
          </div>
        </div>

        {/* Linha do tempo */}
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Linha do tempo</h2>
          <div className="card p-5">
            <NoteComposer contactId={c.id} />
            {evs.length ? (
              <div className="relative space-y-4 pl-5">
                <div className="absolute bottom-1 left-[5px] top-1 w-0.5 bg-line" />
                {evs.map((e) => (
                  <div key={e.id} className="relative">
                    <div className={`absolute -left-[18px] top-1 h-[9px] w-[9px] rounded-full ${EVENT_COLOR[e.type] || "bg-subtle"}`} />
                    <p className="text-sm font-medium">{EVENT_LABEL[e.type] || e.type}</p>
                    {e.type === "note" && e.meta?.text && (
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/80">{e.meta.text}</p>
                    )}
                    <p className="text-xs text-subtle">{fmt(e.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-subtle">Nenhuma atividade registrada ainda.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
