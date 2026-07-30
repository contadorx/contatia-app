"use client";

// ============================================================
// Filtro da aba REGISTRO (Resultados).
//
// Por que client component e não <form> GET: as abas de Resultados vivem em estado
// do React (ReportTabs). Um form GET é navegação completa do browser → o React
// remonta e a aba volta para "Visão geral", ou seja: você filtra e perde a tela que
// estava olhando. router.push faz navegação suave (só o servidor recalcula), a aba
// continua onde está.
// ============================================================

import { useRouter, useSearchParams } from "next/navigation";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { paraUrl } from "@/lib/filtros";

export default function LogFilterBar({
  acoes, usuarios, acaoOpts, membroOpts, gestor,
}: {
  acoes: string[];
  usuarios: string[];
  acaoOpts: SmartOption[];
  membroOpts: SmartOption[];
  gestor: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(next: Record<string, string>) {
    const p = new URLSearchParams(searchParams?.toString() || "");
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`/dashboard/relatorios${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }

  const temFiltro = acoes.length > 0 || usuarios.length > 0;

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="w-[240px]">
        <label className="label">Ação (pode marcar várias)</label>
        <div className="mt-1">
          <SmartSelect
            multiple
            placeholder="Todas as ações"
            className="py-1.5 text-sm"
            values={acoes}
            onValuesChange={(v) => go({ logAcao: paraUrl(v) })}
            options={acaoOpts}
          />
        </div>
      </div>
      {gestor && (
        <div className="w-[240px]">
          <label className="label">Quem fez (pode marcar vários)</label>
          <div className="mt-1">
            <SmartSelect
              multiple
              placeholder="Todo mundo"
              className="py-1.5 text-sm"
              values={usuarios}
              onValuesChange={(v) => go({ logUser: paraUrl(v) })}
              options={membroOpts}
            />
          </div>
        </div>
      )}
      {temFiltro && (
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => go({ logAcao: "", logUser: "" })}>
          Limpar filtro do registro
        </button>
      )}
    </div>
  );
}
