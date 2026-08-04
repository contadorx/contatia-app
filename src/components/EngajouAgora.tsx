"use client";

// ============================================================
// QUEM ENGAJOU NAS ÚLTIMAS 48H — COM NOME E COM O QUÊ
//
// O cartão "Engajou agora" mostrava um NÚMERO e mais nada. Pior: o número contava
// quem engajou E TEM tarefa na fila, enquanto o bloco abaixo listava exatamente o
// contrário. Os dois nunca se cruzavam. O cartão dizia "3" e não havia lugar nenhum
// no app que dissesse quem eram esses 3.
//
// Depois de resolver "quem", faltava "o quê": "abriu o e-mail" não diz QUAL e-mail,
// nem de qual cadência — e sem isso não dá para responder, nem para saber qual
// cadência está funcionando. Agora cada linha mostra o assunto, o link clicado e a
// cadência de origem.
//
// E o bloco FECHA. Ele abria e ficava aberto para sempre; num dia movimentado, 60
// linhas empurravam a fila de tarefas para fora da tela. A escolha fica guardada
// neste navegador — quem fechou não quer reabrir a cada visita.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import EnrollButton from "@/components/EnrollButton";
import NewOpportunityForContact from "@/components/NewOpportunityForContact";

const ROTULO: Record<string, { txt: string; cls: string }> = {
  replied: { txt: "respondeu", cls: "bg-signal/15 text-signal" },
  doc_opened: { txt: "abriu a proposta", cls: "bg-warn/15 text-warn" },
  email_opened: { txt: "abriu o e-mail", cls: "bg-brand-soft text-brand-dark" },
  link_clicked: { txt: "clicou no link", cls: "bg-brand-soft text-brand-dark" },
};

const CHAVE = "contatia:engajou:oculto";

