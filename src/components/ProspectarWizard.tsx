"use client";

// ============================================================
// PROSPECTAR — passo a passo de descobrir → gravar → enriquecer → cadenciar.
//
// Por que uma tela nova e não mais botões no Radar: o Radar é uma FERRAMENTA de
// busca (você garimpa, exporta, descarta). Aqui é um PROCESSO com começo e fim, e o
// valor está justamente em não deixar ninguém no meio do caminho — a tela só libera
// o passo seguinte quando o anterior produziu algo, e no fim mostra o placar do que
// ficou com canal de contato e do que ficou na fila.
//
// A descoberta do passo 4 roda em LOTES no cliente: cada chamada faz um pedaço e
// devolve; o progresso que você vê é real, não um spinner otimista.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SmartSelect from "@/components/SmartSelect";
import { atividadesReceita, buscarNaBase, enviarParaCadastro } from "@/app/dashboard/radar/actions";
import { descobrirEmailsLote, placarEsteira, reenfileirarEsteira, type PlacarEsteira } from "@/app/dashboard/prospectar/actions";
import { capturarDoSiteLote } from "@/app/dashboard/contatos/web-capture-actions";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";
import { bulkEnroll } from "@/app/dashboard/contatos/bulk-actions";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

// tamanho de cada rodada — igual ao que a ação processa na hora, para o progresso
// bater com a realidade (sem prometer mais do que o lote entrega).
const LOTE = { site: 8, email: 6, whats: 60 };

type Atividade = { cnae: string; descricao: string };
type Empresa = {
  cnpj: string; razao_social: string | null; nome_fantasia: string | null;
  cnae: string | null; cnae_descricao: string | null; uf: string | null;
  municipio: string | null; email: string | null; telefone: string | null; porte: string | null;
  socios?: string[] | null;
  jaTem?: boolean; descartado?: boolean;
};
type Etapa = "site" | "email" | "whats";
type Progresso = { feitos: number; total: number; achou: number; nota?: string };

