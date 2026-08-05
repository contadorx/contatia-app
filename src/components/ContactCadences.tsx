"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pauseEnrollment, resumeEnrollment, stopEnrollment } from "@/app/dashboard/cadencias/actions";

type Enr = { id: string; status: string; sequences: { name: string } | null };

const STATUS: Record<string, { l: string; c: string }> = {
  active: { l: "Ativa", c: "bg-signal/10 text-signal" },
  paused: { l: "Pausada", c: "bg-warn/10 text-warn" },
  replied: { l: "Respondeu", c: "bg-brand-soft text-brand-dark" },
  completed: { l: "Concluída", c: "bg-muted text-subtle" },
  stopped: { l: "Parada", c: "bg-muted text-subtle" },
};

// ============================================================
// DESINSCREVER PRECISA PARECER UMA AÇÃO
//
// A saída existia: um link cinza de 12px escrito "remover", do lado de "pausar", com
// o mesmo peso visual do resto. Quem inscreve na cadência errada procura por
// "desinscrever" ou "cancelar" e não encontra nada — o verbo estava errado e a
// aparência dizia "detalhe", não "botão".
//
// E o retorno das três ações era descartado (`void (await ...)`). Se o servidor
// recusasse, a tela não mudava e nada era dito: o operador clicava de novo achando
// que não tinha clicado.
// ============================================================
export default function ContactCadences({ enrollments }: { enrollments: Enr[] }) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  function acao(fn: () => Promise<any>) {
    setErro(null);
    start(async () => {
      try {
        const r: any = await fn();
        if (r?.error) { setErro(r.error); return; }
        router.refresh();
      } catch (e: any) {
        setErro(e?.message || "Não consegui falar com o servidor.");
      }
    });
  }

  if (!enrollments.length) return <p className="text-sm text-subtle">Nenhuma cadência ainda. Use &ldquo;Inscrever&rdquo; acima.</p>;

  return (
    <div className="space-y-2">
      {erro && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{erro}</p>}
      {enrollments.map((e) => {
        const st = STATUS[e.status] || STATUS.stopped;
        return (
          <div key={e.id} className="flex items-center justify-between rounded-lg border border-line p-2.5">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span>
              <span className="text-sm font-medium">{e.sequences?.name || "—"}</span>
            </div>
            <div className="flex items-center gap-3">
              {e.status === "active" && (
                <button
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted"
                  disabled={pending}
                  onClick={() => acao(() => pauseEnrollment(e.id))}
                >
                  Pausar
                </button>
              )}
              {e.status === "paused" && (
                <button
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted"
                  disabled={pending}
                  onClick={() => acao(() => resumeEnrollment(e.id))}
                >
                  Retomar
                </button>
              )}
              {(e.status === "active" || e.status === "paused") && (
                <button
                  className="rounded-lg border border-danger/40 bg-white px-2 py-1 text-xs font-medium text-danger hover:bg-danger/5"
                  disabled={pending}
                  title="Tira o contato desta cadência e cancela os toques que ainda não aconteceram. O histórico do que já foi enviado permanece."
                  onClick={() => {
                    if (confirm(`Desinscrever de "${e.sequences?.name || "esta cadência"}"?\n\nOs toques que ainda não aconteceram serão cancelados. O que já foi enviado continua no histórico.`)) {
                      acao(() => stopEnrollment(e.id));
                    }
                  }}
                >
                  ✕ Desinscrever
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
