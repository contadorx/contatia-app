"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dataHoraCompacta } from "@/lib/datas";
import {
  assumirConversa,
  devolverConversa,
  encerrarConversa,
  reabrirConversa,
} from "@/app/dashboard/conversas/actions";
import { DESFECHOS, DESFECHO_LABEL, type Desfecho } from "@/lib/agente/desfechos";

export type ConversaLinha = {
  id: string;
  nome: string | null;
  phone: string;
  contactId: string | null;
  status: string;
  desfecho: string | null;
  etapa: string | null;
  msgsHoje: number;
  followups: number;
  ultimaMsgEm: string | null;
  ultimaMsgDirecao: string | null;
  ultimaRespostaEm: string | null;
  assumidaPor: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  humano: "Com você",
  agente: "Com o agente",
  sombra: "Sombra",
  pausada: "Sem condução",
  encerrada: "Encerrada",
};

const STATUS_STYLE: Record<string, string> = {
  humano: "bg-brand-soft text-brand-dark",
  agente: "bg-signal/15 text-signal",
  sombra: "bg-warn/15 text-warn",
  pausada: "bg-muted text-subtle",
  encerrada: "bg-muted text-subtle",
};

const FILTROS: { valor: string; rotulo: string }[] = [
  { valor: "", rotulo: "Todas" },
  { valor: "humano", rotulo: "Com você" },
  { valor: "pausada", rotulo: "Sem condução" },
  { valor: "encerrada", rotulo: "Encerradas" },
];

/**
 * Há quantos dias o LEAD não fala. Conta pela última resposta DELE, nunca pela última
 * mensagem da conversa: três follow-ups nossos deixariam "há 2 minutos" numa conversa
 * em que ele sumiu faz duas semanas — exatamente o número que faria alguém insistir.
 */
function diasEmSilencio(ultimaRespostaEm: string | null): number | null {
  if (!ultimaRespostaEm) return null;
  const t = new Date(ultimaRespostaEm).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export default function ConversasPainel({
  linhas,
  total,
  filtro,
}: {
  linhas: ConversaLinha[];
  total: number;
  filtro: string;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [encerrando, setEncerrando] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<any>) {
    setErro(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErro(res.error);
      else {
        setEncerrando(null);
        router.refresh();
      }
    });
  }

  if (!total) {
    return (
      <div className="card p-6">
        <p className="font-semibold">Nenhuma conversa ainda.</p>
        <p className="mt-2 text-sm text-subtle">
          A conversa nasce sozinha na primeira mensagem que entra ou sai pelo WhatsApp — inclusive de número que
          ainda não é contato. Conversas anteriores a esta tela não aparecem aqui: elas não tinham estado guardado.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.valor || "todas"}
            href={f.valor ? `/dashboard/conversas?status=${f.valor}` : "/dashboard/conversas"}
            className={[
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
              filtro === f.valor ? "bg-brand text-white" : "border border-line text-subtle hover:bg-muted",
            ].join(" ")}
          >
            {f.rotulo}
          </Link>
        ))}
        <span className="text-xs text-subtle">
          {linhas.length} de {total}
        </span>
      </div>

      {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

      <div className="mt-4 space-y-2">
        {linhas.map((c) => {
          const silencio = diasEmSilencio(c.ultimaRespostaEm);
          const encerrada = c.status === "encerrada";
          return (
            <div key={c.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.contactId ? (
                      <Link href={`/dashboard/contatos/${c.contactId}`} className="font-semibold hover:underline">
                        {c.nome || c.phone}
                      </Link>
                    ) : (
                      <span className="font-semibold">{c.nome || c.phone}</span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        STATUS_STYLE[c.status] || STATUS_STYLE.pausada
                      }`}
                    >
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                    {c.desfecho && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">
                        {DESFECHO_LABEL[c.desfecho as Desfecho] || c.desfecho}
                      </span>
                    )}
                    {!c.contactId && (
                      <span
                        className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn"
                        title="A conversa existe, mas o número ainda não virou contato. Cadastre em Respostas."
                      >
                        sem cadastro
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                    <span>{c.phone}</span>
                    <span>
                      última: {dataHoraCompacta(c.ultimaMsgEm)}
                      {c.ultimaMsgDirecao === "out" ? " (nossa)" : c.ultimaMsgDirecao === "in" ? " (dele)" : ""}
                    </span>
                    {silencio !== null && silencio >= 1 && (
                      <span className={silencio >= 7 ? "text-warn" : ""}>
                        sem responder há {silencio} {silencio === 1 ? "dia" : "dias"}
                      </span>
                    )}
                    {silencio === null && <span>nunca respondeu</span>}
                    {c.followups > 0 && (
                      <span className={c.followups >= 3 ? "text-warn" : ""}>
                        {c.followups} {c.followups === 1 ? "toque" : "toques"} sem resposta
                      </span>
                    )}
                    {c.msgsHoje > 0 && <span>{c.msgsHoje} hoje</span>}
                    {c.etapa && <span>etapa: {c.etapa}</span>}
                    {c.assumidaPor && c.status === "humano" && <span>com {c.assumidaPor}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {encerrada ? (
                    <button
                      className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-muted disabled:opacity-40"
                      disabled={pending}
                      onClick={() => run(() => reabrirConversa(c.id))}
                      title="O desfecho registrado continua valendo — ele aconteceu."
                    >
                      Reabrir
                    </button>
                  ) : (
                    <>
                      {c.status !== "humano" ? (
                        <button
                          className="rounded-lg border border-brand/40 px-2.5 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-40"
                          disabled={pending}
                          onClick={() => run(() => assumirConversa(c.id))}
                        >
                          Assumir
                        </button>
                      ) : (
                        <button
                          className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-subtle hover:bg-muted disabled:opacity-40"
                          disabled={pending}
                          onClick={() => run(() => devolverConversa(c.id))}
                          title="Você sai de cima dela; ninguém passa a conduzir."
                        >
                          Devolver
                        </button>
                      )}
                      <button
                        className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-subtle hover:bg-muted disabled:opacity-40"
                        disabled={pending}
                        onClick={() => setEncerrando(encerrando === c.id ? null : c.id)}
                      >
                        Encerrar
                      </button>
                    </>
                  )}
                  <Link
                    href="/dashboard/respostas"
                    className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-subtle hover:bg-muted"
                    title="Ler e responder as mensagens desta conversa"
                  >
                    Abrir
                  </Link>
                </div>
              </div>

              {encerrando === c.id && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-xs font-semibold text-subtle">Como terminou?</p>
                  <p className="mt-0.5 text-[11px] text-subtle">
                    O desfecho vira histórico — é dele que o aprendizado do agente vai se alimentar.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DESFECHOS.map((d) => (
                      <button
                        key={d}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-muted disabled:opacity-40"
                        disabled={pending}
                        onClick={() => run(() => encerrarConversa(c.id, d))}
                      >
                        {DESFECHO_LABEL[d]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
