"use client";

import { useState, useTransition } from "react";
import { saveLimiteEnvio } from "@/app/dashboard/config/actions";

// ============================================================
// O RITMO DA FILA — quantos por hora e em que horas
//
// Dois freios que o limite diário não cobre, e que quebram por motivos diferentes:
//
//   · POR HORA: quem hospeda e-mail em cPanel (HostGator, Locaweb, KingHost) é limitado
//     por hora, não por dia. E estourar não devolve "limite atingido" — o servidor passa
//     a RECUSAR CONEXÃO pela hora inteira. Dá para ter 120 de 200 no dia e o lote
//     quebrar assim mesmo, porque os 120 saíram em 5 minutos.
//
//   · HORÁRIO COMERCIAL: e-mail de prospecção que chega às 3h da manhã de domingo é
//     lido como robô pelo destinatário antes de ser lido pelo filtro dele.
//
// A janela vale para a FILA ("Enviar todos"). Enviar uma tarefa, ou as marcadas,
// continua saindo na hora do clique — ali quem escolheu foi uma pessoa.
// ============================================================

const DIAS = [
  { n: 1, r: "seg" }, { n: 2, r: "ter" }, { n: 3, r: "qua" }, { n: 4, r: "qui" },
  { n: 5, r: "sex" }, { n: 6, r: "sáb" }, { n: 0, r: "dom" },
];

export default function LimiteEnvioForm({
  initialHourly, initialOn, initialInicio, initialFim, initialDias, somaHoraCaixas, initialAuto,
}: {
  initialHourly: number | null;
  initialOn: boolean;
  initialInicio: number;
  initialFim: number;
  initialDias: number[];
  /** soma dos tetos por hora já configurados nas caixas — para avisar quando discordam */
  somaHoraCaixas: number;
  initialAuto: boolean;
}) {
  const [hourly, setHourly] = useState(initialHourly ? String(initialHourly) : "");
  const [on, setOn] = useState(initialOn);
  const [ini, setIni] = useState(initialInicio);
  const [fim, setFim] = useState(initialFim);
  const [dias, setDias] = useState<number[]>(initialDias.length ? initialDias : [1, 2, 3, 4, 5]);
  const [auto, setAuto] = useState(initialAuto);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = (await saveLimiteEnvio({
        hourlyCap: hourly.trim() ? Number(hourly) : null,
        horarioOn: on,
        horaInicio: ini,
        horaFim: fim,
        dias,
        filaAutomatica: auto,
      })) as { ok?: boolean; error?: string; semFilaAutomatica?: boolean };
      setMsg(
        res?.error ? res.error
        : res?.semFilaAutomatica
          ? "✓ Ritmo salvo. A fila automática NÃO foi gravada: falta aplicar a migration 0115 no banco."
          : "✓ Salvo. A fila já usa este ritmo no próximo envio."
      );
    });
  }

  const n = Number(hourly) || 0;
  // Discordância que só aparece somando: o teto geral menor que a soma das caixas não é
  // erro (é o cPanel compartilhado), mas o contrário quase sempre é engano de digitação.
  const conflito = n > 0 && somaHoraCaixas > 0 && n > somaHoraCaixas;

  return (
    <div className="card p-5">
      <p className="label">Teto por hora do workspace</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {[50, 100, 200, 500].map((p) => (
          <button key={p} type="button" onClick={() => setHourly(String(p))}
            className={`rounded-lg border px-2.5 py-1 text-xs ${String(p) === hourly ? "border-brand bg-brand text-white" : "border-line hover:bg-muted"}`}>
            {p}/h
          </button>
        ))}
        <input className="input w-28 py-1 text-sm" type="number" min={1} max={20000} placeholder="sem teto"
          value={hourly} onChange={(e) => setHourly(e.target.value)} />
        {hourly && (
          <button type="button" className="text-xs text-subtle underline hover:text-ink" onClick={() => setHourly("")}>
            limpar
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-subtle">
        Soma TODAS as caixas — é o número certo quando elas moram na mesma hospedagem (cPanel →{" "}
        <b>Max hourly emails</b>). A contagem é dos <b>últimos 60 minutos</b>, não da hora do relógio:
        é assim que o provedor conta, e é o que impede 100 às 14h59 + 100 às 15h01.
      </p>
      {conflito && (
        <p className="mt-1 text-[11px] text-warn">
          ⚠ Este teto ({n}/h) é maior que a soma dos tetos das caixas ({somaHoraCaixas}/h) — na prática vai valer o
          das caixas. Se a intenção era liberar mais, suba o de cada caixa.
        </p>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          Enviar só em horário comercial
        </label>
        <div className={`mt-2 ${on ? "" : "pointer-events-none opacity-40"}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-subtle">das</span>
            <select className="input w-20 py-1 text-sm" value={ini} onChange={(e) => setIni(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
            <span className="text-subtle">às</span>
            <select className="input w-20 py-1 text-sm" value={fim} onChange={(e) => setFim(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
            <span className="text-xs text-subtle">(horário de Brasília)</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIAS.map((d) => (
              <button key={d.n} type="button" onClick={() => toggleDia(d.n)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${dias.includes(d.n) ? "border-brand bg-brand text-white" : "border-line hover:bg-muted"}`}>
                {d.r}
              </button>
            ))}
          </div>
          {fim <= ini && (
            <p className="mt-1 text-[11px] text-warn">
              ⚠ O fim precisa ser depois do início. Vou salvar como {ini}h–{Math.min(24, ini + 1)}h.
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] text-subtle">
          Vale para a fila (&ldquo;Enviar todos&rdquo;), que decide sozinha o que sai. Enviar uma tarefa,
          ou as marcadas, continua saindo na hora do clique — com aviso de que está fora da janela.
        </p>
      </div>

      {/* ============================================================
          FILA AUTOMÁTICA — a única função que fala com o lead sem ninguém olhando.
          Por isso ela é um interruptor explícito, com o que acontece escrito ao lado,
          e não uma consequência silenciosa de ter configurado o horário.
          ============================================================ */}
      <div className="mt-4 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Deixar a fila andar sozinha (sem a aba aberta)
        </label>
        <p className="mt-1 text-[11px] text-subtle">
          A cada 10 minutos o servidor envia os toques de e-mail <b>já vencidos</b>, respeitando o
          horário acima, o teto por hora e o limite diário de cada caixa. WhatsApp, Instagram e
          LinkedIn <b>não</b> entram — esses continuam saindo pela sua mão.
          Tudo que sair assim fica em <b>Resultados → Registro</b> como &ldquo;Fila automática enviou&rdquo;.
        </p>
        {auto && !on && (
          <p className="mt-1 text-[11px] text-warn">
            ⚠ Com o horário comercial desligado, a fila automática envia a qualquer hora, inclusive
            de madrugada e no fim de semana. Ligue o horário acima antes de deixá-la solta.
          </p>
        )}
      </div>

      {msg && <p className={`mt-3 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <div className="mt-3">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar ritmo da fila"}
        </button>
      </div>
    </div>
  );
}
