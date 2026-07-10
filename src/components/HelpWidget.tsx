"use client";

import { useState, useTransition, useEffect } from "react";
import { searchKb } from "@/app/dashboard/help-actions";
import { openTicket } from "@/app/dashboard/suporte/actions";

type Article = { id: string; title: string; category: string; body: string };

export function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"kb" | "ticket">("kb");

  return (
    <>
      <button
        onClick={() => { setOpen(true); setMode("kb"); }}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg hover:bg-brand-dark"
        aria-label="Ajuda"
        title="Ajuda"
      >
        <span className="text-xl font-bold">?</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/30" />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{mode === "kb" ? "Como podemos ajudar?" : "Abrir chamado"}</h2>
              <button className="text-subtle hover:text-ink" onClick={() => setOpen(false)}>✕</button>
            </div>

            {mode === "kb" ? (
              <KbSearch onOpenTicket={() => setMode("ticket")} />
            ) : (
              <TicketForm onDone={() => setOpen(false)} onBack={() => setMode("kb")} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function KbSearch({ onOpenTicket }: { onOpenTicket: () => void }) {
  const [q, setQ] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => {
      start(async () => {
        const r = (await searchKb(q)) as any;
        if (r?.articles) setArticles(r.articles);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <input className="input mt-3" autoFocus placeholder="Buscar na ajuda (ex.: como conectar e-mail)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {pending && !articles.length && <p className="text-xs text-subtle">Buscando...</p>}
        {!pending && !articles.length && <p className="py-4 text-center text-sm text-subtle">Nenhum artigo encontrado. Que tal abrir um chamado?</p>}
        {articles.map((a) => (
          <div key={a.id} className="rounded-lg border border-line">
            <button className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => setOpenId(openId === a.id ? null : a.id)}>
              <span className="text-sm font-medium">{a.title}</span>
              <span className="text-xs text-subtle">{openId === a.id ? "−" : "+"}</span>
            </button>
            {openId === a.id && <div className="whitespace-pre-wrap border-t border-line px-3 py-2 text-sm text-subtle">{a.body}</div>}
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-xs text-subtle">Não encontrou o que precisava?</p>
        <button className="btn-brand mt-2 w-full py-1.5 text-sm" onClick={onOpenTicket}>Abrir um chamado</button>
      </div>
    </div>
  );
}

function TicketForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-3">
      <button className="text-xs text-brand-dark hover:underline" onClick={onBack}>← voltar para a ajuda</button>
      <input className="input mt-3" placeholder="Assunto" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input mt-2 min-h-[110px]" placeholder="Descreva o que está acontecendo" value={body} onChange={(e) => setBody(e.target.value)} />
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <button className="btn-brand mt-3 w-full py-1.5 text-sm" disabled={pending} onClick={() => {
        setMsg(null);
        if (!subject.trim() || !body.trim()) { setMsg("Preencha assunto e descrição."); return; }
        start(async () => {
          const r = (await openTicket({ subject, body })) as any;
          if (r?.error) setMsg(r.error);
          else { setMsg("✓ Chamado aberto! Responderemos em breve."); setTimeout(onDone, 1200); }
        });
      }}>{pending ? "Enviando..." : "Enviar chamado"}</button>
    </div>
  );
}
