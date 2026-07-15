"use client";

import { useState, useTransition } from "react";
import { buscarEmailAgora, type ResultadoBusca } from "@/app/dashboard/contatos/discovery-actions";

// ============================================================
// BUSCA DO E-MAIL DO DECISOR
//
// A versão anterior enfileirava a busca e dizia "resultado em alguns minutos" —
// mas o processamento só rodava 1x por dia. O usuário ficava no escuro.
//
// Agora: a busca roda NA HORA, mostra o que está fazendo enquanto trabalha, e
// explica o resultado em português — inclusive quando NÃO acha (dizendo o porquê
// e o que fazer em seguida).
// ============================================================

const ICONE: Record<string, string> = {
  valid: "✓",
  published: "✉",
  not_found: "✕",
  uncertain: "?",
  blocked: "🔒",
  invalid: "✕",
  error: "!",
  sem_worker: "⚙",
};

const COR: Record<string, string> = {
  valid: "border-signal/30 bg-signal/10 text-signal",
  published: "border-brand/30 bg-brand-soft text-brand-dark",
  not_found: "border-warn/30 bg-warn/10 text-warn",
  uncertain: "border-warn/30 bg-warn/10 text-warn",
  blocked: "border-warn/30 bg-warn/10 text-warn",
  invalid: "border-danger/30 bg-danger/10 text-danger",
  error: "border-danger/30 bg-danger/10 text-danger",
  sem_worker: "border-line bg-muted text-subtle",
};

export function EmailFinder({
  contactId,
  contactName,
  companyDomain,
  discovery,
}: {
  contactId: string;
  contactName?: string;
  companyDomain?: string | null;
  discovery?: string | null;
}) {
  const [dominio, setDominio] = useState(companyDomain || "");
  const [res, setRes] = useState<ResultadoBusca | null>(null);
  const [pending, start] = useTransition();
  const [verDetalhes, setVerDetalhes] = useState(false);

  /** limpa o que o usuário colar: https://, www., caminho */
  function limpar(v: string): string {
    let s = (v || "").trim().toLowerCase();
    if (s.includes("@")) s = s.split("@").pop() || "";
    return s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0].trim();
  }

  function buscar() {
    const limpo = limpar(dominio);
    if (!limpo || !limpo.includes(".")) {
      setRes({
        ok: false,
        status: "invalid",
        titulo: "Domínio inválido",
        detalhe: "Digite algo como empresa.com.br — pode colar o site completo que eu limpo.",
      });
      return;
    }
    setDominio(limpo);
    setRes(null);
    start(async () => {
      const r = await buscarEmailAgora(contactId, limpo);
      setRes(r);
      // NÃO recarrega sozinho — deixa o resultado na tela até o usuário atualizar
    });
  }

  // já buscamos antes e não achamos? mostra o histórico
  const jaTentou = discovery && discovery !== "pending" && !res;

  // nome de um termo só = padrões de decisor ficam fracos (colapsam num único palpite)
  const semSobrenome = (contactName || "").trim().split(/\s+/).filter(Boolean).length < 2;

  return (
    <div className="card mt-4 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-lg">🔎</div>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">Achar o e-mail de {contactName || "quem decide"}</p>
          <p className="mt-1 text-sm text-subtle">
            O LinkedIn não mostra e-mail. Diga o <b>site da empresa</b> e eu testo os padrões
            (joao.silva@, jsilva@, joao@…), <b>confirmando com o servidor dela</b> se a caixa
            existe. Se não confirmar, procuro o e-mail que a empresa <b>publicou no site</b>.
          </p>
          {semSobrenome && (
            <p className="mt-2 rounded-lg bg-warn/10 p-2 text-xs text-warn">
              Este contato tem só um nome. Adicione o <b>sobrenome</b> em “Editar dados” para testar todos os padrões (nome.sobrenome@, nsobrenome@…). Só com o primeiro nome, testamos um único palpite.
            </p>
          )}
        </div>
      </div>

      {/* CAMPO + BOTÃO */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label className="label">Site da empresa</label>
          <input
            className="input mt-1"
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            placeholder="empresa.com.br"
            disabled={pending}
            onKeyDown={(e) => e.key === "Enter" && !pending && buscar()}
          />
        </div>
        <button className="btn-brand" onClick={buscar} disabled={pending || !dominio.trim()}>
          {pending ? "Procurando…" : "Procurar e-mail"}
        </button>
      </div>

      {/* ENQUANTO PROCURA — mostrar que está trabalhando */}
      {pending && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft p-4">
          <div className="flex items-center gap-3">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <div>
              <p className="text-sm font-semibold text-brand-dark">Conversando com o servidor de {limpar(dominio)}…</p>
              <p className="mt-0.5 text-xs text-subtle">
                Testando os padrões de e-mail um a um. Leva de 5 a 30 segundos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* RESULTADO */}
      {res && !pending && (
        <div className={`mt-4 rounded-xl border p-4 ${COR[res.status] || COR.error}`}>
          <div className="flex items-start gap-3">
            <span className="text-lg leading-none">{ICONE[res.status] || "!"}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{res.titulo}</p>

              {res.email && (
                <p className="mt-1 font-mono text-sm font-bold">{res.email}</p>
              )}

              <p className="mt-1 text-sm opacity-90">{res.detalhe}</p>

              {res.ok && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-signal/15 px-2 py-0.5 text-xs font-semibold text-signal">✓ salvo no contato</span>
                  <button
                    onClick={() => window.location.reload()}
                    className="rounded-lg border border-signal/40 px-2 py-0.5 text-xs font-medium text-signal hover:bg-signal/10"
                  >
                    Atualizar a ficha
                  </button>
                </div>
              )}

              {/* o que foi testado (transparência) */}
              {res.tentativas && res.tentativas.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setVerDetalhes(!verDetalhes)}
                    className="text-xs font-semibold underline opacity-75 hover:opacity-100"
                  >
                    {verDetalhes ? "ocultar" : `ver ${res.tentativas.length} endereço${res.tentativas.length === 1 ? "" : "s"} testado${res.tentativas.length === 1 ? "" : "s"}`}
                  </button>
                  {verDetalhes && (
                    <ul className="mt-2 space-y-0.5 font-mono text-xs opacity-75">
                      {res.tentativas.map((t, i) => (
                        <li key={i}>
                          {t.status === "valid" ? "✓" : "✕"} {t.email}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* o que fazer agora */}
              {!res.ok && ["not_found", "uncertain", "blocked"].includes(res.status) && (
                <p className="mt-2 text-xs opacity-75">
                  Sem e-mail confiável, este contato deve seguir por <b>WhatsApp</b> ou <b>LinkedIn</b>.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BUSCA ANTERIOR (sem resultado novo na tela) */}
      {jaTentou && (
        <p className="mt-3 text-xs text-subtle">
          Uma busca anterior não encontrou e-mail neste domínio
          {discovery === "blocked" && " (o provedor bloqueia a verificação)"}
          {discovery === "uncertain" && " (o domínio aceita qualquer endereço)"}
          . Você pode tentar outro domínio acima.
        </p>
      )}
    </div>
  );
}
