"use client";

import { useState, useTransition } from "react";
import { sendQuickEmail, sendQuickWhatsApp } from "@/app/dashboard/contatos/quick-send-actions";
import RichTextEditor from "@/components/RichTextEditor";

// Envio AVULSO (fora de cadência) direto da ficha do contato — ex.: mandar uma proposta
// sem interromper/alterar a cadência ativa.
export default function QuickSend({ contactId, hasEmail, hasPhone }: { contactId: string; hasEmail: boolean; hasPhone: boolean }) {
  const [open, setOpen] = useState(false);
  const [canal, setCanal] = useState<"email" | "whatsapp">(hasEmail ? "email" : "whatsapp");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [pending, start] = useTransition();

  if (!hasEmail && !hasPhone) return null;

  function enviar() {
    setMsg(null);
    start(async () => {
      if (canal === "email") {
        const r = (await sendQuickEmail(contactId, subject, body)) as any;
        if (r?.error) setMsg({ t: "err", m: r.error });
        else { setMsg({ t: "ok", m: `E-mail enviado${r?.from ? ` de ${r.from}` : ""}.` }); setSubject(""); setBody(""); }
      } else {
        const r = (await sendQuickWhatsApp(contactId, body)) as any;
        if (r?.error) setMsg({ t: "err", m: r.error });
        else if (r?.assisted && r?.link) { window.open(r.link, "_blank"); setMsg({ t: "ok", m: "Abrindo o WhatsApp para você enviar…" }); setBody(""); }
        else { setMsg({ t: "ok", m: "WhatsApp enviado." }); setBody(""); }
      }
    });
  }

  if (!open) {
    return <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(true)}>✉ Enviar avulso</button>;
  }

  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-muted p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Enviar mensagem avulsa</p>
        <button className="text-xs text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
      </div>
      <p className="mt-0.5 text-xs text-subtle">Fora da cadência — não interrompe nem altera a cadência ativa deste contato.</p>

      {/* seletor de canal (só os disponíveis) */}
      <div className="mt-3 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {hasEmail && (
          <button className={`rounded-md px-3 py-1 text-xs font-semibold ${canal === "email" ? "bg-brand text-white" : "text-subtle"}`} onClick={() => setCanal("email")}>E-mail</button>
        )}
        {hasPhone && (
          <button className={`rounded-md px-3 py-1 text-xs font-semibold ${canal === "whatsapp" ? "bg-brand text-white" : "text-subtle"}`} onClick={() => setCanal("whatsapp")}>WhatsApp</button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {canal === "email" ? (
          <>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto (ex.: Sua proposta)" />
            <RichTextEditor value={body} onChange={setBody} minHeight={120} placeholder="Escreva o e-mail…" />
          </>
        ) : (
          <textarea className="input min-h-[110px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva a mensagem do WhatsApp…" />
        )}
      </div>

      {msg && <p className={`mt-2 text-sm ${msg.t === "ok" ? "text-signal" : "text-danger"}`}>{msg.m}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button className="btn-brand py-1.5 text-sm" disabled={pending || !body.trim() || (canal === "email" && !subject.trim())} onClick={enviar}>
          {pending ? "Enviando..." : canal === "email" ? "Enviar e-mail" : "Enviar WhatsApp"}
        </button>
        <span className="text-xs text-subtle">Usa a sua caixa (rotação/assinatura) e registra na timeline.</span>
      </div>
    </div>
  );
}
