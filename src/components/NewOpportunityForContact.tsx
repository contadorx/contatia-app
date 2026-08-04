"use client";

import { useState, useTransition } from "react";
import { createOpportunityForContact } from "@/app/dashboard/contatos/ficha-actions";

// `compacto` deixa o botão caber onde o espaço é curto (cabeçalho da conversa na caixa,
// linha de reunião) sem virar um segundo componente com a mesma lógica.
export default function NewOpportunityForContact({
  contactId,
  defaultTitle,
  compacto = false,
  rotulo,
}: {
  contactId: string;
  defaultTitle: string;
  compacto?: boolean;
  rotulo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ============================================================
  // 1.500 NÃO É MIL E QUINHENTOS PARA O JAVASCRIPT
  //
  // Era `Number(valor.replace(",", "."))`. Quem digita à brasileira escreve 1.500 e o
  // JS lê 1,5 — o negócio nascia com R$ 1,50 e o pipeline mostrava "R$ 2/mês". Com
  // 1.234,56 o resultado era NaN, que o `|| 0` transformava em negócio de R$ 0,
  // criado com sucesso e sem aviso nenhum. O forecast herdava tudo isso.
  //
  // Agora o ponto de milhar sai antes, a vírgula vira ponto, e valor inválido é
  // RECUSADO em vez de virar zero — zero silencioso é pior que erro na tela.
  // ============================================================
  function valorEmReais(t: string): number | null {
    const limpo = String(t || "").trim().replace(/\s|R\$/g, "");
    if (!limpo) return 0;
    const n = Number(limpo.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function salvar() {
    setErro(null);
    const v = valorEmReais(valor);
    if (v === null) { setErro("Valor inválido. Use 1.500 ou 1500,00."); return; }
    start(async () => {
      const r: any = await createOpportunityForContact(contactId, { title, value_mrr: v });
      if (r?.error) { setErro(r.error); return; }
      setValor("");
      setOpen(false);
    });
  }

  if (!open) {
    return compacto ? (
      <button
        type="button"
        className="rounded-lg border border-brand/40 px-2 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-soft"
        onClick={() => setOpen(true)}
        title="Abre um negócio no pipeline com este contato."
      >
        {rotulo || "+ Negócio"}
      </button>
    ) : (
      <button className="btn-brand py-1.5 text-sm" onClick={() => setOpen(true)}>+ Nova oportunidade</button>
    );
  }

  return (
    <div className="card mt-2 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input sm:col-span-2" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder="Valor mensal (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={salvar} disabled={pending}>{pending ? "Criando…" : "Criar oportunidade"}</button>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>cancelar</button>
      </div>
    </div>
  );
}
