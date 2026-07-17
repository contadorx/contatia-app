import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FeedbacksPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("feedback")
    .select("id, score, comment, created_at, tenant_id, tenants(name)")
    .order("created_at", { ascending: false })
    .limit(300);
  const list = (rows as any[]) || [];

  const total = list.length;
  const promoters = list.filter((r) => r.score >= 9).length;
  const passives = list.filter((r) => r.score >= 7 && r.score <= 8).length;
  const detractors = list.filter((r) => r.score <= 6).length;
  const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;
  const avg = total ? (list.reduce((s, r) => s + r.score, 0) / total).toFixed(1) : "—";

  const color = (s: number) => (s >= 9 ? "text-signal" : s <= 6 ? "text-danger" : "text-warn");

  return (
    <div className="max-w-4xl">
      <p className="mb-1 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link> · Feedbacks
      </p>
      <h1 className="font-display text-2xl font-bold">Feedbacks (NPS)</h1>
      <p className="mt-1 text-sm text-subtle">O que os clientes acham da Contatia — coletado pelo botão de feedback no app.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <div className="card p-5"><p className="text-xs text-subtle">NPS</p><p className={`mt-1 font-display text-3xl font-bold ${nps >= 50 ? "text-signal" : nps >= 0 ? "text-warn" : "text-danger"}`}>{total ? nps : "—"}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">Nota média</p><p className="mt-1 font-display text-3xl font-bold">{avg}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">Respostas</p><p className="mt-1 font-display text-3xl font-bold">{total}</p></div>
        <div className="card p-5">
          <p className="text-xs text-subtle">Distribuição</p>
          <p className="mt-1 text-sm"><span className="text-signal">{promoters} promotores</span></p>
          <p className="text-sm"><span className="text-warn">{passives} neutros</span> · <span className="text-danger">{detractors} detratores</span></p>
        </div>
      </div>

      <div className="mt-6 card divide-y divide-line">
        {!list.length && <p className="p-8 text-center text-sm text-subtle">Nenhum feedback ainda.</p>}
        {list.map((r) => (
          <div key={r.id} className="flex items-start gap-3 p-4">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold ${color(r.score)}`}>{r.score}</span>
            <div className="min-w-0 flex-1">
              {r.comment ? <p className="text-sm text-ink">{r.comment}</p> : <p className="text-sm italic text-subtle">(sem comentário)</p>}
              <p className="mt-0.5 text-xs text-subtle">
                {r.tenants?.name || "workspace"} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">NPS = % promotores (9-10) − % detratores (0-6). Acima de 50 é excelente.</p>
    </div>
  );
}
