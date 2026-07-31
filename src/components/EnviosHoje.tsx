"use client";

// ============================================================
// "ENVIOS DE HOJE" — a faixa que responde "quanto eu já mandei, e quando"
//
// Fica FECHADA por padrão, mostrando só a linha que importa. Um painel aberto no topo
// da tela de trabalho competiria com a fila de tarefas, que é o que a pessoa veio fazer.
//
// A informação central não é o total — é o HORÁRIO DO ÚLTIMO ENVIO. "Você enviou 12
// hoje" não impede ninguém de mandar de novo sem querer; "o último foi às 14:32" impede.
// ============================================================

import { useState } from "react";
import type { ResumoEnvios } from "@/lib/enviosHoje";

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";

export default function EnviosHoje({ dados, gestor }: { dados: ResumoEnvios; gestor: boolean }) {
  const [aberto, setAberto] = useState(false);
  const meuTotal = dados.meusEmails + dados.meusWhats;

  // Sem nenhum envio hoje e sem nada da equipe: não ocupa espaço na tela.
  if (!dados.totalEquipe) return null;

  return (
    <div className="mb-4 rounded-xl border border-line bg-white">
      <button
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
        onClick={() => setAberto((a) => !a)}
      >
        <div className="text-sm">
          <b>Seus envios de hoje:</b>{" "}
          {meuTotal ? (
            <>
              <span className="text-ink">
                {dados.meusEmails} e-mail{dados.meusEmails === 1 ? "" : "s"}
                {dados.meusWhats ? ` e ${dados.meusWhats} WhatsApp` : ""}
              </span>
              <span className="text-subtle"> · último às <b className="text-ink">{hora(dados.ultimoMeu)}</b></span>
            </>
          ) : (
            <span className="text-subtle">nenhum ainda hoje.</span>
          )}
          {gestor && dados.totalEquipe > meuTotal && (
            <span className="text-subtle"> · equipe: {dados.totalEquipe}</span>
          )}
        </div>
        <span className="text-xs text-subtle">{aberto ? "fechar" : "ver detalhe"}</span>
      </button>

      {aberto && (
        <div className="border-t border-line px-4 py-3">
          {dados.semAutoria && (
            <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
              Os envios ainda não estão sendo atribuídos a quem os fez. Isso depende da
              migration <b>0106</b> aplicada no banco — até lá, o painel mostra o total do
              workspace, não o seu.
            </p>
          )}

          {/* capacidade — é o que impede a surpresa de "não sai mais e-mail hoje" */}
          {dados.capacidade.length > 0 && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Capacidade do dia</p>
              <div className="space-y-1.5">
                {dados.capacidade.map((c) => {
                  const pct = c.teto > 0 ? Math.min(100, (c.usados / c.teto) * 100) : 0;
                  const cheio = c.usados >= c.teto;
                  return (
                    <div key={c.caixa} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-[190px] truncate" title={c.caixa}>{c.caixa}</span>
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${cheio ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={cheio ? "font-semibold text-danger" : "text-subtle"}>
                        {c.usados} de {c.teto}
                        {cheio ? " — limite atingido" : ` · restam ${c.teto - c.usados}`}
                      </span>
                      {c.aquecendo && <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">aquecendo</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {gestor && dados.porPessoa.length > 1 && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Por pessoa</p>
              <div className="space-y-1 text-xs">
                {dados.porPessoa.map((p) => (
                  <div key={p.nome} className="flex flex-wrap items-center gap-2">
                    <span className={`min-w-[150px] ${p.souEu ? "font-semibold" : ""}`}>{p.nome}{p.souEu ? " (você)" : ""}</span>
                    <span className="text-subtle">
                      {p.emails} e-mail{p.emails === 1 ? "" : "s"}
                      {p.whats ? ` · ${p.whats} WhatsApp` : ""} · último às <b className="text-ink">{hora(p.ultimo)}</b>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
            {gestor ? "Últimos envios" : "Seus últimos envios"}
          </p>
          {dados.linhas.length === 0 ? (
            <p className="text-xs text-subtle">Nada ainda hoje.</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/70 text-left text-subtle">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Hora</th>
                    <th className="px-2 py-1.5 font-medium">Canal</th>
                    <th className="px-2 py-1.5 font-medium">Contato</th>
                    <th className="px-2 py-1.5 font-medium">Saiu por</th>
                    {gestor && <th className="px-2 py-1.5 font-medium">Quem</th>}
                  </tr>
                </thead>
                <tbody>
                  {dados.linhas.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{hora(l.quando)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${l.tipo === "email_sent" ? "bg-brand-soft text-brand-dark" : "bg-signal/15 text-signal"}`}>
                          {l.tipo === "email_sent" ? "@" : "WA"}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-1.5" title={l.contato || ""}>{l.contato || "—"}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5 text-subtle" title={l.caixa || ""}>{l.caixa || "—"}</td>
                      {gestor && <td className="max-w-[140px] truncate px-2 py-1.5 text-subtle">{l.autor}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
