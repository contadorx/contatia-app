import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AddContactToAccount from "@/components/AddContactToAccount";
import NewContactForAccount from "@/components/NewContactForAccount";
import NewOpportunityForAccount from "@/components/NewOpportunityForAccount";
import EditAccountButton from "@/components/EditAccountButton";
import EnrichAccountButton from "@/components/EnrichAccountButton";
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
    .select("id, name, cnpj, uf, domain, phone, website, cnae, cnae_descricao, municipio, porte, email, cep, bairro, logradouro, numero, complemento, situacao, custom")
    .eq("id", params.id)
    .maybeSingle();

  if (!account) notFound();
  const a = account as any;
  const custom = a.custom || {};

  // endereço completo (rua, número, complemento) + bairro/CEP/município
  const linhaRua = ([a.logradouro, a.numero].filter(Boolean).join(", ") + (a.complemento ? ` — ${a.complemento}` : "")).trim();
  const endereco = [linhaRua, a.bairro, [a.municipio, a.uf].filter(Boolean).join("/"), a.cep ? `CEP ${a.cep}` : ""]
    .filter((s) => s && String(s).trim())
    .join(" · ");
  const capital = typeof custom.capital_social === "number" ? brl(custom.capital_social) : null;
  const socios: string[] = Array.isArray(custom.socios) ? custom.socios : [];
  const hasDetails = !!(a.cnae || a.porte || a.municipio || a.phone || a.email || a.website || endereco || a.situacao);

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
            {[a.situacao, a.cnpj, a.domain].filter(Boolean).join(" · ") || "—"}
          </p>
          <div className="mt-2">
            <AccountTags accountId={account.id} tags={myTags} allTags={(allTags as any[]) || []} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <EnrichAccountButton accountId={account.id} />
          <EditAccountButton account={account as any} />
        </div>
      </div>

      {hasDetails && (
        <div className="card mt-4 grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3">
          <AField label="CNAE" value={[a.cnae, a.cnae_descricao].filter(Boolean).join(" — ") || a.cnae} />
          <AField label="Porte" value={a.porte} />
          <AField label="Situação" value={a.situacao} />
          <AField label="Telefone" value={a.phone} />
          <AField label="E-mail" value={a.email} />
          <div>
            <p className="label">Site</p>
            {a.website ? (
              <a href={a.website} target="_blank" rel="noreferrer" className="text-brand-dark hover:underline">abrir ↗</a>
            ) : (
              <p className="text-subtle">—</p>
            )}
          </div>
          <div className="col-span-2 sm:col-span-3">
            <AField label="Endereço" value={endereco} />
          </div>
          <AField label="Natureza jurídica" value={custom.natureza_juridica} />
          <AField label="Capital social" value={capital} />
          <AField label="Abertura" value={custom.abertura} />
          {socios.length > 0 && (
            <div className="col-span-2 sm:col-span-3">
              <p className="label">Sócios</p>
              <p>{socios.join(" · ")}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Contatos */}
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Contatos ({cs.length})</h2>
          <div className="card divide-y divide-line">
            {cs.length ? (
              cs.map((c) => (
                <Link
                  key={c.id}
                  href={`/dashboard/contatos/${c.id}`}
                  className="flex items-center justify-between p-3 transition hover:bg-muted"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-subtle">{c.role_title || c.email || c.phone || "—"}</p>
                  </div>
                  <span className="text-xs text-subtle">abrir →</span>
                </Link>
              ))
            ) : (
              <p className="p-4 text-sm text-subtle">Nenhum contato nesta empresa ainda.</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <NewContactForAccount accountId={account.id} />
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
              <p className="p-4 text-sm text-subtle">Nenhuma oportunidade ainda.</p>
            )}
          </div>
          <div className="mt-3">
            <NewOpportunityForAccount accountId={account.id} accountName={account.name} contacts={cs.map((c) => ({ id: c.id, name: c.name }))} />
          </div>
        </div>
      </div>
    </div>
  );
}
