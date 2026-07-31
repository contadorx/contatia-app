"use client";

// ============================================================
// SELO DE DONO + BOTÃO DE COMPARTILHAR — caixa de e-mail e instância de WhatsApp
//
// Depois da 0104 uma caixa pode ser SUA, de OUTRA PESSOA ou DO WORKSPACE, e isso muda o
// que acontece no envio. Sem dizer isso na tela, o dono ficaria adivinhando por qual
// endereço o e-mail dele sai.
//
// O aviso ao compartilhar não é enfeite: compartilhar libera a leitura da linha inteira
// da caixa para o resto do workspace — inclusive a senha SMTP / a api_key. Quem clica
// precisa saber disso ANTES.
// ============================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DonoDaCaixa({
  userId,
  isShared,
  meuId,
  nomeDono,
  tipo,
  onCompartilhar,
}: {
  userId: string | null;
  isShared: boolean | null;
  meuId: string | null;
  nomeDono?: string;
  tipo: "email" | "whatsapp";
  onCompartilhar: (compartilhada: boolean) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const doWorkspace = !userId;
  const minha = !!userId && userId === meuId;
  const compartilhada = !!isShared;
  const rotulo = tipo === "email" ? "caixa" : "número";

  function alternar() {
    const ligando = !compartilhada;
    if (ligando) {
      const ok = confirm(
        `Compartilhar esta ${rotulo} com o workspace?\n\n` +
        `Outras pessoas passam a poder enviar por ela quando não tiverem a delas — e passam a ` +
        `enxergar a configuração completa, ${tipo === "email" ? "inclusive a senha SMTP" : "inclusive a chave da API"}.\n\n` +
        `Só compartilhe se essa ${rotulo} for do escritório, não pessoal.`
      );
      if (!ok) return;
    }
    setErro(null);
    start(async () => {
      const r = await onCompartilhar(ligando);
      if (r?.error) { setErro(r.error); return; }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {doWorkspace ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle" title="Sem dono definido: vale para todo mundo do workspace. É como todas as caixas funcionavam antes.">
          do workspace
        </span>
      ) : minha ? (
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-dark" title={`Seus envios saem por aqui — e as respostas voltam para você.`}>
          minha
        </span>
      ) : (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">
          de {nomeDono || "outra pessoa"}
        </span>
      )}

      {!doWorkspace && (
        compartilhada ? (
          <button
            className="rounded-full bg-signal/10 px-2 py-0.5 text-xs font-medium text-signal hover:bg-signal/20 disabled:opacity-50"
            onClick={alternar}
            disabled={pending || (!minha && !!userId)}
            title="Compartilhada: outras pessoas podem enviar por ela. Clique para tornar privada."
          >
            {pending ? "…" : "compartilhada"}
          </button>
        ) : (
          <button
            className="rounded-full border border-line px-2 py-0.5 text-xs text-subtle hover:bg-muted disabled:opacity-50"
            onClick={alternar}
            disabled={pending || (!minha && !!userId)}
            title="Privada: só você envia por ela. Clique para emprestar ao workspace."
          >
            {pending ? "…" : "privada"}
          </button>
        )
      )}

      {erro && <span className="text-xs text-danger">{erro}</span>}
    </span>
  );
}