function quandoTxt(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function encurtar(url: string, max = 46) {
  const limpo = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return limpo.length > max ? limpo.slice(0, max - 1) + "…" : limpo;
}

export type LinhaEngajou = {
  id: string;
  name: string;
  company: string | null;
  score: number;
  tipo: string;
  quando: string;
  temTarefa: boolean;
  assunto?: string | null;
  url?: string | null;
  cadencia?: string | null;
  cadenciaExata?: boolean;
  passo?: number | null;
};

function Selo({ tipo }: { tipo: string }) {
  const r = ROTULO[tipo] || { txt: tipo, cls: "bg-muted text-subtle" };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.cls}`}>{r.txt}</span>;
}

// A segunda linha: o CONTEÚDO do sinal. Fica embaixo do nome de propósito — a
// primeira linha responde "quem", esta responde "o quê", e nessa ordem.
function Detalhe({ l }: { l: LinhaEngajou }) {
  const partes: React.ReactNode[] = [];
  if (l.assunto) {
    partes.push(
      <span key="a" className="truncate" title={l.assunto}>
        ✉ <span className="text-ink">{l.assunto}</span>
      </span>
    );
  }
  if (l.url) {
    partes.push(
      <a key="u" href={l.url} target="_blank" rel="noreferrer" className="truncate text-brand-dark hover:underline" title={l.url}>
        🔗 {encurtar(l.url)}
      </a>
    );
  }
  if (l.cadencia) {
    partes.push(
      <span key="c" className="truncate" title={l.cadenciaExata ? "Cadência que originou este sinal." : "Cadência mais recente deste contato — o sinal é anterior ao registro da origem, então é uma aproximação."}>
        ⟳ {l.cadencia}
        {l.passo ? ` · passo ${l.passo}` : ""}
        {!l.cadenciaExata && <span className="text-subtle"> (provável)</span>}
      </span>
    );
  }
  if (!partes.length) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 pl-0 text-[11px] text-subtle sm:pl-1">
      {partes}
    </div>
  );
}

function Linha({ l, sequences, acoes }: { l: LinhaEngajou; sequences: { id: string; name: string }[]; acoes: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${acoes ? "bg-white" : "bg-white/70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/contatos/${l.id}`} className="font-semibold text-brand-dark hover:underline">
          {l.name}
        </Link>
        {l.company && <span className="max-w-[180px] truncate text-xs text-subtle">{l.company}</span>}
        <Selo tipo={l.tipo} />
        <span className="text-xs text-subtle">{quandoTxt(l.quando)}</span>
        {l.score >= 25 && <span className="text-xs font-semibold text-warn">score {l.score}</span>}
        <span className="ml-auto flex items-center gap-2">
          {acoes && <EnrollButton contactId={l.id} sequences={sequences} />}
          {acoes && <NewOpportunityForContact contactId={l.id} defaultTitle={`Oportunidade — ${l.name}`} compacto />}
          <Link
            href={`/dashboard/contatos/${l.id}#enviar`}
            className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Falar agora
          </Link>
        </span>
      </div>
      <Detalhe l={l} />
    </div>
  );
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
  // Começa aberto e só fecha depois de ler a escolha guardada: ler durante a
  // renderização do servidor daria um HTML diferente do que o navegador desenha, e o
  // React reclamaria de hidratação.
  const [oculto, setOculto] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHAVE) === "1") setOculto(true);
    } catch { /* navegador sem storage: fica aberto, que é o padrão */ }
  }, []);

  function alternar() {
    setOculto((o) => {
      const novo = !o;
      try { window.localStorage.setItem(CHAVE, novo ? "1" : "0"); } catch { /* sem storage: vale só nesta visita */ }
      return novo;
    });
  }

  if (!linhas.length) return null;

  const semPasso = linhas.filter((l) => !l.temTarefa);
  const comPasso = linhas.filter((l) => l.temTarefa);

  return (
    <div id="engajou" className="mt-6 scroll-mt-24 rounded-xl border border-warn/40 bg-warn/5 p-4">
      {/* ============================================================
          O BOTÃO PRECISA SER ACHÁVEL, NÃO SÓ EXISTIR

          Na primeira tentativa ele dividia a linha com a frase explicativa
          ("respondeu, abriu o e-mail…"). Num container estreito a frase come o
          espaço e o botão vira um detalhe cinza no fim de um texto cinza — existe
          e ninguém acha. Agora ele fica sozinho na ponta direita do título, com
          borda e o ✕ na frente; a frase desceu uma linha, onde não disputa nada.
          ============================================================ */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-bold text-ink">
            🔥 Engajou nas últimas 48h{" "}
            <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-bold text-white">{linhas.length}</span>
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            respondeu, abriu o e-mail, abriu a proposta ou clicou num link
            {truncado ? " · mostrando os mais recentes" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={alternar}
          className="shrink-0 whitespace-nowrap rounded-lg border border-warn/50 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink shadow-sm hover:bg-muted"
          title={oculto ? "Mostrar a lista de quem engajou" : "Ocultar a lista — o número no cartão continua contando"}
        >
          {oculto ? `▾ Mostrar (${linhas.length})` : "✕ Ocultar"}
        </button>
      </div>

      {oculto ? (
        <p className="mt-2 text-xs text-subtle">
          Lista recolhida.
          {semPasso.length > 0 && <> <b className="text-warn">{semPasso.length}</b> sem próximo passo.</>}
        </p>
      ) : (
        <>
          {semPasso.length > 0 && (
            <>
              <p className="mt-3 text-sm font-semibold text-ink">
                Sem próximo passo{" "}
                <span className="font-normal text-subtle">
                  — deram sinal e a cadência acabou (ou nunca existiu). Sem ação aqui, esfriam sozinhos.
                </span>
              </p>
              <div className="mt-2 space-y-1.5">
                {semPasso.map((l) => (
                  <Linha key={l.id} l={l} sequences={sequences} acoes />
                ))}
              </div>
            </>
          )}

          {comPasso.length > 0 && (
            <>
              <p className="mt-4 text-sm font-semibold text-ink">
                Já têm tarefa na fila{" "}
                <span className="font-normal text-subtle">
                  — estão lá embaixo com o 🔥, mas aqui você vê quem são sem procurar.
                </span>
              </p>
              <div className="mt-2 space-y-1.5">
                {comPasso.map((l) => (
                  <Linha key={l.id} l={l} sequences={sequences} acoes={false} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
