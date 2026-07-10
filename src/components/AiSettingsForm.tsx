"use client";

import { useState, useTransition } from "react";
import { saveAiSettings } from "@/app/dashboard/config/actions";

export default function AiSettingsForm({ currentModel, hasKey }: { currentModel: string; hasKey: boolean }) {
  const [model, setModel] = useState(currentModel || "");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    setOk(false);
    start(async () => {
      const res = await saveAiSettings({ model, apiKey });
      if (res?.error) setMsg(res.error);
      else {
        setOk(true);
        setApiKey("");
      }
    });
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Modelo</label>
          <input className="input mt-1" value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-4-5" />
          <p className="mt-1 text-xs text-subtle">Cole um id válido da sua conta (GET /v1/models). Vazio = usa o do ambiente.</p>
        </div>
        <div>
          <label className="label">Chave da API {hasKey && <span className="text-signal">(configurada)</span>}</label>
          <input
            type="password"
            className="input mt-1"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? "•••• deixe em branco para manter" : "sk-ant-..."}
          />
          <p className="mt-1 text-xs text-subtle">Guardada no workspace. Nunca é exibida de volta.</p>
        </div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      {ok && <p className="mt-2 text-sm text-signal">✓ Salvo.</p>}
      <button className="btn-brand mt-3 py-1.5 text-sm" onClick={save} disabled={pending}>
        {pending ? "Salvando..." : "Salvar IA"}
      </button>
    </div>
  );
}
