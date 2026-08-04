"use client";

import { useState, useTransition } from "react";
import { getCadenceReport, type StepReport } from "@/app/dashboard/cadencias/report-actions";

const channelLabel: Record<string, string> = { email: "E-mail", whatsapp: "WhatsApp", call: "Ligação", task: "Tarefa", linkedin: "LinkedIn" };

function pct(n: number, d: number) {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export function CadenceReport({ sequenceId }: { sequenceId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<StepReport[] | null>(null);
  const [resumo, setResumo] = useState<{ bounced: number; comEmail: number; rastreioIndisponivel: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!report) {
      start(async () => {
        const r = (await getCadenceReport(sequenceId)) as any;
        if (r?.error) { setErr(r.error); return; }
        setReport(r.report);
        setResumo(r.resumo || null);
      });
    }
  }

  return (
    <div className="mt-2">
      <button className="text-xs font-semibold text-brand-dark hover:underline" onClick={toggle}>
        {open ? "ocultar desempenho" : "ver desempenho por passo →"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-line p-3">
          {pending && <p className="text-xs text-subtle">Calculando...</p>}
          {err && <p className="text-xs text-danger">{err}</p>}
          {report && !report.length && <p className="text-xs text-subtle">Sem dados ainda.</p>}
          {/* Resumo da cadência: hard bounce e o motivo de o rastreio estar zerado.
              Os dois respondem perguntas que a tabela por passo não responde. */}
          {resumo && (
            <div className="mb-3 space-y-1 border-b border-line pb-2">
              <p className="text-xs">
                <span className="text-subtle">Hard bounce: </span>
                <b className={resumo.bounced > 0 ? "text-danger" : "text-ink"}>{resumo.bounced}</b>
                {resumo.comEmail > 0 && (
                  <span className="text-subtle">
                    {" "}de {resumo.comEmail} com e-mail ({pct(resumo.bounced, resumo.comEmail)})
                  </span>
                )}
                <span className="ml-2 text-subtle" title="Não guardamos em qual passo o e-mail bateu na parede, então o número é da cadência inteira.">
                  · da cadência inteira, não por passo
                </span>
              </p>
              {resumo.bounced > 0 && (
                <p className="text-xs text-warn">
                  Bounce alto é o que derruba reputação de domínio — é o primeiro número a
                  olhar quando a entrega piora. Esses endereços já foram suprimidos.
                </p>
              )}
              {resumo.rastreioIndisponivel && (
                <p className="text-xs text-danger">
                  Aberturas e cliques estão zerados porque a base não respondeu:{" "}
                  <span className="font-mono">{resumo.rastreioIndisponivel}</span>. Se a
                  mensagem fala de tabela inexistente, falta aplicar a migration 0108.
                </p>
              )}
            </div>
          )}
          {report && report.length > 0 && (
            <div className="space-y-2">
              {report.map((s) => (
                <div key={s.position} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Passo {s.position + 1} · {channelLabel[s.channel] || s.channel}</span>
                    <span className="text-xs text-subtle">
                      {s.sent} enviados · {s.replied} respostas · <b className="text-ink">{pct(s.replied, s.sent)}</b> resposta
                    </span>
                  </div>
                  {s.subject && <p className="truncate text-xs text-subtle">"{s.subject}"</p>}
                  {/* Aberturas e cliques. O denominador é o RASTREADO, não o enviado:
                      e-mail em texto puro não leva pixel e e-mail sem link não tem o
                      que clicar — contar esses derrubaria a taxa sem motivo. */}
                  {/* Antes esta linha só aparecia com número > 0 — então "sem dado" e
                      "não medimos" ficavam idênticos: nada na tela. Agora só some
                      quando o passo não é de e-mail, onde a métrica não existe mesmo. */}
                  {s.channel === "email" && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-subtle">
                      {s.rastreados === 0 && s.comLink === 0 && (
                        <span className="text-subtle">👁 sem rastreio neste passo ainda</span>
                      )}
                      {s.rastreados > 0 && (
                        <span title={`${s.abertos} de ${s.rastreados} e-mails rastreados foram abertos ao menos uma vez.`}>
                          👁 <b className="text-ink">{pct(s.abertos, s.rastreados)}</b> abertura
                          <span className="text-subtle"> ({s.abertos}/{s.rastreados})</span>
                        </span>
                      )}
                      {s.comLink > 0 && (
                        <span title={`${s.clicados} de ${s.comLink} e-mails com link tiveram ao menos um clique.`}>
                          🔗 <b className="text-ink">{pct(s.clicados, s.comLink)}</b> clique
                          <span className="text-subtle"> ({s.clicados}/{s.comLink})</span>
                        </span>
                      )}
                    </p>
                  )}
                  {s.ab && (
                    <div className="mt-1 grid grid-cols-2 gap-2 rounded bg-muted/60 p-2 text-xs">
                      <div>
                        <p className="font-semibold">A: <span className="font-normal text-subtle">"{s.subject}"</span></p>
                        <p>{s.ab.a.sent} env · {s.ab.a.replied} resp · <b>{pct(s.ab.a.replied, s.ab.a.sent)}</b></p>
                      </div>
                      <div>
                        <p className="font-semibold">B: <span className="font-normal text-subtle">"{s.subject_b}"</span></p>
                        <p>{s.ab.b.sent} env · {s.ab.b.replied} resp · <b>{pct(s.ab.b.replied, s.ab.b.sent)}</b></p>
                      </div>
                      {(() => {
                        const ra = s.ab.a.sent ? s.ab.a.replied / s.ab.a.sent : 0;
                        const rb = s.ab.b.sent ? s.ab.b.replied / s.ab.b.sent : 0;
                        if (s.ab.a.sent + s.ab.b.sent < 10) return <p className="col-span-2 text-[11px] text-subtle">Amostra pequena — resultados ganham confiança com mais envios.</p>;
                        if (ra === rb) return <p className="col-span-2 text-[11px] text-subtle">Empate técnico até agora.</p>;
                        return <p className="col-span-2 text-[11px] font-semibold text-signal">Vencendo: assunto {ra > rb ? "A" : "B"}.</p>;
                      })()}
                    </div>
                  )}
                </div>
              ))}
              {report.some((s) => s.rastreados > 0) && (
                <p className="rounded-lg bg-muted/60 p-2 text-[11px] text-subtle">
                  <b>Sobre a abertura:</b> ela é medida por uma imagem invisível no e-mail e
                  é um sinal <b>fraco</b>. O Apple Mail baixa as imagens sozinho quando a
                  mensagem chega (conta como aberto sem ninguém abrir), e quem lê com
                  imagens desligadas nunca aparece. Use para <b>comparar assuntos entre si</b>,
                  não como número absoluto. Clique e resposta são os sinais confiáveis.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
