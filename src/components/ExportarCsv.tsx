"use client";

// ============================================================
// Botão de exportar CSV — usado em Contatos e em Empresas.
//
// O servidor devolve o CSV pronto (texto); aqui só viramos arquivo e baixamos. Fazer o
// arquivo no servidor garante que a exportação use EXATAMENTE a mesma consulta da tela
// e da exclusão — é isso que torna o "exporte antes de apagar" uma rede de segurança de
// verdade, e não um arquivo parecido.
// ============================================================

import { useState, useTransition } from "react";

export default function ExportarCsv({
  nomeBase,
  rotulo = "Exportar CSV",
  exportar,
  className = "btn-ghost py-1.5 text-sm",
}: {
  nomeBase: string;                                        // ex.: "contatos" → contatos-2026-07-30.csv
  rotulo?: string;
  exportar: () => Promise<{ csv?: string; linhas?: number; truncado?: boolean; error?: string }>;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function baixar(csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nomeBase}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          setMsg(null);
          start(async () => {
            try {
              const r = await exportar();
              if (r?.error) { setMsg(r.error); return; }
              if (!r?.csv) { setMsg("Nada para exportar."); return; }
              baixar(r.csv);
              setMsg(
                `✓ ${r.linhas} linha(s)` +
                (r.truncado ? " — teto de 20.000 por arquivo; refine o filtro para pegar o resto." : "")
              );
            } catch (e: any) {
              setMsg(`Falhou: ${e?.message || "conexão"}. Se acabou de publicar, recarregue com Ctrl+Shift+R.`);
            }
          });
        }}
      >
        {pending ? "Gerando…" : rotulo}
      </button>
      {msg && <span className="text-xs text-subtle">{msg}</span>}
    </span>
  );
}
