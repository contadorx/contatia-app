"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AssignSelect from "@/components/AssignSelect";
import EnrollButton from "@/components/EnrollButton";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { bulkAssign, bulkEnroll } from "@/app/dashboard/contatos/bulk-actions";
import { bulkTag, createTag } from "@/app/dashboard/contatos/tag-actions";
import { bulkDeleteContacts } from "@/app/dashboard/contatos/actions";
import { contarPorFiltro, excluirPorFiltro, exportarContatosPorFiltro } from "@/app/dashboard/contatos/filtro-actions";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";
import { capturarDoSiteLote } from "@/app/dashboard/contatos/web-capture-actions";
import { descobrirEmailsLote } from "@/app/dashboard/prospectar/actions";
import { UltimoToque } from "@/lib/lastTouch";
import ExportarCsv from "@/components/ExportarCsv";
import { useExclusaoLote } from "@/components/useExclusaoLote";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  origin: string | null;
  score: number | null;
  assigned_to: string | null;
  last_activity_at?: string | null;
  wa_status?: string | null;
  web_capture?: string | null;
  emailPendente?: boolean;
  contact_tags?: { tag_id: string; tags: { id: string; name: string; color: string } | null }[];
};

// Estágio da esteira do Radar, derivado dos campos existentes (sem query extra por linha).
// Ordem: raspando o site → descobrindo e-mail → verificando WhatsApp → pronto → sem canal.
function esteiraStage(c: Contact): { label: string; cls: string; pulse: boolean } | null {
  const naEsteira = c.web_capture != null || c.emailPendente || c.wa_status != null || c.origin?.startsWith("Radar");
  if (!naEsteira) return null; // contato manual, fora da esteira
  if (c.web_capture === "queued") return { label: "Site", cls: "bg-amber-100 text-amber-700", pulse: true };
  if (c.emailPendente) return { label: "E-mail", cls: "bg-amber-100 text-amber-700", pulse: true };
  if (c.wa_status === "queued") return { label: "WhatsApp", cls: "bg-amber-100 text-amber-700", pulse: true };
  if (c.email || c.wa_status === "valid") return { label: "Pronto", cls: "bg-emerald-100 text-emerald-700", pulse: false };
  return { label: "Sem canal", cls: "bg-gray-100 text-gray-500", pulse: false };
}
type Member = { id: string; full_name: string | null; email: string };
type Seq = { id: string; name: string };
type Tag = { id: string; name: string; color: string };

