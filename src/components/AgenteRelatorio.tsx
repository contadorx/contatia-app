"use client";

import { PRECOS_CONFERIDOS_EM } from "@/lib/agente/custo";

// ============================================================
// O RELATÓRIO DO AGENTE
//
// Uma pergunta acima de todas: ele se paga? Enquanto isso não tiver resposta em número,
// ligar o agente é aposta — e a espec pede exatamente esta conta ("custo por venda").
//
// O custo vem de `agent_decisoes.tokens_*`, que nasce medindo desde o primeiro turno.
// Isso é de propósito: se a medição começasse quando alguém sentisse falta dela, o
// histórico já estaria perdido.
// ============================================================

export type ResumoAgente = {
  conversas: number;
  porStatus: Record<string, number>;
  porDesfecho: Record<string, number>;
  porEtapa: { etapa: string; total: number; perdidas: number }[];
  turnos: number;
  turnosComErro: number;
  tokensIn: number;
  tokensOut: number;
  custoUsd: number;
  vendas: number;
  receita: number;
  reunioes: number;
  modeloDesconhecido: boolean;
};

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const usd = (v: number) => `US$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DESFECHO_ROTULO: Record<string, string> = {
  venda: "Vendas", reuniao: "Reuniões", recusa: "Recusas", silencio: "Sumiram", opt_out: "Pediram para parar",
};
const STATUS_ROTULO: Record<string, string> = {
  agente: "Com o agente", sombra: "Em sombra", humano: "Com você", pausada: "Sem condução", encerrada: "Encerradas",
};

function Tile({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{rotulo}</p>
      <p className="mt-0.5 font-display text-lg font-bold">{valor}</p>
      {nota && <p className="mt-0.5 text-[11px] text-subtle">{nota}</p>}
    </div>
  );
}

export default function AgenteRelatorio({ r }: { r: ResumoAgente }) {
  if (!r.turnos && !r.conversas) {
    return (
      <div className="card p-6">
        <p className="font-semibold">Ainda não há o que medir.</p>
        <p className="mt-2 text-sm text-subtle">
          Os números aparecem depois do primeiro turno. O custo é contado desde o começo — nenhum histórico se perde
          esperando alguém sentir falta dele.
        </p>
      </div>
    );
  }

  const custoPorVenda = r.vendas ? r.custoUsd / r.vendas : null;
  const custoPorConversa = r.conversas ? r.custoUsd / r.conversas : 0;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <p className="font-display text-base font-bold">Ele se paga?</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Tile rotulo="Custo de API" valor={usd(r.custoUsd)} nota={`${r.turnos} turnos`} />
          <Tile
            rotulo="Custo por venda"
            valor={custoPorVenda === null ? "—" : usd(custoPorVenda)}
            nota={custoPorVenda === null ? "nenhuma venda ainda" : `${r.vendas} venda(s)`}
          />
          <Tile rotulo="Receita fechada" valor={brl(r.receita)} nota="oportunidades marcadas como ganhas" />
          <Tile rotulo="Custo por conversa" valor={usd(custoPorConversa)} nota={`${r.conversas} conversas`} />
        </div>
        <p className="mt-3 text-[11px] text-subtle">
          Custo estimado a partir dos tokens registrados em cada turno, com a tabela de preços conferida em{" "}
          {PRECOS_CONFERIDOS_EM}.{" "}
          {r.modeloDesconhecido && (
            <b className="text-warn">
              Há turnos num modelo fora da tabela — esses foram calculados pelo preço mais caro, então o número real
              tende a ser menor.
            </b>
          )}
        </p>
      </div>

      <div className="card p-5">
        <p className="font-display text-base font-bold">Como as conversas terminaram</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          {["venda", "reuniao", "recusa", "silencio", "opt_out"].map((d) => (
            <Tile key={d} rotulo={DESFECHO_ROTULO[d]} valor={String(r.porDesfecho[d] || 0)} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(r.porStatus).map(([s, n]) => (
            <span key={s} className="rounded-full bg-muted px-2.5 py-1 text-xs text-subtle">
              {STATUS_ROTULO[s] || s}: <b className="text-ink">{n}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <p className="font-display text-base font-bold">Onde as conversas morrem</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          A etapa em que a conversa estava quando acabou em silêncio ou recusa. É o número que diz qual parte do
          playbook reescrever — e é dele que o destilador tira as lições que te propõe.
        </p>
        {!r.porEtapa.length ? (
          <p className="mt-3 text-sm text-subtle">Nenhuma conversa encerrada ainda.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {r.porEtapa.map((e) => {
              const pct = e.total ? Math.round((e.perdidas / e.total) * 100) : 0;
              return (
                <div key={e.etapa}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{e.etapa}</span>
                    <span className={pct >= 60 ? "text-warn" : "text-subtle"}>
                      {e.perdidas} de {e.total} perdidas ({pct}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${pct >= 60 ? "bg-warn" : "bg-brand"}`}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {r.turnosComErro > 0 && (
        <div className="card border-warn/30 p-5">
          <p className="font-display text-base font-bold text-warn">
            {r.turnosComErro} turno(s) falharam
          </p>
          <p className="mt-1 text-sm text-subtle">
            Turno que falha fica registrado com o motivo em <code>agent_decisoes</code>. Falha de API devolve o turno
            para a fila; três seguidas entregam a conversa a um humano.
          </p>
        </div>
      )}
    </div>
  );
}
