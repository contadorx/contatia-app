"use client";

// ============================================================
// Tela de erro do painel.
//
// POR QUE existe: sem este arquivo, qualquer exceção no navegador vira a tela
// genérica do Next — "Application error: a client-side exception has occurred
// (see the browser console)". Ou seja: o usuário não sabe o que houve, e quem vai
// consertar também não, porque a mensagem só existe no console dele.
//
// Aqui a mensagem e o `digest` aparecem na tela, dá para copiar e mandar para o
// suporte, e há um botão para tentar de novo sem perder a sessão.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    // continua indo para o console (e para os Runtime Logs da Vercel, quando é server)
    console.error("[contatia] erro no painel:", error);
  }, [error]);

  const detalhe = [
    `Mensagem: ${error?.message || "(sem mensagem)"}`,
    error?.digest ? `Digest: ${error.digest}` : null,
    `Página: ${typeof window !== "undefined" ? window.location.pathname + window.location.search : ""}`,
    `Quando: ${new Date().toLocaleString("pt-BR")}`,
  ].filter(Boolean).join("\n");

  return (
    <div className="mx-auto max-w-xl">
      <div className="card border-danger/30 p-6">
        <h1 className="font-display text-xl font-bold text-danger">Algo quebrou nesta tela</h1>
        <p className="mt-1 text-sm text-subtle">
          Seus dados não foram afetados por este erro em si. Se você estava no meio de uma ação em lote, confira o
          resultado em <Link href="/dashboard/relatorios" className="text-brand-dark underline">Resultados → Registro</Link>{" "}
          antes de repetir.
        </p>

        <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs text-ink">{detalhe}</pre>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-brand py-2 text-sm" onClick={() => reset()}>Tentar de novo</button>
          <button
            className="btn-ghost py-2 text-sm"
            onClick={() => {
              navigator.clipboard?.writeText(detalhe).then(
                () => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); },
                () => {}
              );
            }}
          >
            {copiado ? "copiado ✓" : "Copiar detalhes"}
          </button>
          <Link href="/dashboard" className="btn-ghost py-2 text-sm">Voltar ao início</Link>
        </div>

        <p className="mt-4 text-xs text-subtle">
          <b>Se isto apareceu logo depois de uma publicação:</b> costuma ser a aba antiga falando com o servidor novo.
          Recarregue segurando <b>Ctrl+Shift+R</b> (ou <b>Cmd+Shift+R</b> no Mac) e tente de novo — na maioria das vezes
          resolve sozinho.
        </p>
      </div>
    </div>
  );
}
