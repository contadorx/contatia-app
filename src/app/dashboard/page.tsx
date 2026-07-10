import { createClient } from "@/lib/supabase/server";
import TaskQueue from "@/components/TaskQueue";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { HOT_THRESHOLD } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function Today() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: rawTasks }, contactsCount, hotCount] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, channel, title, generated_content, due_date, contact_id, contacts(name, company, phone, email, score)")
      .eq("status", "pending")
      .lte("due_date", today),
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase.from("contacts").select("id", { count: "exact", head: true }).gte("score", HOT_THRESHOLD),
  ]);

  // ordena por score do contato (quente primeiro), depois por vencimento
  const tasks = ((rawTasks as any[]) || []).sort((a, b) => {
    const sa = a.contacts?.score ?? 0;
    const sb = b.contacts?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return (a.due_date || "").localeCompare(b.due_date || "");
  });

  const cards = [
    { label: "Toques de hoje", value: tasks.length, live: true },
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
      <TaskQueue tasks={tasks} hotThreshold={HOT_THRESHOLD} />
    </div>
  );
}
