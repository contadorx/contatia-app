"use client";

import { useMemo, useState } from "react";

// ============================================================
// AGENDA EM CALENDÁRIO
// Visão do mês; ao clicar num dia, abre os horários daquele dia:
// as reuniões já marcadas e os horários livres (dentro da janela configurada).
// O SDR só vê/marca nas agendas que lhe foram liberadas.
// Todos os cálculos em horário de Brasília.
// ============================================================

export type Meeting = {
  id: string;
  title: string | null;
  datetime: string;
  duration_min: number | null;
  status: string | null;
  contact_name?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
};

export type Vendedor = { id: string; name: string };

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const BRT = "America/Sao_Paulo";

function chaveDia(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: BRT }); // AAAA-MM-DD
}

function horaBRT(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: BRT, hour: "2-digit", minute: "2-digit",
  });
}

export function CalendarView({
  meetings,
  vendedores,
  vendedorAtivo,
  onTrocarVendedor,
  janela,
  podeAgendar,
  onAgendar,
}: {
  meetings: Meeting[];
  vendedores?: Vendedor[];
  vendedorAtivo?: string;
  onTrocarVendedor?: (id: string) => void;
  janela?: { startHour: number; endHour: number; duration: number; days: number[] };
  podeAgendar?: boolean;
  onAgendar?: (iso: string) => void;
}) {
  const hoje = new Date();
  const [ref, setRef] = useState(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [diaSel, setDiaSel] = useState<string | null>(chaveDia(hoje));

  const cfg = janela || { startHour: 9, endHour: 18, duration: 30, days: [1, 2, 3, 4, 5] };

  // reuniões agrupadas por dia
  const porDia = useMemo(() => {
    const m: Record<string, Meeting[]> = {};
    for (const r of meetings) {
      const k = chaveDia(new Date(r.datetime));
      (m[k] ||= []).push(r);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
    }
    return m;
  }, [meetings]);

  // grade do mês
  const celulas = useMemo(() => {
    const primeiro = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const inicio = new Date(primeiro);
    inicio.setDate(1 - primeiro.getDay()); // volta até o domingo
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      out.push(d);
    }
    return out;
  }, [ref]);

  // horários do dia selecionado
  const horarios = useMemo(() => {
    if (!diaSel) return [];
    const [y, m, d] = diaSel.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    if (!cfg.days.includes(dow)) return [];

    const ocupados = (porDia[diaSel] || []).map((r) => horaBRT(r.datetime));
    const out: { hora: string; iso: string; livre: boolean; reuniao?: Meeting }[] = [];

    for (let h = cfg.startHour; h < cfg.endHour; h++) {
      for (const min of cfg.duration >= 60 ? [0] : [0, 30]) {
        const hora = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        const reuniao = (porDia[diaSel] || []).find((r) => horaBRT(r.datetime) === hora);
        // constrói o instante em BRT (UTC-3, fixo)
        const iso = new Date(Date.UTC(y, m - 1, d, h + 3, min)).toISOString();
        out.push({ hora, iso, livre: !reuniao, reuniao });
      }
    }
    return out;
  }, [diaSel, porDia, cfg]);

  const mesAtual = ref.getMonth();
  const hojeKey = chaveDia(hoje);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      {/* CALENDÁRIO */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button className="btn-ghost px-2 py-1"
              onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}>←</button>
            <p className="font-display text-lg font-bold capitalize">
              {MESES[mesAtual]} {ref.getFullYear()}
            </p>
            <button className="btn-ghost px-2 py-1"
              onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}>→</button>
          </div>

          {vendedores && vendedores.length > 0 && (
            <select
              className="input max-w-[190px] py-1.5 text-sm"
              value={vendedorAtivo || ""}
              onChange={(e) => onTrocarVendedor?.(e.target.value)}
            >
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {DIAS.map((d) => (
            <div key={d} className="pb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{d}</div>
          ))}

          {celulas.map((d, i) => {
            const k = chaveDia(d);
            const doMes = d.getMonth() === mesAtual;
            const qtd = (porDia[k] || []).length;
            const isHoje = k === hojeKey;
            const sel = k === diaSel;
            // dia fora da janela de atendimento (ex.: fim de semana) — sem horários
            const atende = cfg.days.includes(d.getDay());
            const clicavel = atende || qtd > 0;

            return (
              <button
                key={i}
                onClick={() => clicavel && setDiaSel(k)}
                disabled={!clicavel}
                title={!atende ? "Dia sem atendimento" : undefined}
                className={[
                  "relative aspect-square rounded-lg border p-1 text-sm transition",
                  sel ? "border-brand bg-brand-soft font-semibold text-brand-dark" : "border-transparent",
                  clicavel && !sel ? "hover:border-line" : "",
                  !clicavel ? "cursor-default bg-muted/50 text-subtle/40" : "",
                  !doMes ? "text-subtle/40" : clicavel ? "text-ink" : "",
                  isHoje && !sel ? "ring-1 ring-brand/40" : "",
                ].join(" ")}
              >
                <span>{d.getDate()}</span>
                {qtd > 0 && (
                  <span className="absolute inset-x-0 bottom-1 flex justify-center gap-0.5">
                    {Array.from({ length: Math.min(qtd, 3) }).map((_, j) => (
                      <span key={j} className="h-1 w-1 rounded-full bg-brand" />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* HORÁRIOS DO DIA */}
      <div className="card p-5">
        <p className="font-display font-bold">
          {diaSel
            ? new Date(diaSel + "T12:00:00").toLocaleDateString("pt-BR", {
                weekday: "long", day: "2-digit", month: "long",
              })
            : "Escolha um dia"}
        </p>

        {diaSel && horarios.length === 0 && (
          <p className="mt-3 text-sm text-subtle">Dia sem atendimento (fora dos dias configurados).</p>
        )}

        <div className="mt-3 max-h-[420px] space-y-1.5 overflow-y-auto">
          {horarios.map((h) => (
            h.reuniao ? (
              <div key={h.hora} className="flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2">
                <span className="font-mono text-xs font-semibold text-brand-dark">{h.hora}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.reuniao.title || "Reunião"}</p>
                  {h.reuniao.contact_name && (
                    <p className="truncate text-xs text-subtle">{h.reuniao.contact_name}</p>
                  )}
                </div>
              </div>
            ) : (
              <div key={h.hora} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="font-mono text-xs text-subtle">{h.hora}</span>
                <span className="flex-1 text-sm text-subtle">livre</span>
                {podeAgendar && onAgendar && (
                  <button
                    onClick={() => onAgendar(h.iso)}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    agendar
                  </button>
                )}
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}
