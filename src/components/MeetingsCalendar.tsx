"use client";

import { useState } from "react";
import { CalendarView, type Meeting, type Vendedor } from "@/components/CalendarView";

// ============================================================
// Tela de reuniões: calendário do mês → clicar no dia mostra os horários.
// O SDR pode trocar de agenda entre os vendedores que lhe foram liberados
// (permissão dada pelo admin ou pelo próprio vendedor).
// ============================================================

export function MeetingsCalendar({
  meetingsPorDono,
  vendedores,
  meuId,
  podeAgendarEm,
  janela,
}: {
  meetingsPorDono: Record<string, Meeting[]>;
  vendedores: Vendedor[];
  meuId: string;
  podeAgendarEm: string[];        // ids das agendas em que posso marcar
  janela: { startHour: number; endHour: number; duration: number; days: number[] };
}) {
  const [ativo, setAtivo] = useState<string>(
    vendedores.find((v) => v.id === meuId)?.id || vendedores[0]?.id || meuId
  );
  const [pendingSlot, setPendingSlot] = useState<string | null>(null); // horário aguardando confirmação in-app

  const doAtivo = meetingsPorDono[ativo] || [];
  const podeAgendar = ativo === meuId || podeAgendarEm.includes(ativo);
  const nomeAtivo = vendedores.find((v) => v.id === ativo)?.name || "";

  const fmtQuando = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

  function confirmarAgendamento() {
    if (!pendingSlot) return;
    const q = new URLSearchParams({ datetime: pendingSlot, owner: ativo });
    window.location.href = `/dashboard/reunioes/nova?${q.toString()}`;
  }

  return (
    <div>
      {ativo !== meuId && (
        <p className="mb-3 rounded-lg bg-brand-soft p-3 text-sm text-brand-dark">
          Você está vendo a agenda de <b>{nomeAtivo}</b>.
          {podeAgendar ? " Você pode marcar reuniões nela." : " Somente leitura — peça permissão para marcar."}
        </p>
      )}

      <CalendarView
        meetings={doAtivo}
        vendedores={vendedores}
        vendedorAtivo={ativo}
        onTrocarVendedor={setAtivo}
        janela={janela}
        podeAgendar={podeAgendar}
        onAgendar={(iso) => setPendingSlot(iso)}
      />

      {/* confirmação in-app (substitui o confirm() nativo do navegador) */}
      {pendingSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setPendingSlot(null)}
        >
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-base font-bold">Marcar reunião?</p>
            <p className="mt-1 text-sm text-subtle">
              {fmtQuando(pendingSlot)}{ativo !== meuId ? ` — na agenda de ${nomeAtivo}` : ""}.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn-brand" onClick={confirmarAgendamento}>Sim, marcar</button>
              <button className="btn-ghost" onClick={() => setPendingSlot(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
