"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { atividadesReceita, buscarNaBase, contarNaBase, enviarParaCadastro, descartarCnpjs, reincluirCnpjs, exportarRadar } from "@/app/dashboard/radar/actions";
import { diaISO } from "@/lib/datas";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type Atividade = { cnae: string; descricao: string };
type SocioApi = string | { nome?: string; qualificacao?: string; pessoa_juridica?: boolean; desde?: string | null };

type Empresa = {
  cnpj: string; razao_social: string | null; nome_fantasia: string | null;
  cnae: string | null; cnae_descricao: string | null; uf: string | null;
  municipio: string | null; email: string | null; telefone: string | null; porte: string | null;
  // Vêm da base da Receita no VPS. Todos opcionais: o app é publicado pela Vercel e a
  // API do VPS é atualizada à mão — na janela entre as duas, estes campos não existem
  // e a tela não pode depender deles.
  socios?: SocioApi[];
  simples?: boolean | null;   // null = SEM INFORMAÇÃO, que é diferente de "não é"
  mei?: boolean | null;
  situacao?: string | null;
  jaTem?: boolean;
  descartado?: boolean;
};

// Nome do sócio nos dois formatos que a API pode devolver (lista de nomes na v2,
// lista de objetos na v3).
function nomeSocio(s: SocioApi): string {
  return (typeof s === "string" ? s : s?.nome || "").trim();
}
function ehSocioPJ(s: SocioApi): boolean {
  return typeof s === "object" && s?.pessoa_juridica === true;
}
// 49 sócio-administrador · 05 administrador · 16 presidente · 10 diretor
const QUALIF: Record<string, string> = { "49": "sócio-adm.", "05": "administrador", "16": "presidente", "10": "diretor", "22": "sócio", "65": "titular" };

