import { createClient } from "@/lib/supabase/server";
import ProposalForm from "@/components/ProposalForm";
import ShareControl from "@/components/ShareControl";
import ViewDocButton from "@/components/ViewDocButton";
import { dataCurta, dataHora } from "@/lib/datas";

export const dynamic = "force-dynamic";

function fmt(iso: string | null) {
  return dataHora(iso);
}

export default async function Propostas({
  searchParams,
}: {
  searchParams: { q?: string; tipo?: string; envio?: string };
}) {
  const supabase = createClient();
  // Filtros em memória: a lista é pequena (documentos do workspace) e assim o recorte
  // de "só os abertos" — que é o que interessa de verdade — sai de graça.
  const q = (searchParams?.q || "").trim().toLowerCase();
  const tipoF = searchParams?.tipo || "";
  const envioF = searchParams?.envio || "";   // abertos | naoabertos

  const [{ data: docs }, { data: contacts }, { data: shares }] = await Promise.all([
    supabase.from("documents").select("id, name, type, url, storage_path, created_at").order("created_at", { ascending: false }),
    supabase.from("contacts").select("id, name").order("name", { ascending: true }).limit(500),
    supabase
      .from("document_shares")
      // select("*"): sequence_id/step_position nascem na 0109 — pedir pelo nome
      // esvaziaria a tabela inteira antes da migration.
      .select("*, contacts(name), documents(name)")
      .order("sent_at", { ascending: false })
      .limit(50),
  ]);

  const docsTodos = (docs as any[]) || [];
  const docList = docsTodos.filter((d) => {
    if (tipoF && d.type !== tipoF) return false;
    if (!q) return true;
    return `${d.name || ""} ${d.type || ""}`.toLowerCase().includes(q);
  });
  const tiposExistentes = Array.from(new Set(docsTodos.map((d) => d.type).filter(Boolean))) as string[];
  const contactList = (contacts as { id: string; name: string }[]) || [];
  const sharesTodos = (shares as any[]) || [];
  // nome da cadência que gerou cada envio (quando veio de {{documento:…}} num passo)
  const seqIds = Array.from(new Set(sharesTodos.map((s: any) => s.sequence_id).filter(Boolean)));
  const nomeSeq: Record<string, string> = {};
  if (seqIds.length) {
    const { data: sq } = await supabase.from("sequences").select("id, name").in("id", seqIds as string[]);
    for (const x of ((sq as any[]) || [])) nomeSeq[x.id] = x.name;
  }
  const shareList = sharesTodos.filter((s: any) => {
    if (envioF === "abertos" && !(s.total_opens > 0)) return false;
    if (envioF === "naoabertos" && s.total_opens > 0) return false;
    if (!q) return true;
    return `${s.documents?.name || ""} ${s.contacts?.name || ""}`.toLowerCase().includes(q);
  });
  const trackingReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  // retenção (política do plano) para avisar expiração dos arquivos
  const { data: tnt } = await supabase.from("tenants").select("file_retention_months, platform_plans(file_retention_months)").maybeSingle();
  const retMonths = Number((tnt as any)?.platform_plans?.file_retention_months ?? (tnt as any)?.file_retention_months ?? 6);
  function expiryInfo(createdAt: string) {
    const exp = new Date(createdAt);
    exp.setMonth(exp.getMonth() + retMonths);
    const days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
    return { days, date: dataCurta(exp) };
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Propostas & documentos</h1>
      <p className="mt-1 text-sm text-subtle">Gere um link rastreado por destinatário. Quando ele abrir, o contato fica quente.</p>

      {!trackingReady && (
        <div className="mt-4 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          O rastreio de aberturas está indisponível no momento. Fale com o suporte para ativá-lo.
        </div>
      )}

      <div className="mt-6">
        <ProposalForm />
      </div>

      {docsTodos.length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-3">
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={searchParams?.q || ""}
              placeholder="Buscar por documento ou contato…"
              className="input min-w-[220px] flex-1 py-1.5 text-sm"
            />
            {tiposExistentes.length > 1 && (
              <select name="tipo" defaultValue={tipoF} className="input w-auto py-1.5 text-sm">
                <option value="">Qualquer tipo</option>
                {tiposExistentes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            <select name="envio" defaultValue={envioF} className="input w-auto py-1.5 text-sm">
              <option value="">Todos os envios</option>
              <option value="abertos">Só os abertos</option>
              <option value="naoabertos">Só os não abertos</option>
            </select>
            <button className="btn-brand py-1.5 text-sm" type="submit">Filtrar</button>
            {(q || tipoF || envioF) && (
              <a href="/dashboard/propostas" className="text-xs text-subtle underline hover:text-ink">limpar</a>
            )}
          </form>
          <p className="mt-2 text-xs text-subtle">
            {docList.length} de {docsTodos.length} documento(s) · {shareList.length} de {sharesTodos.length} envio(s).
          </p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {docList.length ? (
          docList.map((d) => (
            <div key={d.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {d.name} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">{d.type}</span>
                  </p>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-brand-dark hover:underline">
                      Abrir link ↗
                    </a>
                  )}
                  {d.storage_path && !d.url && (
                    <span className="inline-flex items-center gap-1 text-xs text-subtle">
                      <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand-dark">PDF</span> arquivo privado
                    </span>
                  )}
                  <div className="mt-1">
                    <ViewDocButton documentId={d.id} hasFile={!!d.storage_path} />
                  </div>
                  {d.storage_path && (() => {
                    const { days, date } = expiryInfo(d.created_at);
                    if (days <= 0) return <p className="mt-1 text-xs font-semibold text-danger">Arquivo expirado — não fica mais disponível para download</p>;
                    return <p className="mt-1 text-[11px] text-subtle">Disponível até {date}{days <= 30 ? " — baixe se precisar guardar" : ""}</p>;
                  })()}
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
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Aberturas</th>
                  <th className="px-4 py-3 font-medium">1ª abertura</th>
                </tr>
              </thead>
              <tbody>
                {shareList.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">{s.documents?.name || "—"}</td>
                    <td className="px-4 py-3 text-subtle">{s.contacts?.name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-subtle">
                      {s.sequence_id && nomeSeq[s.sequence_id]
                        ? <>{nomeSeq[s.sequence_id]}{s.step_position != null ? ` · passo ${s.step_position + 1}` : ""}</>
                        : "envio manual"}
                    </td>
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
