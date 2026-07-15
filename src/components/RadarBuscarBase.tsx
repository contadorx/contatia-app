"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { atividadesReceita, buscarNaBase, importarDaBase } from "@/app/dashboard/radar/actions";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type Atividade = { cnae: string; descricao: string };

export default function RadarBuscarBase({ configurada }: { configurada: boolean }) {
  const [open, setOpen] = useState(false);

  // filtros
  const [termo, setTermo] = useState("");
  const [sug, setSug] = useState<Atividade[]>([]);
  const [buscandoSug, setBuscandoSug] = useState(false);
  const [escolhidas, setEscolhidas] = useState<Atividade[]>([]);
  const [cnaeManual, setCnaeManual] = useState("");
  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [porte, setPorte] = useState("");
  const [comEmail, setComEmail] = useState(true);
  const [limite, setLimite] = useState("1000");

  // resultado
  const [previa, setPrevia] = useState<{ total: number | null; amostra: any[]; atividades: Atividade[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const debounce = useRef<any>(null);

  // autocomplete de atividade (debounce 350ms)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (termo.trim().length < 3) {
      setSug([]);
      return;
    }
    setBuscandoSug(true);
    debounce.current = setTimeout(async () => {
      const r = await atividadesReceita(termo);
      setSug((r as any).atividades || []);
      setBuscandoSug(false);
    }, 350);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [termo]);

  function addAtividade(a: Atividade) {
    if (!escolhidas.some((x) => x.cnae === a.cnae)) setEscolhidas([...escolhidas, a]);
    setTermo("");
    setSug([]);
  }
  function removeAtividade(cnae: string) {
    setEscolhidas(escolhidas.filter((x) => x.cnae !== cnae));
  }

  function montarInput() {
    const cnaes = [
      ...escolhidas.map((x) => x.cnae),
      ...cnaeManual.split(/[,\s]+/).map((s) => s.replace(/\D/g, "")).filter((s) => s.length === 7),
    ];
    return {
      // se o usuário escolheu atividades/CNAEs, manda os códigos; senão usa o texto digitado
      cnae: cnaes.length ? cnaes : undefined,
      atividade: !cnaes.length && termo.trim().length >= 3 ? termo.trim() : undefined,
      uf: uf || undefined,
      municipio: municipio.trim() || undefined,
      porte: porte || undefined,
      com_email: comEmail,
    };
  }

  const temFiltro = escolhidas.length > 0 || cnaeManual.replace(/\D/g, "").length >= 7 || termo.trim().length >= 3 || !!uf;

  function verPrevia() {
    setErro(null);
    setMsg(null);
    start(async () => {
      const r: any = await buscarNaBase(montarInput());
      if (r.error) {
        setErro(r.error);
        setPrevia(null);
      } else {
        setPrevia({ total: r.total, amostra: r.amostra || [], atividades: r.atividades || [] });
      }
    });
  }

  function importar() {
    setErro(null);
    setMsg(null);
    start(async () => {
      const r: any = await importarDaBase({ ...montarInput(), limite: Number(limite) });
      if (r.error) {
        setErro(r.error);
      } else {
        const partes = [`${r.inserted} empresa(s) importada(s) para o Radar`];
        if (r.skipped) partes.push(`${r.skipped} já existia(m) e foram puladas`);
        setMsg(partes.join(" · ") + ".");
        setPrevia(null);
      }
    });
  }

  if (!open) {
    return (
      <button className="btn-brand px-4" onClick={() => setOpen(true)}>
        🔎 Buscar na base da Receita
      </button>
    );
  }

  return (
    <div className="card w-full p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">Buscar na base da Receita</h3>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
      </div>

      {!configurada ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A base ainda não está conectada. Configure <code>RECEITA_API_URL</code> e <code>RECEITA_API_TOKEN</code> nas variáveis de ambiente e refaça o deploy.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-subtle">Escolha a atividade e a região. A prévia mostra quantas empresas existem antes de importar.</p>

          {/* atividade + autocomplete */}
          <div className="mt-4">
            <label className="text-xs font-medium text-subtle">Atividade</label>
            <div className="relative">
              <input
                className="input mt-1 w-full"
                placeholder="Ex.: contabilidade, restaurante, advocacia…"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
              {(buscandoSug || sug.length > 0) && termo.trim().length >= 3 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
                  {buscandoSug && <p className="px-3 py-2 text-xs text-subtle">buscando…</p>}
                  {!buscandoSug && sug.length === 0 && <p className="px-3 py-2 text-xs text-subtle">nenhuma atividade encontrada</p>}
                  {sug.map((a) => (
                    <button
                      key={a.cnae}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addAtividade(a)}
                    >
                      <span className="text-subtle">{a.cnae}</span> — {a.descricao}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* chips das atividades escolhidas */}
            {escolhidas.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {escolhidas.map((a) => (
                  <span key={a.cnae} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-1 text-xs text-brand-dark">
                    {a.descricao}
                    <button type="button" className="font-bold" onClick={() => removeAtividade(a.cnae)}>×</button>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-subtle">Dica: clique nas sugestões para fixar a atividade. Sem escolher nenhuma, ela busca pelo texto digitado.</p>
          </div>

          {/* demais filtros */}
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div>
              <label className="text-xs font-medium text-subtle">UF</label>
              <SmartSelect
                placeholder="Todas"
                clearable
                value={uf}
                onValueChange={setUf}
                options={UFS.map((u) => ({ value: u, label: u }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-subtle">Município</label>
              <input className="input mt-1 w-full" placeholder="Ex.: Santo André" value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-subtle">Porte</label>
              <SmartSelect
                placeholder="Qualquer"
                clearable
                value={porte}
                onValueChange={setPorte}
                options={[
                  { value: "ME", label: "ME" },
                  { value: "EPP", label: "EPP" },
                  { value: "Demais", label: "Demais" },
                ]}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={comEmail} onChange={(e) => setComEmail(e.target.checked)} />
              Só empresas com e-mail
            </label>
            <input className="input w-full sm:w-56" placeholder="ou CNAE (código, opcional)" value={cnaeManual} onChange={(e) => setCnaeManual(e.target.value)} />
          </div>

          {/* ações */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-outline px-4" onClick={verPrevia} disabled={pending || !temFiltro}>
              {pending ? "…" : "Ver prévia"}
            </button>
            <div className="flex items-center gap-2">
              <button className="btn-brand px-4" onClick={importar} disabled={pending || !temFiltro}>
                Importar
              </button>
              <select className="input py-1.5" value={limite} onChange={(e) => setLimite(e.target.value)}>
                <option value="500">até 500</option>
                <option value="1000">até 1.000</option>
                <option value="2000">até 2.000</option>
              </select>
            </div>
          </div>

          {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
          {msg && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}

          {/* prévia */}
          {previa && (
            <div className="mt-4 rounded-lg border border-line p-3">
              <p className="text-sm">
                {previa.total === null ? (
                  <>Muitas empresas casam com esse filtro. Refine (UF/município) ou importe uma amostra.</>
                ) : (
                  <>Encontramos <b>{previa.total.toLocaleString("pt-BR")}</b> empresa(s) ativas nesse filtro.</>
                )}
              </p>
              {previa.atividades.length > 0 && (
                <p className="mt-1 text-xs text-subtle">
                  Atividades consideradas: {previa.atividades.slice(0, 6).map((a) => a.descricao).join(" · ")}
                  {previa.atividades.length > 6 ? ` (+${previa.atividades.length - 6})` : ""}
                </p>
              )}
              {previa.amostra.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-subtle">
                      <tr><th className="py-1 pr-3">Empresa</th><th className="py-1 pr-3">Município</th><th className="py-1 pr-3">E-mail</th></tr>
                    </thead>
                    <tbody>
                      {previa.amostra.map((e, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="py-1 pr-3">{e.nome_fantasia || e.razao_social || "—"}</td>
                          <td className="py-1 pr-3 text-subtle">{[e.municipio, e.uf].filter(Boolean).join("/") || "—"}</td>
                          <td className="py-1 pr-3 text-subtle">{e.email || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-[11px] text-subtle">A importação traz até o limite escolhido, pula as que você já tem e marca todas como ATIVAS. Os dados de contato só são enriquecidos ao adicionar aos leads.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
