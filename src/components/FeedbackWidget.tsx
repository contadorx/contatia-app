"use client";

import { useState, useTransition } from "react";
import { submitFeedback } from "@/app/dashboard/feedback-actions";

// NPS leve: um botão discreto acima do "?" de ajuda. Abre o card de 0-10 + comentário.
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function enviar() {
    if (score === null) return;
    start(async () => {
      const r = (await submitFeedback(score, comment)) as any;
      if (!r?.error) setDone(true);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-20 z-40 flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-medium text-subtle shadow-md hover:text-ink"
        title="Deixar feedback"
      >
        ★ Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/30" />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Sua opinião</h2>
              <button className="text-subtle hover:text-ink" onClick={() => setOpen(false)}>✕</button>
            </div>

            {done ? (
              <div className="py-6 text-center">
                <p className="text-2xl">🙏</p>
                <p className="mt-2 text-sm text-subtle">Obrigado pelo feedback! Ele nos ajuda a melhorar a Contatia.</p>
                <button className="btn-brand mt-4 py-1.5 text-sm" onClick={() => setOpen(false)}>Fechar</button>
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm text-subtle">De 0 a 10, o quanto você recomendaria a Contatia para um colega?</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button
                      key={n}
                      onClick={() => setScore(n)}
                      className={`h-9 w-9 rounded-lg border text-sm font-semibold ${score === n ? "border-brand bg-brand text-white" : "border-line hover:bg-muted"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <textarea
                  className="input mt-3 min-h-[70px] text-sm"
                  placeholder="Quer contar o porquê? (opcional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button className="btn-brand mt-3 w-full py-2 text-sm" onClick={enviar} disabled={pending || score === null}>
                  {pending ? "Enviando…" : "Enviar feedback"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
