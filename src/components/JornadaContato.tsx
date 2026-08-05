// ============================================================
// A JORNADA — O QUE ESTE CONTATO RECEBEU, ABRIU E CLICOU
//
// A ficha tinha a linha do tempo de eventos: uma lista cronológica de "Abriu o
// e-mail", "Clicou no link", "E-mail enviado". Serve para auditar, e não serve para
// a pergunta que o vendedor faz antes de ligar: *em que pé está esta pessoa?*
//
// Numa lista cronológica, três aberturas do passo 2 e um clique do passo 1 aparecem
// intercalados com notas e tarefas, e reconstruir a sequência é trabalho manual. Pior:
// o que NÃO aconteceu — o passo que foi enviado e nunca aberto — não aparece em lista
// nenhuma, porque ausência não gera evento. E é exatamente essa a informação que
// muda a decisão.
//
// Aqui a leitura é por CADÊNCIA e por PASSO, na ordem do processo, mostrando também
// os passos que ainda vão acontecer. Cada passo diz o que houve com ele: enviado,
// aberto (quantas vezes), clicado (em qual link), respondido — ou agendado para tal
// dia.
//
// SOBRE A ABERTURA, para não induzir a erro: ela depende de o cliente de e-mail
// carregar uma imagem. Quem bloqueia imagem abre e não conta. Por isso "não aberto"
// aqui significa "não temos registro de abertura", e é assim que está escrito na
// tela. Clique é sinal firme; abertura é piso.
// ============================================================

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stopEnrollment } from "@/app/dashboard/cadencias/actions";
import { dataHora, dataDoDia } from "@/lib/datas";

export type PassoJornada = {
  posicao: number | null;
  canal: string;
  titulo: string | null;
  status: string;               // pending | done | skipped
  quando: string | null;        // due_date (agendado) ou completed_at (feito)
  enviadoEm: string | null;
  aberturas: number;
  primeiraAbertura: string | null;
  cliques: number;
  primeiroClique: string | null;
  urlClicada: string | null;
};

export type JornadaCadencia = {
  enrollmentId: string;
  cadencia: string;
  status: string;               // active | replied | finished | paused
  desde: string | null;
  respondeuEm: string | null;
  passos: PassoJornada[];
};

const CANAL: Record<string, string> = {
  email: "E-mail", whatsapp: "WhatsApp", call: "Ligação", linkedin: "LinkedIn",
};

const SELO_CADENCIA: Record<string, { txt: string; cls: string }> = {
  active: { txt: "em andamento", cls: "bg-brand-soft text-brand-dark" },
  replied: { txt: "respondeu — cadência encerrada", cls: "bg-signal/15 text-signal" },
  finished: { txt: "concluída", cls: "bg-muted text-subtle" },
  paused: { txt: "pausada", cls: "bg-warn/15 text-warn" },
};

