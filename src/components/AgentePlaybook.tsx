"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPlaybook, publicarPlaybook } from "@/app/dashboard/agente/actions";

// ============================================================
// O PLAYBOOK — a estratégia de venda como DADO
//
// Aqui é onde o produto entra. Cada bloco vira uma parte do prompt de cada turno, menos
// `precos`, que vira uma TRAVA: o agente consulta, e o código confere o que ele
// respondeu antes de gerar cobrança. O modelo nunca decide preço.
//
// Por que campos separados e não um textão: um textão vira prompt e some no meio dos
// outros. Objeção separada de argumento permite recuperar a resposta CERTA para a
// objeção que apareceu, em vez de mandar o documento inteiro e torcer.
// ============================================================

export type PlaybookProduto = {
  produtoId: string;
  nome: string;
  preco: number;
  billing: string;
  etapas: any[];
  argumentos: any[];
  objecoes: any[];
  precos: any[];
  regrasDuras: string[];
  publicado: boolean;
  existe: boolean;
};

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ETAPAS_SUGERIDAS = [
  "abertura — gancho pelo contexto (CNAE, cidade, porte)",
  "diagnóstico — uma pergunta por vez",
  "dor — confirmar o custo do problema hoje",
  "valor — case ou número concreto",
  "proposta — plano e preço da tabela",
  "objeções — responder sem baixar preço",
  "fechamento ou reunião",
];

/** Lista editável de texto simples — o formato de etapas, argumentos e regras duras. */
function ListaTexto({
  titulo, ajuda, itens, onChange, placeholder, sugestoes,
}: {
  titulo: string; ajuda: string; itens: string[];
  onChange: (v: string[]) => void; placeholder: string; sugestoes?: string[];
}) {
  const [novo, setNovo] = useState("");
  return (
    <div>
      <p className="text-xs font-semibold text-subtle">{titulo}</p>
      <p className="mt-0.5 text-[11px] text-subtle">{ajuda}</p>
      <div className="mt-2 space-y-1.5">
        {itens.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2 text-[11px] text-subtle">{i + 1}.</span>
            <textarea
              className="input min-h-[38px] w-full text-sm"
              rows={Math.max(1, Math.ceil(it.length / 70))}
              value={it}
              onChange={(e) => onChange(itens.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              className="mt-1 rounded px-1.5 text-xs text-subtle hover:text-danger"
              onClick={() => onChange(itens.filter((_, j) => j !== i))}
              title="Remover"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="input w-full text-sm"
          placeholder={placeholder}
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && novo.trim()) { onChange([...itens, novo.trim()]); setNovo(""); }
          }}
        />
        <button
          className="rounded-lg border border-line px-2.5 text-xs font-semibold text-ink hover:bg-muted"
          onClick={() => { if (novo.trim()) { onChange([...itens, novo.trim()]); setNovo(""); } }}
        >
          Adicionar
        </button>
      </div>
      {sugestoes && !itens.length && (
        <button
          className="mt-2 text-[11px] font-semibold text-brand-dark hover:underline"
          onClick={() => onChange(sugestoes)}
        >
          usar a estratégia padrão ({sugestoes.length} etapas) e ajustar
        </button>
      )}
    </div>
  );
}