export default function RadarBusca({ configurada }: { configurada: boolean }) {
  // filtros
  const [termo, setTermo] = useState("");
  const [sug, setSug] = useState<Atividade[]>([]);
  const [erroSug, setErroSug] = useState<string | null>(null);
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
  // A base conta com teto: para nas 100 mil primeiras linhas. Total batendo exatamente
  // nesse número é o TETO, não o total — e a tela precisa dizer "mais de", não cravar.
  const [totalNoTeto, setTotalNoTeto] = useState(false);
  const TETO_BASE = 100_000;
  // Tamanho da página e teto da exportação vêm do SERVIDOR. Nenhum número desses é
  // escrito aqui: o texto dizia "mais 100" e "teto de 2.000" muito depois de os
  // dois terem mudado. Rótulo que copia constante de outro arquivo mente sozinho.
  const [pagina, setPagina] = useState<number | null>(null);
  const [tetoExport, setTetoExport] = useState<number | null>(null);
  const [contando, setContando] = useState(false);
  const [erroContagem, setErroContagem] = useState<string | null>(null);
  const [casadas, setCasadas] = useState<Atividade[]>([]);
  // O filtro que o SERVIDOR diz ter aplicado (não o que o formulário mostra), e a
  // "impressão digital" do formulário no momento da busca. Se o formulário mudar
  // depois, a lista na tela é de outra pergunta — e isso precisa estar escrito.
  const [aplicado, setAplicado] = useState<string | null>(null);
  const [assinaturaBusca, setAssinaturaBusca] = useState<string | null>(null);
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
    if (termo.trim().length < 3) { setSug([]); setErroSug(null); return; }
    setBuscandoSug(true);
    debounce.current = setTimeout(async () => {
      const r = await atividadesReceita(termo);
      setSug((r as any).atividades || []);
      setErroSug((r as any).error || null);
      setBuscandoSug(false);
    }, 350);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [termo]);

  // Só entra na lista quem tem código de 7 dígitos. Uma atividade sem código não
  // filtra nada — deixá-la entrar foi o que produziu a busca "contabilidade" que
  // devolveu cultivo de arroz.
  function addAtividade(a: Atividade) {
    const cnae = String(a?.cnae ?? "").replace(/\D/g, "");
    if (!/^\d{7}$/.test(cnae)) { setErroSug("Essa atividade veio sem código do CNAE — não dá para filtrar por ela."); return; }
    if (!escolhidas.some((x) => x.cnae === cnae)) setEscolhidas([...escolhidas, { cnae, descricao: a.descricao }]);
    setTermo("");
    setSug([]);
    setErroSug(null);
  }
  const removeAtividade = (cnae: string) => setEscolhidas(escolhidas.filter((x) => x.cnae !== cnae));

  function montarInput() {
    // .filter: um código vazio aqui viraria uma lista que o servidor descarta inteira,
    // e a busca sairia SEM filtro de atividade. Melhor não deixar chegar lá.
    const cnaes = [
      ...escolhidas.map((x) => String(x.cnae ?? "").replace(/\D/g, "")),
      ...cnaeManual.split(/[,\s]+/).map((s) => s.replace(/\D/g, "")),
    ].filter((s) => /^\d{7}$/.test(s));
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
  // Os filtros mudaram depois que a lista foi carregada? Então a lista responde a
  // outra pergunta. Melhor dizer isso do que deixar o operador concluir que a base
  // devolveu lixo — foi exatamente essa confusão que custou uma tarde.
  const filtrosMudaram = assinaturaBusca !== null && JSON.stringify(montarInput()) !== assinaturaBusca;

  const buscaDigitos = busca.replace(/\D/g, "");
  const temBusca = busca.trim().length >= 3 || buscaDigitos.length === 14;
  const temFiltro = temBusca || escolhidas.length > 0 || cnaeManual.replace(/\D/g, "").length >= 7 || termo.trim().length >= 3 || ufs.length > 0;

  // Contagem sob demanda — chamada à parte, com orçamento próprio de tempo.
  function contarTotal() {
    setErroContagem(null);
    setContando(true);
    (async () => {
      try {
        const r: any = await contarNaBase(montarInput());
        if (r?.error) setErroContagem(r.error);
        else if (typeof r?.total === "number") { setTotal(r.total); setTotalNoTeto(r.total >= TETO_BASE); }
      } catch (e: any) {
        setErroContagem("A contagem não voltou a tempo. A lista acima continua válida.");
      } finally {
        setContando(false);
      }
    })();
  }

  function buscar(offset = 0) {
    setErro(null);
    setMsg(null);
    setAviso(null);
    const enviado = montarInput();
    startBusca(async () => {
      const r: any = await buscarNaBase(enviado, offset);
      if (r.error) { setErro(r.error); return; }
      setAviso(r.avisoMulti || null);
      const novas: Empresa[] = r.rows || [];
      if (offset === 0) {
        setResultados(novas);
        setTotal(r.total);
        setTotalNoTeto(r.totalNoTeto === true);
        if (typeof r.pagina === "number") setPagina(r.pagina);
        if (typeof r.tetoExport === "number") setTetoExport(r.tetoExport);
        setCasadas(r.atividades || []);
        setAplicado(typeof r.aplicado === "string" ? r.aplicado : null);
        setAssinaturaBusca(JSON.stringify(enviado));
        setSel(new Set());
      } else {
        // ============================================================
      // A BASE PAGINA SEM ORDEM — ENTÃO A PÁGINA 2 REPETE LINHAS DA 1
      //
      // Isto já era conhecido e está documentado na exportação, que ganhou um `Set` de
      // CNPJs vistos justamente por isso: `limit/offset` sem `order by` no Postgres
      // devolve linhas repetidas entre páginas (e pula outras). A navegação nunca
      // ganhou a mesma proteção.
      //
      // Sem ela, "Carregar mais" traz a mesma empresa duas vezes: `key={r.cnpj}`
      // duplica (as duas linhas passam a compartilhar o checkbox — marcar uma marca a
      // outra), "marcar todos" conta 250 onde há 248 distintas, e o envio volta
      // dizendo "2 já existia(m)" para empresas que você nunca teve. Quem lê esse
      // número como sinal de dedup está lendo algo inventado.
      // ============================================================
      setResultados((prev) => {
        const jaTenho = new Set(prev.map((x) => x.cnpj));
        return [...prev, ...novas.filter((n: any) => !jaTenho.has(n.cnpj))];
      });
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
      // A esteira pode ter falhado mesmo com os contatos criados. Isso vai em ERRO, e
      // não no recado de sucesso: é uma etapa que não vai acontecer sozinha e alguém
      // precisa decidir o que fazer.
      if (r.avisoEsteira) setErro(r.avisoEsteira);
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
    // Sócio e enquadramento também no CSV: quem exporta para trabalhar fora do app
    // precisa saber com QUEM falar e sob qual regime — sem isso a planilha obriga a
    // voltar aqui empresa por empresa.
    const headers = ["CNPJ", "Razão social", "Nome fantasia", "CNAE", "Atividade", "UF", "Município", "Bairro", "CEP", "E-mail", "Telefone", "Telefone 2", "Porte", "Tipo", "Sócio principal", "Qualificação", "Outros sócios", "Regime"];
    const regimeTxt = (r: any) =>
      r.mei === true ? "MEI" : r.simples === true ? "Simples" : r.simples === false ? "Lucro Presumido/Real" : "";
    const corpo = linhas.map((r) => {
      const socios: SocioApi[] = Array.isArray(r.socios) ? r.socios : [];
      const primeiro = socios[0];
      const q = primeiro && typeof primeiro === "object" ? (primeiro as any).qualificacao : "";
      return [
        r.cnpj, r.razao_social, r.nome_fantasia, r.cnae, r.cnae_descricao, r.uf, r.municipio,
        r.bairro, r.cep, r.email, r.telefone, r.telefone2, r.porte,
        r.matriz === true ? "Matriz" : r.matriz === false ? "Filial" : "",
        primeiro ? nomeSocio(primeiro) : "",
        q ? (QUALIF[q] || q) : "",
        socios.slice(1).map(nomeSocio).filter(Boolean).join(" | "),
        regimeTxt(r),
      ].map(csvCell).join(";");
    });
    const csv = "﻿" + [headers.join(";"), ...corpo].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = diaISO();
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
  // Exporta TODAS as empresas da busca (não só as carregadas) — puxa várias páginas da
  // base no servidor. O teto vem do servidor em `r.teto`, e não escrito aqui: a
  // mensagem anterior dizia "teto de 2.000" muito depois de o teto ter virado outro
  // número. Texto que repete uma constante de outro arquivo envelhece calado.
  function exportarTodos() {
    setErro(null);
    setMsg(null);
    startExport(async () => {
      const r: any = await exportarRadar(montarInput());
      if (r.error) { setErro(r.error); return; }
      const linhas = (r.rows || []) as any[];
      if (!linhas.length) { setMsg("Nada para exportar com esses filtros."); return; }
      baixarCsv(linhas);
      const n = linhas.length.toLocaleString("pt-BR");
      const teto = typeof r.teto === "number" ? r.teto.toLocaleString("pt-BR") : null;
      const total = typeof r.total === "number" ? r.total.toLocaleString("pt-BR") : null;
      if (r.capped) {
        setMsg(
          total
            ? `Exportadas ${n} de ${total} — é o teto de ${teto ?? n} por exportação. Refine os filtros (município, porte) para pegar o restante.`
            : `Exportadas ${n} — é o teto por exportação. Refine os filtros para pegar o restante.`
        );
      } else {
        // De propósito NÃO digo "a busca inteira": o CSV já vem sem as descartadas e,
        // se você marcou a opção, sem as que já estão no cadastro. O número exportado
        // ser menor que o total da busca é normal, e prometer "inteira" seria falso.
        setMsg(`Exportadas ${n} empresa(s) para CSV.`);
      }
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
          {(buscandoSug || sug.length > 0 || erroSug) && termo.trim().length >= 3 && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
              {buscandoSug && <p className="px-3 py-2 text-xs text-subtle">buscando…</p>}
              {!buscandoSug && erroSug && <p className="px-3 py-2 text-xs text-danger">{erroSug}</p>}
              {!buscandoSug && !erroSug && sug.length === 0 && <p className="px-3 py-2 text-xs text-subtle">nenhuma atividade encontrada</p>}
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
      {erroContagem && <p className="mt-2 text-xs text-warn">{erroContagem}</p>}
      {aviso && <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{aviso}</p>}
      {filtrosMudaram && resultados.length > 0 && (
        <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">
          Os filtros mudaram depois desta busca — a lista abaixo ainda é da anterior. Clique em Buscar.
        </p>
      )}
      {msg && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}

      {/* ---------- RESULTADOS ---------- */}
      {buscou && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-subtle">
              {/* A base conta com teto de 100 mil. Se o total bater exatamente nesse
                  número, ele é o TETO, não o total — e dizer "100.000" seria mentira. */}
              {total === null
                ? (
                  <>
                    Mostrando <b>{resultados.length}</b>.{" "}
                    <span className="text-xs">A base não devolveu o total desta vez.</span>{" "}
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-dark underline disabled:opacity-50"
                      disabled={contando}
                      onClick={contarTotal}
                    >
                      {contando ? "contando…" : "tentar contar"}
                    </button>
                  </>
                )
                : totalNoTeto
                  ? <>Mais de <b>{TETO_BASE.toLocaleString("pt-BR")}</b> empresas — mostrando {resultados.length}. <span className="text-xs">(paro de contar nas 100 mil; refine para ter o número exato)</span></>
                  : <><b>{total.toLocaleString("pt-BR")}</b> empresa(s) encontradas — mostrando {resultados.length}.</>}
            </p>
            {casadas.length > 0 && (
              <p className="text-xs text-subtle">· atividades: {casadas.slice(0, 4).map((a) => a.descricao).join(" · ")}{casadas.length > 4 ? ` (+${casadas.length - 4})` : ""}</p>
            )}
            {aplicado && (
              <p className="text-xs text-subtle" title="O filtro que a base recebeu de fato — não o que está no formulário.">
                · filtro aplicado: <b>{aplicado}</b>
              </p>
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
                    title={`Puxa todas as empresas da busca (não só as carregadas) e baixa o CSV.${tetoExport ? ` Teto de ${tetoExport.toLocaleString("pt-BR")} por exportação.` : ""}`}
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
                      <p className="text-xs text-subtle">
                        {r.cnpj}{r.porte ? ` · ${r.porte}` : ""}
                        {/* Enquadramento: muda a conversa de venda antes do primeiro
                            contato. Só aparece quando a base RESPONDEU — ausente é
                            "não sei", e não "não é". */}
                        {r.mei === true && <span className="ml-2 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">MEI</span>}
                        {r.mei !== true && r.simples === true && <span className="ml-2 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand-dark">Simples</span>}
                        {r.mei !== true && r.simples === false && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-subtle">Lucro Presumido/Real</span>}
                      </p>
                      {/* O DECISOR, na própria linha. Era o dado que obrigava a abrir a
                          empresa noutro lugar para saber com quem se vai falar. */}
                      {!!r.socios?.length && (
                        <p className="mt-0.5 text-xs text-subtle" title={r.socios.map(nomeSocio).join(" · ")}>
                          <span className="text-ink">{nomeSocio(r.socios[0])}</span>
                          {typeof r.socios[0] === "object" && (r.socios[0] as any).qualificacao
                            ? ` (${QUALIF[(r.socios[0] as any).qualificacao] || "sócio"})`
                            : ""}
                          {ehSocioPJ(r.socios[0]) ? " · empresa" : ""}
                          {r.socios.length > 1 ? ` +${r.socios.length - 1}` : ""}
                        </p>
                      )}
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
                {buscando ? "…" : pagina ? `Carregar mais ${pagina.toLocaleString("pt-BR")}` : "Carregar mais"}
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
