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

  const doAtivo = meetingsPorDono[ativo] || [];
  const podeAgendar = ativo === meuId || podeAgendarEm.includes(ativo);
  const nomeAtivo = vendedores.find((v) => v.id === ativo)?.name || "";

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
        onAgendar={(iso) => {
          const quando = new Date(iso).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
          });
          // leva para o formulário de nova reunião com data/dono pré-preenchidos
          const q = new URLSearchParams({ datetime: iso, owner: ativo });
          if (confirm(`Marcar reunião em ${quando}${ativo !== meuId ? ` na agenda de ${nomeAtivo}` : ""}?`)) {
            window.location.href = `/dashboard/reunioes/nova?${q.toString()}`;
          }
        }}
      />
    </div>
  );
}
