import { createClient } from "@/lib/supabase/server";
import TaskQueue from "@/components/TaskQueue";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { HOT_THRESHOLD } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function Today() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

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

  // anexa cadência + tags a cada task; separa "hoje/atrasados" de "próximos"
  const tasks = sorted.map((t) => ({
    ...t,
    cadence: t.enrollment_id ? cadenceByEnrollment[t.enrollment_id] || null : null,
    tags: t.contact_id ? tagsByContact[t.contact_id] || [] : [],
    is_future: (t.due_date || "") > today,
  }));

  // tags disponíveis para o filtro
  const { data: allTags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  const todayCount = tasks.filter((t) => !t.is_future).length;

  const cards = [
    { label: "Toques de hoje", value: todayCount, live: true },
    { label: "Leads quentes", value: hotCount.count ?? 0, hot: true },
    { label: "Contatos", value: contactsCount.count ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">O que precisa de você hoje</h1>
      <p className="mt-1 text-sm text-subtle">Sua fila de cadência — quem está mais quente vem primeiro.</p>

      <div className="mt-6">
        <OnboardingChecklist />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="flex items-center gap-2">
              {c.live && <span className="h-2 w-2 rounded-full bg-signal" />}
              {c.hot && <span className="h-2 w-2 rounded-full bg-warn" />}
              <span className="label">{c.label}</span>
            </div>
            <p className={`mt-2 font-display text-3xl font-bold ${c.hot ? "text-warn" : ""}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Fila de hoje</h2>
      <TaskQueue tasks={tasks} hotThreshold={HOT_THRESHOLD} lastActivity={lastActivity} allTags={(allTags as any[]) || []} />
    </div>
  );
}
