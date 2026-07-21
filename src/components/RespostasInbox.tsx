"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  replyWhatsApp,
  replyEmail,
  markThreadRead,
  createContactFromThread,
  blockThread,
  deleteThread,
  deleteThreadsBulk,
  fetchMedia,
} from "@/app/dashboard/respostas/actions";
import { waLink } from "@/lib/cadence";
import RichTextEditor from "@/components/RichTextEditor";
import TriageDecisionBar from "@/components/TriageDecisionBar";
import type { ReplyIntent } from "@/lib/replyIntent";

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
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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
}: {
  threads: Thread[];
  canReply: boolean;
  triageByContact?: Record<string, TriageItem>;
  sequences?: Seq[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(threads[0]?.key ?? null);
  const [busca, setBusca] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"block" | "delete" | null>(null);
  const [pending, start] = useTransition();
  // seleção múltipla (só WhatsApp — é o canal com exclusão)
  const [selMode, setSelMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const active = threads.find((t) => t.key === sel) || null;
  const visibleThreads = busca
    ? threads.filter((t) => `${t.name} ${t.phone} ${snippet(t)}`.toLowerCase().includes(busca.toLowerCase()))
    : threads;
  const visibleWa = visibleThreads.filter((t) => t.channel === "whatsapp");

  function toggleCheck(key: string) {
    setChecked((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
    setErr(null);
  }
  function toggleAllWa() {
    setChecked((s) => (visibleWa.every((t) => s.has(t.key)) ? new Set() : new Set(visibleWa.map((t) => t.key))));
    setErr(null);
  }
  function sairSelecao() {
    setSelMode(false);
    setChecked(new Set());
    setErr(null);
  }
  function excluirSelecionadas() {
    const alvos = threads.filter((t) => t.channel === "whatsapp" && checked.has(t.key)).map((t) => ({ phone: t.phone, contactId: t.contactId }));
    if (!alvos.length) return;
    if (!window.confirm(`Excluir ${alvos.length} conversa(s) de WhatsApp? As mensagens desses números são apagadas da caixa. Isso não pode ser desfeito.`)) return;
    act(() => deleteThreadsBulk(alvos), () => { sairSelecao(); setSel(null); });
  }

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
      if (!active.contactId) { setErr("Vincule o contato para responder por e-mail."); return; }
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
          {/* barra de seleção múltipla (WhatsApp) */}
          <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs">
            {!selMode ? (
              <button className="font-medium text-subtle hover:text-brand" onClick={() => setSelMode(true)} disabled={!visibleWa.length}>
                Selecionar conversas
              </button>
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-subtle">
                  <input
                    type="checkbox"
                    checked={visibleWa.length > 0 && visibleWa.every((t) => checked.has(t.key))}
                    onChange={toggleAllWa}
                  />
                  {checked.size > 0 ? `${checked.size} selecionada(s)` : "Selecionar todas (WhatsApp)"}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg bg-danger px-2 py-1 font-bold text-white disabled:opacity-40"
                    disabled={pending || checked.size === 0}
                    onClick={excluirSelecionadas}
                  >
                    Excluir
                  </button>
                  <button className="text-subtle hover:text-ink" onClick={sairSelecao}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="divide-y divide-line">
        {visibleThreads.length === 0 && (
          <p className="p-4 text-sm text-subtle">Nenhuma conversa para “{busca}”.</p>
        )}
        {visibleThreads.map((t) => {
          const selectable = selMode && t.channel === "whatsapp";
          const isChecked = checked.has(t.key);
          return (
          <button
            key={t.key}
            onClick={() => (selectable ? toggleCheck(t.key) : setSel(t.key))}
            className={`flex w-full items-start gap-2 p-3 text-left transition ${
              selectable && isChecked ? "bg-brand-soft/60" : sel === t.key && !selMode ? "bg-brand-soft/50" : "hover:bg-muted"
            } ${selMode && t.channel === "email" ? "opacity-50" : ""}`}
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
                <Link href={`/dashboard/contatos/${active.contactId}`} className="rounded-lg border border-line px-2 py-1 text-brand-dark hover:bg-muted">
                  Ver contato
                </Link>
              ) : active.channel === "whatsapp" ? (
                <button
                  className="rounded-lg border border-brand/40 px-2 py-1 font-semibold text-brand-dark hover:bg-brand-soft"
                  disabled={pending}
                  onClick={() => act(() => createContactFromThread({ phone: active.phone, name: active.name === active.phone ? "" : active.name }))}
                >
                  + Cadastrar contato
                </button>
              ) : null}
              {/* bloquear/excluir são do WhatsApp (por número) */}
              {active.channel === "whatsapp" && (
                <>
                  <button className="rounded-lg border border-line px-2 py-1 text-subtle hover:text-warn" disabled={pending} onClick={() => setConfirm(confirm === "block" ? null : "block")}>
                    Bloquear
                  </button>
                  <button className="rounded-lg border border-line px-2 py-1 text-subtle hover:text-danger" disabled={pending} onClick={() => setConfirm(confirm === "delete" ? null : "delete")}>
                    Excluir
                  </button>
                </>
              )}
            </div>
          </div>

          {/* confirmação de bloquear/excluir */}
          {confirm && (
            <div className={`border-b border-line p-3 text-sm ${confirm === "delete" ? "bg-danger/5" : "bg-warn/5"}`}>
              <p className={confirm === "delete" ? "text-danger" : "text-warn"}>
                {confirm === "block"
                  ? "Bloquear este número? Ele para de aparecer aqui, novas mensagens são ignoradas e o contato (se houver) vira opt-out."
                  : "Excluir esta conversa? As mensagens deste número são apagadas da caixa."}
              </p>
              <div className="mt-2 flex gap-2">
                {confirm === "block" ? (
                  <button className="rounded-lg bg-warn px-3 py-1 text-xs font-bold text-white" disabled={pending}
                    onClick={() => act(() => blockThread({ phone: active.phone, contactId: active.contactId }), () => setSel(null))}>
                    Bloquear
                  </button>
                ) : (
                  <button className="rounded-lg bg-danger px-3 py-1 text-xs font-bold text-white" disabled={pending}
                    onClick={() => act(() => deleteThread({ phone: active.phone, contactId: active.contactId }), () => setSel(null))}>
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
                  placeholder={active.contactId ? "Escreva sua resposta por e-mail…" : "Vincule o contato para responder…"}
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
