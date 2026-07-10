import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import ContactTools from "@/components/ContactTools";
import EnrollButton from "@/components/EnrollButton";

export const dynamic = "force-dynamic";

export default async function Contatos() {
  const supabase = createClient();

  const [{ data: contacts }, { data: sequences }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, email, phone, company, origin, status, score, created_at")
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false }),
  ]);

  const seqs = (sequences as { id: string; name: string }[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Contatos</h1>
      <p className="mt-1 text-sm text-subtle">Sua base de prospecção e relacionamento.</p>

      <div className="mt-6">
        <ContactTools />
      </div>

      <div className="card mt-6 overflow-visible">
        {!contacts?.length ? (
          <div className="p-10 text-center text-sm text-subtle">
            Nenhum contato ainda. Adicione um ou importe seu CSV para começar.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-muted">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/contatos/${c.id}`} className="text-brand-dark hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-subtle">{c.company || "—"}</td>
                  <td className="px-4 py-3 text-subtle">{c.email || c.phone || "—"}</td>
                  <td className="px-4 py-3">
                    {c.origin ? (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">{c.origin}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-semibold ${(c.score ?? 0) >= 25 ? "text-warn" : "text-subtle"}`}>
                      {c.score ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EnrollButton contactId={c.id} sequences={seqs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