export default function AgentePlaybook({ produtos }: { produtos: PlaybookProduto[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState<string | null>(produtos[0]?.produtoId || null);

  if (!produtos.length) {
    return (
      <div className="card p-6">
        <p className="font-semibold">Nenhum produto ativo.</p>
        <p className="mt-2 text-sm text-subtle">
          O playbook é por produto. Cadastre o que você vende em Config → Produtos e serviços; depois volte aqui para
          escrever a estratégia de cada um.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {produtos.map((p) => (
        <PlaybookCard
          key={p.produtoId}
          p={p}
          aberto={aberto === p.produtoId}
          onToggle={() => setAberto(aberto === p.produtoId ? null : p.produtoId)}
          onSalvo={() => router.refresh()}
        />
      ))}
    </div>
  );
}

function PlaybookCard({ p, aberto, onToggle, onSalvo }: { p: PlaybookProduto; aberto: boolean; onToggle: () => void; onSalvo: () => void }) {
  const [etapas, setEtapas] = useState<string[]>(p.etapas.map(String));
  const [argumentos, setArgumentos] = useState<string[]>(p.argumentos.map(String));
  const [regras, setRegras] = useState<string[]>(p.regrasDuras.map(String));
  const [objecoes, setObjecoes] = useState<{ objecao: string; resposta: string }[]>(
    (p.objecoes || []).map((o: any) => ({ objecao: String(o?.objecao ?? ""), resposta: String(o?.resposta ?? "") }))
  );
  const [precos, setPrecos] = useState<{ plano: string; valor: string }[]>(
    (p.precos || []).map((x: any) => ({ plano: String(x?.plano ?? ""), valor: String(x?.valor ?? "") }))
  );
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar() {
    setErro(null); setMsg(null);
    start(async () => {
      const r = await salvarPlaybook({
        produtoId: p.produtoId,
        etapas,
        argumentos,
        regras_duras: regras,
        objecoes: objecoes.filter((o) => o.objecao.trim()),
        precos: precos
          .filter((x) => x.plano.trim())
          .map((x) => ({ plano: x.plano.trim(), valor: Number(String(x.valor).replace(",", ".")) || 0 })),
      });
      if (r?.error) setErro(r.error);
      else { setMsg("Salvo."); onSalvo(); }
    });
  }

  function publicar(v: boolean) {
    setErro(null); setMsg(null);
    start(async () => {
      const r = await publicarPlaybook(p.produtoId, v);
      if (r?.error) setErro(r.error);
      else onSalvo();
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="min-w-0 text-left" onClick={onToggle}>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {p.nome}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-subtle">
              {brl(p.preco)} {p.billing === "recorrente" ? "/mês" : "avulso"}
            </span>
            {p.publicado ? (
              <span className="rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-semibold text-signal">publicado</span>
            ) : p.existe ? (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">rascunho</span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">sem playbook</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            {etapas.length} etapas · {argumentos.length} argumentos · {objecoes.length} objeções · {precos.length} planos
            {regras.length ? ` · ${regras.length} regras duras` : ""}
          </p>
        </button>
        <div className="flex items-center gap-2">
          {p.publicado ? (
            <button className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-subtle hover:bg-muted disabled:opacity-40" disabled={pending} onClick={() => publicar(false)}>
              Despublicar
            </button>
          ) : (
            <button className="rounded-lg border border-brand/40 px-2.5 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-40" disabled={pending} onClick={() => publicar(true)}>
              Publicar
            </button>
          )}
          <button className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-muted" onClick={onToggle}>
            {aberto ? "Fechar" : "Editar"}
          </button>
        </div>
      </div>

      {aberto && (
        <div className="mt-4 space-y-5 border-t border-line pt-4">
          <ListaTexto
            titulo="Etapas — a estratégia"
            ajuda="A ordem em que ele conduz. Uma pergunta por mensagem; mensagens curtas, é WhatsApp."
            itens={etapas} onChange={setEtapas}
            placeholder="ex.: diagnóstico — quantas notas por mês?"
            sugestoes={ETAPAS_SUGERIDAS}
          />

          <ListaTexto
            titulo="Argumentos"
            ajuda="O que convence. Case, número, comparação — o que você diria numa ligação."
            itens={argumentos} onChange={setArgumentos}
            placeholder="ex.: economia média de 6h/mês no fechamento"
          />

          {/* ---------- objeções ---------- */}
          <div>
            <p className="text-xs font-semibold text-subtle">Objeções e respostas</p>
            <p className="mt-0.5 text-[11px] text-subtle">
              Pareadas de propósito: na hora, ele recupera a resposta da objeção que apareceu, em vez de receber o
              documento inteiro e escolher sozinho.
            </p>
            <div className="mt-2 space-y-2">
              {objecoes.map((o, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input
                    className="input text-sm" style={{ width: "34%" }}
                    placeholder="já tenho contador"
                    value={o.objecao}
                    onChange={(e) => setObjecoes(objecoes.map((x, j) => (j === i ? { ...x, objecao: e.target.value } : x)))}
                  />
                  <textarea
                    className="input min-h-[38px] w-full text-sm" rows={1}
                    placeholder="resposta-modelo (tom, não promessa nova)"
                    value={o.resposta}
                    onChange={(e) => setObjecoes(objecoes.map((x, j) => (j === i ? { ...x, resposta: e.target.value } : x)))}
                  />
                  <button className="mt-1 rounded px-1.5 text-xs text-subtle hover:text-danger" onClick={() => setObjecoes(objecoes.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button
              className="mt-2 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-muted"
              onClick={() => setObjecoes([...objecoes, { objecao: "", resposta: "" }])}
            >
              Adicionar objeção
            </button>
          </div>

          {/* ---------- preços ---------- */}
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
            <p className="text-xs font-semibold text-danger">Planos e valores — a trava</p>
            <p className="mt-0.5 text-[11px] text-subtle">
              É contra esta tabela que o sistema confere qualquer valor antes de gerar cobrança. O agente pode falar de
              preço; ele não pode inventar um. Sem pelo menos um plano aqui, publicar fica bloqueado.
            </p>
            <div className="mt-2 space-y-2">
              {precos.map((x, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input text-sm" style={{ width: "50%" }}
                    placeholder="Plano Essencial"
                    value={x.plano}
                    onChange={(e) => setPrecos(precos.map((y, j) => (j === i ? { ...y, plano: e.target.value } : y)))}
                  />
                  <input
                    className="input text-sm" style={{ width: 140 }}
                    placeholder="valor (R$)"
                    value={x.valor}
                    onChange={(e) => setPrecos(precos.map((y, j) => (j === i ? { ...y, valor: e.target.value } : y)))}
                  />
                  <button className="rounded px-1.5 text-xs text-subtle hover:text-danger" onClick={() => setPrecos(precos.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button
              className="mt-2 rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
              onClick={() => setPrecos([...precos, { plano: "", valor: "" }])}
            >
              Adicionar plano
            </button>
          </div>

          <ListaTexto
            titulo="Regras duras"
            ajuda="O que ele NÃO pode dizer ou prometer. Vale como regra no prompt; o que dá para conferir em código, o código confere."
            itens={regras} onChange={setRegras}
            placeholder="ex.: nunca prometer prazo de abertura de empresa"
          />

          {erro && <p className="text-sm text-danger">{erro}</p>}
          {msg && <p className="text-sm text-signal">{msg}</p>}

          <button className="btn-brand disabled:opacity-40" disabled={pending} onClick={salvar}>
            {pending ? "Salvando…" : "Salvar playbook"}
          </button>
        </div>
      )}
    </div>
  );
}
