import { hasFeature } from "@/lib/plan";
import { FeatureLock } from "@/components/UsageLimits";
import { createClient } from "@/lib/supabase/server";
import RadarImport from "@/components/RadarImport";
import RadarPushButton from "@/components/RadarPushButton";
import RadarSeedButton from "@/components/RadarSeedButton";

export const dynamic = "force-dynamic";

export default async function Radar({
  searchParams,
}: {
  searchParams: { cnae?: string; uf?: string; municipio?: string; bairro?: string; capital?: string; porte?: string; tier?: string; q?: string };
}) {
  // O Radar é uma feature do Profissional para cima — é ele que faz o Essencial
  // apertar e o cliente migrar.
  if (!(await hasFeature("radar"))) {
    return (
      <FeatureLock
        feature="radar"
        titulo="Radar de CNPJs da Receita"
        descricao="Encontre empresas brasileiras por atividade, região e porte usando dados públicos — e transforme cada CNPJ em lead com contato."
      />
    );
  }

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

  const [{ data: leads, count }, { data: sequences }] = await Promise.all([
    query,
    supabase.from("sequences").select("id, name").eq("is_active", true),
  ]);

  const rows = (leads as any[]) || [];
  const seqs = (sequences as { id: string; name: string }[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Radar</h1>
      <p className="mt-1 text-sm text-subtle">Garimpe empresas-alvo, enriqueça o CNPJ escolhido e jogue no pipeline.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <RadarImport />
        <RadarSeedButton />
      </div>

      <form className="card mt-6 grid gap-3 p-4 sm:grid-cols-6">
        <input name="q" defaultValue={searchParams.q} className="input sm:col-span-2" placeholder="Nome / razão social" />
        <input name="cnae" defaultValue={searchParams.cnae} className="input" placeholder="CNAE" />
        <input name="uf" defaultValue={searchParams.uf} className="input" placeholder="UF" maxLength={2} />
        <input name="municipio" defaultValue={searchParams.municipio} className="input" placeholder="Município" />
        <input name="bairro" defaultValue={searchParams.bairro} className="input" placeholder="Bairro" />
        <label className="flex items-center gap-2 text-sm text-subtle">
          <input type="checkbox" name="capital" value="1" defaultChecked={searchParams.capital === "1"} />
          Só capitais
        </label>
        <div className="flex gap-2">
          <select name="tier" defaultValue={searchParams.tier} className="input">
            <option value="">Tier</option>
            <option>T1</option>
            <option>T2</option>
            <option>T3</option>
            <option>T4</option>
          </select>
          <button className="btn-brand shrink-0 px-4" type="submit">Filtrar</button>
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
              <th className="px-4 py-3 font-medium">Tier</th>
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
                  <td className="px-4 py-3">{r.tier ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{r.tier}</span> : "—"}</td>
                  <td className="px-4 py-3">
                    <RadarPushButton radarId={r.id} sequences={seqs} converted={!!r.converted_contact_id} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-subtle">
                  Nenhuma empresa. Importe sua base acima ou ajuste os filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-subtle">
        O enriquecimento consulta a API de CNPJ (BrasilAPI por padrão) só na empresa escolhida — descoberta na base local, dados quentes sob demanda.
      </p>
    </div>
  );
}
