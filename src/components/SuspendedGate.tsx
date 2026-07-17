"use client";

import { useState } from "react";

// Tela de REATIVAÇÃO (não é um muro): conta pausada por falta de pagamento, mas com
// caminho de volta claro — pagar e reativar na hora, "já paguei", e falar com a gente.
// Pensada para RECUPERAR churn, não para punir.
export default function SuspendedGate({
  amount,
  paymentLink,
  planosUrl,
  archived,
}: {
  amount?: number | null;
  paymentLink?: string | null;
  planosUrl: string;
  archived?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const valor =
    typeof amount === "number" && amount > 0
      ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;
  const payHref = paymentLink || planosUrl;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warn/15 text-2xl">{archived ? "🗄️" : "⏸️"}</div>
        <h1 className="mt-4 font-display text-xl font-bold">{archived ? "Sua conta está arquivada" : "Sua conta está pausada"}</h1>
        <p className="mt-2 text-sm text-subtle">
          {archived ? (
            <>Sua conta e suas faturas seguem guardadas. Os dados dos leads foram removidos por privacidade, mas a
            porta continua aberta: reative e reimporte sua base quando quiser — a gente te ajuda.</>
          ) : (
            <>Seus dados estão <b>seguros</b> — nada foi apagado. É só regularizar o pagamento e seu acesso
            volta na hora, do jeitinho que você deixou.</>
          )}
        </p>

        <div className="mt-5 rounded-xl border border-line bg-muted/50 p-4">
          {valor && <p className="text-sm text-subtle">Fatura em aberto: <b className="text-ink">{valor}</b></p>}
          <a
            href={payHref}
            target="_blank"
            rel="noreferrer"
            className="btn-brand mt-3 inline-flex w-full justify-center py-2.5 text-sm"
          >
            Pagar e reativar agora →
          </a>
          <button
            className="mt-2 w-full text-xs text-subtle hover:text-ink"
            disabled={refreshing}
            onClick={() => { setRefreshing(true); window.location.reload(); }}
          >
            {refreshing ? "Verificando…" : "Já paguei — atualizar"}
          </button>
        </div>

        <div className="mt-5 border-t border-line pt-4 text-sm">
          <p className="text-subtle">
            Teve algum imprevisto, precisa de mais prazo ou quer rever o plano?
          </p>
          <a href="mailto:suporte@contatia.com.br?subject=Reativar%20minha%20conta" className="font-semibold text-brand hover:underline">
            Falar com a gente
          </a>
          <span className="text-subtle"> — a gente resolve junto.</span>
          <p className="mt-1 text-xs text-subtle">Ou use o chat de ajuda no canto da tela.</p>
        </div>
      </div>
    </main>
  );
}
