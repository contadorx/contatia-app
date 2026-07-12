"use client";

// ============================================================
// Uso × limites do plano.
// Avisa a partir de 80% e mostra o bloqueio ao atingir 100% — sempre com o
// caminho de saída (o plano que resolve). Nunca bloqueia em silêncio.
// ============================================================

export type Uso = {
  recurso: string;
  usado: number;
  limite: number | null;
  percentual: number;
  bloqueado: boolean;
  plano_atual: string;
  plano_sugerido: string;
};

const NOMES: Record<string, string> = {
  usuarios: "Usuários",
  contatos: "Contatos",
  cadencias: "Cadências",
  caixas: "Caixas de e-mail",
};

export function UsageLimits({ usos, compacto = false }: { usos: Uso[]; compacto?: boolean }) {
  const criticos = usos.filter((u) => u.bloqueado);
  const alertas = usos.filter((u) => !u.bloqueado && u.percentual >= 80 && u.limite);
  const plano = usos[0]?.plano_atual || "—";
  const sugerido = usos[0]?.plano_sugerido || "—";

  // Modo compacto: só a faixa de aviso (para o topo das telas)
  if (compacto) {
    if (!criticos.length && !alertas.length) return null;

    const c = criticos[0] || alertas[0];
    const critico = !!criticos.length;

    return (
      <div
        className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ${
          critico ? "border border-danger/30 bg-danger/10 text-danger" : "border border-warn/30 bg-warn/10 text-warn"
        }`}
      >
        <span className="font-medium">
          {critico ? (
            <>
              Limite de <b>{NOMES[c.recurso]?.toLowerCase() || c.recurso}</b> atingido
              ({c.usado} de {c.limite}) no plano {plano}.
            </>
          ) : (
            <>
              Você já usou <b>{c.percentual}%</b> dos {NOMES[c.recurso]?.toLowerCase() || c.recurso} do plano {plano}
              ({c.usado} de {c.limite}).
            </>
          )}
        </span>
        <a href="/dashboard/planos" className="whitespace-nowrap font-semibold underline">
          Mudar para {sugerido} →
        </a>
      </div>
    );
  }

  // Modo completo: as barras de uso (tela de Planos / Configurações)
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display font-semibold">Uso do plano {plano}</p>
        {(criticos.length > 0 || alertas.length > 0) && (
          <a href="/dashboard/planos" className="text-sm font-semibold text-brand hover:underline">
            Ver plano {sugerido} →
          </a>
        )}
      </div>

      <div className="mt-4 space-y-4">
        {usos.map((u) => {
          const ilimitado = u.limite === null;
          const cor = u.bloqueado ? "bg-danger" : u.percentual >= 80 ? "bg-warn" : "bg-brand";

          return (
            <div key={u.recurso}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{NOMES[u.recurso] || u.recurso}</span>
                <span className={u.bloqueado ? "font-semibold text-danger" : "text-subtle"}>
                  {u.usado.toLocaleString("pt-BR")} {ilimitado ? "· ilimitado" : `de ${u.limite?.toLocaleString("pt-BR")}`}
                </span>
              </div>
              {!ilimitado && (
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full transition-all ${cor}`} style={{ width: `${Math.min(100, u.percentual)}%` }} />
                </div>
              )}
              {u.bloqueado && (
                <p className="mt-1 text-xs text-danger">
                  Limite atingido. Para continuar, mude para o plano <b>{u.plano_sugerido}</b>.
                </p>
              )}
              {!u.bloqueado && u.percentual >= 80 && !ilimitado && (
                <p className="mt-1 text-xs text-warn">Chegando ao limite — considere o plano {u.plano_sugerido}.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Trava de feature: mostra a tela bloqueada com o caminho de saída,
// em vez de simplesmente esconder o recurso.
// ============================================================
export function FeatureLock({
  feature,
  titulo,
  descricao,
  planoSugerido = "Profissional",
}: {
  feature: string;
  titulo: string;
  descricao: string;
  planoSugerido?: string;
}) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-2xl">🔒</div>
      <p className="font-display text-lg font-bold">{titulo}</p>
      <p className="mt-2 text-sm text-subtle">{descricao}</p>
      <p className="mt-3 text-sm">
        Disponível a partir do plano <b>{planoSugerido}</b>.
      </p>
      <a href="/dashboard/planos" className="btn-brand mt-5 inline-flex">Ver planos →</a>
    </div>
  );
}
