"use client";

import { useState, useTransition } from "react";
import { saveWebhookConnection, savePipedriveConnection, saveHubspotConnection, saveRdstationConnection, disconnectCrm, testCrmConnection } from "@/app/dashboard/config/crm-actions";

type Conn = any;

export function CrmIntegrations({ connections }: { connections: Conn[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  const webhook = connections.find((c) => c.provider === "webhook");
  const pipedrive = connections.find((c) => c.provider === "pipedrive");
  const hubspot = connections.find((c) => c.provider === "hubspot");
  const rdstation = connections.find((c) => c.provider === "rdstation");

  function run(fn: () => Promise<any>) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r?.error) setMsg({ t: "err", m: r.error });
      else setMsg({ t: "ok", m: r?.msg || "Salvo." });
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-brand-soft p-4 text-sm">
        <p className="font-semibold text-brand-dark">O Contatia alimenta o seu CRM — não substitui.</p>
        <p className="mt-1 text-subtle">
          A prospecção acontece aqui: cadência, resposta, reunião marcada. Quando o lead esquenta,
          o negócio é enviado para o seu CRM, onde a venda é fechada. E quando você marca ganho ou
          perda lá, a cadência daqui para de perseguir a pessoa.
        </p>
      </div>

      {msg && (
        <p className={`rounded-lg p-3 text-sm ${msg.t === "ok" ? "bg-signal/10 text-signal" : "bg-danger/10 text-danger"}`}>{msg.m}</p>
      )}

      {/* WEBHOOK GENÉRICO */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-semibold">Webhook (qualquer CRM ou automação)</p>
            <p className="mt-1 text-sm text-subtle">
              Envia o lead quente em JSON para a URL que você escolher — funciona com Zapier, n8n,
              Make, ERPs e praticamente qualquer sistema. É o caminho universal.
            </p>
          </div>
          {webhook && <span className="rounded-full bg-signal/10 px-3 py-1 text-xs font-semibold text-signal">conectado</span>}
        </div>

        <form action={(fd) => run(() => saveWebhookConnection(fd))} className="mt-4 space-y-3">
          <div>
            <label className="label">URL de destino</label>
            <input name="webhook_url" className="input mt-1" defaultValue={webhook?.webhook_url || ""} placeholder="https://hooks.zapier.com/..." />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Enviar quando</label>
              <select name="push_on" className="input mt-1" defaultValue={webhook?.push_on || "both"}>
                <option value="replied">O contato responder</option>
                <option value="meeting">Uma reunião for marcada</option>
                <option value="both">Nos dois casos</option>
              </select>
            </div>
            <div>
              <label className="label">Segredo (opcional)</label>
              <input name="webhook_secret" className="input mt-1" defaultValue={webhook?.webhook_secret || ""} placeholder="gerado automaticamente" />
              <p className="mt-1 text-xs text-subtle">Enviado no header X-Contatia-Signature para você validar a origem.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-brand" disabled={pending}>{pending ? "Salvando..." : webhook ? "Atualizar" : "Conectar"}</button>
            {webhook && (
              <>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => testCrmConnection("webhook"))}>Enviar teste</button>
                <button type="button" className="btn-ghost text-danger" disabled={pending} onClick={() => { if (confirm("Desconectar o webhook?")) run(() => disconnectCrm("webhook")); }}>Desconectar</button>
              </>
            )}
          </div>
        </form>
      </div>

      {/* PIPEDRIVE */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-semibold">Pipedrive</p>
            <p className="mt-1 text-sm text-subtle">
              Integração nativa: cria a pessoa, a empresa e o negócio no seu funil — com uma nota
              contando de onde veio o lead. E traz de volta os negócios ganhos e perdidos.
            </p>
          </div>
          {pipedrive && <span className="rounded-full bg-signal/10 px-3 py-1 text-xs font-semibold text-signal">conectado</span>}
        </div>

        <form action={(fd) => run(() => savePipedriveConnection(fd))} className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Token da API</label>
              <input name="api_token" className="input mt-1" defaultValue={pipedrive?.api_token || ""} placeholder="cole seu token" />
              <p className="mt-1 text-xs text-subtle">Pipedrive → Configurações pessoais → API.</p>
            </div>
            <div>
              <label className="label">Domínio da empresa</label>
              <input name="company_domain" className="input mt-1" defaultValue={pipedrive?.company_domain || ""} placeholder="minhaempresa" />
              <p className="mt-1 text-xs text-subtle">De <code>minhaempresa</code>.pipedrive.com</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="label">ID do funil (opcional)</label>
              <input name="pipeline_id" className="input mt-1" defaultValue={pipedrive?.pipeline_id || ""} placeholder="ex.: 1" />
            </div>
            <div>
              <label className="label">ID da etapa (opcional)</label>
              <input name="stage_id" className="input mt-1" defaultValue={pipedrive?.stage_id || ""} placeholder="ex.: 1" />
            </div>
            <div>
              <label className="label">Enviar quando</label>
              <select name="push_on" className="input mt-1" defaultValue={pipedrive?.push_on || "both"}>
                <option value="replied">O contato responder</option>
                <option value="meeting">Uma reunião for marcada</option>
                <option value="both">Nos dois casos</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pull_enabled" defaultChecked={pipedrive ? pipedrive.pull_enabled : true} />
            Trazer de volta ganhos e perdas (encerra a cadência de quem já fechou)
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-brand" disabled={pending}>{pending ? "Salvando..." : pipedrive ? "Atualizar" : "Conectar"}</button>
            {pipedrive && (
              <>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => testCrmConnection("pipedrive"))}>Criar negócio de teste</button>
                <button type="button" className="btn-ghost text-danger" disabled={pending} onClick={() => { if (confirm("Desconectar o Pipedrive?")) run(() => disconnectCrm("pipedrive")); }}>Desconectar</button>
              </>
            )}
          </div>
        </form>
      </div>

      {/* HUBSPOT */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-semibold">HubSpot</p>
            <p className="mt-1 text-sm text-subtle">
              Cria o contato, a empresa e o negócio no seu funil, com uma nota de origem.
              Traz de volta os negócios ganhos e perdidos.
            </p>
          </div>
          {hubspot && <span className="rounded-full bg-signal/10 px-3 py-1 text-xs font-semibold text-signal">conectado</span>}
        </div>

        <form action={(fd) => run(() => saveHubspotConnection(fd))} className="mt-4 space-y-3">
          <div>
            <label className="label">Token do Private App</label>
            <input name="api_token" className="input mt-1" defaultValue={hubspot?.api_token || ""} placeholder="pat-na1-..." />
            <p className="mt-1 text-xs text-subtle">HubSpot → Configurações → Integrações → Private Apps. Escopos: crm.objects.contacts, companies, deals (leitura e escrita).</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="label">ID do funil (opcional)</label>
              <input name="pipeline_id" className="input mt-1" defaultValue={hubspot?.pipeline_id || ""} placeholder="default" />
            </div>
            <div>
              <label className="label">ID da etapa (opcional)</label>
              <input name="stage_id" className="input mt-1" defaultValue={hubspot?.stage_id || ""} placeholder="appointmentscheduled" />
            </div>
            <div>
              <label className="label">Enviar quando</label>
              <select name="push_on" className="input mt-1" defaultValue={hubspot?.push_on || "both"}>
                <option value="replied">O contato responder</option>
                <option value="meeting">Uma reunião for marcada</option>
                <option value="both">Nos dois casos</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pull_enabled" defaultChecked={hubspot ? hubspot.pull_enabled : true} />
            Trazer de volta ganhos e perdas (encerra a cadência de quem já fechou)
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-brand" disabled={pending}>{pending ? "Salvando..." : hubspot ? "Atualizar" : "Conectar"}</button>
            {hubspot && (
              <>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => testCrmConnection("hubspot"))}>Criar negócio de teste</button>
                <button type="button" className="btn-ghost text-danger" disabled={pending} onClick={() => { if (confirm("Desconectar o HubSpot?")) run(() => disconnectCrm("hubspot")); }}>Desconectar</button>
              </>
            )}
          </div>
        </form>
      </div>

      {/* RD STATION CRM */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-semibold">RD Station CRM</p>
            <p className="mt-1 text-sm text-subtle">
              Cria a organização, o contato e o negócio no seu funil, com anotação de origem.
              Traz de volta ganhos e perdas.
            </p>
          </div>
          {rdstation && <span className="rounded-full bg-signal/10 px-3 py-1 text-xs font-semibold text-signal">conectado</span>}
        </div>

        <form action={(fd) => run(() => saveRdstationConnection(fd))} className="mt-4 space-y-3">
          <div>
            <label className="label">Token da API</label>
            <input name="api_token" className="input mt-1" defaultValue={rdstation?.api_token || ""} placeholder="cole seu token" />
            <p className="mt-1 text-xs text-subtle">RD Station CRM → Configurações → Integrações → Token da API.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">ID da etapa de entrada (opcional)</label>
              <input name="stage_id" className="input mt-1" defaultValue={rdstation?.stage_id || ""} placeholder="ex.: 5f3a..." />
              <p className="mt-1 text-xs text-subtle">No RD, a etapa define o funil de destino.</p>
            </div>
            <div>
              <label className="label">Enviar quando</label>
              <select name="push_on" className="input mt-1" defaultValue={rdstation?.push_on || "both"}>
                <option value="replied">O contato responder</option>
                <option value="meeting">Uma reunião for marcada</option>
                <option value="both">Nos dois casos</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pull_enabled" defaultChecked={rdstation ? rdstation.pull_enabled : true} />
            Trazer de volta ganhos e perdas (encerra a cadência de quem já fechou)
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-brand" disabled={pending}>{pending ? "Salvando..." : rdstation ? "Atualizar" : "Conectar"}</button>
            {rdstation && (
              <>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => testCrmConnection("rdstation"))}>Criar negócio de teste</button>
                <button type="button" className="btn-ghost text-danger" disabled={pending} onClick={() => { if (confirm("Desconectar o RD Station?")) run(() => disconnectCrm("rdstation")); }}>Desconectar</button>
              </>
            )}
          </div>
        </form>
      </div>

      <p className="text-xs text-subtle">
        A sincronia roda automaticamente no processamento diário. Leads quentes são enviados assim que
        respondem ou marcam reunião.
      </p>
    </div>
  );
}
