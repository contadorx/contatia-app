import { createClient } from "@/lib/supabase/server";
import TaskQueue from "@/components/TaskQueue";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { HOT_THRESHOLD } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function Today() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const { data: tenantRow } = await supabase.from("tenants").select("whatsapp_mode").maybeSingle();
  const waMode = ((tenantRow as any)?.whatsapp_mode as string) || "assistido";

  // no modo automático, avisa se o número desconectou (envios falhariam em silêncio)
  let waDisconnected = false;
  if (waMode === "evolution") {
    const { data: waAcc } = await supabase
      .from("whatsapp_accounts")
      .select("status")
      .eq("is_active", true)
      .not("status", "is", null)
      .neq("status", "open")
      .limit(1);
    waDisconnected = ((waAcc as any[]) || []).length > 0;
  }

  const [{ data: rawTasks }, contactsCount, hotCount] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, channel, title, generated_content, due_date, contact_id, enrollment_id, contacts(name, company, phone, email, score)")
      .eq("status", "pending")
      .lte("due_date", in3),
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase.from("contacts").select("id", { count: "exact", head: true }).gte("score", HOT_THRESHOLD),
  ]);

  const allTasks = (rawTasks as any[]) || [];

  // ordena por score do contato (quente primeiro), depois por vencimento
  const sorted = allTasks.sort((a, b) => {
    const sa = a.contacts?.score ?? 0;
    const sb = b.contacts?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return (a.due_date || "").localeCompare(b.due_date || "");
  });

  const contactIds = Array.from(new Set(sorted.map((t) => t.contact_id).filter(Boolean)));
  const enrollmentIds = Array.from(new Set(sorted.map((t) => t.enrollment_id).filter(Boolean)));

  // cadência por enrollment + tags por contato + última atividade
  const cadenceByEnrollment: Record<string, string> = {};
  const tagsByContact: Record<string, { id: string; name: string; color: string }[]> = {};
  const lastActivity: Record<string, { type: string; created_at: string; text?: string }> = {};

  const [{ data: enrs }, { data: cts }, { data: evs }] = await Promise.all([
    enrollmentIds.length
      ? supabase.from("enrollments").select("id, sequences(name)").in("id", enrollmentIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    contactIds.length
      ? supabase.from("contact_tags").select("contact_id, tags(id, name, color)").in("contact_id", contactIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    contactIds.length
      ? supabase.from("events").select("contact_id, type, created_at, meta").in("contact_id", contactIds as string[]).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  for (const e of (enrs as any[]) || []) cadenceByEnrollment[e.id] = e.sequences?.name || "";
  for (const ct of (cts as any[]) || []) {
    if (ct.tags) (tagsByContact[ct.contact_id] ||= []).push(ct.tags);
  }
  for (const e of (evs as any[]) || []) {
    if (!lastActivity[e.contact_id]) lastActivity[e.contact_id] = { type: e.type, created_at: e.created_at, text: e.meta?.text };
  }

  // "quente agora": engajamento forte (respondeu / abriu proposta / abriu e-mail) nas últimas 48h
  const HOT_NOW_TYPES = new Set(["replied", "doc_opened", "email_opened"]);
  const now48 = Date.now() - 48 * 3600000;
  const hotNowByContact: Record<string, { type: string; created_at: string }> = {};
  for (const e of (evs as any[]) || []) {
    if (!e.contact_id || hotNowByContact[e.contact_id]) continue;
    if (HOT_NOW_TYPES.has(e.type) && new Date(e.created_at).getTime() >= now48) {
      hotNowByContact[e.contact_id] = { type: e.type, created_at: e.created_at };
    }
  }

  // anexa cadência + tags a cada task; separa "hoje/atrasados" de "próximos"
  const tasks = sorted.map((t) => ({
    ...t,
    cadence: t.enrollment_id ? cadenceByEnrollment[t.enrollment_id] || null : null,
    tags: t.contact_id ? tagsByContact[t.contact_id] || [] : [],
    is_future: (t.due_date || "") > today,
    hot_now: t.contact_id ? hotNowByContact[t.contact_id] || null : null,
  }));

  // re-ordena: quem engajou agora (hot_now) vem no topo absoluto, mantendo o resto por score
  tasks.sort((a, b) => {
    const ha = a.hot_now ? 1 : 0;
    const hb = b.hot_now ? 1 : 0;
    if (hb !== ha) return hb - ha;
    return 0; // estável: preserva a ordem anterior (score/vencimento)
  });

  // tags disponíveis para o filtro
  const { data: allTags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  const todayCount = tasks.filter((t) => !t.is_future).length;
  const hotNowCount = new Set(tasks.filter((t) => t.hot_now).map((t) => t.contact_id)).size;

  const cards = [
    { label: "Toques de hoje", value: todayCount, live: true },
    { label: "Engajou agora", value: hotNowCount, fire: true },
    { label: "Contatos", value: contactsCount.count ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">O que precisa de você hoje</h1>
      <p className="mt-1 text-sm text-subtle">Sua fila de cadência — quem está mais quente vem primeiro.</p>

      {waDisconnected && (
        <a href="/dashboard/config" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <span className="font-medium text-warn">⚠ Seu WhatsApp desconectou. Os envios automáticos estão pausados até reconectar.</span>
          <span className="font-semibold text-warn">Reconectar →</span>
        </a>
      )}

      <div className="mt-6">
        <OnboardingChecklist />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="flex items-center gap-2">
              {c.live && <span className="h-2 w-2 rounded-full bg-signal" />}
              {c.fire && <span className="text-xs">🔥</span>}
              <span className="label">{c.label}</span>
            </div>
            <p className={`mt-2 font-display text-3xl font-bold ${c.fire ? "text-warn" : ""}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Fila de hoje</h2>
      <TaskQueue tasks={tasks} hotThreshold={HOT_THRESHOLD} lastActivity={lastActivity} allTags={(allTags as any[]) || []} waMode={waMode} />
    </div>
  );
}
