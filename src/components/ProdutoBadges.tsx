import Link from "next/link";
import type { ProdutoVinculo } from "@/lib/produtos";

// Mostra em quais produtos o contato/empresa está inscrito, com o "como":
// ● cadência ativa   ◆ oportunidade no funil. Fica no topo da ficha.
export default function ProdutoBadges({
  produtos,
  titulo = "Produtos",
  vazio = "Ainda não está inscrito em nenhum produto.",
  divider = true,
}: {
  produtos: ProdutoVinculo[];
  titulo?: string;
  vazio?: string;
  divider?: boolean;
}) {
  return (
    <div className={divider ? "mt-4 border-t border-line pt-4" : ""}>
      <div className="mb-2 flex items-center justify-between">
        <p className="label">{titulo}</p>
        <Link href="/dashboard/config/produtos" className="text-xs text-subtle hover:text-brand">
          gerenciar →
        </Link>
      </div>
      {produtos.length ? (
        <div className="flex flex-wrap gap-2">
          {produtos.map((p) => {
            const como = [p.viaCadencia ? "cadência" : null, p.viaOportunidade ? "oportunidade" : null]
              .filter(Boolean)
              .join(" · ");
            return (
              <span
                key={p.id}
                title={como ? `Via ${como}` : undefined}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/5 px-3 py-1 text-xs font-medium text-brand-dark"
              >
                {p.name}
                <span className="text-[10px] font-normal text-subtle">{como}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-subtle">{vazio}</p>
      )}
    </div>
  );
}
