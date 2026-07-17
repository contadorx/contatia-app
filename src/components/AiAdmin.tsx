"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAssistant, loadConversation, setConversation } from "@/app/dashboard/superadmin/ia/actions";

type Assistant = {
  kind: "support" | "sales";
  enabled: boolean;
  model: string | null;
  greeting: string;
  brain: string;
  notify_email: string | null;
};
type Conv = {
  id: string;
  kind: "support" | "sales";
  status: string;
  handled: boolean;
  source: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  msg_count: number;
  ticket_id: string | null;
  created_at: string;
  last_at: string;
};

const fmt = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AiAdmin({ assistants, conversations }: { assistants: Assistant[]; conversations: Conv[] }) {
  const pend = conversations.filter((c) => c.status === "escalated" && !c.handled);
  const [tab, setTab] = useState<"pend" | "support" | "sales" | "config">(pend.length ? "pend" : "support");

  const tabs: { k: typeof tab; label: string; count?: number }[] = [
    { k: "pend", label: "Escalonados", count: pend.length },
    { k: "support", label: "Suporte" },
    { k: "sales", label: "Vendas" },
    { k: "config", label: "Configurar" },
  ];

  const list =
    tab === "pend" ? pend : tab === "support" ? conversations.filter((c) => c.kind === "support") : tab === "sales" ? conversations.filter((c) => c.kind === "sales") : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${tab === t.k ? "bg-brand text-white" : "bg-muted text-subtle hover:text-ink"}`}
          >
            {t.label}
            {t.count ? <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] text-white">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "config" ? (
        <div className="space-y-5">
          {assistants
            .slice()
            .sort((a) => (a.kind === "support" ? -1 : 1))
            .map((a) => (
              <ConfigCard key={a.kind} a={a} />
            ))}
        </div>
      ) : (
        <div className="space-y-2">
          {!list.length && <p className="card p-6 text-center text-sm text-subtle">Nenhuma conversa aqui ainda.</p>}
          {list.map((c) => (
            <ConvRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConvRow({ c }: { c: Conv }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ role: string; content: string }[] | null>(null);
  const [pending, start] = useTransition();

  const contact = [c.visitor_name, c.visitor_email, c.visitor_phone].filter(Boolean).join(" · ") || "sem contato informado";
  const statusColor = c.status === "escalated" ? "text-danger" : c.status === "resolved" ? "text-signal" : "text-subtle";

  function toggle() {
    setOpen((o) => !o);
    if (!msgs) start(async () => { const r = (await loadConversation(c.id)) as any; if (r?.messages) setMsgs(r.messages); });
  }
  function mark(patch: { handled?: boolean; status?: string }) {
    start(async () => { await setConversation(c.id, patch); router.refresh(); });
  }

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.kind === "sales" ? "bg-brand-soft text-brand-dark" : "bg-muted text-subtle"}`}>
              {c.kind === "sales" ? "VENDAS" : "SUPORTE"}
            </span>
            <span className="truncate">{contact}</span>
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            <span className={statusColor}>{c.status}</span> · {c.msg_count} msgs · {fmt(c.last_at)} · via {c.source || "—"}
            {c.handled ? " · ✓ tratado" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <button className="rounded-lg border border-line px-2 py-1 hover:bg-muted" onClick={toggle} disabled={pending}>
            {open ? "fechar" : "ver conversa"}
          </button>
          {c.status === "escalated" && !c.handled && (
            <button className="rounded-lg border border-signal/40 px-2 py-1 text-signal hover:bg-signal/10" onClick={() => mark({ handled: true })} disabled={pending}>
              marcar tratado
            </button>
          )}
          {c.status !== "resolved" && (
            <button className="rounded-lg border border-line px-2 py-1 hover:bg-muted" onClick={() => mark({ status: "resolved", handled: true })} disabled={pending}>
              resolver
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {!msgs && <p className="text-xs text-subtle">carregando…</p>}
          {msgs?.map((m, i) => (
            <div key={i} className={`text-sm ${m.role === "user" ? "text-ink" : "text-subtle"}`}>
              <b>{m.role === "user" ? (c.kind === "sales" ? "Lead" : "Cliente") : "IA"}:</b>{" "}
              <span className="whitespace-pre-wrap">{m.content}</span>
            </div>
          ))}
          {c.ticket_id && <p className="text-[11px] text-subtle">Chamado gerado: {c.ticket_id}</p>}
        </div>
      )}
    </div>
  );
}

function ConfigCard({ a }: { a: Assistant }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(a.enabled);
  const [greeting, setGreeting] = useState(a.greeting || "");
  const [brain, setBrain] = useState(a.brain || "");
  const [model, setModel] = useState(a.model || "");
  const [notify, setNotify] = useState(a.notify_email || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const r = (await saveAssistant(a.kind, {
        enabled,
        greeting,
        brain,
        model: model.trim() || null,
        notify_email: notify.trim() || null,
      })) as any;
      setMsg(r?.error ? r.error : "✓ Salvo.");
      if (!r?.error) router.refresh();
    });
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">{a.kind === "support" ? "IA de Suporte (no app)" : "IA de Vendas (no site)"}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Ativa
        </label>
      </div>

      <label className="label mt-4 block">Saudação (1ª mensagem)</label>
      <textarea className="input mt-1 min-h-[60px] text-sm" value={greeting} onChange={(e) => setGreeting(e.target.value)} />

      <label className="label mt-3 block">Cérebro / instruções (o que a IA sabe e como age)</label>
      <textarea className="input mt-1 min-h-[220px] font-mono text-xs" value={brain} onChange={(e) => setBrain(e.target.value)} />
      {a.kind === "support" && (
        <p className="mt-1 text-[11px] text-subtle">A IA de suporte também lê a Base de Conhecimento (superadmin → KB) automaticamente.</p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label block">Avisar escalonamento para (e-mail)</label>
          <input className="input mt-1 text-sm" value={notify} onChange={(e) => setNotify(e.target.value)} placeholder="voce@contatia.com.br (vazio = padrão do sistema)" />
        </div>
        <div>
          <label className="label block">Modelo (opcional)</label>
          <input className="input mt-1 text-sm" value={model} onChange={(e) => setModel(e.target.value)} placeholder="vazio = padrão (Haiku)" />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-brand py-1.5 text-sm" onClick={save} disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button>
        {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</span>}
      </div>
    </div>
  );
}
