"use client";

// ============================================================
// "Cancelar e remarcar" — o caso de quando o convidado avisa que não pode.
//
// Por que não é só um botão: cancelar mexe na agenda de OUTRA pessoa. Então a tela
// deixa explícito o que vai acontecer (o evento sai da agenda dela, e ela recebe o
// link para escolher outro horário), permite escrever um motivo que entra no e-mail,
// e deixa desligar o envio para o caso de você já ter avisado por WhatsApp.
// ============================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarEremarcar } from "@/app/dashboard/reunioes/actions";

export default function MeetingReschedule({ id, temAgendaPublica }: { id: string; temAgendaPublica: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviarEmail, setEnviarEmail] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!aberto) {
    return (
      <button
        className="rounded-lg border border-warn/40 px-2 py-1 text-xs text-warn hover:bg-warn/10"
        onClick={() => { setAberto(true); setMsg(null); setErro(null); }}
      >
        Cancelar e remarcar
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-warn/30 bg-warn/5 p-3">
      <p className="text-sm font-semibold text-ink">Cancelar e oferecer nova data</p>
      <ul className="mt-1 list-disc pl-4 text-xs text-subtle">
        <li>O compromisso <b>sai da agenda do convidado</b> automaticamente (e do seu Google, se conectado).</li>
        <li>
          {temAgendaPublica
            ? "O e-mail leva o link da sua agenda pública para ele escolher o novo horário sozinho."
            : "Sua agenda pública está desligada, então o e-mail pede que ele responda com horários. Para mandar o link, ligue em Config → Link público de agendamento."}
        </li>
        <li>A reunião fica no histórico como <b>remarcada</b> — não é apagada.</li>
      </ul>

      <label className="label mt-3 block">Motivo (opcional, vai no e-mail)</label>
      <input
        className="input mt-1 w-full text-sm"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: imprevisto na agenda, precisei liberar o horário"
      />

      <label className="mt-2 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enviarEmail} onChange={(e) => setEnviarEmail(e.target.checked)} />
        Enviar o e-mail de cancelamento agora
        <span className="text-subtle">(desmarque se você já avisou por WhatsApp)</span>
      </label>

      {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
      {msg && <p className="mt-2 text-xs text-signal">{msg}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          disabled={pending}
          onClick={() => {
            setErro(null); setMsg(null);
            start(async () => {
              const r = (await cancelarEremarcar(id, { motivo, enviarEmail })) as any;
              if (r?.error) { setErro(r.error); return; }
              setMsg(
                (r?.emailEnviado ? "✓ Convidado avisado e horário liberado." : "✓ Reunião marcada como remarcada.") +
                (r?.aviso ? ` ${r.aviso}` : "")
              );
              router.refresh();
            });
          }}
        >
          {pending ? "Cancelando…" : "Confirmar cancelamento"}
        </button>
        <button className="text-xs text-subtle underline" disabled={pending} onClick={() => setAberto(false)}>
          voltar
        </button>
      </div>
    </div>
  );
}