export default function ContactsTable({
  contacts,
  sequences,
  members,
  tags = [],
  products = {},
  filtro,
}: {
  contacts: Contact[];
  sequences: Seq[];
  members: Member[];
  tags?: Tag[];
  products?: Record<string, { id: string; name: string }[]>;
  // filtro ATUAL da tela — é ele que a exclusão em massa refaz no servidor
  filtro?: { q?: string; view?: string; tag?: string[]; produto?: string[]; cadencia?: string[]; frio?: string };
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [seq, setSeq] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // "todos do filtro": quando o operador quer agir sobre TUDO que bate com o filtro,
  // não só sobre as 200 linhas carregadas. Guarda o total conferido no servidor, que
  // é reconferido na hora de apagar.
  const [todosFiltro, setTodosFiltro] = useState<number | null>(null);
  // quem decide se o recorte é real é o SERVIDOR (filtroVazio) — ver contarPorFiltro
  const [semFiltroReal, setSemFiltroReal] = useState(false);
  const [contando, setContando] = useState(false);
  // exclusão em voltas, com progresso e botão de parar (ver useExclusaoLote)
  const { rodando: apagando, feitos, alvo: alvoExclusao, parar, rodar } = useExclusaoLote();

  // Mudou o filtro (navegação suave, o componente não remonta) → seleção e modo
  // "todos do filtro" ficariam pendurados de um recorte que não existe mais.
  const filtroChave = JSON.stringify(filtro || {});
  useEffect(() => {
    setSel(new Set());
    setTodosFiltro(null);
    setMsg(null);
  }, [filtroChave]);

  const allIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const allChecked = sel.size > 0 && sel.size === contacts.length;
  // A faixa "selecionar todos" aparece sempre que tudo o que está na tela está marcado.
  // Antes ela exigia a página cheia (200), e então sumia bem no fim de uma limpeza —
  // quando sobravam menos de 200 e ainda havia mais do que a tela mostra. `paginaCheia`
  // sobrou só para escolher a frase certa.
  const paginaCheia = contacts.length >= 200;
  const temFiltro = !!(
    filtro && (filtro.q || filtro.view || filtro.frio || filtro.tag?.length || filtro.produto?.length || filtro.cadencia?.length)
  );

  const seqOpts: SmartOption[] = sequences.map((s) => ({ value: s.id, label: s.name }));
  const assignOpts: SmartOption[] = [
    { value: "__none__", label: "Sem dono" },
    ...members.map((m) => ({ value: m.id, label: m.full_name || m.email })),
  ];
  const tagOpts: SmartOption[] = tags.map((t) => ({ value: t.id, label: t.name }));

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    // desmarcar UMA linha tem que desarmar o "todos do filtro": senão o botão continua
    // dizendo "Excluir os 22100" — inclusive o contato que a pessoa acabou de tirar —
    // e a faixa com o "voltar" some, porque ela só aparece com tudo marcado.
    setTodosFiltro(null);
    setMsg(null);
  }
  function toggleAll() {
    setSel((s) => (s.size === contacts.length ? new Set() : new Set(allIds)));
    setTodosFiltro(null);
    setMsg(null);
  }
  function clear() {
    setSel(new Set());
    setTodosFiltro(null);
    setMsg(null);
  }

  // Pergunta ao servidor quantos batem com o filtro (a tela só conhece 200).
  // Só roda no clique — contar a base inteira a cada carregamento foi, um dia, 44%
  // do tempo do banco.
  function selecionarTodosDoFiltro() {
    setMsg(null);
    setContando(true);
    start(async () => {
      // sem este try, uma exceção da server action vira rejeição não tratada e o Next
      // troca a página inteira pelo "Application error" — a tela some no meio da ação.
      try {
        const r = (await contarPorFiltro(filtro || {})) as { total?: number; semFiltro?: boolean; error?: string };
        if (r?.error) { setMsg(r.error); return; }
        setTodosFiltro(r.total ?? 0);
        setSemFiltroReal(!!r.semFiltro);
      } catch (e: any) {
        setMsg(`Não consegui contar: ${e?.message || "falha de conexão"}. Recarregue a página (Ctrl+Shift+R) e tente de novo.`);
      } finally {
        setContando(false);
      }
    });
  }

  // Exclusão de TUDO que bate com o filtro (o servidor refaz a consulta).
  // Vai em VOLTAS: o servidor devolve o que deu tempo de apagar em ~40s e quanto sobrou;
  // este laço chama de novo até zerar. Sem isso, uma base grande parava nos ~4.000 —
  // que é o que cabe nos 60 segundos da função.
  async function excluirTudoDoFiltro() {
    const n = todosFiltro ?? 0;
    if (!n || apagando) return;
    const recorta = !semFiltroReal;
    const alvoTxt = recorta ? `os ${n} contatos que batem com o filtro atual` : `TODOS os ${n} contatos da sua base`;
    if (!confirm(`Excluir ${alvoTxt}?\n\nIsso apaga junto as tarefas, matrículas em cadência e o histórico de cada um. Não tem como desfazer.`)) return;
    if (!recorta && !confirm(`Confirma de novo: nenhum filtro em vigor, então isso zera a sua base de contatos (${n}). Continuar?`)) return;

    setMsg(null);
    const r = await rodar(n, async (confirmar) => {
      const x = (await excluirPorFiltro(filtro || {}, { total: confirmar })) as
        { excluidos?: number; restam?: number; error?: string; aviso?: string };
      return { excluidos: x?.excluidos ?? 0, restam: x?.restam ?? 0, error: x?.error, aviso: x?.aviso };
    });

    setMsg(
      (r.erro ? `${r.total > 0 ? `✓ ${r.total} excluído(s) antes de parar. ` : ""}${r.erro}` :
        `✓ ${r.total} contato(s) excluído(s).` +
        (r.aviso ? ` ${r.aviso}` : "") +
        (r.parado ? ` Você interrompeu — ainda restam ${r.restam}.` :
          r.restam > 0 ? ` Ainda restam ${r.restam}; clique de novo para continuar.` : ""))
    );
    clear();
    router.refresh();
  }

  function doEnroll() {
    if (!seq) return setMsg("Escolha a cadência.");
    setMsg(null);
    start(async () => {
      try {
        const res = (await bulkEnroll([...sel], seq)) as
          { enrolled?: number; semDado?: number; jaInscrito?: number; suprimidos?: number;
            outros?: number; tarefas?: number; truncado?: boolean; error?: string } | undefined;

        // `res` PODE vir undefined: quando a função do servidor é morta por tempo, a
        // resposta que chega não é um payload de server action e o Next resolve vazio.
        // Antes isto explodia em `res.enrolled` e derrubava a tela inteira — foi o
        // "Cannot read properties of undefined (reading 'enrolled')".
        if (!res) {
          setMsg(
            "A inscrição não retornou resposta — normalmente é tempo esgotado no servidor. " +
            "Parte pode ter entrado: confira em Resultados → Registro ANTES de tentar de novo, " +
            "para não inscrever duas vezes."
          );
          router.refresh();
          return;
        }
        if (res.error) { setMsg(res.error); return; }

        const partes = [`✓ ${res.enrolled ?? 0} inscrito(s)`];
        if (res.tarefas) partes.push(`${res.tarefas} tarefa(s) criadas`);
        if (res.semDado) partes.push(`⚠ ${res.semDado} sem e-mail/telefone — complete o cadastro (visão “A completar”)`);
        if (res.jaInscrito) partes.push(`${res.jaInscrito} já em cadência`);
        if (res.suprimidos) partes.push(`${res.suprimidos} suprimidos (pediram para parar)`);
        if (res.truncado) partes.push("teto de 2.000 por vez — selecione o resto e repita");
        setMsg(partes.join(" · "));
        clear();
        setSeq("");
        router.refresh();
      } catch (e: any) {
        setMsg(
          `A inscrição foi interrompida (${e?.message || "falha de conexão"}). ` +
          `Parte pode ter entrado — confira em Resultados → Registro antes de repetir.`
        );
        router.refresh();
      }
    });
  }
  function doTag() {
    if (!tagIds.length) return setMsg("Escolha ao menos uma tag.");
    setMsg(null);
    start(async () => {
      const res = (await bulkTag([...sel], tagIds)) as { count?: number; tags?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setMsg(`✓ ${res.tags && res.tags > 1 ? `${res.tags} tags aplicadas` : "tag aplicada"} a ${res.count} contatos.`);
        clear();
        setTagIds([]);
      }
    });
  }
  function doVerifyWa() {
    setMsg(null);
    start(async () => {
      const res = (await verificarWhatsAppLote([...sel])) as { ok?: boolean; verificados?: number; comWa?: number; semWa?: number; enfileirados?: number; semTelefone?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        const partes = [`✓ ${res.comWa ?? 0} com WhatsApp`];
        if (res.semWa) partes.push(`${res.semWa} sem WhatsApp`);
        if (res.enfileirados) partes.push(`${res.enfileirados} na fila (verificação continua sozinha)`);
        if (res.semTelefone) partes.push(`${res.semTelefone} sem telefone`);
        setMsg(partes.join(" · "));
        clear();
        router.refresh();
      }
    });
  }
  function doCaptureWeb() {
    setMsg(null);
    start(async () => {
      const res = (await capturarDoSiteLote([...sel])) as { ok?: boolean; achou?: number; whats?: number; filaVerif?: number; enfileirados?: number; semDominio?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        const partes = [`✓ ${res.achou ?? 0} número(s) no site`];
        if (res.whats) partes.push(`${res.whats} já confirmados no WhatsApp`);
        if (res.filaVerif) partes.push(`${res.filaVerif} na fila de verificação`);
        if (res.enfileirados) partes.push(`${res.enfileirados} na fila (captura continua sozinha)`);
        if (res.semDominio) partes.push(`${res.semDominio} sem domínio`);
        setMsg(partes.join(" · "));
        clear();
        router.refresh();
      }
    });
  }
  // Descoberta de e-mail direto da lista. Antes só existia dentro do Prospectar — quem
  // chegava aqui por um filtro ("sem e-mail", "veio do Radar") tinha que sair da tela,
  // ir ao wizard e refazer a seleção.
  function doDescobrirEmail() {
    setMsg(null);
    start(async () => {
      try {
        const res = (await descobrirEmailsLote([...sel])) as
          { achou?: number; publicados?: number; semEmail?: number; restantes?: number; semDominio?: number; semWorker?: boolean; error?: string };
        if (res?.error) { setMsg(res.error); return; }
        if (res?.semWorker) { setMsg("O worker de e-mail (VPS) não respondeu. A descoberta continua pelo cron; tente de novo mais tarde."); return; }
        const partes = [`✓ ${(res.achou ?? 0) + (res.publicados ?? 0)} e-mail(is) encontrado(s)`];
        if (res.publicados) partes.push(`${res.publicados} publicados no site`);
        if (res.semEmail) partes.push(`${res.semEmail} sem caixa confirmada`);
        if (res.semDominio) partes.push(`${res.semDominio} sem domínio corporativo`);
        if (res.restantes) partes.push(`${res.restantes} na fila (o cron continua sozinho)`);
        setMsg(partes.join(" · "));
        clear();
        router.refresh();
      } catch (e: any) {
        setMsg(`Falhou: ${e?.message || "conexão"}. Se acabou de publicar, recarregue com Ctrl+Shift+R.`);
      }
    });
  }

  function doCreateTag() {
    if (!newTag.trim()) return;
    start(async () => {
      const res = (await createTag(newTag)) as { tag?: Tag; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setNewTag("");
        setShowNewTag(false);
        setMsg("✓ Tag criada.");
        router.refresh();
      }
    });
  }

  if (!contacts.length) {
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nenhum contato ainda. Adicione um ou importe seu CSV para começar.
      </div>
    );
  }

  return (
    <div>
      {/* Exportar sempre à mão — inclusive (e principalmente) ANTES de apagar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ExportarCsv
          nomeBase="contatos"
          rotulo={temFiltro ? "Exportar CSV (filtro atual)" : "Exportar CSV (todos)"}
          exportar={() => exportarContatosPorFiltro(filtro || {})}
        />
        <span className="text-xs text-subtle">
          As 5 primeiras colunas são as que o importador do Contatia espera — dá para reimportar sem editar.
        </span>
      </div>

      {/* Barra de ações em lote */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 shadow-sm backdrop-blur">
          {/* Progresso da exclusão em voltas — sem isto, apagar 78 mil parece travado */}
          {apagando && (
            <div className="mb-2 rounded-lg border border-red-200 bg-white/80 px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-red-700">
                  Excluindo… {feitos.toLocaleString("pt-BR")} de {alvoExclusao.toLocaleString("pt-BR")}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-red-100">
                  <div
                    className="h-full bg-red-500 transition-all"
                    style={{ width: `${alvoExclusao ? Math.min(100, (feitos / alvoExclusao) * 100) : 0}%` }}
                  />
                </div>
                <button className="text-xs font-medium text-subtle underline hover:text-ink" onClick={parar}>
                  parar
                </button>
              </div>
              <p className="mt-1 text-[11px] text-subtle">
                Vai em voltas de até 40 segundos e continua sozinho. Não feche a aba — o que já saiu está no registro.
              </p>
            </div>
          )}

          {/* A ponte entre "as 200 da tela" e "tudo que bate com o filtro" */}
          {allChecked && (
            <div className="mb-2 rounded-lg border border-brand/20 bg-white/70 px-3 py-2 text-sm">
              {todosFiltro === null ? (
                <>
                  <span className="text-subtle">
                    As <b>{contacts.length}</b> desta página estão marcadas
                    {paginaCheia ? " — a lista mostra só as primeiras." : "."}
                  </span>{" "}
                  <button
                    className="font-semibold text-brand-dark underline disabled:opacity-50"
                    onClick={selecionarTodosDoFiltro}
                    disabled={pending || contando || apagando}
                  >
                    {contando ? "contando…" : temFiltro ? "Selecionar todos que batem com o filtro" : "Selecionar todos os contatos"}
                  </button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-brand-dark">
                    {todosFiltro} contato(s) selecionado(s) — {semFiltroReal ? "a base inteira" : "todos os que batem com o filtro"}.
                  </span>{" "}
                  <button className="text-subtle underline disabled:opacity-50" onClick={() => setTodosFiltro(null)} disabled={pending || apagando}>
                    voltar para as {contacts.length} desta página
                  </button>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{sel.size} selecionado{sel.size > 1 ? "s" : ""}</span>

          <div className="flex items-center gap-1">
            <SmartSelect
              className="py-1.5 text-sm"
              options={seqOpts}
              value={seq}
              onValueChange={(v) => setSeq(v)}
              placeholder="Inscrever em cadência…"
              clearable
            />
            <button className="btn-brand py-1.5 text-sm" onClick={doEnroll} disabled={pending || apagando || !seq}>
              {pending ? "..." : "Inscrever"}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <SmartSelect
              className="py-1.5 text-sm"
              options={assignOpts}
              value={assignTo}
              onValueChange={(v) => setAssignTo(v)}
              placeholder="Atribuir a…"
              clearable
            />
            <button
              className="btn-ghost py-1.5 text-sm"
              onClick={() => start(async () => {
                setMsg(null);
                const res = (await bulkAssign([...sel], assignTo === "__none__" ? null : assignTo || null)) as { count?: number; error?: string };
                if (res?.error) setMsg(res.error);
                else { setMsg(`✓ ${res.count} atribuídos.`); clear(); setAssignTo(""); }
              })}
              disabled={pending || apagando || !assignTo}
            >
              Atribuir
            </button>
          </div>

          {tags.length > 0 && (
            <div className="flex items-center gap-1">
              <SmartSelect
                multiple
                className="py-1.5 text-sm"
                options={tagOpts}
                values={tagIds}
                onValuesChange={setTagIds}
                placeholder="Aplicar tags…"
              />
              <button className="btn-ghost py-1.5 text-sm" onClick={doTag} disabled={pending || apagando || !tagIds.length}>Aplicar</button>
            </div>
          )}

          <button
            className="rounded-lg border border-brand/40 bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-brand-soft/70"
            onClick={doCaptureWeb}
            disabled={pending || apagando}
            title="Lê o site da empresa e captura o telefone/WhatsApp publicado. Um link wa.me já entra como WhatsApp confirmado."
          >
            {pending ? "..." : "Capturar do site"}
          </button>

          <button
            className="rounded-lg border border-signal/40 bg-signal/5 px-3 py-1.5 text-sm font-medium text-signal hover:bg-signal/10"
            onClick={doVerifyWa}
            disabled={pending || apagando}
            title="Descobre quais números têm WhatsApp (checa com e sem o 9º dígito). Exige o modo Evolution."
          >
            {pending ? "..." : "Verificar WhatsApp"}
          </button>

          <button
            className="rounded-lg border border-brand/40 bg-brand-soft/60 px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-brand-soft"
            onClick={doDescobrirEmail}
            disabled={pending || apagando}
            title="Testa os padrões de e-mail (nome@domínio) no servidor do destinatário e só grava o que for confirmado. Precisa do contato SEM e-mail e COM domínio corporativo."
          >
            {pending ? "..." : "Descobrir e-mail"}
          </button>

          <button
            className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            onClick={() => {
              // com "todos do filtro" ligado, quem manda é o filtro — não a lista de ids
              if (todosFiltro !== null) { void excluirTudoDoFiltro(); return; }
              if (!confirm(`Excluir ${sel.size} contato(s)? Isso não pode ser desfeito.`)) return;
              start(async () => {
                setMsg(null);
                const res = (await bulkDeleteContacts([...sel])) as { count?: number; error?: string };
                if (res?.error) setMsg(res.error);
                else { setMsg(`✓ ${res.count} excluído(s).`); clear(); router.refresh(); }
              });
            }}
            disabled={pending || apagando}
          >
            {apagando ? "Excluindo…" : todosFiltro !== null ? `Excluir os ${todosFiltro}` : "Excluir"}
          </button>
          <ExportarCsv
            nomeBase="contatos"
            rotulo={todosFiltro !== null ? `Exportar os ${todosFiltro}` : `Exportar ${sel.size}`}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
            exportar={() =>
              todosFiltro !== null
                ? exportarContatosPorFiltro(filtro || {})
                : exportarContatosPorFiltro(filtro || {}, { ids: [...sel] })
            }
          />
          <button className="text-xs text-subtle hover:text-ink" onClick={clear}>
            limpar seleção
          </button>
          </div>

          {todosFiltro !== null && (
            <p className="mt-2 text-[11px] text-subtle">
              Inscrever, atribuir, aplicar tag, capturar do site e verificar WhatsApp continuam agindo sobre as{" "}
              <b>{sel.size}</b> desta página — essas ações trabalham contato a contato e não aguentam a base inteira de
              uma vez. Só a <b>exclusão</b> vale para os {todosFiltro}.
            </p>
          )}
        </div>
      )}
      {msg && <p className="mb-3 text-sm text-signal">{msg}</p>}

      {/* Criar tag — compacto, fora da faixa fixa */}
      <div className="mb-3">
        {!showNewTag ? (
          <button className="text-xs font-medium text-subtle hover:text-brand" onClick={() => setShowNewTag(true)}>
            ＋ Nova tag
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[220px] py-1.5 text-sm"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Nome da tag (ex.: Quente, Decisor, Follow-up)"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") doCreateTag(); }}
            />
            <button className="btn-brand py-1.5 text-sm" onClick={doCreateTag} disabled={pending || !newTag.trim()}>Criar</button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => { setShowNewTag(false); setNewTag(""); }}>cancelar</button>
          </div>
        )}
      </div>

      <div className="card overflow-visible">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-3 py-3">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Selecionar todos" />
              </th>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Contato</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium" title="Quanto o contato está engajado. Quente a partir de 25.">Score</th>
              <th className="px-4 py-3 font-medium" title="Última atividade com este contato.">Último toque</th>
              <th className="px-4 py-3 font-medium">Responsável</th>
              <th className="px-4 py-3 font-medium text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => {
              const checked = sel.has(c.id);
              return (
                <tr key={c.id} className={`border-b border-line last:border-0 hover:bg-muted ${checked ? "bg-brand-soft/40" : ""}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} aria-label={`Selecionar ${c.name}`} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/contatos/${c.id}`} className="text-brand-dark hover:underline">
                      {c.name}
                    </Link>
                    {(() => {
                      const st = esteiraStage(c);
                      if (!st) return null;
                      return (
                        <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`} title="Estágio na esteira do Radar">
                          {st.pulse && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                          {st.label}
                        </span>
                      );
                    })()}
                    {c.contact_tags && c.contact_tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.contact_tags.map((ct) =>
                          ct.tags ? (
                            <span key={ct.tag_id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${ct.tags.color}22`, color: ct.tags.color }}>
                              {ct.tags.name}
                            </span>
                          ) : null
                        )}
                      </div>
                    )}
                    {(products[c.id]?.length ?? 0) > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {products[c.id].map((p) => (
                          <span key={p.id} className="rounded-full border border-brand/25 bg-brand/5 px-1.5 py-0.5 text-[10px] font-medium text-brand-dark">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-subtle">{c.company || "—"}</td>
                  <td className="px-4 py-3 text-subtle">
                    {c.email ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {c.email}
                        {c.wa_status === "valid" && (
                          <span className="rounded-full bg-signal/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal">WhatsApp ✓</span>
                        )}
                      </span>
                    ) : c.phone ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {c.phone}
                        {c.wa_status === "valid" ? (
                          <span className="rounded-full bg-signal/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal">WhatsApp ✓</span>
                        ) : c.wa_status === "invalid" ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-subtle">sem WhatsApp</span>
                        ) : (
                          <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                            sem e-mail
                          </span>
                        )}
                      </span>
                    ) : (
                      <Link
                        href={`/dashboard/contatos/${c.id}`}
                        className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/20"
                        title="Sem e-mail nem telefone — clique para completar o cadastro. Sem um deles, o contato não entra em cadência."
                      >
                        sem contato — preencher
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.origin ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">{c.origin}</span> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-semibold ${(c.score ?? 0) >= 25 ? "text-warn" : "text-subtle"}`}>{c.score ?? 0}</span>
                  </td>
                  <td className="px-4 py-3">
                    <UltimoToque at={c.last_activity_at} />
                  </td>
                  <td className="px-4 py-3">
                    <AssignSelect contactId={c.id} current={c.assigned_to} members={members} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EnrollButton contactId={c.id} sequences={sequences} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">
        <b>Score</b> mede o engajamento do contato (aberturas, cliques, respostas). <span className="font-semibold text-warn">Quente</span> a partir de 25.
      </p>
    </div>
  );
}
