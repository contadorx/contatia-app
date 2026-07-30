"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { atividadesReceita, buscarNaBase, enviarParaCadastro, descartarCnpjs, reincluirCnpjs, exportarRadar } from "@/app/dashboard/radar/actions";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type Atividade = { cnae: string; descricao: string };
type Empresa = {
  cnpj: string; razao_social: string | null; nome_fantasia: string | null;
  cnae: string | null; cnae_descricao: string | null; uf: string | null;
  municipio: string | null; email: string | null; telefone: string | null; porte: string | null;
  jaTem?: boolean;
  descartado?: boolean;
};

export default function RadarBusca({ configurada }: { configurada: boolean }) {
  // filtros
  const [termo, setTermo] = useState("");
  const [sug, setSug] = useState<Atividade[]>([]);
  const [buscandoSug, setBuscandoSug] = useState(false);
  const [escolhidas, setEscolhidas] = useState<Atividade[]>([]);
  const [cnaeManual, setCnaeManual] = useState("");
  // UF e porte aceitam VÁRIOS (ex.: SP + RJ + MG; ME + EPP)
  const [ufs, setUfs] = useState<string[]>([]);
  const [municipio, setMunicipio] = useState("");
  const [portes, setPortes] = useState<string[]>([]);
  const [comEmail, setComEmail] = useState(true);
  const [emailCorp, setEmailCorp] = useState(false);
  const [ocultarJaTem, setOcultarJaTem] = useState(false);
  const [busca, setBusca] = useState("");

  // resultados
  const [resultados, setResultados] = useState<Empresa[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [casadas, setCasadas] = useState<Atividade[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [buscou, setBuscou] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null); // API v2 no VPS ignorou multi
  const [buscando, startBusca] = useTransition();
  const [enviando, startEnvio] = useTransition();
  const [descartando, startDescarte] = useTransition();
  const [exportando, startExport] = useTransition();
  // como salvar do Radar: "empresa" (padrão, sem contato-fantasma) ou "empresa_contato".
  const [modoSalvar, setModoSalvar] = useState<"empresa" | "empresa_contato">("empresa");

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
      // ufs/portes = listas (API v3). O servidor manda também o 1º valor em uf/porte
      // para a API v2 continuar respondendo em vez de quebrar.
      ufs: ufs.length ? ufs : undefined,
      municipio: municipio.trim() || undefined,
      portes: portes.length ? portes : undefined,
      com_email: comEmail,
      email_corporativo: comEmail && emailCorp,
      ocultarJaTem,
    };
  }
  const buscaDigitos = busca.replace(/\D/g, "");
  const temBusca = busca.trim().length >= 3 || buscaDigitos.length === 14;
  const temFiltro = temBusca || escolhidas.length > 0 || cnaeManual.replace(/\D/g, "").length >= 7 || termo.trim().length >= 3 || ufs.length > 0;

  function buscar(offset = 0) {
    setErro(null);
    setMsg(null);
    setAviso(null);
    startBusca(async () => {
      const r: any = await buscarNaBase(montarInput(), offset);
      if (r.error) { setErro(r.error); return; }
      setAviso(r.avisoMulti || null);
      const novas: Empresa[] = r.rows || [];
      if (offset === 0) {
        setResultados(novas);
        setTotal(r.total);
        setCasadas(r.atividades || []);
        setSel(new Set());
      } else {
        setResultados((prev) => [...prev, ...novas]);
      }
      // paginação pelo offset BRUTO consumido da base (não pelo nº exibido), para o
      // "carregar mais" não repetir quando escondemos as já cadastradas.
      setNextOffset(typeof r.nextOffset === "number" ? r.nextOffset : (offset + novas.length));
      setTemMais(typeof r.temMais === "boolean" ? r.temMais : novas.length === 100);
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
  const selecionaveis = resultados.filter((r) => !r.jaTem && !r.descartado);
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
      const r: any = await enviarParaCadastro(escolhidasRows, modoSalvar);
      if (r.error) { setErro(r.error); return; }
      const partes: string[] = [];
      if (modoSalvar === "empresa_contato") partes.push(`${r.contatosCriados} contato(s) e ${r.empresasCriadas} empresa(s) criadas`);
      else partes.push(`${r.empresasCriadas} empresa(s) criadas`);
      if (r.pulados) partes.push(`${r.pulados} já existia(m)`);
      let sufixo = modoSalvar === "empresa_contato" ? ". Veja em Empresas e Contatos." : ". Veja em Empresas.";
      if (r.limiteAtingido) sufixo += " (parei ao atingir o limite de contatos do seu plano.)";
      setMsg(partes.join(" · ") + sufixo);
      setSel(new Set());
    });
  }

  // Descarta CNPJs: ficam em CINZA (igual "já na base") e não podem ser selecionados/enviados.
  function descartar(cnpjs: string[]) {
    if (!cnpjs.length) return;
    setErro(null);
    setMsg(null);
    startDescarte(async () => {
      const r: any = await descartarCnpjs(cnpjs);
      if (r.error) { setErro(r.error); return; }
      const alvo = new Set(cnpjs);
      setResultados((rows) => rows.map((x) => (alvo.has(x.cnpj) ? { ...x, descartado: true } : x)));
      setSel((s) => { const n = new Set(s); for (const c of cnpjs) n.delete(c); return n; });
      setMsg(`${r.count} CNPJ(s) descartado(s) — ficam em cinza e não voltam nas buscas.`);
    });
  }

  // Desfaz o descarte de um CNPJ (volta ao normal).
  function reincluir(cnpj: string) {
    setErro(null);
    setMsg(null);
    startDescarte(async () => {
      const r: any = await reincluirCnpjs([cnpj]);
      if (r.error) { setErro(r.error); return; }
      setResultados((rows) => rows.map((x) => (x.cnpj === cnpj ? { ...x, descartado: false } : x)));
    });
  }

  const ocupado = buscando || enviando;

  // ---------- EXPORTAR CSV ----------
  // Exporta as selecionadas (se houver seleção) ou todas as carregadas. Usa BOM +
  // separador ";" — o padrão do Excel em português, que abre acentos e colunas certos.
  function csvCell(v: any) {
    const s = v == null ? "" : String(v);
    return /[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function baixarCsv(linhas: any[]) {
    if (!linhas.length) return;
    const headers = ["CNPJ", "Razão social", "Nome fantasia", "CNAE", "Atividade", "UF", "Município", "Bairro", "CEP", "E-mail", "Telefone", "Telefone 2", "Porte", "Tipo"];
    const corpo = linhas.map((r) => [
      r.cnpj, r.razao_social, r.nome_fantasia, r.cnae, r.cnae_descricao, r.uf, r.municipio,
      r.bairro, r.cep, r.email, r.telefone, r.telefone2, r.porte,
      r.matriz === true ? "Matriz" : r.matriz === false ? "Filial" : "",
    ].map(csvCell).join(";"));
    const csv = "﻿" + [headers.join(";"), ...corpo].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `radar-contatia-${hoje}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function exportarCsv() {
    const linhas = (sel.size > 0 ? resultados.filter((r) => sel.has(r.cnpj)) : resultados) as any[];
    if (!linhas.length) return;
    baixarCsv(linhas);
    setMsg(`${linhas.length} empresa(s) exportadas para CSV.`);
  }
  // Exporta TODAS as empresas da busca (não só as carregadas) — puxa várias páginas
  // da base no servidor, com teto de 2.000 por exportação.
  function exportarTodos() {
    setErro(null);
    setMsg(null);
    startExport(async () => {
      const r: any = await exportarRadar(montarInput());
      if (r.error) { setErro(r.error); return; }
      const linhas = (r.rows || []) as any[];
      if (!linhas.length) { setMsg("Nada para exportar com esses filtros."); return; }
      baixarCsv(linhas);
      const totalTxt = typeof r.total === "number" ? ` de ${r.total.toLocaleString("pt-BR")}` : "";
      setMsg(r.capped
        ? `Exportadas ${linhas.length} empresas (teto de 2.000${totalTxt}). Refine os filtros para pegar o restante.`
        : `${linhas.length} empresa(s)${totalTxt} exportadas para CSV.`);
    });
  }

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
            <label className="text-xs font-medium text-subtle">UF (pode marcar várias)</label>
            <SmartSelect multiple placeholder="Todas" values={ufs} onValuesChange={setUfs} maxTagsShown={4}
              options={UFS.map((u) => ({ value: u, label: u }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-subtle">Município</label>
            <input className="input mt-1 w-full" placeholder="Ex.: Santo André" value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-subtle">Porte (pode marcar vários)</label>
            <SmartSelect multiple placeholder="Qualquer" values={portes} onValuesChange={setPortes}
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
          <label className="flex items-center gap-2 text-sm" title="Não mostra empresas cujo CNPJ já está no seu cadastro de Empresas.">
            <input type="checkbox" checked={ocultarJaTem} onChange={(e) => setOcultarJaTem(e.target.checked)} />
            Ocultar já cadastradas
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
      {aviso && <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{aviso}</p>}
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
            {resultados.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="btn-outline py-1.5 text-xs"
                  onClick={exportarCsv}
                  title="Baixa um CSV (abre no Excel/Sheets) com as empresas — as selecionadas, ou todas as carregadas na tela."
                >
                  ⬇ Exportar {sel.size > 0 ? `selecionadas (${sel.size})` : `carregadas (${resultados.length})`}
                </button>
                {sel.size === 0 && (temMais || total === null) && (
                  <button
                    className="btn-brand py-1.5 text-xs"
                    onClick={exportarTodos}
                    disabled={exportando}
                    title="Puxa todas as empresas da busca (não só as carregadas) e baixa o CSV. Teto de 2.000 por exportação."
                  >
                    {exportando ? "Exportando…" : "⬇ Exportar todos"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* barra de ação em lote */}
          {sel.size > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2">
              <span className="text-sm font-medium text-brand-dark">{sel.size} selecionada(s)</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-brand/30 text-xs">
                <button type="button" onClick={() => setModoSalvar("empresa")}
                  className={`px-2.5 py-1 font-medium ${modoSalvar === "empresa" ? "bg-brand text-white" : "bg-white text-brand-dark hover:bg-brand-soft"}`}
                  title="Salva só a empresa (recomendado). O contato real entra depois, quando houver uma pessoa/e-mail.">
                  Só empresa
                </button>
                <button type="button" onClick={() => setModoSalvar("empresa_contato")}
                  className={`px-2.5 py-1 font-medium ${modoSalvar === "empresa_contato" ? "bg-brand text-white" : "bg-white text-brand-dark hover:bg-brand-soft"}`}
                  title="Cria a empresa e um contato POR SÓCIO (quando a Receita identifica os sócios). Sem sócio, cria um contato com o nome da empresa.">
                  Empresa + sócios
                </button>
              </div>
              <button className="text-xs text-subtle hover:text-danger" onClick={() => descartar(Array.from(sel))} disabled={descartando}>
                {descartando ? "descartando…" : "descartar selecionadas"}
              </button>
              <button className="btn-brand ml-auto px-4" onClick={enviar} disabled={enviando}>
                {enviando ? "Enviando…" : modoSalvar === "empresa" ? "Enviar para Empresas" : "Enviar para Empresas e Contatos"}
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
                  <th className="px-3 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {resultados.length ? resultados.map((r) => (
                  <tr key={r.cnpj} className={`border-b border-line last:border-0 ${r.jaTem || r.descartado ? "opacity-60" : sel.has(r.cnpj) ? "bg-brand-soft/40" : "hover:bg-muted"}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={sel.has(r.cnpj)} disabled={r.jaTem || r.descartado} onChange={() => toggle(r.cnpj)} title={r.jaTem ? "Já está na sua base" : r.descartado ? "Descartado" : ""} />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">
                        {r.nome_fantasia || r.razao_social || "—"}
                        {r.jaTem && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-subtle">✓ já na base</span>}
                        {!r.jaTem && r.descartado && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-subtle">descartado</span>}
                      </p>
                      <p className="text-xs text-subtle">{r.cnpj}{r.porte ? ` · ${r.porte}` : ""}</p>
                    </td>
                    <td className="px-3 py-3 text-subtle">{r.cnae_descricao || r.cnae || "—"}</td>
                    <td className="px-3 py-3 text-subtle">{[r.municipio, r.uf].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-3 py-3 text-subtle">{r.email || "—"}</td>
                    <td className="px-3 py-3 text-subtle">{r.telefone || "—"}</td>
                    <td className="px-3 py-3 text-right">
                      {r.descartado ? (
                        <button className="text-xs text-subtle hover:text-brand disabled:opacity-50" disabled={descartando} onClick={() => reincluir(r.cnpj)} title="Voltar a mostrar este CNPJ nas buscas.">
                          reincluir
                        </button>
                      ) : !r.jaTem ? (
                        <button className="text-xs text-subtle hover:text-danger disabled:opacity-50" disabled={descartando} onClick={() => descartar([r.cnpj])} title="Descartar: fica em cinza e não volta nas buscas (ex.: sem perfil).">
                          descartar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-subtle">Nenhuma empresa encontrada com esses filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {temMais && (
            <div className="mt-3 text-center">
              <button className="btn-outline px-4" onClick={() => buscar(nextOffset)} disabled={ocupado}>
                {buscando ? "…" : "Carregar mais 100"}
              </button>
            </div>
          )}

          {resultados.length > 0 && (
            <p className="mt-3 text-xs text-subtle">
              Marque as empresas e escolha como salvar: <b>Só empresa</b> (padrão) grava em <b>Empresas</b> com e-mail,
              telefone, CNAE e município — o contato real entra depois. <b>Empresa + contato</b> também cria um contato.
              As que você já tem aparecem em <b>cinza</b> (&ldquo;já na base&rdquo;); o <b>descartar</b> deixa o CNPJ igual — em cinza, marcado como &ldquo;descartado&rdquo; e fora das próximas buscas (dá pra <b>reincluir</b>).
            </p>
          )}
        </>
      )}
    </div>
  );
}
