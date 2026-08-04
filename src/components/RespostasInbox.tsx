"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  replyWhatsApp,
  replyEmail,
  markThreadRead,
  createContactFromThread,
  createContactFromEmailThread,
  blockThread,
  deleteThread,
  deleteEmailThread,
  blockEmailThread,
  excluirConversas,
  marcarConversasLidas,
  arquivarConversas,
  desarquivarConversas,
  fetchMedia,
} from "@/app/dashboard/respostas/actions";
import { waLink } from "@/lib/cadence";
import RichTextEditor from "@/components/RichTextEditor";
import TriageDecisionBar from "@/components/TriageDecisionBar";
import NewOpportunityForContact from "@/components/NewOpportunityForContact";
import type { ReplyIntent } from "@/lib/replyIntent";
import { dataHora } from "@/lib/datas";

export type TriageItem = { id: string; intent: ReplyIntent };
export type Seq = { id: string; name: string };

export type Thread = {
  key: string;
  channel: "whatsapp" | "email";
  contactId: string | null;
  name: string;
  phone: string;
  email?: string;
  subject?: string;   // último assunto (para o "Re:" ao responder por e-mail)
  messages: { id: string; direction: string; text: string; mediaType: string | null; created_at: string; read: boolean }[];
  unread: number;
  lastAt: string;
};

function fmt(iso: string) {
  return dataHora(iso);
}
function snippet(t: Thread) {
  const last = t.messages[t.messages.length - 1];
  if (!last) return "";
  const p = last.direction === "out" ? "Você: " : "";
  const label = last.mediaType ? `[${MEDIA_LABEL[last.mediaType] || "mídia"}] ` : "";
  return p + label + (last.text || "").slice(0, 50);
}
const MEDIA_LABEL: Record<string, string> = { image: "imagem", audio: "áudio", video: "vídeo", document: "documento", sticker: "figurinha" };

