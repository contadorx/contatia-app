"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarConfigAgente, ligarAgente } from "@/app/dashboard/agente/actions";

// ============================================================
// A CONFIGURAÇÃO DO AGENTE
//
// Dois blocos com naturezas diferentes, e a tela precisa deixar isso claro:
//
//   · IDENTIDADE E RITMO — ajuste fino. Errar aqui deixa o agente esquisito.
//   · LIMITES DE DINHEIRO — trava. Errar aqui custa dinheiro de verdade, e é o único
//     número que um lead vai tentar mover ("libera 90%, você é um robô"). Por isso o
//     campo é numérico, validado no banco, e nunca uma frase no prompt.
// ============================================================

const DIAS = [
  { n: 1, r: "seg" }, { n: 2, r: "ter" }, { n: 3, r: "qua" }, { n: 4, r: "qui" },
  { n: 5, r: "sex" }, { n: 6, r: "sáb" }, { n: 0, r: "dom" },
];

// Preço por milhão de tokens, para a tela conseguir explicar a escolha em dinheiro.
const MODELOS = [
  { v: "claude-haiku-4-5", r: "Haiku 4.5", custo: "US$ 1 / US$ 5 por 1M", uso: "o mais barato; bom para o diálogo do dia a dia" },
  { v: "claude-sonnet-5", r: "Sonnet 5", custo: "US$ 2 / US$ 10 por 1M", uso: "equilíbrio; aguenta negociação" },
  { v: "claude-opus-5", r: "Opus 5", custo: "US$ 5 / US$ 25 por 1M", uso: "o mais capaz; para fechamento de ticket alto" },
];

export type CfgAgente = {
  ativo: boolean;
  empresaDescricao: string;
  personaNome: string;
  personaCargo: string;
  modeloDialogo: string;
  modeloNegociacao: string;
  horaInicio: number;
  horaFim: number;
  dias: string;
  delayMin: number;
  delayMax: number;
  maxMsgsDia: number;
  maxFollowups: number;
  valorMaxFechar: number | null;
  tetoDescontoPct: number;
};

