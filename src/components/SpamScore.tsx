"use client";

// Exibição do resultado do SpamCheck (SpamAssassin). Usado na saúde do domínio
// e no editor de cadência. Score: quanto MENOR, melhor.

export type SpamRule = { rule: string; score: number; description: string };
export type SpamResultView = { score: number; rules: SpamRule[]; verdict: "bom" | "atencao" | "risco" };

const MAP = {
  bom: { label: "Baixo risco de spam", cls: "text-signal", bar: "bg-signal" },
  atencao: { label: "Atenção — dá pra melhorar", cls: "text-warn", bar: "bg-warn" },
  risco: { label: "Alto risco de cair em spam", cls: "text-danger", bar: "bg-danger" },
} as const;

export default function SpamScore({ result }: { result: SpamResultView }) {
  const m = MAP[result.verdict];
  // barra 0..100: 0 = impecável; ~8 = péssimo. Limita em 8 pra não estourar.
  const pct = Math.min(100, Math.max(2, (result.score / 8) * 100));
  const ruins = result.rules.filter((r) => r.score > 0).slice(0, 6);

  return (
    <div className="mt-2 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between">
        <p className={`text-sm font-semibold ${m.cls}`}>{m.label}</p>
        <p className={`font-display text-lg font-bold ${m.cls}`}>{result.score.toFixed(1)}</p>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${m.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-subtle">
        Score do SpamAssassin — quanto <b>menor</b>, melhor. Provedores costumam marcar spam a partir de ~5,0.
      </p>
      {ruins.length > 0 ? (
        <div className="mt-2">
          <p className="label">O que pesou contra</p>
          <ul className="mt-1 space-y-1">
            {ruins.map((r) => (
              <li key={r.rule} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-subtle">{r.description || r.rule}</span>
                <span className="shrink-0 font-semibold text-danger">+{r.score.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-signal">Nenhuma regra negativa disparou — conteúdo limpo.</p>
      )}
    </div>
  );
}
