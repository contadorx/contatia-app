"use client";

import { useState, useTransition } from "react";
import {
  saveWhatsApp,
  deleteWhatsApp,
  whatsappQR,
  whatsappStatus,
  whatsappSetWebhook,
  setWhatsAppMode,
} from "@/app/dashboard/config/whatsapp-actions";

type Acc = { id: string; evolution_url: string; instance: string; is_active: boolean; inbound_token: string };
type Mode = "assistido" | "evolution" | "meta";

// ============================================================
// WhatsApp — o NÍVEL é escolha do cliente (trade-off de risco):
//   1) Link wa.me (assistido) — zero risco. Default.
//   2) API não-oficial (Evolution) — com risco, exige aceite.
//   3) API oficial da Meta — roadmap (ainda não disponível).
// ============================================================
export default function WhatsAppConnect({
  accounts,
  mode = "assistido",
  acked = false,
  platformReady = false,
}: {
  accounts: Acc[];
  mode?: Mode;
  acked?: boolean;
  platformReady?: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [showAck, setShowAck] = useState(false);
  const [ack, setAck] = useState(false);

  function escolher(m: "assistido" | "evolution", ackRisk?: boolean) {
    setErr(null);
    start(async () => {
      const res = (await setWhatsAppMode(m, ackRisk)) as { ok?: boolean; needsAck?: boolean; error?: string };
      if (res?.needsAck) {
        setShowAck(true);
        return;
      }
      if (res?.error) setErr(res.error);
      else {
        setShowAck(false);
        setAck(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* NÍVEL 1 — LINK wa.me (assistido) */}
      <ModeCard
        selected={mode === "assistido"}
        badge="Zero risco"
        badgeClass="bg-signal/10 text-signal"
        title="Link do WhatsApp (assistido)"
        desc="A mensagem cai pronta na sua fila. Você clica, abre o SEU WhatsApp já com o texto preenchido e envia. Nada é automatizado — por isso não há risco nenhum de bloqueio do número."
        action={
          mode === "assistido" ? (
            <span className="text-xs font-semibold text-signal">✓ Em uso</span>
          ) : (
            <button className="btn-ghost py-1.5 text-sm" disabled={pending} onClick={() => escolher("assistido")}>
              Usar este modo
            </button>
          )
        }
      />

      {/* NÍVEL 2 — API não-oficial (Evolution) */}
      <ModeCard
        selected={mode === "evolution"}
        badge="Com risco de bloqueio"
        badgeClass="bg-warn/10 text-warn"
        title="API não-oficial (envio automático + captura de resposta)"
        desc="Conecta seu número por QR e a Contatia envia da fila e recebe as respostas sozinha (a cadência pausa quando o lead responde). Usa um protocolo NÃO-OFICIAL do WhatsApp — é mais produtivo, mas viola os termos e existe risco REAL de banimento do número."
        action={
          mode === "evolution" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-warn">✓ Em uso</span>
              <button className="btn-ghost py-1.5 text-xs" disabled={pending} onClick={() => escolher("assistido")}>
                Desativar
              </button>
            </div>
          ) : (
            <button className="btn-ghost py-1.5 text-sm" disabled={pending} onClick={() => escolher("evolution", acked || undefined)}>
              {acked ? "Ativar" : "Ativar (aceitar risco)"}
            </button>
          )
        }
      />

      {/* aceite de risco (aparece ao ativar pela primeira vez) */}
      {showAck && mode !== "evolution" && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <p className="text-sm font-semibold text-warn">Antes de ativar, confirme que você entende o risco</p>
          <p className="mt-1 text-sm text-ink/80">
            O modo não-oficial usa o protocolo do WhatsApp Web (Baileys). <b>Não</b> é a API oficial da Meta e
            viola os Termos de Serviço do WhatsApp. Há risco <b>real</b> de banimento do número, que a Contatia
            não pode evitar nem reverter. Recomendamos usar um número <b>secundário/dedicado</b>, nunca o
            pessoal principal. Para operar sem risco de ban, use o modo assistido (link) — ou aguarde a API
            oficial da Meta.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>Li e assumo o risco de banimento no meu número ao usar o modo não-oficial.</span>
          </label>
          <div className="mt-3 flex gap-2">
            <button className="btn-brand py-1.5 text-sm" disabled={pending || !ack} onClick={() => escolher("evolution", true)}>
              {pending ? "Ativando…" : "Aceitar e ativar"}
            </button>
            <button className="btn-ghost py-1.5 text-sm" onClick={() => { setShowAck(false); setAck(false); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* NÍVEL 3 — API oficial da Meta (roadmap) */}
      <ModeCard
        selected={false}
        disabled
        badge="Em breve"
        badgeClass="bg-muted text-subtle"
        title="API oficial da Meta (Cloud API)"
        desc="O canal oficial e aprovado pela Meta: sem risco de banimento. Está no nosso roadmap de produtização — assim que disponível, você poderá migrar sem trocar nada do seu fluxo."
        action={<span className="text-xs text-subtle">No roadmap</span>}
      />

      {err && <p className="text-sm text-danger">{err}</p>}

      {/* ÁREA DE CONEXÃO — só quando o modo Evolution está ativo */}
      {mode === "evolution" && (
        <div className="rounded-xl border border-line bg-muted/40 p-4">
          <p className="text-sm font-semibold">Conexão do número</p>
          {platformReady ? (
            <p className="mt-0.5 text-xs text-subtle">
              O servidor é gerenciado pela Contatia — você só precisa escanear o QR abaixo com o WhatsApp do
              número que vai usar.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-subtle">
              Informe os dados do seu servidor Evolution para conectar o número.
            </p>
          )}

          {accounts.map((a) => (
            <AccountRow key={a.id} acc={a} />
          ))}

          {/* sem instância ainda: modo avançado (traga seu servidor) */}
          {(!platformReady || accounts.length === 0) && <ByoForm />}
        </div>
      )}
    </div>
  );
}

function ModeCard({
  selected,
  disabled,
  badge,
  badgeClass,
  title,
  desc,
  action,
}: {
  selected: boolean;
  disabled?: boolean;
  badge: string;
  badgeClass: string;
  title: string;
  desc: string;
  action: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        selected ? "border-brand bg-brand-soft/40" : disabled ? "border-line bg-muted/30 opacity-70" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badgeClass}`}>{badge}</span>
          </div>
          <p className="mt-1 text-sm text-subtle">{desc}</p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}

// Formulário "traga seu servidor" (BYO) — modo avançado, para quem não usa o
// servidor gerenciado da plataforma.
function ByoForm() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ evolution_url: "", api_key: "", instance: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveWhatsApp(f);
      if (res?.error) setMsg(res.error);
      else {
        setF({ evolution_url: "", api_key: "", instance: "" });
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className="btn-ghost mt-3 text-xs" onClick={() => setOpen(true)}>
        Usar meu próprio servidor Evolution (avançado)
      </button>
    );

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <input className="input" value={f.evolution_url} onChange={(e) => setF({ ...f, evolution_url: e.target.value })} placeholder="URL Evolution (https://evo...)" />
        <input className="input" value={f.instance} onChange={(e) => setF({ ...f, instance: e.target.value })} placeholder="Nome da instância" />
        <input className="input" type="password" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} placeholder="API key" />
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "..." : "Conectar"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function AccountRow({ acc }: { acc: Acc }) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function showQR() {
    setErr(null);
    setQr(null);
    start(async () => {
      const res = (await whatsappQR(acc.id)) as { base64?: string; error?: string };
      if (res?.error) setErr(res.error);
      else if (res?.base64) {
        const v = res.base64;
        setQr(v.startsWith("data:") || v.startsWith("http") ? v : `data:image/png;base64,${v}`);
      }
    });
  }
  function checkStatus() {
    setErr(null);
    start(async () => {
      const res = (await whatsappStatus(acc.id)) as { state?: string; error?: string };
      if (res?.error) setErr(res.error);
      else setState(res.state || "—");
    });
  }
  function remove() {
    start(async () => void (await deleteWhatsApp(acc.id)));
  }

  const [busyWh, setBusyWh] = useState(false);
  const [msgWh, setMsgWh] = useState<string | null>(null);

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{acc.instance}</p>
          <p className="text-xs text-subtle">{acc.evolution_url}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button className="text-subtle hover:text-ink" onClick={showQR} disabled={pending}>Mostrar QR</button>
          <button className="text-subtle hover:text-ink" onClick={checkStatus} disabled={pending}>Conexão</button>
          <button className="text-subtle hover:text-danger" onClick={remove} disabled={pending} title="Desconecta este número. Para trocar de número, remova e ative de novo.">Remover</button>
        </div>
      </div>
      {state && <p className="mt-2 text-xs">Conexão: <b className={state === "open" ? "text-signal" : "text-warn"}>{state}</b></p>}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      {qr && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-subtle">Escaneie com o WhatsApp do número:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR WhatsApp" className="h-48 w-48 rounded-lg border border-line" />
        </div>
      )}
      <div className="mt-4 rounded-xl border border-line bg-muted p-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 font-semibold text-signal">✓</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">As respostas dos leads chegam sozinhas</p>
            <p className="mt-0.5 text-xs text-subtle">
              Assim que você escaneia o QR, a Contatia já passa a receber as respostas — e a
              cadência de quem responde <b>pausa automaticamente</b>. Você não precisa configurar nada.
            </p>
          </div>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-subtle">Não está recebendo as respostas?</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="btn-ghost text-xs"
              disabled={busyWh}
              onClick={async () => {
                setBusyWh(true);
                const r = (await whatsappSetWebhook(acc.id)) as any;
                setBusyWh(false);
                setMsgWh(r?.error || "Pronto — o recebimento das respostas foi reativado.");
              }}
            >
              {busyWh ? "Reativando…" : "Reativar recebimento"}
            </button>
            {msgWh && <span className="text-xs font-medium text-brand-dark">{msgWh}</span>}
          </div>
        </details>
      </div>
    </div>
  );
}
