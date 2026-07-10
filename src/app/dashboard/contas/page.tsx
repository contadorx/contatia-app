import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AccountTools from "@/components/AccountTools";

export const dynamic = "force-dynamic";

export default async function Contas() {
  const supabase = createClient();
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, uf, cnpj, domain, contacts(count), opportunities(count)")
    .order("created_at", { ascending: false })
    .limit(300);

  const rows = (accounts as any[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Empresas</h1>
      <p className="mt-1 text-sm text-subtle">As contas B2B: cada empresa reúne seus contatos e oportunidades.</p>

      <div className="mt-6">
        <AccountTools />
      </div>

      <div className="card mt-6 overflow-hidden">
        {!rows.length ? (
          <div className="p-10 text-center text-sm text-subtle">Nenhuma empresa ainda. Crie a primeira acima.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">UF</th>
                <th className="px-4 py-3 font-medium">Contatos</th>
                <th className="px-4 py-3 font-medium">Oportunidades</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0 hover:bg-muted">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/contas/${a.id}`} className="text-brand-dark hover:underline">
                      {a.name}
                    </Link>
                    {a.domain && <span className="ml-2 text-xs text-subtle">{a.domain}</span>}
                  </td>
                  <td className="px-4 py-3 text-subtle">{a.uf || "—"}</td>
                  <td className="px-4 py-3 text-subtle">{a.contacts?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3 text-subtle">{a.opportunities?.[0]?.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
