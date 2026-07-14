import { createClient } from "@/lib/supabase/server";
import RadarImport from "@/components/RadarImport";
import RadarPushButton from "@/components/RadarPushButton";
import RadarSeedButton from "@/components/RadarSeedButton";
import SmartSelect from "@/components/SmartSelect";

export const dynamic = "force-dynamic";

export default async function Radar({
  searchParams,
}: {
  searchParams: { cnae?: string; uf?: string; municipio?: string; bairro?: string; capital?: string; porte?: string; tier?: string; q?: string };
}) {
  // O Radar está incluído em TODOS os planos (Individual e Equipes) — sem gate.
  const supabase = createClient();

  let query = supabase
    .from("radar_leads")
    .select("id, cnpj, razao_social, nome_fantasia, cnae, uf, municipio, bairro, is_capital, porte, tier, converted_contact_id", { count: "exact" })
    .order("razao_social", { ascending: true })
    .limit(100);

  if (searchParams.cnae) query = query.ilike("cnae", `%${searchParams.cnae}%`);
  if (searchParams.uf) query = query.eq("uf", searchParams.uf.toUpperCase());
  if (searchParams.municipio) query = query.ilike("municipio", `%${searchParams.municipio}%`);
  if (searchParams.bairro) query = query.ilike("bairro", `%${searchParams.bairro}%`);
  if (searchParams.capital === "1") query = query.eq("is_capital", true);
  if (searchParams.porte) query = query.ilike("porte", `%${searchParams.porte}%`);
  if (searchParams.tier) query = query.eq("tier", searchParams.tier);
  if (searchParams.q) query = query.or(`razao_social.ilike.%${searchParams.q}%,nome_fantasia.ilike.%${searchParams.q}%`);

  const [{ data: leads, count }, { data: sequences }, { count: totalBase }] = await Promise.all([
    query,
    supabase.from("sequences").select("id, name").eq("is_active", true),
    supabase.from("radar_leads").select("id", { count: "exact", head: true }),
  ]);

  const rows = (leads as any[]) || [];
  const seqs = (sequences as { id: string; name: string }[]) || [];
  const advActive = !!(searchParams.cnae || searchParams.bairro || searchParams.capital === "1" || searchParams.porte || searchParams.tier);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Radar</h1>
      <p className="mt-1 text-sm text-subtle">Garimpe empresas-alvo e adicione as escolhidas aos seus leads.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <RadarImport />
        {(totalBase ?? 0) === 0 && <RadarSeedButton />}
      </div>

      <form className="card mt-6 p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <input name="q" defaultValue={searchParams.q} className="input sm:col-span-2" placeholder="Nome / razão social" />
          <input name="uf" defaultValue={searchParams.uf} className="input" placeholder="UF" maxLength={2} />
          <input name="municipio" defaultValue={searchParams.municipio} className="input" placeholder="Município" />
        </div>

        <details className="mt-3" open={advActive}>
          <summary className="cursor-pointer select-none text-xs font-medium text-brand hover:underline">Mais filtros</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <input name="cnae" defaultValue={searchParams.cnae} className="input" placeholder="Atividade (CNAE)" />
            <input name="bairro" defaultValue={searchParams.bairro} className="input" placeholder="Bairro" />
            <input name="porte" defaultValue={searchParams.porte} className="input" placeholder="Porte" />
            <SmartSelect
              name="tier"
              defaultValue={searchParams.tier}
              placeholder="Prioridade (todas)"
              clearable
              options={[
                { value: "T1", label: "T1 — alta" },
                { value: "T2", label: "T2 — média-alta" },
                { value: "T3", label: "T3 — média" },
                { value: "T4", label: "T4 — baixa" },
              ]}
            />
            <label className="flex items-center gap-2 text-sm text-subtle">
              <input type="checkbox" name="capital" value="1" defaultChecked={searchParams.capital === "1"} />
              Só capitais
            </label>
          </div>
        </details>

        <div className="mt-3 flex items-center gap-2">
          <button className="btn-brand px-4" type="submit">Filtrar</button>
          {(searchParams.q || advActive) && (
            <a href="/dashboard/radar" className="text-xs text-subtle hover:text-ink">limpar</a>
          )}
        </div>
      </form>

      <p className="mt-4 text-sm text-subtle">{count ?? 0} empresas na base (mostrando até 100).</p>

      <div className="card mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">CNAE</th>
              <th className="px-4 py-3 font-medium">UF</th>
              <th className="px-4 py-3 font-medium">Porte</th>
              <th className="px-4 py-3 font-medium" title="Prioridade do lead: T1 (melhor encaixe) a T4 (menor).">Prioridade</th>
              <th className="px-4 py-3 font-medium text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.nome_fantasia || r.razao_social || "—"}</p>
                    <p className="text-xs text-subtle">{r.cnpj || "sem CNPJ"} · {[r.bairro, r.municipio].filter(Boolean).join(", ") || "—"}{r.is_capital && <span className="ml-1 rounded bg-brand-soft px-1 py-0.5 text-[9px] font-bold text-brand-dark">CAPITAL</span>}</p>
                  </td>
                  <td className="px-4 py-3 text-subtle">{r.cnae || "—"}</td>
                  <td className="px-4 py-3 text-subtle">{r.uf || "—"}</td>
                  <td className="px-4 py-3 text-subtle">{r.porte || "—"}</td>
                  <td className="px-4 py-3">{r.tier ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs" title="Prioridade do lead (T1 alta … T4 baixa)">{r.tier}</span> : "—"}</td>
                  <td className="px-4 py-3">
                    <RadarPushButton radarId={r.id} sequences={seqs} converted={!!r.converted_contact_id} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-subtle">
                  Nenhuma empresa encontrada. Importe sua base acima ou ajuste os filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-subtle">
        <b>Prioridade</b> vai de T1 (melhor encaixe com o seu perfil de cliente) a T4 (menor). Os dados de contato
        (telefone, e-mail, sócios) são buscados só quando você adiciona a empresa aos leads — não antes.
      </p>
    </div>
  );
}
