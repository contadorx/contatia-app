"use client";

// ============================================================
// QUEM ENGAJOU NAS ÚLTIMAS 48H — COM NOME
//
// O cartão "Engajou agora" mostrava um NÚMERO e mais nada. Pior: o número contava
// quem engajou E TEM tarefa na fila, enquanto o bloco abaixo listava exatamente o
// contrário — quem engajou e NÃO tem tarefa. Os dois nunca se cruzavam. Resultado
// prático: o cartão dizia "3" e não havia lugar nenhum no app que dissesse quem eram
// esses 3. Para descobrir, só abrindo ficha por ficha.
//
// Agora existe UMA lista com todo mundo que deu sinal nas últimas 48h, e o cartão
// aponta para ela. A lista continua separando os dois casos, porque a ação é
// diferente:
//   · SEM próximo passo → decisão pendente: matricular, abrir oportunidade, falar.
//   · COM tarefa na fila → já está encaminhado: só saber quem é e pular a fila por ele.
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
  temTarefa: boolean;
};

function Selo({ tipo }: { tipo: string }) {
  const r = ROTULO[tipo] || { txt: tipo, cls: "bg-muted text-subtle" };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.cls}`}>{r.txt}</span>;
}

export default function EngajouAgora({
  linhas,
  sequences,
  truncado,
}: {
  linhas: LinhaEngajou[];
  sequences: { id: string; name: string }[];
  truncado?: boolean;
}) {
  if (!linhas.length) return null;

  const semPasso = linhas.filter((l) => !l.temTarefa);
  const comPasso = linhas.filter((l) => l.temTarefa);

  return (
    <div id="engajou" className="mt-6 scroll-mt-24 rounded-xl border border-warn/40 bg-warn/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display font-bold text-ink">
          🔥 Engajou nas últimas 48h{" "}
          <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-bold text-white">{linhas.length}</span>
        </p>
        <p className="text-xs text-subtle">
          respondeu, abriu o e-mail, abriu a proposta ou clicou num link
          {truncado ? " · mostrando os mais recentes" : ""}
        </p>
      </div>

      {semPasso.length > 0 && (
        <>
          <p className="mt-3 text-sm font-semibold text-ink">
            Sem próximo passo <span className="font-normal text-subtle">— deram sinal e a cadência acabou (ou nunca existiu). Sem ação aqui, esfriam sozinhos.</span>
          </p>
          <div className="mt-2 space-y-1.5">
            {semPasso.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                <Link href={`/dashboard/contatos/${l.id}`} className="font-semibold text-brand-dark hover:underline">
                  {l.name}
                </Link>
                {l.company && <span className="max-w-[180px] truncate text-xs text-subtle">{l.company}</span>}
                <Selo tipo={l.tipo} />
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
            ))}
          </div>
        </>
      )}

      {comPasso.length > 0 && (
        <>
          <p className="mt-4 text-sm font-semibold text-ink">
            Já têm tarefa na fila <span className="font-normal text-subtle">— estão lá embaixo com o 🔥, mas aqui você vê quem são sem procurar.</span>
          </p>
          <div className="mt-2 space-y-1.5">
            {comPasso.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <Link href={`/dashboard/contatos/${l.id}`} className="font-semibold text-brand-dark hover:underline">
                  {l.name}
                </Link>
                {l.company && <span className="max-w-[180px] truncate text-xs text-subtle">{l.company}</span>}
                <Selo tipo={l.tipo} />
                <span className="text-xs text-subtle">{quandoTxt(l.quando)}</span>
                {l.score >= 25 && <span className="text-xs font-semibold text-warn">score {l.score}</span>}
                <Link
                  href={`/dashboard/contatos/${l.id}#enviar`}
                  className="ml-auto rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  Falar agora
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
