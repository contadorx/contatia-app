"use client";

import { useTransition, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { completeTask, skipTask, snoozeTask, sendEmailTask, markReplied, sendWhatsAppTask, sendAllEmailTasks, completeTasks, skipTasks, deleteTasks } from "@/app/dashboard/task-actions";
import { channelLabel, waLink, type Channel } from "@/lib/cadence";
import { linkInstagramDM, linkLinkedin, handleInstagram } from "@/lib/redes";
import { conferirRede } from "@/app/dashboard/contatos/social-actions";
import { capturarDoSiteLote } from "@/app/dashboard/contatos/web-capture-actions";
import { tipoTelefone } from "@/lib/telefone";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import RichTextEditor from "@/components/RichTextEditor";

type Task = {
  id: string;
  channel: Channel;
  title: string | null;
  generated_content: string | null;
  due_date: string;
  contact_id: string | null;
  cadence?: string | null;
  tags?: { id: string; name: string; color: string }[];
  is_future?: boolean;
  hot_now?: { type: string; created_at: string } | null;
  // dono da TAREFA (carimbado na inscrição, vindo do responsável do contato)
  owner_id?: string;
  owner_name?: string;
  contacts: {
    name: string; company: string | null; phone: string | null; email: string | null; score: number | null;
    wa_status?: string | null;
    instagram?: string | null; linkedin?: string | null;
    instagram_conferido_at?: string | null; linkedin_conferido_at?: string | null;
  } | null;
};
type LastActivity = Record<string, { type: string; created_at: string; text?: string }>;
type Tag = { id: string; name: string; color: string };

const chanStyle: Record<Channel, string> = {
  email: "bg-brand-soft text-brand-dark",
  whatsapp: "bg-signal/10 text-signal",
  call: "bg-warn/10 text-warn",
  linkedin: "bg-blue-50 text-blue-700",
  instagram: "bg-fuchsia-50 text-fuchsia-700",
};

const EVENT_LABEL: Record<string, string> = {
  note: "Nota",
  task_done: "Toque enviado",
  email_sent: "E-mail enviado",
  whatsapp_sent: "WhatsApp enviado",
  replied: "Respondeu",
  doc_opened: "Abriu a proposta",
  email_opened: "Abriu o e-mail",
  link_clicked: "Clicou no link",
  meeting: "Reunião marcada",
};

function rel(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "agora";
  if (d < 3600) return `${Math.floor(d / 60)}min`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export default function TaskQueue({
  tasks: allTasks,
  hotThreshold,
  lastActivity = {},
  allTags = [],
  waMode = "assistido",
}: {
  tasks: Task[];
  hotThreshold: number;
  lastActivity?: LastActivity;
  allTags?: Tag[];
  waMode?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<Record<string, { subject: string; body: string }>>({});
  // "copiado ✓" por linha: o prefill do Instagram falha em algumas versões do app, e
  // sem o texto na área de transferência a pessoa fica na frente de uma caixa vazia.
  const [copiado, setCopiado] = useState<string | null>(null);
  function copiar(id: string, texto: string) {
    const limpo = (texto || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const fim = () => { setCopiado(id); setTimeout(() => setCopiado((v) => (v === id ? null : v)), 2000); };
    try {
      navigator.clipboard.writeText(limpo).then(fim, () => {
        // navegador sem permissão de área de transferência (http, iframe): plano B
        const ta = document.createElement("textarea");
        ta.value = limpo; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); fim(); } finally { document.body.removeChild(ta); }
      });
    } catch { /* copiar nunca pode derrubar a tela */ }
  }
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // seleção em lote (checkbox por linha) — vazio = nada selecionado
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);

  // filtros
  const [periodo, setPeriodo] = useState<"hoje" | "3dias" | "todos">("hoje");
  const [canalFilters, setCanalFilters] = useState<string[]>([]); // vazio = todos os canais
  const [busca, setBusca] = useState("");                        // busca por contato/empresa
  const [tagFilters, setTagFilters] = useState<string[]>([]);   // filtro por VÁRIAS tags

  const cadences = Array.from(new Set(allTasks.map((t) => t.cadence).filter(Boolean))) as string[];
  const [cadFilters, setCadFilters] = useState<string[]>([]);   // filtro por VÁRIAS cadências

  // ============================================================
  // FILTRO POR RESPONSÁVEL
  //
  // As opções saem das tarefas que ESTÃO na fila, não da lista de usuários: oferecer
  // gente com zero tarefa só faz o operador filtrar e ver vazio. Quando aparece um
  // nome só, a caixa continua visível e diz por quê — é a informação que importa
  // ("está tudo no admin"), e escondê-la faria a fila parecer distribuída.
  // ============================================================
  const donos = Array.from(
    new Map(allTasks.map((t) => [t.owner_id || "", t.owner_name || "sem responsável"])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const [respFilters, setRespFilters] = useState<string[]>([]);

  const tasks = allTasks.filter((t) => {
    if (periodo === "hoje" && t.is_future) return false;
    if (canalFilters.length && !canalFilters.includes(t.channel)) return false;
    if (tagFilters.length && !(t.tags || []).some((tg) => tagFilters.includes(tg.id))) return false;
    if (cadFilters.length && !cadFilters.includes(t.cadence || "")) return false;
    if (respFilters.length && !respFilters.includes(t.owner_id || "")) return false;
    if (busca) {
      const q = busca.toLowerCase();
      const hay = `${t.contacts?.name || ""} ${t.contacts?.company || ""} ${t.contacts?.email || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pendingEmails = tasks.filter((t) => t.channel === "email").length;

  // ============================================================
  // TOQUE DE WHATSAPP QUE NÃO TEM COMO SAIR
  //
  // `wa_status='invalid'` quer dizer que já perguntamos ao WhatsApp, com e sem o 9º
  // dígito, e a resposta foi "não existe". Enquanto isso não aparecia na fila, a
  // tarefa era indistinguível das outras: você clicava, tomava o erro, e amanhã ela
  // estava lá de novo — o disparo de hoje foi assim.
  //
  // Aqui ela ganha cara de PENDÊNCIA DE REVISÃO, não de tarefa: some o botão de
  // enviar (não há para onde) e entram as três saídas reais — procurar outro número
  // no site, abrir a ficha para digitar um celular, ou pular o toque.
  // ============================================================
  const travadoSemWa = (t: Task) => t.channel === "whatsapp" && t.contacts?.wa_status === "invalid";
  const semWaNaFila = tasks.filter(travadoSemWa);
  const [soTravados, setSoTravados] = useState(false);
  const tarefasVisiveis = soTravados ? semWaNaFila : tasks;
  // e-mails marcados na fila: o botão passa a dizer o que vai fazer com eles
  const emailsSelecionados = allTasks.filter((t) => sel.has(t.id) && t.channel === "email").length;

  useEffect(() => {
    if (focus > tasks.length - 1) setFocus(Math.max(0, tasks.length - 1));
  }, [tasks.length, focus]);

  // ---------- seleção em lote ----------
  const idsVisiveis = tasks.map((t) => t.id);
  const selVisiveis = idsVisiveis.filter((id) => sel.has(id));
  const todosMarcados = idsVisiveis.length > 0 && selVisiveis.length === idsVisiveis.length;

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTodos() {
    setSel((s) => {
      const n = new Set(s);
      if (todosMarcados) idsVisiveis.forEach((id) => n.delete(id));
      else idsVisiveis.forEach((id) => n.add(id));
      return n;
    });
  }
  function limparSel() { setSel(new Set()); setConfirmando(false); }

  // Roda a ação em lote sobre o que está SELECIONADO E VISÍVEL — nunca sobre algo que
  // saiu da visão por filtro (evita apagar o que o operador não está vendo).
  function emLote(fn: (ids: string[]) => Promise<any>, sucesso: (n: number) => string) {
    setErr(null); setBulkMsg(null);
    const ids = selVisiveis;
    if (!ids.length) return;
    start(async () => {
      const res = (await fn(ids)) as { count?: number; done?: number; error?: string };
      if (res?.error) { setErr(res.error); return; }
      const n = res.count ?? res.done ?? ids.length;
      setBulkMsg(sucesso(n));
      limparSel();
      router.refresh();
    });
  }

  // ============================================================
  // UM CLIQUE DRENA A FILA
  //
  // O envio de um lote é limitado pelo tempo da função (uns 40 segundos úteis), não
  // pelo tamanho da fila. Com 200 tarefas isso virava "clique de novo" vinte vezes — e
  // a queixa, três vezes seguidas, foi a mesma: "não envia em massa". Enviava; só
  // exigia que a pessoa fosse o laço de repetição.
  //
  // Agora a tela repete sozinha, e para pelos motivos certos:
  //   · acabou a fila;
  //   · bateu o limite diário (insistir hoje não muda nada);
  //   · uma volta inteira não enviou NADA (erro que se repetiria em todas);
  //   · teto de voltas, para nunca virar laço infinito numa aba esquecida aberta.
  //
  // O progresso aparece a cada volta: a pessoa vê o número andando em vez de olhar
  // para um botão travado sem saber se ainda está vivo.
  // ============================================================
  const MAX_VOLTAS = 15;

  function sendAll() {
    setErr(null);
    setBulkMsg(null);
    // manda a SELEÇÃO quando existe: marcar 260 linhas e ver o botão pegar outras é o
    // tipo de discordância que faz a pessoa desconfiar do número que aparece depois.
    const escolhidas = allTasks.filter((t) => sel.has(t.id) && t.channel === "email").map((t) => t.id);
    start(async () => {
      let totalEnviados = 0;
      let totalFalhas = 0;
      const caixas: Record<string, number> = {};
      let ultima: any = null;

      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const res = (await sendAllEmailTasks(escolhidas.length ? escolhidas : undefined)) as
          { sent?: number; failed?: number; restantes?: number; limiteAtingido?: string | null;
            primeiroErro?: string | null; detalhe?: string; error?: string;
            diagnostico?: string | null; motivos?: string[];
            paradoPorLimite?: boolean; paradoPorTempo?: boolean; duracaoMs?: number; msPorEmail?: number | null;
            tempos?: { banco: number; smtp: number; copia: number };
            capacidadeHoje?: number; usadosHoje?: number; folgaHoje?: number;
            resumoCapacidade?: string; comoAumentar?: string;
            descartadasDaSelecao?: number; tetoPorClique?: number | null;
            porCaixa?: Record<string, number> } | undefined;

        // resposta vazia = função morta por tempo. Antes isso não dizia nada, e a
        // pessoa clicava de novo — reenviando o que já tinha saído.
        if (!res) {
          setErr(
            "O envio em lote não retornou resposta (tempo esgotado). Parte pode ter saído — " +
            "confira o painel \"Seus envios de hoje\" ANTES de clicar de novo."
          );
          break;
        }
        if (res.error) { setErr(res.error); break; }

        ultima = res;
        totalEnviados += res.sent ?? 0;
        totalFalhas += res.failed ?? 0;
        for (const [c, n] of Object.entries(res.porCaixa || {})) caixas[c] = (caixas[c] || 0) + n;

        // progresso enquanto as voltas acontecem
        setBulkMsg(
          `Enviando… ${totalEnviados} até agora` +
          (res.restantes ? ` · ${res.restantes} na fila` : "") +
          (res.msPorEmail ? ` · ${(res.msPorEmail / 1000).toFixed(1)}s por e-mail` : "")
        );

        // motivos para NÃO dar outra volta
        if (!res.restantes) break;
        if (res.paradoPorLimite) break;
        if (!res.sent) break;    // volta inteira sem enviar nada: a próxima repetiria
      }

      router.refresh();

      const res = ultima;
      if (!res) return;

      // Zero enviados com explicação NÃO é mensagem de sucesso: vai no lugar do erro,
      // que é onde o operador olha quando algo não aconteceu.
      if (!totalEnviados && res.diagnostico) { setErr(res.diagnostico); setBulkMsg(null); return; }

      const detalhe = Object.entries(caixas).map(([c, n]) => `${n} por ${c}`).join(", ");
      const partes = [`✓ ${totalEnviados} e-mail(is) enviado(s)`];
      if (detalhe) partes.push(detalhe);
      if (totalFalhas) partes.push(`${totalFalhas} falharam`);
      if (res.restantes) {
        // "clique de novo" só quando clicar de novo adianta: parada por limite do dia
        // significa que hoje acabou, e insistir devolveria zero.
        partes.push(
          res.paradoPorLimite
            ? `${res.restantes} continuam na fila e saem nos próximos dias`
            : `${res.restantes} ainda na fila — clique de novo para continuar`
        );
      }
      if (res.descartadasDaSelecao) {
        partes.push(`${res.descartadasDaSelecao} da sua seleção ficaram de fora (não são e-mail, já saíram, ou vencem depois de hoje)`);
      }
      // O CUSTO POR MENSAGEM, e onde ele foi. Sem isto, "por que só saíram 10?" só
      // podia ser respondido com palpite — e foi, duas vezes.
      if (res.msPorEmail) {
        const t = res.tempos;
        const reparte = t
          ? ` (envio ${(t.smtp / 1000).toFixed(0)}s · cópia ${(t.copia / 1000).toFixed(0)}s · banco ${(t.banco / 1000).toFixed(0)}s na última volta)`
          : "";
        partes.push(`${(res.msPorEmail / 1000).toFixed(1)}s por e-mail${reparte}`);
      }
      setBulkMsg(partes.join(" · ") + ".");

      // O limite é a informação mais importante do lote: sem destaque, ela some no meio
      // do resumo e a pessoa acha que enviou tudo. E vem com a conta do dia + o que
      // fazer, porque "tente amanhã" sozinho não diz se o freio é aquecimento, limite
      // configurado ou caixa de menos.
      if (res.limiteAtingido) {
        setErr(
          [res.limiteAtingido, res.resumoCapacidade, res.comoAumentar ? `Para enviar mais hoje: ${res.comoAumentar}` : ""]
            .filter(Boolean)
            .join(" ")
        );
      }
      else if (totalFalhas && res.motivos?.length) setErr(`Não saíram: ${res.motivos.slice(0, 3).join(" · ")}`);
      else if (totalFalhas && res.primeiroErro) setErr(`Primeira falha: ${res.primeiroErro}`);
    });
  }

  // conclui todos os toques visíveis (fila sequencial por tipo)
  function completeVisible() {
    setErr(null);
    setBulkMsg(null);
    const ids = tasks.filter((t) => t.channel !== "email").map((t) => t.id);
    if (!ids.length) return;
    start(async () => {
      const res = (await completeTasks(ids)) as { done?: number; error?: string };
      if (res?.error) setErr(res.error);
      else { setBulkMsg(`✓ ${res.done} toque(s) marcados como feitos.`); router.refresh(); }
    });
  }
  // rótulo do botão "marcar todos como feitos" quando há filtro de canal sem e-mail
  const canaisSemEmail = canalFilters.filter((c) => c !== "email");
  const mostrarConcluirVisiveis =
    canalFilters.length > 0 && !canalFilters.includes("email") && tasks.length > 0;
  function act(fn: () => Promise<unknown>) {
    start(async () => { await fn(); });
  }

  // Procura OUTRO número no site da empresa para um contato travado. O resultado é
  // dito com todas as letras: "achei" e "não achei" levam a próximos passos opostos, e
  // um spinner que some sem mensagem faz a pessoa clicar de novo achando que falhou.
  function procurarNumero(t: Task) {
    if (!t.contact_id) return;
    setErr(null); setBulkMsg(null);
    start(async () => {
      const r = (await capturarDoSiteLote([t.contact_id!])) as
        { ok?: boolean; achou?: number; whats?: number; filaVerif?: number; semDominio?: number; error?: string } | undefined;
      if (r?.error) { setErr(r.error); return; }
      if (r?.semDominio) {
        setErr(`${t.contacts?.name || "Este contato"}: não há site/domínio conhecido para raspar. Abra a ficha e informe o domínio da empresa, ou procure o celular pelo Radar (sócios).`);
        return;
      }
      if (r?.whats) setBulkMsg(`✓ Achei um WhatsApp no site de ${t.contacts?.company || t.contacts?.name}. A tarefa volta a valer.`);
      else if (r?.achou) setBulkMsg(`Achei telefone no site de ${t.contacts?.company || t.contacts?.name}${r.filaVerif ? " — está na fila de verificação do WhatsApp" : ""}.`);
      else setErr(`Nada de telefone novo no site de ${t.contacts?.company || t.contacts?.name}. Restam a ficha (digitar um celular) ou pular o toque.`);
      router.refresh();
    });
  }
  function send(id: string, override?: { subject?: string; body?: string }) {
    setErr(null);
    start(async () => {
      const res = (await sendEmailTask(id, override)) as { error?: string; aviso?: string } | undefined;
      if (res?.error) { setErr(res.error); return; }
      // `aviso` = o e-mail SAIU, mas algo secundário falhou (hoje: a cópia em
      // "Enviados"). Não pode virar erro vermelho — quem lê "falhou" manda de novo,
      // e o cliente receberia duas vezes.
      setErr(res?.aviso || null);
      setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
    });
  }
  function sendWa(id: string, body?: string) {
    setErr(null);
    start(async () => {
      const res = (await sendWhatsAppTask(id, body)) as { error?: string } | undefined;
      if (res?.error) setErr(res.error);
      else setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
    });
  }

  // ação primária por canal (Enter)
  function primary(t: Task) {
    if (t.channel === "email" && t.contacts?.email) send(t.id, editing[t.id] ? { subject: editing[t.id].subject, body: editing[t.id].body } : undefined);
    // WhatsApp automático (Evolution) → envia pela instância; modo assistido → concluir (o envio é manual pelo link)
    else if (t.channel === "whatsapp" && t.contacts?.phone && waMode === "evolution") sendWa(t.id, editing[t.id] ? editing[t.id].body : undefined);
    else act(() => completeTask(t.id, t.contact_id ?? undefined));
  }

  // navegação por teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // O corpo do e-mail é um editor contentEditable (div), não um <textarea>: sem
      // esta linha, digitar espaço no e-mail marcava/desmarcava a linha em vez de
      // escrever. Botão/link em foco também mantêm o comportamento nativo do teclado.
      if (el?.isContentEditable || tag === "BUTTON" || tag === "A") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!tasks.length) return;
      const t = tasks[focus];
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setFocus((f) => Math.min(tasks.length - 1, f + 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (e.key === "Enter") { if (t) { e.preventDefault(); primary(t); } }
      else if (e.key === "r") { if (t?.contact_id) { e.preventDefault(); act(() => markReplied(t.contact_id as string)); } }
      else if (e.key === "z") { if (t) { e.preventDefault(); act(() => snoozeTask(t.id, 1)); } }
      else if (e.key === "x") { if (t) { e.preventDefault(); act(() => skipTask(t.id)); } }
      // Espaço marca/desmarca a linha em foco — é como se seleciona em lote sem mouse.
      else if (e.key === " ") { if (t) { e.preventDefault(); toggleSel(t.id); } }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tasks, focus, editing]);

  // mantém o foco dentro do intervalo quando a lista muda (uso sequencial)
  useEffect(() => {
    setFocus((f) => Math.min(f, Math.max(0, tasks.length - 1)));
  }, [tasks.length]);

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  if (!allTasks.length)
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        <p className="font-medium text-ink">Nada na fila hoje.</p>
        <p className="mt-1">Reabasteça: traga novos leads ou resgate quem esfriou — e inscreva numa cadência.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <a href="/dashboard/contatos?view=prontos" className="btn-brand py-1.5 text-xs">Inscrever contatos</a>
          <a href="/dashboard/radar" className="btn-ghost py-1.5 text-xs">Buscar no Radar</a>
          <a href="/dashboard/contatos?view=resgatar" className="btn-ghost py-1.5 text-xs">Resgatar frios</a>
          <a href="/dashboard/cadencias" className="btn-ghost py-1.5 text-xs">Criar cadência</a>
        </div>
      </div>
    );

  return (
    <div className="space-y-2">
      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
        <div className="flex gap-1">
          {(["hoje", "3dias", "todos"] as const).map((p) => (
            <button
              key={p}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${periodo === p ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}
              onClick={() => setPeriodo(p)}
            >
              {p === "hoje" ? "Hoje + atrasados" : p === "3dias" ? "Próx. 3 dias" : "Todos"}
            </button>
          ))}
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar contato/empresa…"
          className="input w-[190px] shrink-0 grow-0 py-1 text-xs"
        />
        <div className="w-[160px] shrink-0 grow-0">
          <SmartSelect
            multiple
            className="py-1 text-xs"
            placeholder="Todos os canais"
            values={canalFilters}
            onValuesChange={setCanalFilters}
            options={[
              { value: "email", label: "E-mail" },
              { value: "whatsapp", label: "WhatsApp" },
              { value: "call", label: "Ligação" },
              { value: "linkedin", label: "LinkedIn" },
              { value: "instagram", label: "Instagram" },
            ]}
          />
        </div>
        {cadences.length > 0 && (
          <div className="w-[150px] shrink-0 grow-0">
            <SmartSelect
              multiple
              className="py-1 text-xs"
              placeholder="Todas as cadências"
              values={cadFilters}
              onValuesChange={setCadFilters}
              options={cadences.map((c): SmartOption => ({ value: c, label: c }))}
            />
          </div>
        )}
        {allTags.length > 0 && (
          <div className="w-[130px] shrink-0 grow-0">
            <SmartSelect
              multiple
              className="py-1 text-xs"
              placeholder="Todas as tags"
              values={tagFilters}
              onValuesChange={setTagFilters}
              options={allTags.map((t): SmartOption => ({ value: t.id, label: t.name }))}
            />
          </div>
        )}
        {donos.length > 0 && (
          <div className="w-[150px] shrink-0 grow-0">
            <SmartSelect
              multiple
              className="py-1 text-xs"
              placeholder="Todos os responsáveis"
              values={respFilters}
              onValuesChange={setRespFilters}
              options={donos.map(([id, nome]): SmartOption => ({ value: id, label: nome }))}
            />
          </div>
        )}
        {tasks.length > 0 && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-subtle">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={todosMarcados} onChange={toggleTodos} />
            Marcar todas
          </label>
        )}
        <span className="shrink-0 text-xs text-subtle">{tasks.length} na visão</span>
      </div>

      {/* A fila inteira numa pessoa só não é um estado a esconder: é o que explica
          por que filtrar por responsável não separa nada hoje, e onde se resolve. */}
      {donos.length === 1 && allTasks.length > 0 && (
        <p className="px-1 text-[11px] text-subtle">
          Todas as {allTasks.length} tarefas estão com <b>{donos[0][1]}</b>. O dono da tarefa é carimbado na
          inscrição, a partir do <b>responsável do contato</b> — quem não tem responsável fica com quem inscreveu.
          Para dividir a fila, atribua os contatos em{" "}
          <a href="/dashboard/contatos" className="text-brand-dark underline">Contatos</a> e inscreva depois disso.
        </p>
      )}

      {tasks.length === 0 && (
        <div className="card p-8 text-center text-sm text-subtle">Nenhum toque nesta visão. Ajuste os filtros acima.</div>
      )}

      {/* ---------- barra de AÇÕES EM LOTE (só aparece com seleção) ---------- */}
      {selVisiveis.length > 0 && (
        <div className="sticky top-2 z-10 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-dark">
              {selVisiveis.length} tarefa(s) selecionada(s)
            </span>
            <button className="btn-ghost py-1 text-xs" onClick={limparSel} disabled={pending}>Limpar seleção</button>
            <span className="mx-1 h-4 w-px bg-line" />
            <button
              className="btn-ghost py-1 text-xs"
              disabled={pending}
              onClick={() => emLote(completeTasks, (n) => `✓ ${n} tarefa(s) concluída(s).`)}
            >
              Concluir
            </button>
            <button
              className="btn-ghost py-1 text-xs"
              disabled={pending}
              onClick={() => emLote(skipTasks, (n) => `✓ ${n} tarefa(s) pulada(s).`)}
            >
              Pular
            </button>
            {!confirmando ? (
              <button
                className="rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                disabled={pending}
                onClick={() => setConfirmando(true)}
              >
                Excluir…
              </button>
            ) : (
              <span className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-2 py-1">
                <span className="text-xs text-danger">
                  Excluir {selVisiveis.length} de vez? Não tem como desfazer.
                </span>
                <button
                  className="rounded-lg bg-danger px-2 py-0.5 text-xs font-semibold text-white"
                  disabled={pending}
                  onClick={() => emLote(deleteTasks, (n) => `✓ ${n} tarefa(s) excluída(s). Ficou registrado em Resultados → Registro.`)}
                >
                  {pending ? "Excluindo…" : "Sim, excluir"}
                </button>
                <button className="text-xs text-subtle underline" onClick={() => setConfirmando(false)} disabled={pending}>
                  cancelar
                </button>
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-subtle">
            <b>Concluir</b> marca como feito (pontua o contato). <b>Pular</b> dispensa o toque, mas mantém o histórico da
            cadência. <b>Excluir</b> apaga a tarefa do banco — tudo fica registrado em Resultados → Registro.
          </p>
        </div>
      )}

      {/* barra de atalhos + envio em lote */}
      <div className="flex flex-wrap items-center gap-3">
        {pendingEmails > 0 && (
          <button className="btn-brand py-1.5 text-sm" onClick={sendAll} disabled={pending}>
            {pending
              ? "Enviando..."
              : emailsSelecionados > 0
              ? `Enviar os ${emailsSelecionados} selecionados`
              : `Enviar todos os e-mails (${pendingEmails})`}
          </button>
        )}
        {mostrarConcluirVisiveis && (
          <button className="btn-ghost py-1.5 text-sm" onClick={completeVisible} disabled={pending}>
            Marcar como feitos os {canaisSemEmail.map((c) => channelLabel[c as Channel] || c).join(" / ")} ({tasks.length})
          </button>
        )}
        <span className="text-xs text-subtle">
          Teclado: <b>↑/↓</b> navegar · <b>Enter</b> enviar/concluir · <b>Espaço</b> marcar · <b>r</b> respondeu · <b>z</b> adiar · <b>x</b> pular
        </span>
        {semWaNaFila.length > 0 && (
          <button
            type="button"
            onClick={() => setSoTravados((v) => !v)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${soTravados ? "bg-warn text-white" : "border border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"}`}
            title="Toques de WhatsApp para números que já foram verificados e não têm conta. Não adianta enviar — precisam de outro número."
          >
            {soTravados ? "◂ voltar à fila" : `${semWaNaFila.length} sem WhatsApp — revisar`}
          </button>
        )}
        {bulkMsg && <span className="text-sm text-signal">{bulkMsg}</span>}
      </div>
      {err && <div className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{err}</div>}

      {tarefasVisiveis.map((t, i) => {
        const c = t.contacts;
        const content = t.generated_content || "";
        const score = c?.score ?? 0;
        const hot = score >= hotThreshold;
        const focused = i === focus;
        const la = t.contact_id ? lastActivity[t.contact_id] : undefined;
        const hotNowLabel = t.hot_now
          ? t.hot_now.type === "replied" ? "🔥 RESPONDEU"
          : t.hot_now.type === "doc_opened" ? "🔥 ABRIU PROPOSTA"
          : "🔥 ABRIU E-MAIL"
          : null;
        return (
          <div
            key={t.id}
            ref={(el) => { rowRefs.current[i] = el; }}
            onClick={() => setFocus(i)}
            className={`card p-4 transition ${t.hot_now ? "ring-2 ring-warn bg-warn/5" : hot ? "ring-1 ring-warn/40" : ""} ${focused ? "ring-2 ring-brand" : ""} ${sel.has(t.id) ? "bg-brand-soft/30" : ""}`}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-brand"
                checked={sel.has(t.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSel(t.id)}
                aria-label="Selecionar tarefa"
              />
              <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${chanStyle[t.channel]}`}>
                {channelLabel[t.channel]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold">
                  {/* O SCORE NA FILA. A ordem já é por score (o servidor ordena assim),
                      mas sem o número a ordem é invisível — e quando o limite do dia
                      aperta, a decisão é "quem eu mando primeiro?". Com o número dá
                      para parar na hora certa em vez de descobrir depois que os 80
                      envios foram para os frios. */}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      hot ? "bg-warn/15 text-warn" : score > 0 ? "bg-muted text-subtle" : "bg-muted/60 text-subtle/60"
                    }`}
                    title={`Score ${score} — quente a partir de ${hotThreshold}. A fila vem ordenada por ele.`}
                  >
                    {score}
                  </span>
                  {c?.name || "Contato"}
                  {c?.company ? <span className="font-normal text-subtle">· {c.company}</span> : null}
                  {hotNowLabel && <span className="rounded-full bg-warn px-2 py-0.5 text-[10px] font-bold text-white">{hotNowLabel}</span>}
                  {!hotNowLabel && hot && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">QUENTE</span>}
                </p>
                <p className="truncate text-xs text-subtle">
                  {t.title || content || channelLabel[t.channel]}
                  {/* o dono só aparece quando há mais de um: com a fila inteira numa
                      pessoa, repetir o mesmo nome em toda linha é ruído */}
                  {donos.length > 1 && t.owner_name ? <span className="ml-1 opacity-70">· {t.owner_name}</span> : null}
                </p>
              </div>

              {t.channel === "whatsapp" && c?.phone && travadoSemWa(t) && (
                <>
                  <span
                    className="shrink-0 rounded-lg bg-danger/10 px-2 py-1 text-[11px] font-semibold text-danger"
                    title="Perguntamos ao WhatsApp com e sem o 9º dígito e este número não tem conta. Enviar não é possível — o que resolve é outro número."
                  >
                    sem WhatsApp{tipoTelefone(c.phone) === "fixo" ? " (fixo)" : ""}
                  </span>
                  <button
                    className="btn-ghost py-1.5 text-xs"
                    disabled={pending}
                    title="Raspa o site da empresa procurando telefone/WhatsApp publicado"
                    onClick={(e) => { e.stopPropagation(); procurarNumero(t); }}
                  >
                    Procurar no site
                  </button>
                  <a
                    className="btn-ghost py-1.5 text-xs"
                    href={`/dashboard/contatos/${t.contact_id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Abrir a ficha para digitar outro número"
                  >
                    Abrir ficha
                  </a>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={() => act(() => skipTask(t.id))}>
                    Pular
                  </button>
                </>
              )}
              {t.channel === "whatsapp" && c?.phone && !travadoSemWa(t) && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Editar"}
                  </button>
                  {waMode === "evolution" ? (
                    <>
                      {/* modo automático: envia pela instância + link como plano B */}
                      <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => sendWa(t.id, editing[t.id] ? editing[t.id].body : undefined)}>Enviar</button>
                      {waLink(c.phone, editing[t.id]?.body ?? content) && (
                        <a className="text-xs text-subtle hover:text-ink" href={waLink(c.phone, editing[t.id]?.body ?? content)} target="_blank" rel="noreferrer" title="Abrir no WhatsApp Web/app" onClick={(e) => e.stopPropagation()}>↗</a>
                      )}
                    </>
                  ) : (
                    <>
                      {/* modo assistido: abre o SEU WhatsApp com a mensagem pronta, depois marca como feito */}
                      {waLink(c.phone, editing[t.id]?.body ?? content) ? (
                        <a className="btn-brand py-1.5 text-xs" href={waLink(c.phone, editing[t.id]?.body ?? content)} target="_blank" rel="noreferrer" title="Abrir no seu WhatsApp com a mensagem pronta" onClick={(e) => e.stopPropagation()}>Abrir WhatsApp</a>
                      ) : (
                        <span className="text-xs text-subtle" title="Telefone inválido">sem nº válido</span>
                      )}
                      <button
                        className="btn-ghost py-1.5 text-xs"
                        disabled={pending}
                        title={
                          waMode === "hibrido"
                            ? "No modo híbrido a tarefa se marca sozinha quando o envio for detectado pelo número conectado. Este botão é o atalho para não esperar."
                            : "Marcar esta tarefa como feita"
                        }
                        onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}
                      >
                        Feito
                      </button>
                    </>
                  )}
                </>
              )}
              {t.channel === "email" && c?.email && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: t.title || "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Editar"}
                  </button>
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => send(t.id, editing[t.id] ? { subject: editing[t.id].subject, body: editing[t.id].body } : undefined)}>Enviar</button>
                  <a className="text-xs text-subtle hover:text-ink" href={`mailto:${c.email}?subject=${encodeURIComponent(t.title || "")}&body=${encodeURIComponent(content)}`} title="Abrir no seu cliente de e-mail" onClick={(e) => e.stopPropagation()}>✎</a>
                </>
              )}
              {/* ============================================================
                  INSTAGRAM — toque assistido
                  A API do Instagram não deixa mandar a primeira mensagem (só responder
                  dentro de 24h de uma interação que o prospect iniciou). Então o app
                  prepara o link com o texto e QUEM ENVIA É VOCÊ. Risco de bloqueio: zero.
                  ============================================================ */}
              {t.channel === "instagram" && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Editar"}
                  </button>
                  {linkInstagramDM(c?.instagram, editing[t.id]?.body ?? content) ? (
                    <>
                      {/* copiar antes de abrir: o ?text= do Instagram funciona na maioria
                          das versões do app, mas não em todas — sem o texto na área de
                          transferência, a pessoa cairia numa caixa vazia. */}
                      <button
                        className="btn-ghost py-1.5 text-xs"
                        title="Copiar a mensagem (o texto pronto nem sempre aparece no app do Instagram)"
                        onClick={(e) => { e.stopPropagation(); copiar(t.id, editing[t.id]?.body ?? content); }}
                      >
                        {copiado === t.id ? "copiado ✓" : "Copiar texto"}
                      </button>
                      <a
                        className="btn-brand py-1.5 text-xs"
                        href={linkInstagramDM(c?.instagram, editing[t.id]?.body ?? content) as string}
                        target="_blank"
                        rel="noreferrer"
                        title={`Abrir a conversa com @${handleInstagram(c?.instagram)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Abrir DM
                      </a>
                      {/* "era esse" é a ÚNICA verificação possível nestes canais: não
                          existe API que confirme um perfil, e conferir do servidor faria
                          o Instagram bloquear o workspace. Quem consegue verificar é
                          quem acabou de abrir — por isso o botão fica aqui, no momento
                          em que a pessoa está olhando o perfil. */}
                      {!c?.instagram_conferido_at && t.contact_id && (
                        <button
                          className="text-xs text-subtle underline hover:text-signal"
                          disabled={pending}
                          title="Abri e é o perfil certo — marca como conferido"
                          onClick={(e) => { e.stopPropagation(); act(() => conferirRede(t.contact_id as string, "instagram", true)); }}
                        >
                          era esse ✓
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-subtle" title="Contato sem @ do Instagram">sem @</span>
                  )}
                  {c?.instagram && !c?.instagram_conferido_at && (
                    <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn" title="Ninguém confirmou que este é o perfil certo. Confira antes de mandar.">
                      não conferido
                    </span>
                  )}
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Feito</button>
                </>
              )}

              {/* LINKEDIN — abre o perfil. Não existe URL pública que abra conversa nova
                  já endereçada, e inventar uma faria a pessoa cair no lugar errado. */}
              {t.channel === "linkedin" && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Editar"}
                  </button>
                  {linkLinkedin(c?.linkedin) ? (
                    <>
                      <button
                        className="btn-ghost py-1.5 text-xs"
                        title="Copiar a mensagem para colar no LinkedIn"
                        onClick={(e) => { e.stopPropagation(); copiar(t.id, editing[t.id]?.body ?? content); }}
                      >
                        {copiado === t.id ? "copiado ✓" : "Copiar texto"}
                      </button>
                      <a
                        className="btn-brand py-1.5 text-xs"
                        href={linkLinkedin(c?.linkedin) as string}
                        target="_blank"
                        rel="noreferrer"
                        title="Abrir o perfil no LinkedIn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Abrir perfil
                      </a>
                      {!c?.linkedin_conferido_at && t.contact_id && (
                        <button
                          className="text-xs text-subtle underline hover:text-signal"
                          disabled={pending}
                          title="Abri e é o perfil certo — marca como conferido"
                          onClick={(e) => { e.stopPropagation(); act(() => conferirRede(t.contact_id as string, "linkedin", true)); }}
                        >
                          era esse ✓
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-subtle" title="Contato sem perfil do LinkedIn">sem perfil</span>
                  )}
                  {c?.linkedin && !c?.linkedin_conferido_at && (
                    <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn" title="Ninguém confirmou que este é o perfil certo. Confira antes de mandar.">
                      não conferido
                    </span>
                  )}
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Feito</button>
                </>
              )}
              {t.channel === "call" && (
                <>
                  <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={(e) => { e.stopPropagation(); setEditing((s) => s[t.id] ? (() => { const n = { ...s }; delete n[t.id]; return n; })() : { ...s, [t.id]: { subject: "", body: content } }); }}>
                    {editing[t.id] ? "Fechar" : "Ver script"}
                  </button>
                  {c?.phone && (
                    <a className="btn-ghost py-1.5 text-xs" href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} onClick={(e) => e.stopPropagation()} title="Ligar">Ligar</a>
                  )}
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))}>Registrar</button>
                </>
              )}

              {t.contact_id && (
                <button
                  className="rounded-lg border border-signal/40 px-2 py-1.5 text-xs font-semibold text-signal hover:bg-signal/10"
                  disabled={pending}
                  onClick={() => act(() => markReplied(t.contact_id as string))}
                  title="Marcar que respondeu — pausa a cadência"
                >
                  Respondeu
                </button>
              )}
              <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => completeTask(t.id, t.contact_id ?? undefined))} title="Concluir">✓</button>
              <button className="text-xs text-subtle hover:text-ink" disabled={pending} onClick={() => act(() => snoozeTask(t.id, 1))} title="Adiar 1 dia">↷</button>
              <button className="text-xs text-subtle hover:text-danger" disabled={pending} onClick={() => act(() => skipTask(t.id))} title="Pular">✕</button>
            </div>

            {/* editor inline de e-mail / script de ligação */}
            {editing[t.id] && t.channel === "email" && (
              <div className="mt-3 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                <label className="label">Assunto</label>
                <input
                  className="input mt-1 text-sm"
                  value={editing[t.id].subject}
                  onChange={(e) => setEditing((s) => ({ ...s, [t.id]: { ...s[t.id], subject: e.target.value } }))}
                />
                <label className="label mt-2 block">Corpo</label>
                <div className="mt-1">
                  <RichTextEditor
                    value={editing[t.id].body}
                    onChange={(html) => setEditing((s) => ({ ...s, [t.id]: { ...s[t.id], body: html } }))}
                    minHeight={140}
                  />
                </div>
                <p className="mt-1 text-xs text-subtle">A assinatura do negócio é anexada automaticamente no envio. Variáveis como {"{{primeiro_nome}}"} são resolvidas.</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => send(t.id, { subject: editing[t.id].subject, body: editing[t.id].body })}>
                    {pending ? "Enviando..." : "Enviar editado"}
                  </button>
                  <button className="btn-ghost py-1.5 text-xs" onClick={() => setEditing((s) => { const n = { ...s }; delete n[t.id]; return n; })}>Cancelar</button>
                </div>
              </div>
            )}
            {editing[t.id] && t.channel === "whatsapp" && (
              <div className="mt-3 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                <label className="label">Mensagem do WhatsApp</label>
                <textarea
                  className="input mt-1 min-h-[100px] text-sm"
                  value={editing[t.id].body}
                  onChange={(e) => setEditing((s) => ({ ...s, [t.id]: { ...s[t.id], body: e.target.value } }))}
                />
                <p className="mt-1 text-xs text-subtle">Edite antes de enviar. Vale tanto para o envio pela instância quanto para o link &ldquo;↗&rdquo;.</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-brand py-1.5 text-xs" disabled={pending} onClick={() => sendWa(t.id, editing[t.id].body)}>
                    {pending ? "Enviando..." : "Enviar editado"}
                  </button>
                  <button className="btn-ghost py-1.5 text-xs" onClick={() => setEditing((s) => { const n = { ...s }; delete n[t.id]; return n; })}>Cancelar</button>
                </div>
              </div>
            )}
            {editing[t.id] && t.channel === "call" && (
              <div className="mt-3 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                <p className="label">Roteiro da ligação</p>
                <div className="mt-1 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{content || "Sem roteiro definido para este passo."}</div>
              </div>
            )}

            {/* contexto inline: última atividade do contato */}
            {la && (
              <p className="mt-2 truncate border-t border-line pt-2 text-xs text-subtle">
                <span className={la.type === "replied" || la.type === "doc_opened" ? "font-semibold text-signal" : ""}>
                  {EVENT_LABEL[la.type] || la.type}
                </span>
                {la.text ? <span className="text-ink/70"> — {la.text}</span> : null}
                <span className="text-subtle"> · {rel(la.created_at)} atrás</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
