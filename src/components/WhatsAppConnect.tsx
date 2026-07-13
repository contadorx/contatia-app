"use client";

import { useState, useTransition, useEffect } from "react";
import { saveWhatsApp, deleteWhatsApp, whatsappQR, whatsappStatus } from "@/app/dashboard/config/whatsapp-actions";

type Acc = { id: string; evolution_url: string; instance: string; is_active: boolean; inbound_token: string };

export default function WhatsAppConnect({ accounts }: { accounts: Acc[] }) {
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

  return (
    <div>
      {accounts.map((a) => (
        <AccountRow key={a.id} acc={a} />
      ))}

      {!open ? (
        <button className="btn-ghost mt-2" onClick={() => setOpen(true)}>
          + Conectar instância Evolution
        </button>
      ) : (
        <div className="mt-3 rounded-xl border border-line p-4">
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
      )}
    </div>
  );
}

function AccountRow({ acc }: { acc: Acc }) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  function showQR() {
    setErr(null);
    setQr(null);
    start(async () => {
      const res = (await whatsappQR(acc.id)) as { base64?: string; error?: string };
      if (res?.error) setErr(res.error);
      else if (res?.base64) {
        // pode vir: imagem base64, "data:image/..." pronto, ou uma URL de imagem
        const v = res.base64;
        setQr(
          v.startsWith("data:") || v.startsWith("http")
            ? v
            : `data:image/png;base64,${v}`
        );
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

  const webhook = `${origin}/api/whatsapp/webhook/${acc.inbound_token}`;

  return (
    <div className="mb-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{acc.instance}</p>
          <p className="text-xs text-subtle">{acc.evolution_url}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button className="text-subtle hover:text-ink" onClick={showQR} disabled={pending}>QR</button>
          <button className="text-subtle hover:text-ink" onClick={checkStatus} disabled={pending}>Status</button>
          <button className="text-subtle hover:text-danger" onClick={remove} disabled={pending}>Remover</button>
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
      <div className="mt-3">
        <p className="label">Webhook de entrada (cole no Evolution → eventos MESSAGES_UPSERT)</p>
        <input className="input mt-1 text-xs" value={webhook} readOnly onFocus={(e) => e.target.select()} />
      </div>
    </div>
  );
}
