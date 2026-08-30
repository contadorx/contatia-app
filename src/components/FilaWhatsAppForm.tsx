"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dataHoraCompacta } from "@/lib/datas";
import { setFilaWhatsApp, setRitmoChip, liberarChip } from "@/app/dashboard/config/whatsapp-actions";

// ============================================================
// O PAINEL DA FILA AUTOMÁTICA DE WHATSAPP
//
// A tela tem uma obrigação além de funcionar: dizer a verdade sobre o que o botão faz.
// Ligar isto é a única função do app que fala com o cliente do cliente, sozinha, pelo
// canal que pode custar o número da empresa. Um toggle discreto com o rótulo "fila
// automática" seria uma armadilha.
// ============================================================

export type ChipRitmo = {
  id: string;
  instance: string;
  papel: string | null;
  aquecido: boolean | null;
  falhasSeguidas: number | null;
  pausadoEm: string | null;
  pausaMotivo: string | null;
  dailyCap: number | null;
};

const PAPEIS = [
  { v: "principal", r: "Principal", d: "A linha do negócio. É o número que você não pode perder." },
  { v: "conversa", r: "Conversa", d: "Responde quem já respondeu. Não abre conversa fria." },
  { v: "frio", r: "Frio", d: "Dedicado a primeiro toque. Descartável por natureza." },
];

