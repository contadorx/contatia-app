"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { atividadesReceita, buscarNaBase, enviarParaCadastro } from "@/app/dashboard/radar/actions";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type Atividade = { cnae: string; descricao: string };
type Empresa = {
  cnpj: string; razao_social: string | null; nome_fantasia: string | null;
  cnae: string | null; cnae_descricao: string | null; uf: string | null;
  municipio: string | null; email: string | null; telefone: string | null; porte: string | null;
  jaTem?: boolean;
};

export default function RadarBusca({ configurada }: { configurada: boolean }) {
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
  const [emailCorp, setEmailCorp] = useState(false);
  const [busca, setBusca] = useState("");

  // resultados
  const [resultados, setResultados] = useState<Empresa[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [casadas, setCasadas] = useState<Atividade[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, startBusca] = useTransition();
  const [enviando, startEnvio] = useTransition();

  const debounce = useRef<any>(null);

  // autocomplete de atividade
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (termo.trim().length < 3) { setSug([]); return; }
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
  const removeAtividade = (cnae: string) => setEscolhidas(escolhidas.filter((x) => x.cnae !== cnae));

  function montarInput() {
    const cnaes = [
      ...escolhidas.map((x) => x.cnae),
      ...cnaeManual.split(/[,\s]+/).map((s) => s.replace(/\D/g, "")).filter((s) => s.length === 7),
    ];
    return {
      busca: busca.trim() || undefined,
      cnae: cnaes.length ? cnaes : undefined,
      atividade: !cnaes.length && termo.trim().length >= 3 ? termo.trim() : undefined,
      uf: uf || undefined,
      municipio: municipio.trim() || undefined,
      porte: porte || undefined,
      com_email: comEmail,
      email_corporativo: comEmail && emailCorp,
    };
  }
  const buscaDigitos = busca.replace(/\D/g, "");
  const temBusca = busca.trim().length >= 3 || buscaDigitos.length === 14;
  const temFiltro = temBusca || escolhidas.length > 0 || cnaeManual.replace(/\D/g, "").length >= 7 || termo.trim().length >= 3 || !!uf;

  function buscar(offset = 0) {
    setErro(null);
    setMsg(null);
    startBusca(async () => {
      const r: any = await buscarNaBase(montarInput(), offset);
      if (r.error) { setErro(r.error); return; }
      const novas: Empresa[] = r.rows || [];
      if (offset === 0) {
        setResultados(novas);
        setTotal(r.total);
        setCasadas(r.atividades || []);
        setSel(new Set());
      } else {
        setResultados((prev) => [...prev, ...novas]);
      }
      setTemMais(novas.length === 100);
      setBuscou(true);
    });
  }

  function toggle(cnpj: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(cnpj) ? n.delete(cnpj) : n.add(cnpj);
      return n;
    });
  }
  // "selecionar todos" só marca as que ainda NÃO estão na sua base
  const selecionaveis = resultados.filter((r) => !r.jaTem);
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((r) => sel.has(r.cnpj));
  function toggleTodos() {
    setSel(todosMarcados ? new Set() : new Set(selecionaveis.map((r) => r.cnpj)));
  }

  function enviar() {
    const escolhidasRows = resultados.filter((r) => sel.has(r.cnpj));
    if (!escolhidasRows.length) return;
    setErro(null);
    setMsg(null);
    startEnvio(async () => {
      const r: any = await enviarParaCadastro(escolhidasRows);
      if (r.error) { setErro(r.error); return; }
      const partes: string[] = [];
      partes.push(`${r.contatosCriados} contato(s) e ${r.empresasCriadas} empresa(s) criadas`);
      if (r.pulados) partes.push(`${r.pulados} já existia(m)`);
      setMsg(partes.join(" · ") + ". Veja em Empresas e Contatos.");
      setSel(new Set());
    });
  }

  const ocupado = buscando || enviando;

  return (
    <div>
      {!configurada && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A base ainda não está conectada. Configure <code>RECEITA_API_URL</code> e <code>RECEITA_API_TOKEN</code> nas variáveis de ambiente e refaça o deploy.
        </p>
      )}

      {/* ---------- FILTROS ---------- */}
      <div className="card p-4">
        {/* busca por razão social / nome fantasia / CNPJ */}
        <label className="text-xs font-medium text-subtle">Razão social, nome fantasia ou CNPJ</label>
        <input
          className="input mt-1 w-full"
          placeholder="Ex.: Padaria do Zé, ou 12.345.678/0001-90"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(0); } }}
        />
        <div className="my-3 flex items-center gap-2 text-[11px] uppercase tracking-wide text-subtle">
          <span className="h-px flex-1 bg-line" /> ou busque por segmento <span className="h-px flex-1 bg-line" />
        </div>

        {/* atividade + autocomplete */}
        <label className="text-xs font-medium text-subtle">Atividade</label>
        <div className="relative mt-1">
          <input
            className="input w-full"
            placeholder="Ex.: contabilidade, restaurante, advocacia…"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(0); } }}
          />
          {(buscandoSug || sug.length > 0) && termo.trim().length >= 3 && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
              {buscandoSug && <p className="px-3 py-2 text-xs text-subtle">buscando…</p>}
              {!buscandoSug && sug.length === 0 && <p className="px-3 py-2 text-xs text-subtle">nenhuma atividade encontrada</p>}
              {sug.map((a) => (
                <button key={a.cnae} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addAtividade(a)}>
                  <span className="text-subtle">{a.cnae}</span> — {a.descricao}
                </button>
              ))}
            </div>
          )}
        </div>
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

        {/* região / porte */}
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-subtle">UF</label>
            <SmartSelect placeholder="Todas" clearable value={uf} onValueChange={setUf} options={UFS.map((u) => ({ value: u, label: u }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-subtle">Município</label>
            <input className="input mt-1 w-full" placeholder="Ex.: Santo André" value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-subtle">Porte</label>
            <SmartSelect placeholder="Qualquer" clearable value={porte} onValueChange={setPorte}
              options={[{ value: "ME", label: "ME" }, { value: "EPP", label: "EPP" }, { value: "Demais", label: "Demais" }]} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={comEmail}
              onChange={(e) => { setComEmail(e.target.checked); if (!e.target.checked) setEmailCorp(false); }}
            />
            Só empresas com e-mail
          </label>
          <label className={`flex items-center gap-2 text-sm ${comEmail ? "" : "opacity-40"}`} title="Descarta e-mails gratuitos (gmail, hotmail, outlook, yahoo, uol, bol…), deixando só domínios empresariais.">
            <input type="checkbox" checked={emailCorp} disabled={!comEmail} onChange={(e) => setEmailCorp(e.target.checked)} />
            Só e-mail empresarial <span className="text-subtle">(sem gmail/hotmail…)</span>
          </label>
          <input className="input w-full sm:w-56" placeholder="ou CNAE (código, opcional)" value={cnaeManual} onChange={(e) => setCnaeManual(e.target.value)} />
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-brand px-5" onClick={() => buscar(0)} disabled={ocupado || !temFiltro || !configurada}>
              {buscando ? "Buscando…" : "Buscar"}
            </button>
          </div>
        </div>
      </div>

      {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
      {msg && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}

      {/* ---------- RESULTADOS ---------- */}
      {buscou && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-subtle">
              {total === null
                ? <>Muitos resultados — refine UF/município. Mostrando {resultados.length}.</>
                : <><b>{total.toLocaleString("pt-BR")}</b> empresa(s) encontradas — mostrando {resultados.length}.</>}
            </p>
            {casadas.length > 0 && (
              <p className="text-xs text-subtle">· atividades: {casadas.slice(0, 4).map((a) => a.descricao).join(" · ")}{casadas.length > 4 ? ` (+${casadas.length - 4})` : ""}</p>
            )}
          </div>

          {/* barra de ação em lote */}
          {sel.size > 0 && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2">
              <span className="text-sm font-medium text-brand-dark">{sel.size} selecionada(s)</span>
              <button className="btn-brand ml-auto px-4" onClick={enviar} disabled={enviando}>
                {enviando ? "Enviando…" : "Enviar para Empresas e Contatos"}
              </button>
            </div>
          )}

          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={todosMarcados} onChange={toggleTodos} title="Selecionar todos" />
                  </th>
                  <th className="px-3 py-3 font-medium">Empresa</th>
                  <th className="px-3 py-3 font-medium">Atividade</th>
                  <th className="px-3 py-3 font-medium">Município</th>
                  <th className="px-3 py-3 font-medium">E-mail</th>
                  <th className="px-3 py-3 font-medium">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {resultados.length ? resultados.map((r) => (
                  <tr key={r.cnpj} className={`border-b border-line last:border-0 ${r.jaTem ? "opacity-60" : sel.has(r.cnpj) ? "bg-brand-soft/40" : "hover:bg-muted"}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={sel.has(r.cnpj)} disabled={r.jaTem} onChange={() => toggle(r.cnpj)} title={r.jaTem ? "Já está na sua base" : ""} />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">
                        {r.nome_fantasia || r.razao_social || "—"}
                        {r.jaTem && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-subtle">✓ já na base</span>}
                      </p>
                      <p className="text-xs text-subtle">{r.cnpj}{r.porte ? ` · ${r.porte}` : ""}</p>
                    </td>
                    <td className="px-3 py-3 text-subtle">{r.cnae_descricao || r.cnae || "—"}</td>
                    <td className="px-3 py-3 text-subtle">{[r.municipio, r.uf].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-3 py-3 text-subtle">{r.email || "—"}</td>
                    <td className="px-3 py-3 text-subtle">{r.telefone || "—"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-subtle">Nenhuma empresa encontrada com esses filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {temMais && (
            <div className="mt-3 text-center">
              <button className="btn-outline px-4" onClick={() => buscar(resultados.length)} disabled={ocupado}>
                {buscando ? "…" : "Carregar mais 100"}
              </button>
            </div>
          )}

          {resultados.length > 0 && (
            <p className="mt-3 text-xs text-subtle">
              Marque as empresas e clique em enviar: elas entram em <b>Empresas</b> e <b>Contatos</b> já com e-mail, telefone, CNAE e município. As que você já tem são puladas.
            </p>
          )}
        </>
      )}
    </div>
  );
}
