"use client";

// ============================================================
// Agenda pública — escolha por CALENDÁRIO.
//
// Antes: uma lista corrida de "segunda-feira, 04 de agosto" com os horários embaixo,
// dia após dia. Funciona, mas quem agenda pensa em data ("consigo na quinta?"), não em
// rolar uma lista. Agora é um mês de verdade: clica no dia, abrem os horários dele.
//
// Regra que o desenho respeita: dia SEM horário livre não é clicável e fica apagado —
// a disponibilidade real aparece ANTES do clique, em vez de ser descoberta depois.
// ============================================================

import { useMemo, useState, useTransition } from "react";
import { createBooking } from "@/app/agendar/[token]/actions";

type Slots = { date: string; dateISO: string; times: { iso: string; label: string }[] }[];

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// yyyy-mm-dd → partes numéricas. De propósito SEM passar por Date: `new Date("2026-08-04")`
// é interpretado como UTC e, em Brasília, volta um dia — o calendário sairia deslocado.
function partes(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}
const chave = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function BookingWidget({ token, slots }: { token: string; slots: Slots }) {
  const porDia = useMemo(() => {
    const m = new Map<string, Slots[number]>();
    for (const s of slots) m.set(s.dateISO, s);
    return m;
  }, [slots]);

  const primeiro = slots[0]?.dateISO;
  const [mesAberto, setMesAberto] = useState(() => {
    const hoje = new Date();
    const base = primeiro ? partes(primeiro) : { y: hoje.getFullYear(), m: hoje.getMonth(), d: 1 };
    return { ano: base.y, mes: base.m };
  });
  const [diaSel, setDiaSel] = useState<string | null>(primeiro || null);
  const [picked, setPicked] = useState<{ iso: string; label: string; date: string } | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", note: "" });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  // navegação limitada ao intervalo que realmente tem agenda
  const primeiroP = primeiro ? partes(primeiro) : null;
  const ultimoP = slots.length ? partes(slots[slots.length - 1].dateISO) : null;
  const podeVoltar = !!primeiroP && (mesAberto.ano > primeiroP.y || (mesAberto.ano === primeiroP.y && mesAberto.mes > primeiroP.m));
  const podeAvancar = !!ultimoP && (mesAberto.ano < ultimoP.y || (mesAberto.ano === ultimoP.y && mesAberto.mes < ultimoP.m));

  function andarMes(delta: number) {
    setMesAberto((s) => {
      const d = new Date(s.ano, s.mes + delta, 1);
      return { ano: d.getFullYear(), mes: d.getMonth() };
    });
  }

  if (done) {
    return (
      <div className="rounded-xl bg-signal/10 p-6 text-center">
        <p className="font-display text-lg font-bold text-signal">✓ Reunião agendada!</p>
        <p className="mt-1 text-sm text-ink">{done}</p>
        <p className="mt-2 text-xs text-subtle">Você recebe os detalhes por e-mail. Até lá!</p>
      </div>
    );
  }

  if (!slots.length) {
    return (
      <p className="rounded-lg bg-muted p-4 text-center text-sm text-subtle">
        Nenhum horário disponível nos próximos dias. Tente novamente mais tarde.
      </p>
    );
  }

  // ---------- passo 2: dados de quem agenda ----------
  if (picked) {
    return (
      <div>
        <button className="text-xs text-brand-dark hover:underline" onClick={() => setPicked(null)}>← trocar horário</button>
        <div className="mt-2 rounded-lg bg-brand-soft p-3 text-sm">
          <p className="font-semibold capitalize text-brand-dark">{picked.date}</p>
          <p className="text-brand-dark">às {picked.label}</p>
        </div>
        <div className="mt-4 grid gap-3">
          <div><label className="label">Seu nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} /></div>
          <div><label className="label">Seu e-mail *</label><input className="input mt-1" type="email" value={f.email} onChange={(e) => up("email", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Telefone</label><input className="input mt-1" value={f.phone} onChange={(e) => up("phone", e.target.value)} /></div>
            <div><label className="label">Empresa</label><input className="input mt-1" value={f.company} onChange={(e) => up("company", e.target.value)} /></div>
          </div>
          <div><label className="label">Assunto (opcional)</label><textarea className="input mt-1 min-h-[70px]" value={f.note} onChange={(e) => up("note", e.target.value)} placeholder="Sobre o que você quer conversar?" /></div>
        </div>
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        <button
          className="btn-brand mt-4 w-full"
          disabled={pending}
          onClick={() => {
            setErr(null);
            start(async () => {
              const r = (await createBooking(token, { ...f, datetime: picked.iso })) as any;
              if (r?.error) setErr(r.error);
              else setDone(r.whenLabel);
            });
          }}
        >
          {pending ? "Agendando..." : "Confirmar agendamento"}
        </button>
      </div>
    );
  }

  // ---------- passo 1: calendário ----------
  const primeiroDiaSemana = new Date(mesAberto.ano, mesAberto.mes, 1).getDay();
  const diasNoMes = new Date(mesAberto.ano, mesAberto.mes + 1, 0).getDate();
  const celulas: (number | null)[] = [
    ...Array.from({ length: primeiroDiaSemana }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];
  const diaAberto = diaSel ? porDia.get(diaSel) : null;

  return (
    <div>
      {/* cabeçalho do mês */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-lg border border-line px-2.5 py-1 text-sm text-subtle transition hover:text-ink disabled:opacity-30"
          onClick={() => andarMes(-1)}
          disabled={!podeVoltar}
          aria-label="Mês anterior"
        >
          ←
        </button>
        <p className="font-display text-base font-bold capitalize">
          {MESES[mesAberto.mes]} de {mesAberto.ano}
        </p>
        <button
          type="button"
          className="rounded-lg border border-line px-2.5 py-1 text-sm text-subtle transition hover:text-ink disabled:opacity-30"
          onClick={() => andarMes(1)}
          disabled={!podeAvancar}
          aria-label="Próximo mês"
        >
          →
        </button>
      </div>

      {/* grade do mês */}
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="pb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">{d}</div>
        ))}
        {celulas.map((dia, i) => {
          if (dia === null) return <div key={`vazio-${i}`} />;
          const k = chave(mesAberto.ano, mesAberto.mes, dia);
          const vagas = porDia.get(k)?.times.length ?? 0;
          const selecionado = diaSel === k;
          return (
            <button
              key={k}
              type="button"
              disabled={!vagas}
              onClick={() => setDiaSel(k)}
              title={vagas ? `${vagas} horário(s) livre(s)` : "sem horário"}
              className={`flex aspect-square items-center justify-center rounded-lg text-sm transition ${
                selecionado
                  ? "bg-brand font-bold text-white"
                  : vagas
                  ? "border border-brand/30 bg-brand-soft/50 font-medium text-brand-dark hover:bg-brand-soft"
                  : "cursor-default text-subtle/40"
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-center text-[11px] text-subtle">
        Os dias em destaque têm horário livre · fuso de Brasília
      </p>

      {/* horários do dia escolhido */}
      <div className="mt-4 border-t border-line pt-4">
        {diaAberto ? (
          <>
            <p className="mb-2 text-sm font-semibold capitalize">{diaAberto.date}</p>
            <div className="flex flex-wrap gap-2">
              {diaAberto.times.map((t) => (
                <button
                  key={t.iso}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:border-brand hover:bg-brand-soft"
                  onClick={() => setPicked({ iso: t.iso, label: t.label, date: diaAberto.date })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-subtle">Escolha um dia em destaque para ver os horários.</p>
        )}
      </div>
    </div>
  );
}