export default function FilaWhatsAppForm({
  ligada,
  modoAutomatico,
  chips,
  pendentes,
  janelaLigada,
}: {
  ligada: boolean;
  modoAutomatico: boolean;
  chips: ChipRitmo[];
  pendentes: number;
  janelaLigada: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<any>) {
    setErro(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErro(res.error);
      else router.refresh();
    });
  }

  const soPrincipal = chips.length === 1 && (chips[0].papel || "principal") === "principal";
  const cap = chips.find((c) => c.aquecido)?.dailyCap ?? chips[0]?.dailyCap ?? 40;

  return (
    <div className="card p-5">
      {/* ---------- o que isto é, antes do botão ---------- */}
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
        <p className="text-sm font-semibold text-danger">
          Isto dispara WhatsApp sozinho, sem ninguém olhando.
        </p>
        <p className="mt-1 text-xs text-subtle">
          É a função de maior risco do sistema. O WhatsApp não avisa antes de bloquear um número: quando acontece,
          a conversa de todo mundo que estava falando com ele morre junto.
          {soPrincipal && (
            <>
              {" "}
              <b className="text-danger">
                Você tem um número só, e ele está marcado como principal — é a linha do negócio. Se cair, não há reserva.
              </b>
            </>
          )}
        </p>
      </div>

      {/* ---------- o ritmo real, em números ---------- */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-3">
          <p className="text-[11px] uppercase tracking-wide text-subtle">Intervalo entre envios</p>
          <p className="mt-0.5 text-sm font-semibold">4 a 14 min</p>
          <p className="mt-0.5 text-[11px] text-subtle">sorteado a cada vez</p>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <p className="text-[11px] uppercase tracking-wide text-subtle">Teto do dia</p>
          <p className="mt-0.5 text-sm font-semibold">{cap} mensagens</p>
          <p className="mt-0.5 text-[11px] text-subtle">dividido com o envio manual</p>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <p className="text-[11px] uppercase tracking-wide text-subtle">Na fila agora</p>
          <p className="mt-0.5 text-sm font-semibold">{pendentes} toques</p>
          <p className="mt-0.5 text-[11px] text-subtle">
            {pendentes > 0 ? `~${Math.ceil(pendentes / Math.max(1, cap))} dia(s) neste ritmo` : "nada vencido"}
          </p>
        </div>
      </div>

      {!janelaLigada && (
        <p className="mt-3 rounded-lg bg-warn/10 p-3 text-xs text-warn">
          Você não configurou horário comercial. Para o WhatsApp isso <b>não</b> vira “pode a qualquer hora”: esta fila
          usa 9h–18h, seg–sex, por segurança. Mensagem de prospecção que apita às 3h da manhã é lida como robô antes de
          qualquer filtro. Configure acima se quiser outra janela.
        </p>
      )}

      {/* ---------- os números ---------- */}
      <div className="mt-4">
        <p className="text-xs font-semibold text-subtle">Números</p>
        <div className="mt-2 space-y-2">
          {chips.length === 0 && <p className="text-xs text-subtle">Nenhum número ativo.</p>}
          {chips.map((c) => (
            <div key={c.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{c.instance}</span>
                  {c.pausadoEm ? (
                    <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                      pausado
                    </span>
                  ) : c.aquecido ? (
                    <span className="rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-semibold text-signal">
                      aquecido
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">
                      não aquecido
                    </span>
                  )}
                  {(c.falhasSeguidas ?? 0) > 0 && !c.pausadoEm && (
                    <span className="text-[11px] text-warn">{c.falhasSeguidas} falha(s) seguida(s)</span>
                  )}
                </div>
                <select
                  className="input py-1 text-xs"
                  style={{ width: 150 }}
                  value={c.papel || "principal"}
                  disabled={pending}
                  onChange={(e) => run(() => setRitmoChip(c.id, { papel: e.target.value }))}
                >
                  {PAPEIS.map((p) => (
                    <option key={p.v} value={p.v}>
                      {p.r}
                    </option>
                  ))}
                </select>
              </div>

              <p className="mt-1 text-[11px] text-subtle">
                {PAPEIS.find((p) => p.v === (c.papel || "principal"))?.d}
              </p>

              {c.pausadoEm ? (
                <div className="mt-2 rounded-lg bg-danger/5 p-2">
                  <p className="text-[11px] text-danger">
                    Pausado em {dataHoraCompacta(c.pausadoEm)} — {c.pausaMotivo || "falhas seguidas"}
                  </p>
                  <button
                    className="mt-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-muted disabled:opacity-40"
                    disabled={pending}
                    onClick={() => {
                      if (confirm("Antes de liberar: você verificou a conexão do número? Liberar sem entender a falha costuma repetir as mesmas três falhas — e é isso que custa o número.")) {
                        run(() => liberarChip(c.id));
                      }
                    }}
                  >
                    Liberar número
                  </button>
                </div>
              ) : (
                <label className="mt-2 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!c.aquecido}
                    disabled={pending}
                    onChange={(e) => run(() => setRitmoChip(c.id, { aquecido: e.target.checked }))}
                  />
                  <span className="text-subtle">
                    <b className="text-ink">Está aquecido</b> — marque só depois de 2 a 4 semanas de uso real deste
                    número (conversa de gente, não disparo). O app não tem como medir isso; quem sabe é você.
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>
      </div>

      {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

      {/* ---------- o interruptor ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {ligada ? (
          <>
            <button
              className="rounded-lg border border-danger/50 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
              disabled={pending}
              onClick={() => run(() => setFilaWhatsApp(false))}
            >
              Desligar a fila agora
            </button>
            <span className="text-xs text-signal">● ligada — os toques vencidos estão saindo sozinhos</span>
          </>
        ) : (
          <>
            <button
              className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
              disabled={pending || !modoAutomatico}
              onClick={() => {
                const aviso = soPrincipal
                  ? "Você vai ligar o disparo automático de WhatsApp no seu ÚNICO número, que é a linha principal do negócio.\n\nSe ele for bloqueado, você perde as conversas ativas e a linha. Não há reserva.\n\nLigar mesmo assim?"
                  : "Ligar o disparo automático de WhatsApp? As mensagens vencidas passam a sair sozinhas, sem ninguém olhando.";
                if (confirm(aviso)) run(() => setFilaWhatsApp(true));
              }}
            >
              Ligar a fila automática
            </button>
            <span className="text-xs text-subtle">
              {modoAutomatico
                ? "desligada — os toques de WhatsApp só saem no clique"
                : "indisponível: o canal está em modo manual (mude acima, sabendo do risco)"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
