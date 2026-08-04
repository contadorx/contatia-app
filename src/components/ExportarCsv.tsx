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
import { diaISO } from "@/lib/datas";

export default function ExportarCsv({
  nomeBase,
  rotulo = "Exportar CSV",
  exportar,
  className = "btn-ghost py-1.5 text-sm",
}: {
  nomeBase: string;                                        // ex.: "contatos" → contatos-2026-07-30.csv
  rotulo?: string;
  exportar: () => Promise<{ csv?: string; linhas?: number; truncado?: boolean; teto?: number; error?: string }>;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function baixar(csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nomeBase}-${diaISO()}.csv`;
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
                // O teto vem do servidor: escrever "20.000" aqui é o mesmo erro que
                // fez a tela do Radar anunciar um teto de 2.000 que já era 5.000.
                `✓ ${(r.linhas ?? 0).toLocaleString("pt-BR")} linha(s)` +
                (r.truncado
                  ? ` — teto de ${typeof r.teto === "number" ? r.teto.toLocaleString("pt-BR") : "um arquivo"} por arquivo; refine o filtro para pegar o resto.`
                  : "")
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
