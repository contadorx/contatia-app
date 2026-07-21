"use client";

import { useEffect, useState, useTransition } from "react";
import { checkMyDomain, deliveryHealth } from "@/app/dashboard/config/domain-actions";

type Health = {
  domain: string;
  mx: { ok: boolean; records: string[] };
  spf: { ok: boolean; value?: string; includesBrevo?: boolean };
  dmarc: { ok: boolean; value?: string; policy?: string };
  dkim: { ok: boolean; foundSelectors: string[] };
  score: number;
};

type Delivery = {
  sent: number;
  clicks: number;
  clickRate: number;
  replies: number;
  replyRate: number;
  bounces: number;
  bounceRate: number;
  suppressed: number;
};

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-subtle">{detail}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? "bg-signal/10 text-signal" : "bg-danger/10 text-danger"}`}>
        {ok ? "✓ OK" : "✕ Falta"}
      </span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="font-display text-xl font-bold">{value}</p>
      <p className="text-xs font-medium">{label}</p>
      {sub && <p className="text-[11px] text-subtle">{sub}</p>}
    </div>
  );
}

export function DomainHealthPanel() {
  const [manual, setManual] = useState("");
  const [res, setRes] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Saúde de envio (engajamento real dos últimos 30 dias)
  const [del, setDel] = useState<Delivery | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delPending, startDel] = useTransition();

  function run() {
    setErr(null);
    start(async () => {
      const r = (await checkMyDomain(manual || undefined)) as any;
      if (r?.error) setErr(r.error);
      else setRes(r.result);
    });
  }

  function loadDelivery() {
    setDelErr(null);
    startDel(async () => {
      const r = (await deliveryHealth()) as any;
      if (r?.error) setDelErr(r.error);
      else setDel(r.result);
    });
  }

  // Carrega o resumo de envio automaticamente ao abrir a tela.
  useEffect(() => {
    loadDelivery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scoreColor = res ? (res.score >= 4 ? "text-signal" : res.score >= 2 ? "text-warn" : "text-danger") : "";

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1" style={{ minWidth: 220 }}>
          <label className="label">Domínio</label>
          <input className="input mt-1" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="em branco = usa o da sua caixa (ex.: contatia.com.br)" />
        </div>
        <button className="btn-brand" disabled={pending} onClick={run}>{pending ? "Checando..." : "Checar domínio"}</button>
      </div>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      {res && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm">Domínio <b>{res.domain}</b></p>
            <p className={`font-display text-lg font-bold ${scoreColor}`}>{res.score}/4</p>
          </div>
          <div className="mt-2">
            <Row ok={res.mx.ok} label="MX — recebe e-mail" detail={res.mx.ok ? `${res.mx.records.length} servidor(es): ${res.mx.records.slice(0, 2).join(", ")}` : "Sem MX. O domínio não recebe respostas — a detecção por IMAP não funcionará."} />
            <Row ok={res.spf.ok} label="SPF — autoriza quem envia" detail={res.spf.ok ? (res.spf.includesBrevo ? "Presente e inclui o Brevo." : "Presente. Confirme se inclui o provedor de envio (Brevo).") : "Sem SPF. Adicione o TXT de SPF do seu provedor para não cair em spam."} />
            <Row ok={res.dkim.ok} label="DKIM — assina os e-mails" detail={res.dkim.ok ? `Selectors encontrados: ${res.dkim.foundSelectors.join(", ")}` : "Nenhum selector DKIM conhecido encontrado. No Brevo, adicione os registros brevo1/brevo2 no DNS."} />
            <Row ok={res.dmarc.ok} label="DMARC — política de proteção" detail={res.dmarc.ok ? `Presente (política: ${res.dmarc.policy || "?"}).` : "Sem DMARC. Adicione _dmarc com v=DMARC1; p=none para começar a monitorar."} />
          </div>
          <p className="mt-3 text-xs text-subtle">
            {res.score >= 4
              ? "Domínio bem configurado para envio. Ótima base de entregabilidade."
              : "Faltam registros. Enquanto não estiverem OK, seus e-mails têm mais chance de cair em spam. Configure no DNS do domínio (não no app) — cada provedor (Brevo, HostGator) fornece os valores exatos."}
          </p>
        </div>
      )}

      {/* Saúde de envio — engajamento real (funciona no SMTP puro, sem API externa). */}
      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Saúde de envio — engajamento (30 dias)</p>
          <button className="text-xs font-medium text-subtle hover:text-brand disabled:opacity-50" onClick={loadDelivery} disabled={delPending}>
            {delPending ? "atualizando…" : "atualizar"}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-subtle">
          O bloco de cima checa a <b>configuração</b> do domínio. Este mostra o que seus envios reais estão gerando —
          atividade é o melhor sinal, sem feedback do provedor, de que você está caindo na caixa de entrada.
        </p>

        {delErr && <p className="mt-3 text-sm text-danger">{delErr}</p>}

        {del && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="E-mails enviados" value={del.sent} />
              <Stat label="Cliques em links" value={del.clicks} sub={del.sent ? `${del.clickRate.toFixed(1)}% dos envios` : "—"} />
              <Stat label="Respostas" value={del.replies} sub={del.sent ? `${del.replyRate.toFixed(1)}% dos envios` : "—"} />
              <Stat label="Bounces (30d)" value={del.bounces} sub={del.sent ? `${del.bounceRate.toFixed(1)}% dos envios` : "não entregues"} />
            </div>
            {del.sent === 0 && (
              <p className="mt-2 text-xs text-subtle">Sem envios nos últimos 30 dias ainda — os números aparecem conforme suas cadências rodarem.</p>
            )}
            {del.bounceRate > 3 && del.sent >= 50 && (
              <p className="mt-2 text-xs text-warn">⚠ Bounce acima de 3% queima reputação. Vale limpar a base (a supressão já bloqueia os que voltaram) e reduzir o ritmo de envio.</p>
            )}
            <p className="mt-3 text-[11px] text-subtle">
              <b>{del.suppressed}</b> e-mail(s) na lista de supressão (não recebem mais). Os <b>bounces</b> são capturados
              automaticamente: por webhook, se você usa Brevo, e agora também por <b>IMAP</b> (o app lê os retornos
              "mailer-daemon" que caem na sua caixa) — funciona em SMTP puro. <b>Reclamação de spam</b> e reputação do
              Gmail continuam só via Google Postmaster.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
