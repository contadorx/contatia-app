import { createClient } from "@/lib/supabase/server";
import TaskQueue from "@/components/TaskQueue";

export const dynamic = "force-dynamic";

export default async function Today() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [contactsCount, tasksToday, meetingsCount] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("tasks")
      .select("id, channel, title, generated_content, due_date, contacts(name, company, phone, email)")
      .eq("status", "pending")
      .lte("due_date", today)
      .order("due_date", { ascending: true }),
    supabase.from("meetings").select("id", { count: "exact", head: true }).eq("status", "agendada"),
  ]);

  const tasks = (tasksToday.data as any[]) || [];

  const cards = [
    { label: "Toques de hoje", value: tasks.length, live: true },
    { label: "Contatos", value: contactsCount.count ?? 0 },
    { label: "Reuniões agendadas", value: meetingsCount.count ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">O que precisa de você hoje</h1>
      <p className="mt-1 text-sm text-subtle">Sua fila de cadência. Quem respondeu vem primeiro.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="flex items-center gap-2">
              {c.live && <span className="h-2 w-2 rounded-full bg-signal" />}
              <span className="label">{c.label}</span>
            </div>
            <p className="mt-2 font-display text-3xl font-bold">{c.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Fila de hoje</h2>
      <TaskQueue tasks={tasks} />
    </div>
  );
}
