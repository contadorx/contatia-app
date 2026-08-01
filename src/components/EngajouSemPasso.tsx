"use client";

// ============================================================
// "ENGAJOU E NÃO TEM PRÓXIMO PASSO"
//
// O bloco mais importante da tela Hoje que não existia. Quem respondeu, abriu a
// proposta ou clicou num link nas últimas 48 horas E não tem nenhuma tarefa agendada
// é, por definição, o lead que está esfriando por falta de ação — não por falta de
// interesse. Antes ele simplesmente não aparecia em lugar nenhum.
//
// Fica ACIMA da fila de tarefas de propósito: a fila é trabalho já decidido; isto é
// decisão pendente, e decisão vence trabalho.
// ============================================================

import Link from "next/link";
import EnrollButton from "@/components/EnrollButton";
import NewOpportunityForContact from "@/components/NewOpportunityForContact";

const ROTULO: Record<string, { txt: string; cls: string }> = {
  replied: { txt: "respondeu", cls: "bg-signal/15 text-signal" },
  doc_opened: { txt: "abriu a proposta", cls: "bg-warn/15 text-warn" },
  email_opened: { txt: "abriu o e-mail", cls: "bg-brand-soft text-brand-dark" },
  link_clicked: { txt: "clicou no link", cls: "bg-brand-soft text-brand-dark" },
};

function quandoTxt(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export type LinhaEngajou = {
  id: string;
  name: string;
  company: string | null;
  score: number;
  tipo: string;
  quando: string;
};

export default function EngajouSemPasso({
  linhas,
  sequences,
}: {
  linhas: LinhaEngajou[];
  sequences: { id: string; name: string }[];
}) {
  if (!linhas.length) return null;

  return (
    <div className="mt-6 rounded-xl border border-warn/40 bg-warn/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display font-bold text-ink">
          🔥 Engajou e está sem próximo passo{" "}
          <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-bold text-white">{linhas.length}</span>
        </p>
        <p className="text-xs text-subtle">últimas 48h · nenhuma tarefa agendada para estes</p>
      </div>
      <p className="mt-1 text-sm text-subtle">
        Deram sinal e a cadência deles acabou (ou nunca existiu). Sem uma ação aqui, esfriam sozinhos.
      </p>

      <div className="mt-3 space-y-1.5">
        {linhas.map((l) => {
          const r = ROTULO[l.tipo] || { txt: l.tipo, cls: "bg-muted text-subtle" };
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
              <Link href={`/dashboard/contatos/${l.id}`} className="font-semibold text-brand-dark hover:underline">
                {l.name}
              </Link>
              {l.company && <span className="max-w-[180px] truncate text-xs text-subtle">{l.company}</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.cls}`}>{r.txt}</span>
              <span className="text-xs text-subtle">{quandoTxt(l.quando)}</span>
              {l.score >= 25 && <span className="text-xs font-semibold text-warn">score {l.score}</span>}
              <span className="ml-auto flex items-center gap-2">
                <EnrollButton contactId={l.id} sequences={sequences} />
                <NewOpportunityForContact contactId={l.id} defaultTitle={`Oportunidade — ${l.name}`} compacto />
                <Link
                  href={`/dashboard/contatos/${l.id}#enviar`}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  Falar agora
                </Link>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
