"use client";

// ============================================================
// O BLOCO, AGORA SEM MEMÓRIA PRÓPRIA
//
// A versão anterior guardava aqui o que sabia do contato e decidia os passos com base
// nisso. Como cada passo MUDA o contato (o CNPJ traz o domínio, o site traz o telefone),
// as decisões seguintes saíam de uma foto velha: o WhatsApp nem entrava no plano e a
// busca de e-mail se comportava diferente do controle individual — que sempre leu o
// estado real do banco.
//
// Agora este componente não decide nada. Ele percorre os passos, e o SERVIDOR relê o
// contato antes de cada um e devolve o estado novo. A tela só desenha. Não há mais nada
// aqui que possa envelhecer.
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rodarPasso } from "@/app/dashboard/contatos/atualizar-actions";
import {
  passosPendentes,
  ORDEM_PASSOS,
  ROTULO_PASSO as ROTULO,
  type EstadoContato,
  type PassoId,
  type ResultadoPasso,
} from "@/lib/passosContato";

const EM_ANDAMENTO: Record<PassoId, string> = {
  cnpj: "Consultando o CNPJ na base da Receita…",
  site: "Lendo o site da empresa…",
  email: "Procurando o e-mail (conversa com o servidor do domínio, pode demorar)…",
  whatsapp: "Verificando o WhatsApp…",
};


export default function AtualizarDadosContato({
  contactId,
  estadoInicial,
}: {
  contactId: string;
  estadoInicial: EstadoContato;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoContato>(estadoInicial);
  const [rodando, setRodando] = useState<PassoId | null>(null);
  const [linhas, setLinhas] = useState<ResultadoPasso[]>([]);
  const [pronto, setPronto] = useState(false);

  const pendentes = passosPendentes(estado);
  const nadaAFazer = pendentes.length === 0;

  async function rodar() {
    setLinhas([]);
    setPronto(false);
    for (const passo of ORDEM_PASSOS) {
      setRodando(passo);
      const r = await rodarPasso(contactId, passo);
      setLinhas((prev) => [...prev, r]);
      // O estado devolvido é o do banco DEPOIS do passo — é ele que decide o próximo.
      if (r.estado) setEstado(r.estado);
    }
    setRodando(null);
    setPronto(true);
    router.refresh();
  }

  const cor = (t: ResultadoPasso["tom"]) =>
    t === "ok" ? "text-brand-dark" : t === "erro" ? "text-danger" : "text-subtle";
  const icone = (t: ResultadoPasso["tom"]) =>
    t === "ok" ? "✓" : t === "erro" ? "✕" : t === "nada" ? "—" : "·";

  // Um quadro do que o contato TEM, sempre visível. Antes só existiam mensagens do que
  // aconteceu; faltava a resposta para "afinal, o que este contato tem hoje?".
  const canais: { rotulo: string; valor: string; ok: boolean }[] = [
    {
      rotulo: "E-mail",
      valor: !estado.temEmail
        ? "não tem"
        : estado.emailForaDoDominio ? "de outro domínio"
        : estado.emailDeBalcao ? "caixa compartilhada"
        : "do decisor",
      ok: estado.temEmail && !estado.emailDeBalcao && !estado.emailForaDoDominio,
    },
    {
      rotulo: "WhatsApp",
      valor:
        estado.waStatus === "valid" ? "confirmado"
        : estado.waStatus === "invalid" ? "número não tem"
        : estado.temTelefone ? "não verificado"
        : "sem telefone",
      ok: estado.waStatus === "valid",
    },
    { rotulo: "Redes", valor: estado.temRede ? "Instagram ou LinkedIn" : "não tem", ok: estado.temRede },
    {
      rotulo: "Receita",
      valor: estado.enriquecido ? "enriquecido" : estado.temCnpj ? "não enriquecido" : "sem CNPJ",
      ok: estado.enriquecido,
    },
  ];

  return (
    <div className="rounded-lg border border-line bg-muted/30 p-3">
      {/* o quadro de canais: o que existe hoje, num relance */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {canais.map((c) => (
          <div key={c.rotulo} className="text-xs">
            <span className="text-subtle">{c.rotulo}: </span>
            <span className={c.ok ? "font-medium text-brand-dark" : "text-subtle"}>{c.valor}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          className="btn-brand py-1.5 text-sm disabled:opacity-50"
          onClick={rodar}
          disabled={!!rodando || nadaAFazer}
          title={
            nadaAFazer
              ? "Não há por onde: ou já está tudo preenchido, ou falta CNPJ e domínio."
              : `Roda em ordem: ${pendentes.map((p) => ROTULO[p]).join(" → ")}. Cada passo alimenta o seguinte.`
          }
        >
          {rodando ? "Atualizando…" : nadaAFazer ? "✓ Nada a descobrir" : `⟳ Atualizar dados (${pendentes.length})`}
        </button>
        {!rodando && !nadaAFazer && (
          <span className="text-xs text-subtle">{pendentes.map((p) => ROTULO[p]).join(" → ")}</span>
        )}
        {rodando && <span className="text-xs text-subtle">{EM_ANDAMENTO[rodando]}</span>}
      </div>

      {estado.emailForaDoDominio && !rodando && (
        <p className="mt-2 text-xs text-warn">
          O e-mail atual é de um domínio diferente do da empresa — herança de cadastro
          antigo. Vou procurar o do decisor no domínio certo; só troco se o servidor
          confirmar.
        </p>
      )}
      {estado.emailDeBalcao && !estado.emailForaDoDominio && !rodando && (
        <p className="mt-2 text-xs text-warn">
          O e-mail atual é de caixa compartilhada. Vou procurar o do decisor no mesmo
          domínio — e só troco se o servidor confirmar.
        </p>
      )}

      {linhas.length > 0 && (
        <ul className="mt-3 space-y-1">
          {linhas.map((l, i) => (
            <li key={i} className={`text-xs ${cor(l.tom)}`}>
              <span className="inline-block w-4">{icone(l.tom)}</span>
              <b className="font-medium">{ROTULO[l.passo]}</b>: {l.texto}
            </li>
          ))}
        </ul>
      )}

      {pronto && !rodando && (
        <p className="mt-2 text-xs text-subtle">
          Terminei. O que ficou em branco ou não existe publicado, ou o servidor do
          domínio não confirma — nos dois casos insistir agora não muda o resultado.
        </p>
      )}
    </div>
  );
}
