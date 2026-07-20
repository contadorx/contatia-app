"use client";

import { useState, useTransition } from "react";
import { checkMyDomain, checkSpamContent } from "@/app/dashboard/config/domain-actions";
import SpamScore, { type SpamResultView } from "@/components/SpamScore";

type Health = {
  domain: string;
  mx: { ok: boolean; records: string[] };
  spf: { ok: boolean; value?: string; includesBrevo?: boolean };
  dmarc: { ok: boolean; value?: string; policy?: string };
  dkim: { ok: boolean; foundSelectors: string[] };
  score: number;
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

export function DomainHealthPanel() {
  const [manual, setManual] = useState("");
  const [res, setRes] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Teste de spam do conteúdo (SpamAssassin via Postmark)
  const [subj, setSubj] = useState("");
  const [body, setBody] = useState("");
  const [spam, setSpam] = useState<SpamResultView | null>(null);
  const [spamErr, setSpamErr] = useState<string | null>(null);
  const [spamPending, startSpam] = useTransition();

  function run() {
    setErr(null);
    start(async () => {
      const r = (await checkMyDomain(manual || undefined)) as any;
      if (r?.error) setErr(r.error);
      else setRes(r.result);
    });
  }

  function runSpam() {
    setSpamErr(null);
    setSpam(null);
    startSpam(async () => {
      const r = (await checkSpamContent(subj, body)) as any;
      if (r?.error) setSpamErr(r.error);
      else setSpam(r.result);
    });
  }

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

      {/* Teste de spam do CONTEÚDO — complementa o DNS acima. */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-semibold">Teste de spam do conteúdo</p>
        <p className="mt-0.5 text-xs text-subtle">
          O de cima checa se o <b>domínio</b> está configurado. Este roda o <b>texto do e-mail</b> pelo SpamAssassin
          (a mesma engine dos provedores) e aponta o que aumenta o risco de spam. Grátis, sem enviar nada a ninguém.
        </p>
        <div className="mt-3">
          <label className="label">Assunto</label>
          <input className="input mt-1" value={subj} onChange={(e) => setSubj(e.target.value)} placeholder="Cole aqui o assunto do e-mail" />
        </div>
        <div className="mt-3">
          <label className="label">Corpo do e-mail</label>
          <textarea
            className="input mt-1 min-h-[120px] leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Cole aqui o corpo do e-mail (pode ser com texto ou HTML)."
          />
        </div>
        <button className="btn-brand mt-3" disabled={spamPending} onClick={runSpam}>
          {spamPending ? "Testando..." : "Testar conteúdo"}
        </button>
        {spamErr && <p className="mt-3 text-sm text-danger">{spamErr}</p>}
        {spam && <SpamScore result={spam} />}
      </div>
    </div>
  );
}
