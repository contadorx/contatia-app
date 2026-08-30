"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dataHoraCompacta } from "@/lib/datas";
import { criarExemplo, alternarExemplo, apagarExemplo, decidirLicao } from "@/app/dashboard/agente/actions";

// ============================================================
// TREINO — o que o agente aprende, e o que ele NÃO aprende sozinho
//
// Duas metades com regras opostas, e a tela existe para deixar isso óbvio:
//
//   EXEMPLOS entram sozinhos. Uma conversa que virou venda ou reunião vira exemplo sem
//   ninguém aprovar, porque exemplo só muda TOM e ARGUMENTO.
//
//   LIÇÕES não. Uma lição mexe em REGRA, e regra passa por você. É o que impede o agente
//   de aprender um vício — ou de ser "treinado" por um lead mal-intencionado que repete
//   a mesma manipulação até ela parecer padrão.
//
// A correção humana é o material mais valioso dos dois: quando você assume uma conversa
// e responde do seu jeito, o par (contexto → sua resposta) entra com peso maior.
// ============================================================

export type ExemploLinha = {
  id: string;
  produto: string | null;
  caminho: string;
  origem: string;
  peso: number;
  ativo: boolean;
};

export type LicaoLinha = {
  id: string;
  texto: string;
  evidencia: string | null;
  criadoEm: string;
};

const ORIGEM_ROTULO: Record<string, string> = {
  won: "virou venda",
  reuniao: "virou reunião",
  editado_por_humano: "corrigido por você",
  manual: "escrito à mão",
};

const ORIGEM_ESTILO: Record<string, string> = {
  won: "bg-signal/10 text-signal",
  reuniao: "bg-brand-soft text-brand-dark",
  editado_por_humano: "bg-warn/15 text-warn",
  manual: "bg-muted text-subtle",
};

const MODELO_CAMINHO = `Contexto: escritório de contabilidade, 12 funcionários, São Paulo. Chegou pela cadência de e-mail.
Movimentos: perguntei quantas notas por mês (uma pergunta só). Ele disse 400 e reclamou do fechamento manual.
Fiquei na dor antes de falar de preço: perguntei quantas horas isso custa por mês. Ele disse "uns 2 dias".
Aí trouxe o número: 6h/mês economizadas em média. Só então apresentei o plano.
Objeção: "já tenho contador" — respondi que não substitui, organiza o que ele já faz.
Resultado: reunião marcada para quinta.`;

export default function AgenteTreino({
  exemplos, licoes, produtos,
}: {
  exemplos: ExemploLinha[];
  licoes: LicaoLinha[];
  produtos: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [caminho, setCaminho] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [peso, setPeso] = useState(3);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<any>, limpar = false) {
    setErro(null);
    start(async () => {
      const r = await fn();
      if (r?.error) setErro(r.error);
      else { if (limpar) setCaminho(""); router.refresh(); }
    });
  }

  return (
    <div className="space-y-6">
      {/* ---------- fila de lições ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">Lições esperando você</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          Padrões que o destilador noturno encontrou nas conversas. <b>Só o que você aprovar muda o playbook</b> — é o
          que impede o agente de aprender um vício, ou de ser treinado por quem está do outro lado.
        </p>

        {!licoes.length ? (
          <p className="mt-3 text-sm text-subtle">
            Nada pendente. As lições aparecem quando houver conversas suficientes para comparar — elas nascem do
            resultado real, não de palpite.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {licoes.map((l) => (
              <div key={l.id} className="rounded-lg border border-warn/30 bg-warn/5 p-3">
                <p className="text-sm font-medium">{l.texto}</p>
                {l.evidencia && <p className="mt-1 text-xs text-subtle">Evidência: {l.evidencia}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-lg border border-signal/40 px-2.5 py-1 text-xs font-semibold text-signal hover:bg-signal/10 disabled:opacity-40"
                    disabled={pending}
                    onClick={() => run(() => decidirLicao(l.id, "aprovada"))}
                  >
                    Aprovar
                  </button>
                  <button
                    className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-subtle hover:bg-muted disabled:opacity-40"
                    disabled={pending}
                    onClick={() => run(() => decidirLicao(l.id, "rejeitada"))}
                  >
                    Rejeitar
                  </button>
                  <span className="text-[11px] text-subtle">{dataHoraCompacta(l.criadoEm)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- ensinar à mão ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">Ensinar uma conversa</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          Escreva o <b>caminho</b>, não a transcrição: contexto → os movimentos que você fez → resultado. A transcrição
          inteira custa caro no prompt e ensina menos, porque o que importa é a sequência de decisões.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Produto</span>
            <select className="input mt-1" style={{ width: 220 }} value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">qualquer produto</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-subtle">Peso (1–10)</span>
            <input type="number" min={1} max={10} className="input mt-1" style={{ width: 90 }} value={peso} onChange={(e) => setPeso(Number(e.target.value))} />
          </label>
          <button
            className="text-xs font-semibold text-brand-dark hover:underline"
            onClick={() => setCaminho(MODELO_CAMINHO)}
          >
            ver um exemplo do formato
          </button>
        </div>

        <textarea
          className="input mt-3 w-full text-sm"
          rows={7}
          placeholder="Contexto: … / Movimentos: … / Resultado: …"
          value={caminho}
          onChange={(e) => setCaminho(e.target.value)}
        />

        {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

        <button
          className="btn-brand mt-3 disabled:opacity-40"
          disabled={pending || caminho.trim().length < 20}
          onClick={() => run(() => criarExemplo({ produtoId: produtoId || null, caminho, peso }), true)}
        >
          {pending ? "Salvando…" : "Guardar exemplo"}
        </button>
      </div>

      {/* ---------- o que ele já sabe ---------- */}
      <div className="card p-5">
        <p className="font-display text-base font-bold">O que ele já sabe ({exemplos.filter((e) => e.ativo).length} ativos)</p>
        <p className="mt-0.5 max-w-2xl text-sm text-subtle">
          Conversas que deram certo entram aqui sozinhas quando o motor existir. As que você corrigiu à mão entram com
          peso maior — sua correção vale mais que um acerto do robô.
        </p>

        {!exemplos.length ? (
          <p className="mt-3 text-sm text-subtle">Nenhum exemplo ainda. Escreva o primeiro acima.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {exemplos.map((e) => (
              <div key={e.id} className={`rounded-lg border border-line p-3 ${e.ativo ? "" : "opacity-50"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ORIGEM_ESTILO[e.origem] || ORIGEM_ESTILO.manual}`}>
                    {ORIGEM_ROTULO[e.origem] || e.origem}
                  </span>
                  <span className="text-[11px] text-subtle">peso {e.peso}</span>
                  {e.produto && <span className="text-[11px] text-subtle">· {e.produto}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      className="rounded-lg border border-line px-2 py-0.5 text-[11px] font-semibold text-subtle hover:bg-muted disabled:opacity-40"
                      disabled={pending}
                      onClick={() => run(() => alternarExemplo(e.id, !e.ativo))}
                    >
                      {e.ativo ? "Desativar" : "Reativar"}
                    </button>
                    <button
                      className="rounded-lg border border-line px-2 py-0.5 text-[11px] font-semibold text-subtle hover:text-danger disabled:opacity-40"
                      disabled={pending}
                      onClick={() => { if (confirm("Apagar este exemplo?")) run(() => apagarExemplo(e.id)); }}
                    >
                      Apagar
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs text-subtle">{e.caminho}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
