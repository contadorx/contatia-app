import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, ProductRow } from "@/components/ProductTools";

export const dynamic = "force-dynamic";

export default async function ProdutosConfig() {
  const supabase = createClient();
  const [{ data: products }, { data: accounts }] = await Promise.all([
    supabase.from("products").select("id, name, kind, billing, price, active, email_account_id, email_accounts(from_email)").order("created_at", { ascending: false }),
    supabase.from("email_accounts").select("id, from_email, display_name").eq("is_active", true).order("created_at", { ascending: true }),
  ]);
  const list = (products as any[]) || [];
  const accts = (accounts as any[]) || [];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-subtle">
        <Link href="/dashboard/config" className="hover:text-ink">Configurações</Link>
        <span>/</span>
        <span className="text-ink">Produtos & Serviços</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold">Produtos & Serviços</h1>
      <p className="mt-1 text-sm text-subtle">Seu catálogo do que você vende. Vincule um item a cada oportunidade para medir receita por produto no funil e nas métricas.</p>

      <div className="mt-6">
        <ProductForm accounts={accts} />
      </div>

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Cobrança</th>
              <th className="px-4 py-3 font-medium">Preço ref.</th>
              <th className="px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => <ProductRow key={p.id} p={p} accounts={accts} />)}
            {!list.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-subtle">Catálogo vazio. Adicione seu primeiro produto ou serviço acima.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
