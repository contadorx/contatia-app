"use client";

// ============================================================
// REVISAR OS DADOS DE CONTATO (ficha)
//
// A queixa: "nos contatos já estabelecidos não tem como revisar para ver se encontra
// informações de e-mail ou whats mais atuais". Era verdade — as duas ferramentas
// existiam, mas só para quem NÃO tinha o dado:
//
//  · a busca de e-mail só aparecia quando o contato estava sem e-mail, e a ação
//    recusava com "apague o e-mail atual se quiser procurar outro";
//  · a verificação de WhatsApp só existia em LOTE, na lista — não na ficha.
//
// Aqui as duas ficam disponíveis para qualquer contato, fechadas por padrão (é
// manutenção, não é o trabalho do dia). O e-mail atual só é substituído quando o
// servidor confirma um endereço diferente.
// ============================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmailFinder } from "@/components/EmailFinder";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";

const SELO_WA: Record<string, { txt: string; cls: string }> = {
  valid: { txt: "tem WhatsApp", cls: "bg-signal/10 text-signal" },
  invalid: { txt: "não tem WhatsApp", cls: "bg-muted text-subtle" },
  queued: { txt: "na fila de verificação", cls: "bg-warn/10 text-warn" },
  error: { txt: "a verificação falhou", cls: "bg-amber-100 text-amber-700" },
};

export default function RevisarContato({
  contactId,
  contactName,
  email,
  phone,
  waStatus,
  waCheckedAt,
  companyDomain,
  discovery,
}: {
  contactId: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  waStatus: string | null;
  waCheckedAt: string | null;
  companyDomain: string | null;
  discovery: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(null);

  const selo = waStatus ? SELO_WA[waStatus] : null;
  const quando = waCheckedAt
    ? new Date(waCheckedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  function reverificarWa() {
    setRecado(null);
    start(async () => {
      const r: any = await verificarWhatsAppLote([contactId]);
      if (r?.error) { setRecado({ ok: false, texto: r.error }); return; }
      if (r?.semTelefone) { setRecado({ ok: false, texto: "Este contato não tem telefone para verificar." }); return; }
      if (r?.enfileirados) { setRecado({ ok: true, texto: "Número enfileirado — o resultado sai na próxima passada da verificação (de hora em hora)." }); router.refresh(); return; }
      setRecado({
        ok: true,
        texto: r?.comWa ? "Verificado agora: o número TEM WhatsApp." : "Verificado agora: o número NÃO tem WhatsApp.",
      });
      router.refresh();
    });
  }

  return (
    <div className="card mt-4 p-0">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/50"
        onClick={() => setAberto((a) => !a)}
      >
        <div className="text-sm">
          <b>Revisar dados de contato</b>{" "}
          <span className="text-subtle">
            — conferir se existe e-mail ou WhatsApp mais atual
          </span>
        </div>
        <span className="text-xs text-subtle">{aberto ? "fechar" : "abrir"}</span>
      </button>

      {aberto && (
        <div className="border-t border-line px-5 py-4">
          {/* ---- WhatsApp ---- */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">WhatsApp:</span>
            {phone ? (
              <>
                <span className="text-subtle">{phone}</span>
                {selo ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo.cls}`}>{selo.txt}</span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">nunca verificado</span>
                )}
                {quando && <span className="text-xs text-subtle">· verificado em {quando}</span>}
                <button
                  type="button"
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
                  disabled={pending}
                  onClick={reverificarWa}
                >
                  {pending ? "Verificando…" : selo ? "Verificar de novo" : "Verificar agora"}
                </button>
              </>
            ) : (
              <span className="text-subtle">sem telefone cadastrado — edite os dados para incluir um.</span>
            )}
          </div>
          {recado && (
            <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${recado.ok ? "bg-brand-soft text-brand-dark" : "bg-danger/10 text-danger"}`}>
              {recado.texto}
            </p>
          )}

          {/* ---- E-mail ---- */}
          <div className="mt-4 border-t border-line pt-4">
            {email ? (
              <EmailFinder
                contactId={contactId}
                contactName={contactName}
                companyDomain={companyDomain}
                discovery={discovery}
                revisao
                emailAtual={email}
              />
            ) : (
              <p className="text-sm text-subtle">
                Este contato está sem e-mail — o buscador completo aparece logo abaixo, fora deste painel.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
