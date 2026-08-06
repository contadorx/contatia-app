"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { simularReaplicacao, reaplicarTextos } from "@/app/dashboard/cadencias/actions";

// ============================================================
// "ATUALIZAR OS TOQUES QUE AINDA NÃO SAÍRAM"
//
// Editar a cadência não mexe em quem já está inscrito — o texto foi renderizado e
// gravado dentro de cada tarefa na hora da inscrição. Este botão é a ponte que faltava.
//
// A ordem da tela é de propósito: SIMULAR primeiro, aplicar depois. O número sozinho
// ("47 tarefas") não é revisão; o que responde "é isso mesmo que eu quero mandar?" são
// os exemplos ANTES → DEPOIS com o texto de verdade, do contato de verdade. Só depois
// de ver isso é que aparece o botão que escreve.
// ============================================================
export default function ReaplicarTextos({ sequenceId, nome }: { sequenceId: string; nome: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pend, start] = useTransition();
  const [sim, setSim] = useState<{
    mudam?: number; editadas?: number; semColunaEditado?: boolean;
    exemplos?: { contato: string; canal: string; antes: string; depois: string }[];
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function simular() {
    setErr(null); setMsg(null); setSim(null);
    start(async () => {
      const r = (await simularReaplicacao(sequenceId)) as any;
      if (r?.error) { setErr(r.error); return; }
      setSim(r);
      setAberto(true);
    });
  }

  function aplicar() {
    setErr(null);
    start(async () => {
      const r = (await reaplicarTextos(sequenceId)) as any;
      if (r?.error && !r?.atualizadas) { setErr(r.error); return; }
      setMsg(
        `✓ ${r.atualizadas} tarefa(s) atualizada(s)` +
          (r.editadasPuladas ? ` · ${r.editadasPuladas} editada(s) à mão foram preservadas` : "") +
          (r.incompleto ? " · sobrou fila: clique de novo para continuar" : "") + "."
      );
      // simula de novo para o painel refletir o que ficou
      const s2 = (await simularReaplicacao(sequenceId)) as any;
      if (!s2?.error) setSim(s2);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
        disabled={pend}
        onClick={() => (aberto ? setAberto(false) : simular())}
        title="Aplica o texto ATUAL da cadência nas tarefas que ainda não saíram. Não mexe no que já foi enviado."
      >
        {pend && !sim ? "Conferindo…" : aberto ? "fechar" : "Atualizar toques pendentes"}
      </button>

      {aberto && sim && (
        <div className="mt-2 w-full rounded-xl border border-brand/30 bg-brand-soft/30 p-3">
          <p className="text-sm">
            <b>{sim.mudam ?? 0}</b>{" "}
            {(sim.mudam ?? 0) === 1 ? "tarefa pendente mudaria" : "tarefas pendentes mudariam"} em “{nome}”.
            {sim.editadas ? (
              <> <b>{sim.editadas}</b> foram editadas à mão e ficam como estão.</>
            ) : null}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            Só mexe no que <b>ainda não saiu</b>. O que já foi enviado fica intacto — reescrever isso estragaria o
            registro do que o cliente recebeu.
          </p>
          {sim.semColunaEditado && (
            <p className="mt-1 text-[11px] text-warn">
              A migration 0112 ainda não foi aplicada: sem ela não dá para distinguir uma tarefa que você editou à
              mão, e a atualização passaria por cima dela.
            </p>
          )}

          {(sim.exemplos || []).length > 0 && (
            <div className="mt-2 space-y-2">
              {(sim.exemplos || []).map((e, i) => (
                <div key={i} className="rounded-lg border border-line bg-surface p-2 text-[11px]">
                  <p className="font-semibold">{e.contato} · {e.canal}</p>
                  <p className="mt-1 text-subtle"><b>antes:</b> {e.antes || "(vazio)"}</p>
                  <p className="text-ink"><b>depois:</b> {e.depois || "(vazio)"}</p>
                </div>
              ))}
              {(sim.mudam ?? 0) > 3 && (
                <p className="text-[11px] text-subtle">…e mais {(sim.mudam ?? 0) - 3}.</p>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="btn-brand py-1.5 text-xs"
              disabled={pend || !(sim.mudam ?? 0)}
              onClick={aplicar}
            >
              {pend ? "Aplicando…" : `Aplicar em ${sim.mudam ?? 0}`}
            </button>
            <button className="btn-ghost py-1.5 text-xs" disabled={pend} onClick={simular}>
              Conferir de novo
            </button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => setAberto(false)}>
              cancelar
            </button>
          </div>

          {msg && <p className="mt-2 text-xs text-signal">{msg}</p>}
          {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        </div>
      )}
      {!aberto && err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </>
  );
}