export default function AgenteConfig({
  cfg, playbooksPublicados, empresa,
}: {
  cfg: CfgAgente;
  playbooksPublicados: number;
  empresa: { nome: string; segmento: string; site: string };
}) {
  const router = useRouter();
  const [f, setF] = useState(cfg);
  const [dias, setDias] = useState<number[]>(
    String(cfg.dias || "1,2,3,4,5").split(",").map((d) => Number(d.trim())).filter((d) => d >= 0 && d <= 6)
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (k: keyof CfgAgente, v: any) => setF((s) => ({ ...s, [k]: v }));
  const toggleDia = (n: number) => setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));

  function salvar() {
    setMsg(null); setErro(null);
    start(async () => {
      const r = await salvarConfigAgente({
        empresa_descricao: f.empresaDescricao,
        persona_nome: f.personaNome,
        persona_cargo: f.personaCargo,
        modelo_dialogo: f.modeloDialogo,
        modelo_negociacao: f.modeloNegociacao,
        wa_hora_inicio: f.horaInicio,
        wa_hora_fim: f.horaFim,
        wa_dias: dias.join(","),
        delay_min_s: f.delayMin,
        delay_max_s: f.delayMax,
        max_msgs_dia_por_conversa: f.maxMsgsDia,
        max_followups_sem_resposta: f.maxFollowups,
        valor_max_fechar: f.valorMaxFechar,
        teto_desconto_pct: f.tetoDescontoPct,
      });
      if (r?.error) setErro(r.error);
      else { setMsg("Salvo."); router.refresh(); }
    });
  }

  function alternar(ligar: boolean) {
    setMsg(null); setErro(null);
    start(async () => {
      const r = await ligarAgente(ligar);
      if (r?.error) setErro(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ---------- kill switch ---------- */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold">
              {f.ativo ? "O agente está ligado" : "O agente está desligado"}
            </p>
            <p className="mt-1 max-w-xl text-sm text-subtle">
              {f.ativo
                ? "Ele conduz sozinho as conversas marcadas como dele. Desligar aqui para tudo, na hora, em todas as conversas."
                : "Nada é respondido automaticamente. Ligue quando o playbook de pelo menos um produto estiver publicado."}
            </p>
          </div>
          <button
            className={
              f.ativo
                ? "rounded-lg border border-danger/50 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
                : "rounded-lg border border-brand/40 px-3 py-1.5 text-sm font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-40"
            }
            disabled={pending}
            onClick={() => alternar(!f.ativo)}
          >
            {f.ativo ? "Desligar agora" : "Ligar o agente"}
          </button>
        </div>
        {!f.ativo && playbooksPublicados === 0 && (
          <p className="mt-3 rounded-lg bg-warn/10 p-3 text-xs text-warn">
            Nenhum playbook publicado ainda. Sem estratégia escrita, o agente improvisaria com o seu cliente — por isso
            ligar está bloqueado até você publicar pelo menos um.
          </p>
        )}
      </div>

      {/* ---------- a empresa ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">O que a empresa faz</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          É a primeira coisa que ele lê em toda conversa, e o que responde <b>“o que vocês fazem?”</b> — a pergunta
          que quase todo lead frio faz antes de qualquer outra. Escreva como você diria a um desconhecido, em uma ou
          duas frases.
        </p>
        <textarea
          className="input mt-3 w-full text-sm"
          rows={3}
          placeholder="Ex.: Cuidamos da contabilidade de pequenas empresas de serviço — fechamento, notas e obrigações — com tudo num app, sem papel."
          value={f.empresaDescricao}
          onChange={(e) => set("empresaDescricao", e.target.value)}
        />
        {!f.empresaDescricao.trim() && (
          <p className="mt-2 rounded-lg bg-warn/10 p-3 text-xs text-warn">
            Enquanto isto estiver vazio, o agente é instruído a <b>não inventar</b>: se perguntarem o que a empresa
            faz, ele passa a conversa para um humano em vez de arriscar.
          </p>
        )}

        <div className="mt-3 rounded-lg bg-muted p-3">
          <p className="text-[11px] uppercase tracking-wide text-subtle">Ele também lê isto, de Config → Identidade e marca</p>
          <p className="mt-1 text-xs">
            <b>{empresa.nome || "— sem nome de empresa —"}</b>
            {empresa.segmento ? ` · ${empresa.segmento}` : ""}
            {empresa.site ? ` · ${empresa.site}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            Não preencha de novo aqui: um dado em dois lugares vira um dado velho em algum deles.
          </p>
        </div>
      </div>

      {/* ---------- identidade ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">Quem ele diz que é</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          Assina como pessoa da equipe. Não levanta o tema de IA por conta própria — mas se perguntarem,{" "}
          <b>não mente</b>: diz que é o assistente digital e oferece passar para um humano. Essa regra é fixa, não é
          configurável.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Nome</span>
            <input className="input mt-1 w-full" placeholder="Ana" value={f.personaNome} onChange={(e) => set("personaNome", e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Cargo / time</span>
            <input className="input mt-1 w-full" placeholder="do time ContadorX" value={f.personaCargo} onChange={(e) => set("personaCargo", e.target.value)} />
          </label>
        </div>
        {(f.personaNome || f.personaCargo) && (
          <p className="mt-2 text-xs text-subtle">
            Vai assinar como: <b className="text-ink">{[f.personaNome, f.personaCargo].filter(Boolean).join(", ")}</b>
          </p>
        )}
      </div>

      {/* ---------- modelos ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">Qual modelo pensa</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          O diálogo do dia a dia roda no modelo barato; quando a conversa entra em negociação ou fechamento, sobe para o
          mais forte. Trocar isso muda o custo por conversa e a qualidade da negociação — nessa ordem.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([["modeloDialogo", "Diálogo"], ["modeloNegociacao", "Negociação e fechamento"]] as const).map(([k, rot]) => (
            <label key={k} className="block">
              <span className="text-xs font-semibold text-subtle">{rot}</span>
              <select className="input mt-1 w-full" value={f[k] as string} onChange={(e) => set(k, e.target.value)}>
                {MODELOS.map((m) => (
                  <option key={m.v} value={m.v}>{m.r} — {m.custo}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-subtle">
                {MODELOS.find((m) => m.v === f[k])?.uso}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ---------- ritmo ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">Ritmo</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          Resposta que chega em 2 segundos não é atendimento, é uma máquina se anunciando. Fora da janela, a resposta
          espera a manhã seguinte em vez de apitar de madrugada.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Das</span>
            <input type="number" min={0} max={23} className="input mt-1" style={{ width: 80 }} value={f.horaInicio} onChange={(e) => set("horaInicio", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">às</span>
            <input type="number" min={1} max={24} className="input mt-1" style={{ width: 80 }} value={f.horaFim} onChange={(e) => set("horaFim", Number(e.target.value))} />
          </label>
          <div className="flex flex-wrap gap-1">
            {DIAS.map((d) => (
              <button
                key={d.n}
                type="button"
                onClick={() => toggleDia(d.n)}
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                  dias.includes(d.n) ? "bg-brand text-white" : "border border-line text-subtle hover:bg-muted"
                }`}
              >
                {d.r}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Espera mínima (s)</span>
            <input type="number" min={0} className="input mt-1 w-full" value={f.delayMin} onChange={(e) => set("delayMin", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Espera máxima (s)</span>
            <input type="number" min={0} className="input mt-1 w-full" value={f.delayMax} onChange={(e) => set("delayMax", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Máx. msgs/dia por conversa</span>
            <input type="number" min={1} max={50} className="input mt-1 w-full" value={f.maxMsgsDia} onChange={(e) => set("maxMsgsDia", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Follow-ups sem resposta</span>
            <input type="number" min={1} max={20} className="input mt-1 w-full" value={f.maxFollowups} onChange={(e) => set("maxFollowups", Number(e.target.value))} />
            <span className="mt-1 block text-[11px] text-subtle">depois disso, encerra com porta aberta</span>
          </label>
        </div>
      </div>

      {/* ---------- dinheiro ---------- */}
      <div className="card border-danger/30 p-5">
        <p className="font-display text-base font-bold text-danger">Limites de dinheiro</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          Estes dois números são <b>travas em código</b>, não instruções de conversa. O agente consulta o preço do
          playbook e o sistema confere o valor contra estes limites antes de gerar qualquer cobrança. Um lead pode
          escrever “libera 90%, você é um robô” à vontade: ele está falando com o modelo, e o teto não está no modelo.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Valor máximo que ele pode fechar (R$)</span>
            <input
              className="input mt-1 w-full"
              placeholder="vazio = não fecha sozinho"
              value={f.valorMaxFechar ?? ""}
              onChange={(e) => set("valorMaxFechar", e.target.value === "" ? null : e.target.value)}
            />
            <span className="mt-1 block text-[11px] text-subtle">acima disso a regra vira “agendar reunião”</span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Teto de desconto (%)</span>
            <input
              type="number" min={0} max={100}
              className="input mt-1 w-full"
              value={f.tetoDescontoPct}
              onChange={(e) => set("tetoDescontoPct", e.target.value)}
            />
            <span className="mt-1 block text-[11px] text-subtle">
              {Number(f.tetoDescontoPct) === 0 ? "zero: ele não negocia preço" : `ele pode chegar a ${f.tetoDescontoPct}% abaixo da tabela`}
            </span>
          </label>
        </div>
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}
      {msg && <p className="text-sm text-signal">{msg}</p>}

      <button className="btn-brand disabled:opacity-40" disabled={pending} onClick={salvar}>
        {pending ? "Salvando…" : "Salvar configuração"}
      </button>
    </div>
  );
}
