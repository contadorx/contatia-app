"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { replyWhatsApp, markThreadRead } from "@/app/dashboard/respostas/actions";
import { waLink } from "@/lib/cadence";

export type Thread = {
  key: string;
  contactId: string | null;
  name: string;
  phone: string;
  messages: { id: string; direction: string; text: string; created_at: string; read: boolean }[];
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
  return p + (last.text || "").slice(0, 60);
}

export default function RespostasInbox({ threads, canReply }: { threads: Thread[]; canReply: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(threads[0]?.key ?? null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const active = threads.find((t) => t.key === sel) || null;

  // ao abrir uma conversa com não-lidas, marca como lida
  useEffect(() => {
    if (active && active.unread > 0) {
      markThreadRead({ contactId: active.contactId, phone: active.phone }).then(() => router.refresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  if (!threads.length) {
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nenhuma resposta ainda. Quando um lead responder no WhatsApp, a conversa aparece aqui — e a cadência dele pausa sozinha.
      </div>
    );
  }

  function send() {
    if (!active || !text.trim()) return;
    setErr(null);
    start(async () => {
      const res = (await replyWhatsApp({ contactId: active.contactId, phone: active.phone, text })) as { ok?: boolean; error?: string };
      if (res?.error) setErr(res.error);
      else {
        setText("");
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* lista de conversas */}
      <div className="card divide-y divide-line overflow-hidden">
        {threads.map((t) => (
          <button
            key={t.key}
            onClick={() => setSel(t.key)}
            className={`flex w-full items-start gap-2 p-3 text-left transition ${sel === t.key ? "bg-brand-soft/50" : "hover:bg-muted"}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">{t.name}</p>
                {t.unread > 0 && <span className="rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-bold text-white">{t.unread}</span>}
              </div>
              <p className="truncate text-xs text-subtle">{snippet(t)}</p>
            </div>
            <span className="shrink-0 text-[10px] text-subtle">{fmt(t.lastAt).split(" ")[0]}</span>
          </button>
        ))}
      </div>

      {/* conversa */}
      {active ? (
        <div className="card flex min-h-[420px] flex-col p-0">
          <div className="flex items-center justify-between border-b border-line p-4">
            <div>
              <p className="font-display font-bold">{active.name}</p>
              <p className="text-xs text-subtle">{active.phone || "—"}</p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {active.contactId && (
                <Link href={`/dashboard/contatos/${active.contactId}`} className="text-brand-dark hover:underline">
                  Ver contato →
                </Link>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {active.messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.direction === "out" ? "bg-brand text-white" : "bg-muted text-ink"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text || <span className="opacity-60">(mídia/sem texto)</span>}</p>
                  <p className={`mt-1 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-subtle"}`}>{fmt(m.created_at)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* resposta */}
          <div className="border-t border-line p-3">
            {canReply ? (
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
                <p className="text-xs text-subtle">
                  Você está no modo assistido — responda pelo seu próprio WhatsApp.
                </p>
                {waLink(active.phone, "") && (
                  <a className="btn-brand py-1.5 text-sm" href={waLink(active.phone, "")} target="_blank" rel="noreferrer">
                    Abrir WhatsApp
                  </a>
                )}
              </div>
            )}
            {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          </div>
        </div>
      ) : (
        <div className="card flex min-h-[420px] items-center justify-center text-sm text-subtle">
          Selecione uma conversa.
        </div>
      )}
    </div>
  );
}