export default function RespostasInbox({
  threads,
  canReply,
  triageByContact = {},
  sequences = [],
  verArquivadas = false,
}: {
  threads: Thread[];
  canReply: boolean;
  triageByContact?: Record<string, TriageItem>;
  sequences?: Seq[];
  verArquivadas?: boolean;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(threads[0]?.key ?? null);
  const [busca, setBusca] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"block" | "delete" | null>(null);
  const [pending, start] = useTransition();
  // ============================================================
  // SELEÇÃO MÚLTIPLA — o que estava errado
  //
  // 1) O gatilho era um texto cinza ("Selecionar conversas") sem cara de botão. Não
  //    parecia clicável, e num painel cheio de conversas passava por rótulo.
  // 2) A confirmação usava window.confirm(). O Chrome BLOQUEIA esse diálogo depois que
  //    a pessoa marca "impedir que esta página crie mais diálogos" — e aí confirm()
  //    devolve false na hora, para sempre. O clique em Excluir vira nada. Sem aviso.
  // 3) O erro (`err`) só era desenhado DENTRO do painel da conversa, do outro lado da
  //    tela — e nem isso quando nenhuma conversa estava aberta. Qualquer falha do
  //    servidor ficava invisível.
  //
  // Agora: botão de verdade, confirmação dentro da própria barra, e o resultado
  // (sucesso ou erro) aparece ali mesmo, com o número de mensagens afetadas.
  // ============================================================
  const [selMode, setSelMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmaLote, setConfirmaLote] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroLote, setErroLote] = useState<string | null>(null);

  const active = threads.find((t) => t.key === sel) || null;
  const visibleThreads = busca
    ? threads.filter((t) => `${t.name} ${t.phone} ${snippet(t)}`.toLowerCase().includes(busca.toLowerCase()))
    : threads;
  // Antes só WhatsApp entrava na seleção. Agora vale a conversa inteira, dos dois
  // canais — quem tem a caixa cheia de e-mail também precisa limpar.
  const selecionaveis = visibleThreads;

  function limparRecados() {
    setErr(null);
    setErroLote(null);
    setAviso(null);
    setConfirmaLote(false);
  }
  function toggleCheck(key: string) {
    setChecked((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
    limparRecados();
  }
  function toggleTodas() {
    setChecked((s) => (selecionaveis.length > 0 && selecionaveis.every((t) => s.has(t.key)) ? new Set() : new Set(selecionaveis.map((t) => t.key))));
    limparRecados();
  }
  // as conversas marcadas, no formato que o servidor entende (canal + quem é)
  function alvosSelecionados() {
    return threads
      .filter((t) => checked.has(t.key))
      .map((t) => ({ channel: t.channel, contactId: t.contactId, phone: t.phone, email: t.email }));
  }
  function sairSelecao() {
    setSelMode(false);
    setChecked(new Set());
    limparRecados();
  }
  // Executa a ação em lote e SEMPRE devolve um recado na própria barra: quantas
  // mensagens saíram, ou o motivo de não ter saído nenhuma.
  function agirEmLote(fn: (alvos: any[]) => Promise<any>, verbo: "excluídas" | "marcadas como lidas" | "arquivadas" | "devolvidas à caixa") {
    const alvos = alvosSelecionados();
    if (!alvos.length) return;
    const quantas = alvos.length;
    setErroLote(null);
    setAviso(null);
    start(async () => {
      let res: any;
      try {
        res = await fn(alvos);
      } catch (e: any) {
        setErroLote(e?.message || "Falha ao falar com o servidor. Recarregue a página e tente de novo.");
        return;
      }
      if (res?.error) { setErroLote(res.error); return; }
      const msgs = res?.mensagens ?? 0;
      setChecked(new Set());
      setConfirmaLote(false);
      setAviso(`${quantas} conversa${quantas === 1 ? "" : "s"} ${verbo} (${msgs} mensagem${msgs === 1 ? "" : "s"}).`);
      if (verbo === "excluídas") setSel(null);
      router.refresh();
    });
  }
  const contagemSelecionada = () => {
    const alvos = alvosSelecionados();
    const nWa = alvos.filter((a) => a.channel === "whatsapp").length;
    return { total: alvos.length, wa: nWa, em: alvos.length - nWa };
  };

  useEffect(() => {
    setConfirm(null);
    if (active && active.unread > 0) {
      markThreadRead({ contactId: active.contactId, phone: active.phone, email: active.email, channel: active.channel }).then(() => router.refresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  if (!threads.length) {
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nenhuma resposta ainda. Quando um lead responder — no WhatsApp ou por e-mail — a conversa aparece aqui, e a cadência dele pausa sozinha.
      </div>
    );
  }

  function act(fn: () => Promise<any>, after?: () => void) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErr(res.error);
      else { after?.(); router.refresh(); }
    });
  }
  function send() {
    if (!active || !text.trim()) return;
    if (active.channel === "email") {
      if (!active.contactId) { setErr("Cadastre o contato (botão acima) para responder por e-mail."); return; }
      const subj = active.subject ? `Re: ${active.subject.replace(/^re:\s*/i, "")}` : "Re:";
      act(() => replyEmail({ contactId: active.contactId as string, subject: subj, body: text }), () => setText(""));
    } else {
      act(() => replyWhatsApp({ contactId: active.contactId, phone: active.phone, text }), () => setText(""));
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* lista de conversas */}
      <div className="card overflow-hidden">
        <div className="border-b border-line p-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar conversa…"
            className="input py-1.5 text-sm"
          />
          {/* ---- barra de seleção múltipla (WhatsApp + e-mail) ---- */}
          <div className="mt-2 px-1 text-xs">
            {!selMode ? (
              // Botão de verdade, com borda: o texto cinza de antes não parecia clicável.
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-line bg-white px-2 py-1.5 font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-40"
                  onClick={() => { setSelMode(true); limparRecados(); }}
                  disabled={!selecionaveis.length}
                >
                  ☑ Selecionar conversas
                </button>
                <Link
                  href={verArquivadas ? "/dashboard/respostas" : "/dashboard/respostas?arquivadas=1"}
                  className={`shrink-0 rounded-lg border px-2 py-1.5 font-medium ${
                    verArquivadas ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-subtle hover:bg-muted"
                  }`}
                >
                  {verArquivadas ? "← caixa" : "arquivadas"}
                </Link>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-brand/30 bg-brand-soft/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={selecionaveis.length > 0 && selecionaveis.every((t) => checked.has(t.key))}
                      onChange={toggleTodas}
                    />
                    {checked.size > 0 ? `${checked.size} selecionada(s)` : `Selecionar todas (${selecionaveis.length})`}
                  </label>
                  <button type="button" className="text-subtle underline hover:text-ink" onClick={sairSelecao}>
                    Sair da seleção
                  </button>
                </div>

                {checked.size === 0 ? (
                  <p className="text-[11px] text-subtle">
                    Clique nas conversas da lista para marcar. Depois escolha a ação.
                  </p>
                ) : !confirmaLote ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-line bg-white px-2 py-1 font-medium hover:bg-muted disabled:opacity-40"
                      disabled={pending}
                      onClick={() => agirEmLote((a) => marcarConversasLidas(a), "marcadas como lidas")}
                      title="Zera o não-lido dessas conversas sem abrir uma por uma."
                    >
                      {pending ? "…" : "Marcar como lida"}
                    </button>
                    {/* ARQUIVAR: o meio-termo. Tira da caixa sem apagar histórico —
                        antes só existia excluir, que é definitivo. */}
                    <button
                      type="button"
                      className="rounded-lg border border-line bg-white px-2 py-1 font-medium hover:bg-muted disabled:opacity-40"
                      disabled={pending}
                      onClick={() =>
                        verArquivadas
                          ? agirEmLote((a) => desarquivarConversas(a), "devolvidas à caixa")
                          : agirEmLote((a) => arquivarConversas(a), "arquivadas")
                      }
                      title={verArquivadas ? "Devolve as conversas para a caixa." : "Tira da caixa sem apagar nada. Reversível em “ver arquivadas”."}
                    >
                      {pending ? "…" : verArquivadas ? "Desarquivar" : "Arquivar"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-danger px-2 py-1 font-bold text-white disabled:opacity-40"
                      disabled={pending}
                      onClick={() => { setConfirmaLote(true); setAviso(null); setErroLote(null); }}
                    >
                      Excluir
                    </button>
                  </div>
                ) : (
                  // Confirmação DENTRO da tela. window.confirm() é bloqueável pelo
                  // navegador — e quando é bloqueado, o clique simplesmente não faz nada.
                  <div className="rounded-lg border border-danger/40 bg-danger/5 p-2">
                    {(() => {
                      const c = contagemSelecionada();
                      const det = [c.wa ? `${c.wa} de WhatsApp` : "", c.em ? `${c.em} de e-mail` : ""].filter(Boolean).join(" e ");
                      return (
                        <p className="text-[11px] text-danger">
                          Excluir <b>{c.total} conversa{c.total === 1 ? "" : "s"}</b> ({det})? As mensagens saem da
                          caixa. Os <b>contatos não são apagados</b> — só o histórico da conversa. Não dá para desfazer.
                        </p>
                      );
                    })()}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-danger px-2 py-1 font-bold text-white disabled:opacity-40"
                        disabled={pending}
                        onClick={() => agirEmLote((a) => excluirConversas(a), "excluídas")}
                      >
                        {pending ? "Excluindo…" : "Confirmar exclusão"}
                      </button>
                      <button type="button" className="text-subtle underline hover:text-ink" onClick={() => setConfirmaLote(false)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* o resultado aparece AQUI — antes só existia no painel da conversa,
                    do outro lado da tela, e sumia junto com ela. */}
                {aviso && <p className="rounded-lg bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand-dark">{aviso}</p>}
                {erroLote && <p className="rounded-lg bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger">{erroLote}</p>}
              </div>
            )}
          </div>
        </div>
        <div className="divide-y divide-line">
        {visibleThreads.length === 0 && (
          <p className="p-4 text-sm text-subtle">Nenhuma conversa para “{busca}”.</p>
        )}
        {visibleThreads.map((t) => {
          const selectable = selMode;
          const isChecked = checked.has(t.key);
          return (
          <button
            key={t.key}
            type="button"
            onClick={() => (selectable ? toggleCheck(t.key) : setSel(t.key))}
            className={`flex w-full items-start gap-2 p-3 text-left transition ${
              selectable && isChecked ? "bg-brand-soft/60" : sel === t.key && !selMode ? "bg-brand-soft/50" : "hover:bg-muted"
            }`}
          >
            {selectable && (
              <input type="checkbox" checked={isChecked} readOnly className="mt-0.5 shrink-0" aria-label={`Selecionar ${t.name}`} />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${t.channel === "email" ? "bg-brand-soft text-brand-dark" : "bg-signal/15 text-signal"}`}>
                  {t.channel === "email" ? "@" : "WA"}
                </span>
                <p className="truncate text-sm font-semibold">{t.name}</p>
                {t.unread > 0 && <span className="rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-bold text-white">{t.unread}</span>}
                {t.contactId && triageByContact[t.contactId] && (
                  <span className="shrink-0 rounded-full bg-warn px-1.5 py-0.5 text-[9px] font-bold uppercase text-white" title="aguardando decisão">decidir</span>
                )}
              </div>
              <p className="truncate text-xs text-subtle">{snippet(t)}</p>
            </div>
            <span className="shrink-0 text-[10px] text-subtle">{fmt(t.lastAt).split(" ")[0]}</span>
          </button>
          );
        })}
        </div>
      </div>

      {/* conversa */}
      {active ? (
        <div className="card flex min-h-[420px] flex-col p-0">
          {/* cabeçalho com gestão */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-display font-bold">
                <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${active.channel === "email" ? "bg-brand-soft text-brand-dark" : "bg-signal/15 text-signal"}`}>{active.channel === "email" ? "E-MAIL" : "WHATSAPP"}</span>
                {active.name}
              </p>
              <p className="text-xs text-subtle">{active.channel === "email" ? (active.email || "—") : (active.phone || "—")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {active.contactId ? (
                <>
                  <Link href={`/dashboard/contatos/${active.contactId}`} className="rounded-lg border border-line px-2 py-1 text-brand-dark hover:bg-muted">
                    Ver contato
                  </Link>
                  {/* Quem acabou de responder é o melhor candidato a virar negócio —
                      e este era o único lugar da jornada onde não dava para abrir um. */}
                  <NewOpportunityForContact
                    contactId={active.contactId}
                    defaultTitle={`Oportunidade — ${active.name}`}
                    compacto
                  />
                </>
              ) : active.channel === "whatsapp" ? (
                <button
                  className="rounded-lg border border-brand/40 px-2 py-1 font-semibold text-brand-dark hover:bg-brand-soft"
                  disabled={pending}
                  onClick={() => act(() => createContactFromThread({ phone: active.phone, name: active.name === active.phone ? "" : active.name }))}
                >
                  + Cadastrar contato
                </button>
              ) : (
                <button
                  className="rounded-lg border border-brand/40 px-2 py-1 font-semibold text-brand-dark hover:bg-brand-soft"
                  disabled={pending}
                  onClick={() => act(() => createContactFromEmailThread({ email: active.email || "", name: active.name === active.email ? "" : active.name }))}
                >
                  + Cadastrar contato para responder
                </button>
              )}
              {/* Bloquear/Excluir valem para os DOIS canais. Antes existiam só no
                  WhatsApp ("por número"), e a conversa de e-mail não tinha gestão
                  nenhuma: não dava para tirar da caixa nem para parar de receber. */}
              <button className="rounded-lg border border-line px-2 py-1 text-subtle hover:text-warn" disabled={pending} onClick={() => setConfirm(confirm === "block" ? null : "block")}>
                Bloquear
              </button>
              <button className="rounded-lg border border-line px-2 py-1 text-subtle hover:text-danger" disabled={pending} onClick={() => setConfirm(confirm === "delete" ? null : "delete")}>
                Excluir
              </button>
            </div>
          </div>

          {/* confirmação de bloquear/excluir */}
          {confirm && (
            <div className={`border-b border-line p-3 text-sm ${confirm === "delete" ? "bg-danger/5" : "bg-warn/5"}`}>
              <p className={confirm === "delete" ? "text-danger" : "text-warn"}>
                {confirm === "block"
                  ? active.channel === "email"
                    ? "Bloquear este endereço? Ele entra na lista de supressão — nenhum e-mail seu sai mais para ele, em cadência nenhuma — e o contato (se houver) vira opt-out."
                    : "Bloquear este número? Ele para de aparecer aqui, novas mensagens são ignoradas e o contato (se houver) vira opt-out."
                  : active.channel === "email"
                    ? "Excluir esta conversa? As mensagens deste endereço são apagadas da caixa. O CONTATO não é apagado — só o histórico."
                    : "Excluir esta conversa? As mensagens deste número são apagadas da caixa."}
              </p>
              <div className="mt-2 flex gap-2">
                {confirm === "block" ? (
                  <button className="rounded-lg bg-warn px-3 py-1 text-xs font-bold text-white" disabled={pending}
                    onClick={() => act(
                      () => active.channel === "email"
                        ? blockEmailThread({ email: active.email, contactId: active.contactId })
                        : blockThread({ phone: active.phone, contactId: active.contactId }),
                      () => setSel(null))}>
                    Bloquear
                  </button>
                ) : (
                  <button className="rounded-lg bg-danger px-3 py-1 text-xs font-bold text-white" disabled={pending}
                    onClick={() => act(
                      () => active.channel === "email"
                        ? deleteEmailThread({ email: active.email, contactId: active.contactId })
                        : deleteThread({ phone: active.phone, contactId: active.contactId }),
                      () => setSel(null))}>
                    Excluir
                  </button>
                )}
                <button className="btn-ghost py-1 text-xs" onClick={() => setConfirm(null)}>Cancelar</button>
              </div>
            </div>
          )}

          {/* barra de decisão da triagem — só quando este contato tem resposta pendente */}
          {active.contactId && triageByContact[active.contactId] && (
            <TriageDecisionBar item={triageByContact[active.contactId]} sequences={sequences} name={active.name} />
          )}

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {active.messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-brand text-white" : "bg-muted text-ink"}`}>
                  {m.mediaType && <MediaBlock messageId={m.id} type={m.mediaType} out={m.direction === "out"} />}
                  {m.text ? (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  ) : (
                    !m.mediaType && <span className="opacity-60">(sem texto)</span>
                  )}
                  <p className={`mt-1 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-subtle"}`}>{fmt(m.created_at)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* resposta */}
          <div className="border-t border-line p-3">
            {active.channel === "email" ? (
              // e-mail: responder daqui sempre (usa a sua caixa; não depende do modo WhatsApp)
              <>
                {active.subject && <p className="mb-1 text-[11px] text-subtle">Assunto: <b>Re: {active.subject.replace(/^re:\s*/i, "")}</b></p>}
                <RichTextEditor
                  value={text}
                  onChange={setText}
                  minHeight={90}
                  placeholder={active.contactId ? "Escreva sua resposta por e-mail…" : "Cadastre o contato (botão acima) para responder…"}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-subtle">Sai pela sua caixa (rotação/assinatura) e fica registrado aqui.</p>
                  <button className="btn-brand shrink-0 py-1.5 text-sm" disabled={pending || !text.trim() || !active.contactId} onClick={send}>
                    {pending ? "…" : "Enviar"}
                  </button>
                </div>
              </>
            ) : canReply ? (
              <>
                <div className="flex items-end gap-2">
                  <textarea
                    className="input min-h-[44px] flex-1 text-sm"
                    placeholder="Escreva sua resposta…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                  />
                  <button className="btn-brand py-2 text-sm" disabled={pending || !text.trim()} onClick={send}>
                    {pending ? "…" : "Enviar"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-subtle">Ctrl/⌘+Enter envia. A resposta sai pela instância conectada.</p>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-subtle">Você está no modo assistido — responda pelo seu próprio WhatsApp.</p>
                {waLink(active.phone, "") && (
                  <a className="btn-brand py-1.5 text-sm" href={waLink(active.phone, "")} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
                )}
              </div>
            )}
            {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          </div>
        </div>
      ) : (
        <div className="card flex min-h-[420px] items-center justify-center text-sm text-subtle">Selecione uma conversa.</div>
      )}
    </div>
  );
}

// Mídia buscada sob demanda (não fica armazenada no app).
function MediaBlock({ messageId, type, out }: { messageId: string; type: string; out: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    setErr(null);
    start(async () => {
      const res = (await fetchMedia(messageId)) as { dataUrl?: string; error?: string };
      if (res?.error) setErr(res.error);
      else if (res?.dataUrl) setUrl(res.dataUrl);
    });
  }

  if (url) {
    if (type === "image" || type === "sticker") return <img src={url} alt="mídia" className="mb-1 max-h-64 rounded-lg" />;
    if (type === "audio") return <audio controls src={url} className="mb-1 w-56" />;
    if (type === "video") return <video controls src={url} className="mb-1 max-h-64 rounded-lg" />;
    return <a href={url} download className={`mb-1 block underline ${out ? "text-white" : "text-brand-dark"}`}>Baixar documento</a>;
  }

  return (
    <div className="mb-1">
      <button
        className={`rounded-lg border px-2 py-1 text-xs ${out ? "border-white/40 text-white" : "border-line text-subtle hover:text-ink"}`}
        disabled={pending}
        onClick={load}
      >
        {pending ? "Buscando…" : `Ver ${MEDIA_LABEL[type] || "mídia"}`}
      </button>
      {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
    </div>
  );
}