export default function ProspectarWizard({
  receitaOk, workerOk, waPronto, sequences,
}: {
  receitaOk: boolean; workerOk: boolean; waPronto: boolean; sequences: { id: string; name: string }[];
}) {
  const [passo, setPasso] = useState<1 | 2 | 3 | 4>(1);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // ---------- passo 1: filtros ----------
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [sug, setSug] = useState<Atividade[]>([]);
  const [buscandoSug, setBuscandoSug] = useState(false);
  const [escolhidas, setEscolhidas] = useState<Atividade[]>([]);
  const [cnaeManual, setCnaeManual] = useState("");
  const [ufs, setUfs] = useState<string[]>([]);
  const [municipio, setMunicipio] = useState("");
  const [portes, setPortes] = useState<string[]>([]);
  const [comEmail, setComEmail] = useState(true);
  const [emailCorp, setEmailCorp] = useState(false);
  const [ocultarJaTem, setOcultarJaTem] = useState(true);
  const debounce = useRef<any>(null);

  // ---------- passo 2: resultados ----------
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<Empresa[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());

  // ---------- passo 3: gravação ----------
  const [criarSocios, setCriarSocios] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [gravado, setGravado] = useState<{ empresas: number; contatos: number; pulados: number; limite: boolean } | null>(null);
  const [contatoIds, setContatoIds] = useState<string[]>([]);

  // ---------- passo 4: descoberta ----------
  const [rodando, setRodando] = useState<Etapa | null>(null);
  const [prog, setProg] = useState<Record<Etapa, Progresso | null>>({ site: null, email: null, whats: null });
  const [placar, setPlacar] = useState<PlacarEsteira | null>(null);
  const [cadencia, setCadencia] = useState("");
  const [inscrevendo, setInscrevendo] = useState(false);

  // autocomplete de atividade
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (termo.trim().length < 3) { setSug([]); return; }
    setBuscandoSug(true);
    debounce.current = setTimeout(async () => {
      const r: any = await atividadesReceita(termo);
      setSug(r?.atividades || []);
      setBuscandoSug(false);
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [termo]);

  function montarInput() {
    const cnaes = [
      ...escolhidas.map((x) => x.cnae),
      ...cnaeManual.split(/[,\s]+/).map((s) => s.replace(/\D/g, "")).filter((s) => s.length === 7),
    ];
    return {
      busca: busca.trim() || undefined,
      cnae: cnaes.length ? cnaes : undefined,
      atividade: !cnaes.length && termo.trim().length >= 3 ? termo.trim() : undefined,
      ufs: ufs.length ? ufs : undefined,
      municipio: municipio.trim() || undefined,
      portes: portes.length ? portes : undefined,
      com_email: comEmail,
      email_corporativo: comEmail && emailCorp,
      ocultarJaTem,
    };
  }

  const temFiltro =
    busca.trim().length >= 3 ||
    escolhidas.length > 0 ||
    cnaeManual.replace(/\D/g, "").length >= 7 ||
    termo.trim().length >= 3 ||
    ufs.length > 0;

  async function buscar(offset = 0) {
    setErro(null); setMsg(null); setAviso(null); setBuscando(true);
    try {
      const r: any = await buscarNaBase(montarInput(), offset);
      if (r?.error) { setErro(r.error); return; }
      setAviso(r?.avisoMulti || null);
      const novas: Empresa[] = r?.rows || [];
      if (offset === 0) { setResultados(novas); setTotal(r?.total ?? null); setSel(new Set()); }
      else setResultados((p) => [...p, ...novas]);
      setNextOffset(typeof r?.nextOffset === "number" ? r.nextOffset : offset + novas.length);
      setTemMais(!!r?.temMais);
      setPasso(2);
    } finally {
      setBuscando(false);
    }
  }

  const selecionaveis = resultados.filter((e) => !e.jaTem && !e.descartado);
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((e) => sel.has(e.cnpj));

  function toggle(cnpj: string) {
    setSel((p) => { const n = new Set(p); n.has(cnpj) ? n.delete(cnpj) : n.add(cnpj); return n; });
  }
  function marcarTodos() {
    setSel((p) => {
      const n = new Set(p);
      if (todosMarcados) selecionaveis.forEach((e) => n.delete(e.cnpj));
      else selecionaveis.forEach((e) => n.add(e.cnpj));
      return n;
    });
  }

  async function gravar() {
    setErro(null); setMsg(null); setGravando(true);
    try {
      const escolhidasEmpresas = resultados.filter((e) => sel.has(e.cnpj));
      const r: any = await enviarParaCadastro(escolhidasEmpresas, criarSocios ? "empresa_contato" : "empresa");
      if (r?.error) { setErro(r.error); return; }
      setGravado({
        empresas: r?.empresasCriadas || 0,
        contatos: r?.contatosCriados || 0,
        pulados: r?.pulados || 0,
        limite: !!r?.limiteAtingido,
      });
      const ids: string[] = r?.contatoIds || [];
      setContatoIds(ids);
      setProg({ site: null, email: null, whats: null });
      setPlacar(null);
      setPasso(criarSocios && ids.length ? 4 : 3);
      if (ids.length) await atualizarPlacar(ids);
    } finally {
      setGravando(false);
    }
  }

  async function atualizarPlacar(ids: string[] = contatoIds) {
    if (!ids.length) return;
    try {
      const r = await placarEsteira(ids);
      if (r?.placar) setPlacar(r.placar);
      // sem placar a tela ficaria muda (o painel inteiro depende dele) — então avisa
      else if (r?.error) setErro(`Não consegui montar o placar: ${r.error}`);
    } catch (e: any) {
      setErro(`Não consegui montar o placar: ${e?.message || "erro de conexão"}`);
    }
  }

  // Roda uma etapa em rodadas de LOTE até acabar. Cada rodada é uma chamada ao
  // servidor; o progresso é atualizado a cada volta (nada de barra fake).
  async function rodarEtapa(etapa: Etapa) {
    if (!contatoIds.length) return;
    setErro(null); setMsg(null); setRodando(etapa);
    const tamanho = LOTE[etapa];
    const fila = [...contatoIds];
    let feitos = 0;
    let achou = 0;
    let nota = "";
    setProg((p) => ({ ...p, [etapa]: { feitos: 0, total: fila.length, achou: 0 } }));
    let quebrou = false;
    try {
      for (let i = 0; i < fila.length; i += tamanho) {
        const chunk = fila.slice(i, i + tamanho);
        if (etapa === "site") {
          const r: any = await capturarDoSiteLote(chunk);
          if (r?.error) { setErro(r.error); quebrou = true; break; }
          achou += r?.achou || 0;
          if (r?.semDominio) nota = "Alguns contatos não têm domínio de site — nada a raspar neles.";
        } else if (etapa === "email") {
          const r: any = await descobrirEmailsLote(chunk);
          if (r?.error) { setErro(r.error); quebrou = true; break; }
          achou += r?.achou || 0;
          if (r?.semWorker) nota = "O worker SMTP está desligado: só encontramos e-mail publicado no site.";
        } else {
          const r: any = await verificarWhatsAppLote(chunk);
          if (r?.error) { setErro(r.error); quebrou = true; break; }
          achou += r?.comWa || 0;
          if (r?.semTelefone) nota = "Parte dos contatos ainda não tem telefone — rode a captura no site antes.";
        }
        feitos += chunk.length;
        setProg((p) => ({ ...p, [etapa]: { feitos, total: fila.length, achou, nota } }));
      }
      await atualizarPlacar();
    } catch (e: any) {
      // sem este catch, um timeout da função (site fora do ar, SMTP lento) virava
      // "unhandled rejection": a barra congelava e a tela não dizia nada.
      quebrou = true;
      setErro(
        `A etapa "${etapa === "site" ? "site" : etapa === "email" ? "e-mail" : "WhatsApp"}" parou no meio ` +
        `(${e?.message || "tempo esgotado"}). O que já foi encontrado está salvo; o resto continua na fila dos robôs ` +
        `— clique de novo para retomar de onde parou.`
      );
      await atualizarPlacar().catch(() => {});
    } finally {
      setRodando(null);
    }
    return !quebrou;
  }

  async function rodarTudo() {
    // se uma etapa quebra, para a sequência: seguir para a próxima só empilharia erro
    if (!(await rodarEtapa("site"))) return;
    if (!(await rodarEtapa("email"))) return;
    if (waPronto) await rodarEtapa("whats");
  }

  // limite por clique: bulkEnroll matricula um por um (cria as tarefas de cada passo),
  // e passar de ~200 estoura o tempo da função. Melhor dizer isso do que travar.
  const MAX_INSCRICAO = 200;

  async function inscrever() {
    // usa prontosIds (TODOS os com canal), não a amostra da tabela (20 linhas)
    const todos = placar?.prontosIds || [];
    if (!cadencia || !todos.length) return;
    setErro(null); setMsg(null); setInscrevendo(true);
    try {
      const ids = todos.slice(0, MAX_INSCRICAO);
      const r: any = await bulkEnroll(ids, cadencia);
      if (r?.error) { setErro(r.error); return; }
      const extras = [
        r?.semDado ? `${r.semDado} sem canal` : "",
        r?.jaInscrito ? `${r.jaInscrito} já estavam` : "",
      ].filter(Boolean).join(", ");
      const sobrou = todos.length - ids.length;
      setMsg(
        `✓ ${r?.enrolled || 0} contato(s) inscrito(s) na cadência${extras ? ` (${extras})` : ""}.` +
        (sobrou > 0 ? ` Faltam ${sobrou} — clique de novo para continuar (vão ${MAX_INSCRICAO} por vez).` : "")
      );
      await atualizarPlacar();
    } catch (e: any) {
      setErro(`A inscrição parou no meio (${e?.message || "tempo esgotado"}). Clique de novo: quem já entrou não entra duas vezes.`);
    } finally {
      setInscrevendo(false);
    }
  }

  function recomecar() {
    setPasso(1); setSel(new Set()); setResultados([]); setTotal(null); setTemMais(false);
    setGravado(null); setContatoIds([]); setPlacar(null);
    setProg({ site: null, email: null, whats: null });
    setMsg(null); setErro(null); setAviso(null);
  }

  return (
    <div className="mt-6 space-y-4">
      {!receitaOk && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A base da Receita não está conectada: defina <code>RECEITA_API_URL</code> e <code>RECEITA_API_TOKEN</code> e
          refaça o deploy. Sem ela, o passo 1 não tem onde buscar.
        </p>
      )}

      <Trilha passo={passo} />

      {erro && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {aviso && <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{aviso}</p>}
      {msg && <p className="rounded-lg bg-signal/10 px-3 py-2 text-sm text-signal">{msg}</p>}

      {/* ================= PASSO 1 — ACHAR ================= */}
      <Caixa n={1} titulo="Achar as empresas" aberto={passo === 1} resumo={passo > 1 ? `${resultados.length} empresa(s) na tela${total ? ` de ${total.toLocaleString("pt-BR")} na base` : ""}` : undefined} onAbrir={() => setPasso(1)}>
        <label className="text-xs font-medium text-subtle">Razão social, nome fantasia ou CNPJ</label>
        <input
          className="input mt-1 w-full"
          placeholder="Ex.: Padaria do Zé, ou 12.345.678/0001-90"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && temFiltro) { e.preventDefault(); buscar(0); } }}
        />

        <div className="my-3 flex items-center gap-2 text-[11px] uppercase tracking-wide text-subtle">
          <span className="h-px flex-1 bg-line" /> ou por segmento <span className="h-px flex-1 bg-line" />
        </div>

        <label className="text-xs font-medium text-subtle">Atividade</label>
        <div className="relative mt-1">
          <input
            className="input w-full"
            placeholder="Ex.: contabilidade, restaurante, advocacia…"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
          {(buscandoSug || sug.length > 0) && termo.trim().length >= 3 && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
              {buscandoSug && <p className="px-3 py-2 text-xs text-subtle">buscando…</p>}
              {!buscandoSug && !sug.length && <p className="px-3 py-2 text-xs text-subtle">nenhuma atividade encontrada</p>}
              {sug.map((a) => (
                <button
                  key={a.cnae}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => { setEscolhidas((p) => (p.some((x) => x.cnae === a.cnae) ? p : [...p, a])); setTermo(""); setSug([]); }}
                >
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
                <button type="button" className="font-bold" onClick={() => setEscolhidas((p) => p.filter((x) => x.cnae !== a.cnae))}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-subtle">UF (várias)</label>
            <SmartSelect multiple placeholder="Todas" values={ufs} onValuesChange={setUfs} maxTagsShown={4}
              options={UFS.map((u) => ({ value: u, label: u }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-subtle">Município</label>
            <input className="input mt-1 w-full" placeholder="Ex.: Santo André" value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-subtle">Porte (vários)</label>
            <SmartSelect multiple placeholder="Qualquer" values={portes} onValuesChange={setPortes}
              options={[{ value: "ME", label: "ME" }, { value: "EPP", label: "EPP" }, { value: "Demais", label: "Demais" }]} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={comEmail} onChange={(e) => { setComEmail(e.target.checked); if (!e.target.checked) setEmailCorp(false); }} />
            Só com e-mail
          </label>
          <label className={`flex items-center gap-2 ${comEmail ? "" : "opacity-40"}`}>
            <input type="checkbox" checked={emailCorp} disabled={!comEmail} onChange={(e) => setEmailCorp(e.target.checked)} />
            Só e-mail empresarial <span className="text-subtle">(dá domínio para raspar o site)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ocultarJaTem} onChange={(e) => setOcultarJaTem(e.target.checked)} />
            Esconder as que já tenho
          </label>
          <input className="input w-full sm:w-52" placeholder="ou CNAE (7 dígitos)" value={cnaeManual} onChange={(e) => setCnaeManual(e.target.value)} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button className="btn-brand px-5" onClick={() => buscar(0)} disabled={buscando || !temFiltro || !receitaOk}>
            {buscando ? "Buscando…" : "Buscar na base"}
          </button>
          {!temFiltro && <span className="text-xs text-subtle">Escolha uma atividade/UF ou digite um nome/CNPJ.</span>}
        </div>
      </Caixa>

      {/* ================= PASSO 2 — ESCOLHER ================= */}
      <Caixa
        n={2}
        titulo="Revisar e escolher"
        aberto={passo === 2}
        travado={!resultados.length}
        resumo={passo > 2 ? `${sel.size} empresa(s) escolhida(s)` : undefined}
        onAbrir={() => resultados.length && setPasso(2)}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={todosMarcados} onChange={marcarTodos} />
            Marcar as {selecionaveis.length} da tela
          </label>
          <span className="text-xs text-subtle">
            {sel.size} escolhida(s){total ? ` · ${total.toLocaleString("pt-BR")} na base` : ""}
          </span>
          {temMais && (
            <button className="btn-ghost py-1 text-xs" onClick={() => buscar(nextOffset)} disabled={buscando}>
              {buscando ? "Carregando…" : "Carregar mais 100"}
            </button>
          )}
        </div>

        <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-subtle">
              <tr>
                <th className="px-3 py-2"> </th>
                <th className="px-3 py-2 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium">Atividade</th>
                <th className="px-3 py-2 font-medium">Onde</th>
                <th className="px-3 py-2 font-medium">Contato na base</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((e) => {
                const bloqueada = e.jaTem || e.descartado;
                return (
                  <tr key={e.cnpj} className={`border-t border-line ${bloqueada ? "opacity-50" : "hover:bg-muted"}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        disabled={!!bloqueada}
                        checked={sel.has(e.cnpj)}
                        onChange={() => toggle(e.cnpj)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{e.nome_fantasia || e.razao_social || e.cnpj}</p>
                      <p className="text-xs text-subtle">
                        {e.cnpj}
                        {e.porte ? ` · ${e.porte}` : ""}
                        {e.jaTem ? " · já no cadastro" : ""}
                        {Array.isArray(e.socios) && e.socios.length ? ` · ${e.socios.length} sócio(s)` : ""}
                      </p>
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-xs text-subtle">{e.cnae_descricao || e.cnae || "—"}</td>
                    <td className="px-3 py-2 text-xs text-subtle">{[e.municipio, e.uf].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={e.email ? "" : "text-subtle"}>{e.email || "sem e-mail"}</span>
                      <br />
                      <span className={e.telefone ? "text-subtle" : "text-subtle"}>{e.telefone || "sem telefone"}</span>
                    </td>
                  </tr>
                );
              })}
              {!resultados.length && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-subtle">Nada aqui ainda — faça a busca no passo 1.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-brand px-5" onClick={() => setPasso(3)} disabled={!sel.size}>
            Continuar com {sel.size || 0} empresa(s)
          </button>
          <button className="btn-ghost py-1.5 text-sm" onClick={() => setPasso(1)}>Ajustar filtros</button>
        </div>
      </Caixa>

      {/* ================= PASSO 3 — GRAVAR ================= */}
      <Caixa
        n={3}
        titulo="Gravar empresa + sócios (já enriquecidos)"
        aberto={passo === 3}
        travado={!sel.size}
        resumo={gravado ? `${gravado.empresas} empresa(s) e ${gravado.contatos} contato(s) gravados` : undefined}
        onAbrir={() => sel.size && setPasso(3)}
      >
        <p className="text-sm text-subtle">
          A base já traz CNAE, município, telefone e e-mail — grava direto, sem consulta paga. Os sócios viram
          <b> um contato cada</b> (o decisor), com o domínio da empresa preenchido para os próximos passos. Duplicidade
          é resolvida por CNPJ: empresa que você já tem não entra de novo.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={criarSocios} onChange={(e) => setCriarSocios(e.target.checked)} />
          Criar um contato por sócio <span className="text-subtle">(desmarque para gravar só a empresa)</span>
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-brand px-5" onClick={gravar} disabled={gravando || !sel.size}>
            {gravando ? "Gravando…" : `Gravar ${sel.size} empresa(s)`}
          </button>
          <button className="btn-ghost py-1.5 text-sm" onClick={() => setPasso(2)}>Voltar à seleção</button>
        </div>

        {gravado && (
          <div className="mt-4 rounded-xl border border-line bg-muted/40 p-3 text-sm">
            <p>
              <b>{gravado.empresas}</b> empresa(s) e <b>{gravado.contatos}</b> contato(s) gravados
              {gravado.pulados ? ` · ${gravado.pulados} pulada(s) por já existirem` : ""}.
            </p>
            {gravado.limite && (
              <p className="mt-1 text-warn">
                O limite de contatos do seu plano foi atingido — o restante não entrou. Veja em Planos.
              </p>
            )}
            {!contatoIds.length && (
              <p className="mt-1 text-subtle">
                Sem contatos novos, não há canal para descobrir. As empresas estão em{" "}
                <Link href="/dashboard/contas" className="text-brand-dark underline">Empresas</Link>.
              </p>
            )}
          </div>
        )}
      </Caixa>

      {/* ================= PASSO 4 — DESCOBRIR CANAIS ================= */}
      <Caixa
        n={4}
        titulo="Descobrir e-mail e WhatsApp"
        aberto={passo === 4}
        travado={!contatoIds.length}
        onAbrir={() => contatoIds.length && setPasso(4)}
      >
        <p className="text-sm text-subtle">
          Três buscas, na ordem que dá mais resultado: o <b>site</b> primeiro (acha telefone, link de WhatsApp e e-mail
          publicado numa passada), depois o <b>e-mail do decisor</b> testado no servidor da empresa, e por fim a
          <b> confirmação do WhatsApp</b>. O que não couber no tempo fica na fila e os robôs terminam de hora em hora.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-brand px-5" onClick={rodarTudo} disabled={!!rodando}>
            {rodando ? "Rodando…" : "Rodar as três buscas"}
          </button>
          <span className="text-xs text-subtle">ou uma por uma:</span>
          <button className="btn-ghost py-1 text-xs" onClick={() => rodarEtapa("site")} disabled={!!rodando}>1. Site</button>
          <button className="btn-ghost py-1 text-xs" onClick={() => rodarEtapa("email")} disabled={!!rodando}>2. E-mail</button>
          <button className="btn-ghost py-1 text-xs" onClick={() => rodarEtapa("whats")} disabled={!!rodando || !waPronto} title={waPronto ? "" : "Exige o WhatsApp no modo Evolution conectado (Config → Canais)"}>
            3. WhatsApp
          </button>
        </div>

        {!workerOk && (
          <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            O worker de e-mail (SMTP) está desligado — o passo 2 vai achar só e-mail publicado no site. Ligue
            <code> WORKER_URL</code> e <code>WORKER_TOKEN</code> para testar os padrões nome@empresa.
          </p>
        )}
        {!waPronto && (
          <p className="mt-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            O WhatsApp não está no modo Evolution conectado, então a confirmação de número fica de fora. Os telefones
            achados no site continuam sendo gravados.
          </p>
        )}

        <div className="mt-4 space-y-2">
          <Barra rotulo="1. Raspar o site" p={prog.site} rodando={rodando === "site"} achouLabel="com telefone/e-mail" />
          <Barra rotulo="2. E-mail do decisor" p={prog.email} rodando={rodando === "email"} achouLabel="com e-mail" />
          <Barra rotulo="3. Confirmar WhatsApp" p={prog.whats} rodando={rodando === "whats"} achouLabel="com WhatsApp" />
        </div>

        {placar && (
          <div className="mt-5">
            <p className="label mb-2">Placar dos {placar.total} contato(s) gravados</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Placa label="Com e-mail" valor={placar.comEmail} />
              <Placa label="Com WhatsApp" valor={placar.comWhats} />
              <Placa label="Prontos p/ cadência" valor={placar.comAlgumCanal} destaque />
              <Placa label="Sem canal ainda" valor={placar.semCanal} />
            </div>
            {(placar.filaSite || placar.filaWhats || placar.filaEmail) > 0 && (
              <p className="mt-2 text-xs text-subtle">
                Na fila dos robôs: {placar.filaSite} site · {placar.filaEmail} e-mail · {placar.filaWhats} WhatsApp.
                Eles rodam de hora em hora — volte aqui ou olhe o selo de estágio em Contatos.
              </p>
            )}
            {placar.semDominio > 0 && (
              <p className="mt-1 text-xs text-subtle">
                {placar.semDominio} contato(s) sem domínio de site (e-mail da base era gmail/hotmail ou não havia
                e-mail): para estes só o WhatsApp resolve.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
              <div className="w-[240px]">
                <label className="label">Inscrever os prontos numa cadência</label>
                <div className="mt-1">
                  <SmartSelect
                    clearable
                    placeholder={sequences.length ? "Escolher cadência…" : "Nenhuma cadência criada"}
                    value={cadencia}
                    onValueChange={setCadencia}
                    options={sequences.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </div>
              </div>
              <button className="btn-brand px-4" onClick={inscrever} disabled={inscrevendo || !cadencia || !placar.comAlgumCanal}>
                {inscrevendo
                  ? "Inscrevendo…"
                  : `Inscrever ${Math.min(placar.prontosIds.length, MAX_INSCRICAO)} contato(s)` +
                    (placar.prontosIds.length > MAX_INSCRICAO ? ` de ${placar.prontosIds.length}` : "")}
              </button>
              <button className="btn-ghost py-1.5 text-sm" onClick={() => reenfileirarEsteira(contatoIds).then(() => atualizarPlacar())} disabled={!!rodando}>
                Tentar de novo mais tarde (voltar p/ fila)
              </button>
              <Link href="/dashboard/contatos?view=prontos" className="btn-ghost py-1.5 text-sm">Ver em Contatos</Link>
              <button className="ml-auto text-xs text-subtle underline" onClick={recomecar}>prospectar outro lote</button>
            </div>

            {placar.prontos.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs text-subtle">
                    <tr>
                      <th className="px-3 py-2 font-medium">Decisor</th>
                      <th className="px-3 py-2 font-medium">Empresa</th>
                      <th className="px-3 py-2 font-medium">E-mail</th>
                      <th className="px-3 py-2 font-medium">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {placar.prontos.map((p) => (
                      <tr key={p.id} className="border-t border-line">
                        <td className="px-3 py-2">
                          <Link href={`/dashboard/contatos/${p.id}`} className="font-medium text-brand-dark hover:underline">{p.nome}</Link>
                        </td>
                        <td className="px-3 py-2 text-xs text-subtle">{p.empresa || "—"}</td>
                        <td className="px-3 py-2 text-xs">{p.email || <span className="text-subtle">—</span>}</td>
                        <td className="px-3 py-2 text-xs">{p.whats || <span className="text-subtle">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {placar.comAlgumCanal > placar.prontos.length && (
                  <p className="px-3 py-2 text-xs text-subtle">
                    Amostra: {placar.prontos.length} dos {placar.comAlgumCanal} prontos (a inscrição na cadência usa
                    todos, não só estes).
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Caixa>
    </div>
  );
}

// ---------------- peças da tela ----------------

function Trilha({ passo }: { passo: number }) {
  const passos = ["Achar", "Escolher", "Gravar", "Descobrir canais"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {passos.map((t, i) => {
        const n = i + 1;
        const feito = passo > n;
        const atual = passo === n;
        return (
          <div key={t} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                atual ? "bg-brand text-white" : feito ? "bg-signal/15 text-signal" : "bg-muted text-subtle"
              }`}
            >
              {feito ? "✓" : n}
            </span>
            <span className={`text-xs ${atual ? "font-semibold text-ink" : "text-subtle"}`}>{t}</span>
            {n < passos.length && <span className="mx-1 h-px w-5 bg-line" />}
          </div>
        );
      })}
    </div>
  );
}

function Caixa({
  n, titulo, aberto, travado, resumo, onAbrir, children,
}: {
  n: number; titulo: string; aberto: boolean; travado?: boolean; resumo?: string;
  onAbrir: () => void; children: React.ReactNode;
}) {
  return (
    <section className={`card p-4 ${aberto ? "ring-1 ring-brand/30" : ""} ${travado ? "opacity-60" : ""}`}>
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left"
        onClick={onAbrir}
        disabled={travado}
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${aberto ? "bg-brand text-white" : "bg-muted text-subtle"}`}>{n}</span>
        <span className="flex-1">
          <span className="block font-display text-base font-bold">{titulo}</span>
          {!aberto && resumo && <span className="block text-xs text-subtle">{resumo}</span>}
          {!aberto && travado && <span className="block text-xs text-subtle">conclua o passo anterior</span>}
        </span>
        <span className="text-xs text-subtle">{aberto ? "▴" : "▾"}</span>
      </button>
      {aberto && <div className="mt-4">{children}</div>}
    </section>
  );
}

function Barra({ rotulo, p, rodando, achouLabel }: { rotulo: string; p: Progresso | null; rodando: boolean; achouLabel: string }) {
  const pct = p && p.total ? Math.round((p.feitos / p.total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className={rodando ? "font-semibold text-brand-dark" : "text-subtle"}>{rotulo}</span>
        <span className="text-subtle">
          {p ? `${p.feitos}/${p.total} · ${p.achou} ${achouLabel}` : "não rodou ainda"}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${pct >= 100 ? "bg-signal" : "bg-brand"} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {p?.nota && <p className="mt-1 text-[11px] text-subtle">{p.nota}</p>}
    </div>
  );
}

function Placa({ label, valor, destaque }: { label: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`card p-3 ${destaque ? "ring-1 ring-signal/40" : ""}`}>
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-bold">{valor}</p>
    </div>
  );
}
