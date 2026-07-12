"use client";

import { useState, useTransition } from "react";
import { enqueueEmailDiscovery } from "@/app/dashboard/contatos/discovery-actions";

// ============================================================
// Aparece quando o contato não tem e-mail (típico dos leads do LinkedIn).
// Você informa o site da empresa; o Contatia testa os padrões corporativos
// (joao.silva@, jsilva@…) e CONFIRMA no servidor se a caixa existe.
// Só grava o e-mail se o servidor confirmar. Nunca chuta.
// ============================================================

const EXPLICACAO: Record<string, string> = {
  pending: "Procurando o e-mail… o resultado aparece em alguns minutos.",
  valid: "E-mail encontrado e confirmado no servidor.",
  not_found: "Testamos os padrões de e-mail deste domínio e nenhum existe. Use WhatsApp ou LinkedIn com este contato.",
  uncertain: "O servidor deste domínio aceita qualquer endereço (catch-all), então não dá para confiar num palpite. Use WhatsApp ou peça o e-mail.",
  blocked: "O provedor (Google/Microsoft) não permite verificar se a caixa existe. Use WhatsApp ou peça o e-mail.",
  invalid: "Este domínio não tem servidor de e-mail.",
};

export function EmailFinder({
  contactId,
  companyDomain,
  discovery,
}: {
  contactId: string;
  companyDomain?: string | null;
  discovery?: string | null;
}) {
  const [dominio, setDominio] = useState(companyDomain || "");
  const [msg, setMsg] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(
    discovery && discovery !== "pending" && EXPLICACAO[discovery]
      ? { t: discovery === "valid" ? "ok" : "info", m: EXPLICACAO[discovery] }
      : null
  );
  const [pending, start] = useTransition();

  function buscar() {
    setMsg(null);
    start(async () => {
      const r = (await enqueueEmailDiscovery(contactId, dominio)) as any;
      if (r?.error) setMsg({ t: "err", m: r.error });
      else setMsg({ t: "info", m: r.msg || EXPLICACAO.pending });
    });
  }

  return (
    <div className="card mt-4 p-5">
      <p className="font-display font-semibold">Sem e-mail — procurar o do decisor?</p>
      <p className="mt-1 text-sm text-subtle">
        O LinkedIn não mostra e-mail. Informe o site da empresa e o Contatia testa os padrões
        corporativos, <b>confirmando no servidor se a caixa existe</b> antes de gravar. Se não
        confirmar, nada é enviado — o contato segue por WhatsApp.
      </p>

      {msg && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm ${
            msg.t === "ok" ? "bg-signal/10 text-signal" : msg.t === "err" ? "bg-danger/10 text-danger" : "bg-brand-soft text-brand-dark"
          }`}
        >
          {msg.m}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1" style={{ minWidth: 220 }}>
          <label className="label">Site ou domínio da empresa</label>
          <input
            className="input mt-1"
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            placeholder="empresa.com.br"
            onKeyDown={(e) => e.key === "Enter" && dominio && buscar()}
          />
        </div>
        <button className="btn-brand" onClick={buscar} disabled={pending || !dominio.trim()}>
          {pending ? "Procurando…" : "Procurar e-mail"}
        </button>
      </div>

      <p className="mt-2 text-xs text-subtle">
        Pode colar o endereço completo (https://www.empresa.com.br/sobre) — usamos só o domínio.
      </p>
    </div>
  );
}