function Marca({ ok, alerta, children }: { ok?: boolean; alerta?: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
      ok ? "bg-signal/15 text-signal" : alerta ? "bg-warn/15 text-warn" : "bg-muted text-subtle"
    }`}>
      {children}
    </span>
  );
}

export default function JornadaContato({ jornada }: { jornada: JornadaCadencia[] }) {
  // A cadência errada é percebida AQUI — é este bloco que mostra o que está saindo.
  // Obrigar a rolar até outro painel para desfazer é atrito no pior momento.
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function desinscrever(id: string, nome: string) {
    if (!confirm(`Desinscrever de "${nome}"?\n\nOs toques que ainda não aconteceram serão cancelados. O que já foi enviado continua no histórico.`)) return;
    setErro(null);
    start(async () => {
      try {
        const r: any = await stopEnrollment(id);
        if (r?.error) { setErro(r.error); return; }
        router.refresh();
      } catch (e: any) {
        setErro(e?.message || "Não consegui falar com o servidor.");
      }
    });
  }

  if (!jornada.length) {
    return (
      <div className="card mt-4 p-5">
        <h2 className="font-display text-sm font-semibold">Jornada</h2>
        <p className="mt-1 text-sm text-subtle">
          Este contato ainda não entrou em nenhuma cadência. Assim que entrar, cada passo aparece
          aqui com o que aconteceu — enviado, aberto, clicado, respondido.
        </p>
      </div>
    );
  }

  return (
    <div className="card mt-4 p-5">
      <h2 className="font-display text-sm font-semibold">Jornada</h2>
      <p className="mt-0.5 text-xs text-subtle">
        O que este contato recebeu e o que fez com cada mensagem, na ordem do processo.
      </p>

      {erro && <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{erro}</p>}

      <div className="mt-4 space-y-5">
        {jornada.map((c) => {
          const selo = SELO_CADENCIA[c.status] || { txt: c.status, cls: "bg-muted text-subtle" };
          const enviados = c.passos.filter((p) => p.enviadoEm).length;
          const abertos = c.passos.filter((p) => p.aberturas > 0).length;
          const clicados = c.passos.filter((p) => p.cliques > 0).length;
          return (
            <div key={c.enrollmentId}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{c.cadencia}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo.cls}`}>{selo.txt}</span>
                {c.desde && <span className="text-xs text-subtle">desde {dataDoDia(String(c.desde).slice(0, 10))}</span>}
                {(c.status === "active" || c.status === "paused") && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => desinscrever(c.enrollmentId, c.cadencia)}
                    className="ml-auto rounded-lg border border-danger/40 bg-white px-2 py-0.5 text-[11px] font-medium text-danger hover:bg-danger/5 disabled:opacity-40"
                    title="Tira o contato desta cadência e cancela os toques que ainda não aconteceram."
                  >
                    ✕ Desinscrever
                  </button>
                )}
              </div>
              {/* o resumo em números vem antes da lista: responde "vale a pena olhar?" */}
              <p className="mt-0.5 text-xs text-subtle">
                {enviados} enviado(s) · {abertos} com abertura registrada · {clicados} com clique
              </p>

              <ol className="mt-2 space-y-1.5">
                {c.passos.map((p, i) => {
                  const futuro = p.status === "pending";
                  return (
                    <li
                      key={i}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        p.cliques > 0 ? "border-signal/40 bg-signal/5"
                        : p.aberturas > 0 ? "border-brand/30 bg-brand-soft/20"
                        : futuro ? "border-dashed border-line bg-white"
                        : "border-line bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-subtle">
                          {p.posicao ? `Passo ${p.posicao}` : "Passo"}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-subtle">
                          {CANAL[p.canal] || p.canal}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink" title={p.titulo || ""}>
                          {p.titulo || "(sem assunto)"}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {p.status === "skipped" && <Marca>pulado</Marca>}
                        {futuro && (
                          <Marca alerta>
                            agendado {p.quando ? `para ${dataDoDia(String(p.quando).slice(0, 10))}` : ""}
                          </Marca>
                        )}
                        {p.enviadoEm && <Marca ok>enviado {dataHora(p.enviadoEm)}</Marca>}

                        {p.aberturas > 0 ? (
                          <Marca ok>
                            abriu {p.aberturas > 1 ? `${p.aberturas}×` : ""} {p.primeiraAbertura ? `· 1ª em ${dataHora(p.primeiraAbertura)}` : ""}
                          </Marca>
                        ) : p.enviadoEm && p.canal === "email" ? (
                          // "sem registro" e não "não abriu": imagem bloqueada não conta
                          // abertura, e afirmar o contrário levaria a descartar lead bom.
                          <Marca>sem registro de abertura</Marca>
                        ) : null}

                        {p.cliques > 0 && (
                          <Marca ok>
                            clicou {p.cliques > 1 ? `${p.cliques}×` : ""} {p.primeiroClique ? `· ${dataHora(p.primeiroClique)}` : ""}
                          </Marca>
                        )}
                      </div>

                      {p.urlClicada && (
                        <a
                          href={p.urlClicada}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block max-w-full truncate text-[11px] text-brand-dark hover:underline"
                          title={p.urlClicada}
                        >
                          🔗 {p.urlClicada.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>

              {c.respondeuEm && (
                <p className="mt-1.5 text-xs font-medium text-signal">
                  ✓ Respondeu em {dataHora(c.respondeuEm)} — a cadência parou aqui, como deve.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 border-t border-line pt-2 text-[11px] text-subtle">
        Abertura depende de o cliente de e-mail carregar imagens; quem bloqueia imagem abre sem
        contar. Por isso o clique é o sinal firme e a abertura é piso, nunca teto.{" "}
        <Link href="/dashboard/relatorios" className="text-brand-dark hover:underline">Ver por cadência →</Link>
      </p>
    </div>
  );
}
