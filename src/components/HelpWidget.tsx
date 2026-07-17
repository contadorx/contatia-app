"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { supportChat, supportGreeting } from "@/app/dashboard/suporte/ai-actions";
import { TicketComposer } from "@/components/SupportTools";

type Msg = { role: "user" | "assistant"; content: string };

// Widget de ajuda: chat com a IA de SUPORTE (1ª camada). Quando a IA não resolve,
// ela encaminha para o time (abre chamado por trás) e avisa que retornaremos.
// O botão "abrir um chamado" continua disponível para quem preferir o caminho manual.
export function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"chat" | "ticket">("chat");

  return (
    <>
      <button
        onClick={() => { setOpen(true); setMode("chat"); }}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg hover:bg-brand-dark"
        aria-label="Ajuda"
        title="Ajuda"
      >
        <span className="text-xl font-bold">?</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/30" />
          <div className="relative flex h-[560px] max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-display text-base font-bold">{mode === "chat" ? "Ajuda do Contatia" : "Abrir chamado"}</h2>
              <button className="text-subtle hover:text-ink" onClick={() => setOpen(false)}>✕</button>
            </div>
            {mode === "chat" ? (
              <SupportChat onOpenTicket={() => setMode("ticket")} />
            ) : (
              <div className="p-5">
                <TicketComposer onDone={() => setOpen(false)} onBack={() => setMode("chat")} autoFocus />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SupportChat({ onOpenTicket }: { onOpenTicket: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [convId, setConvId] = useState<string | undefined>();
  const [escalated, setEscalated] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supportGreeting().then((g) => {
      if (!g.enabled) { setDisabled(true); return; }
      setMsgs([{ role: "assistant", content: g.greeting }]);
    });
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, pending]);

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    start(async () => {
      const r = (await supportChat({ conversationId: convId, message: text })) as any;
      if (r?.error) { setMsgs((m) => [...m, { role: "assistant", content: r.error }]); return; }
      if (r?.conversationId) setConvId(r.conversationId);
      if (r?.reply) setMsgs((m) => [...m, { role: "assistant", content: r.reply }]);
      if (r?.escalated) setEscalated(true);
    });
  }

  if (disabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-subtle">O atendimento por IA está indisponível no momento.</p>
        <button className="btn-brand py-1.5 text-sm" onClick={onOpenTicket}>Abrir um chamado</button>
      </div>
    );
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.role === "user" ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm bg-muted text-ink"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {pending && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-subtle">digitando…</div></div>}
        {escalated && (
          <div className="rounded-xl border border-signal/30 bg-signal/5 p-3 text-xs text-ink">
            ✓ Encaminhei para o time. Retornamos pelo seu e-mail. Se preferir, você também pode <button className="font-semibold text-brand hover:underline" onClick={onOpenTicket}>abrir um chamado</button>.
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="input max-h-28 min-h-[42px] flex-1 resize-none text-sm"
            placeholder="Escreva sua dúvida…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn-brand h-[42px] px-4 text-sm" onClick={send} disabled={pending || !input.trim()}>Enviar</button>
        </div>
        <button className="mt-2 text-[11px] text-subtle hover:text-ink" onClick={onOpenTicket}>prefiro abrir um chamado</button>
      </div>
    </>
  );
}
