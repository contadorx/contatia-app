import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AddContactToAccount from "@/components/AddContactToAccount";
import EditAccountButton from "@/components/EditAccountButton";
import AccountTags from "@/components/AccountTags";

export const dynamic = "force-dynamic";

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function AField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={value ? "" : "text-subtle"}>{value || "—"}</p>
    </div>
  );
}

export default async function ContaDetalhe({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, cnpj, uf, domain, phone, website, cnae, municipio, porte")
    .eq("id", params.id)
    .maybeSingle();

  if (!account) notFound();
  const a = account as any;
  const hasDetails = !!(a.cnae || a.porte || a.municipio || a.phone || a.website);

  const [{ data: contacts }, { data: opps }, { data: freeContacts }, { data: accountTags }, { data: allTags }] = await Promise.all([
    supabase.from("contacts").select("id, name, email, phone, role_title").eq("account_id", params.id),
    supabase.from("opportunities").select("id, title, value_mrr, status").eq("account_id", params.id),
    supabase.from("contacts").select("id, name").is("account_id", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("account_tags").select("tags(id, name, color)").eq("account_id", params.id),
    supabase.from("tags").select("id, name, color").order("name", { ascending: true }),
  ]);

  const cs = (contacts as any[]) || [];
  const os = (opps as any[]) || [];
  const myTags = ((accountTags as any[]) || []).map((r) => r.tags).filter(Boolean);

  return (
    <div>
      <Link href="/dashboard/contas" className="text-sm text-subtle hover:text-brand">
        ← Empresas
      </Link>

      <div className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{account.name}</h1>
          <p className="mt-1 text-sm text-subtle">
            {[account.uf, account.cnpj, account.domain].filter(Boolean).join(" · ") || "—"}
          </p>
          <div className="mt-2">
            <AccountTags accountId={account.id} tags={myTags} allTags={(allTags as any[]) || []} />
          </div>
        </div>
        <EditAccountButton account={account as any} />
      </div>

      {hasDetails && (
        <div className="card mt-4 grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3">
          <AField label="CNAE" value={a.cnae} />
          <AField label="Porte" value={a.porte} />
          <AField label="Município/UF" value={[a.municipio, a.uf].filter(Boolean).join(" / ")} />
          <AField label="Telefone" value={a.phone} />
          <div>
            <p className="label">Site</p>
            {a.website ? (
              <a href={a.website} target="_blank" rel="noreferrer" className="text-brand-dark hover:underline">abrir ↗</a>
            ) : (
              <p className="text-subtle">—</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Contatos */}
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Contatos ({cs.length})</h2>
          <div className="card divide-y divide-line">
            {cs.length ? (
              cs.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-subtle">{c.role_title || c.email || c.phone || "—"}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-subtle">Nenhum contato nesta empresa ainda.</p>
            )}
          </div>
          <div className="mt-3">
            <AddContactToAccount accountId={account.id} available={(freeContacts as any[]) || []} />
          </div>
        </div>

        {/* Oportunidades */}
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Oportunidades ({os.length})</h2>
          <div className="card divide-y divide-line">
            {os.length ? (
              os.map((o) => (
                <div key={o.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{o.title}</p>
                    <p className="text-xs text-subtle">{o.status}</p>
                  </div>
                  <span className="text-sm font-bold text-brand-dark">{brl(o.value_mrr)}/mês</span>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-subtle">Nenhuma oportunidade. Crie no Pipeline vinculando esta empresa.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
