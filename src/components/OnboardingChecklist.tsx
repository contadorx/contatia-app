import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DismissOnboarding from "@/components/DismissOnboarding";

export default async function OnboardingChecklist() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // A CHECAGEM DE DISPENSA VEM PRIMEIRO, sozinha. Antes ela ia em paralelo com quatro
  // contagens — ou seja, quem já dispensou o checklist continuava pagando quatro
  // varreduras (uma delas nos 78 mil contatos) em TODA abertura da home, para no fim
  // receber um `return null`.
  const { data: me } = await supabase
    .from("profiles")
    .select("onboarding_hidden")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  if ((me as any)?.onboarding_hidden) return null;

  // E a pergunta aqui é "existe pelo menos UM?", não "quantos existem". `limit(1)`
  // para na primeira linha; `count: exact` percorre a tabela toda para responder a
  // mesma coisa.
  const existe = async (tabela: string) => {
    const { data } = await supabase.from(tabela).select("id").limit(1);
    return ((data as any[]) || []).length > 0;
  };
  const [temEmail, temContato, temCadencia, temMatricula] = await Promise.all([
    existe("email_accounts"),
    existe("contacts"),
    existe("sequences"),
    existe("enrollments"),
  ]);

  // Ordem por VALOR primeiro: o usuário vê resultado no Radar (zero config) antes de
  // topar o muro de conectar e-mail — que fica por último e reenquadrado como opcional.
  const steps = [
    {
      done: temContato,
      label: "Traga seus primeiros contatos",
      hint: "Garimpe empresas na base da Receita (Radar) — sem configurar nada — ou importe um CSV.",
      href: "/dashboard/radar",
    },
    {
      done: temCadencia,
      label: "Crie uma cadência",
      hint: "Use um modelo pronto, monte do zero ou gere com IA em segundos.",
      href: "/dashboard/cadencias",
    },
    {
      done: temMatricula,
      label: "Inscreva contatos na cadência",
      hint: "Selecione vários e inscreva em lote — os toques caem aqui no Hoje.",
      href: "/dashboard/contatos",
    },
    {
      done: temEmail,
      label: "Conecte um e-mail para enviar",
      hint: "Só pra disparar e-mails automáticos — o WhatsApp assistido já funciona sem isso.",
      href: "/dashboard/config?tab=canais",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // setup completo → checklist some

  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="card mb-6 border-brand/30 bg-brand-soft/40 p-5">
      <div className="flex items-center justify-between">
        <p className="font-display text-lg font-bold">Primeiros passos</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-subtle">{doneCount} de {steps.length}</span>
          <DismissOnboarding />
        </div>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
        <div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div className="mt-4 space-y-2">
        {steps.map((s, i) => {
          const isNext = i === nextIdx;
          return (
            <Link
              key={i}
              href={s.href}
              className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition ${
                isNext ? "bg-white shadow-sm ring-1 ring-brand/30" : "hover:bg-white/60"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  s.done ? "bg-signal text-white" : isNext ? "border-2 border-brand text-brand" : "border border-line text-subtle"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div>
                <p className={`text-sm ${s.done ? "text-subtle line-through" : "font-medium text-ink"}`}>{s.label}</p>
                {!s.done && <p className="text-xs text-subtle">{s.hint}</p>}
              </div>
              {isNext && <span className="ml-auto self-center text-xs font-semibold text-brand">começar →</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
