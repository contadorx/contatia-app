import { createClient } from "@/lib/supabase/server";
import ProposalForm from "@/components/ProposalForm";
import ShareControl from "@/components/ShareControl";

export const dynamic = "force-dynamic";

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export default async function Propostas() {
  const supabase = createClient();

  const [{ data: docs }, { data: contacts }, { data: shares }] = await Promise.all([
    supabase.from("documents").select("id, name, type, url, storage_path, created_at").order("created_at", { ascending: false }),
    supabase.from("contacts").select("id, name").order("name", { ascending: true }).limit(500),
    supabase
      .from("document_shares")
      .select("id, token, total_opens, first_open_at, sent_at, contacts(name), documents(name)")
      .order("sent_at", { ascending: false })
      .limit(50),
  ]);

  const docList = (docs as any[]) || [];
  const contactList = (contacts as { id: string; name: string }[]) || [];
  const shareList = (shares as any[]) || [];
  const trackingReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Propostas & documentos</h1>
      <p className="mt-1 text-sm text-subtle">Gere um link rastreado por destinatário. Quando ele abrir, o contato fica quente.</p>

      {!trackingReady && (
        <div className="mt-4 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          Para o rastreio funcionar, configure <b>SUPABASE_SERVICE_ROLE_KEY</b> no ambiente (Vercel). Sem ela, os links de rastreio não abrem.
        </div>
      )}

      <div className="mt-6">
        <ProposalForm />
      </div>

      <div className="mt-6 space-y-3">
        {docList.length ? (
          docList.map((d) => (
            <div key={d.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {d.name} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">{d.type}</span>
                  </p>
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-brand-dark hover:underline">
                    {d.url}
                  </a>
                  {d.storage_path && !d.url && (
                    <span className="inline-flex items-center gap-1 text-xs text-subtle">
                      <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand-dark">PDF</span> arquivo enviado (privado)
                    </span>
                  )}
                </div>
              </div>
              <ShareControl documentId={d.id} contacts={contactList} />
            </div>
          ))
        ) : (
          <div className="card p-8 text-center text-sm text-subtle">Nenhum documento ainda. Adicione um link acima.</div>
        )}
      </div>

      {shareList.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Envios & aberturas</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th className="px-4 py-3 font-medium">Documento</th>
                  <th className="px-4 py-3 font-medium">Contato</th>
                  <th className="px-4 py-3 font-medium">Aberturas</th>
                  <th className="px-4 py-3 font-medium">1ª abertura</th>
                </tr>
              </thead>
              <tbody>
                {shareList.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">{s.documents?.name || "—"}</td>
                    <td className="px-4 py-3 text-subtle">{s.contacts?.name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={s.total_opens > 0 ? "font-semibold text-signal" : "text-subtle"}>{s.total_opens || 0}</span>
                    </td>
                    <td className="px-4 py-3 text-subtle">{fmt(s.first_open_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
