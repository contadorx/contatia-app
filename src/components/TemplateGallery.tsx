"use client";

import { useState, useTransition } from "react";
import { createFromTemplate, saveAsTemplate } from "@/app/dashboard/cadencias/actions";

type Template = {
  id: string;
  name: string;
  audience: string | null;
  description: string | null;
  steps: any[];
  is_global: boolean;
};

export function TemplateGallery({ templates }: { templates: Template[] }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function use(id: string) {
    setMsg(null);
    start(async () => {
      const res = (await createFromTemplate(id)) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else setMsg("✓ Cadência criada a partir do template. Ela aparece na lista — edite à vontade.");
    });
  }

  if (!open)
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Usar um template ({templates.length})
      </button>
    );

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Templates de cadência</p>
        <button className="text-xs text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
      </div>
      <p className="mt-1 text-xs text-subtle">Clone um acervo pronto e ajuste — em vez de começar do zero.</p>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{t.name}</p>
              {t.is_global && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand-dark">PRONTO</span>}
            </div>
            {t.audience && <p className="text-xs text-subtle">{t.audience}</p>}
            {t.description && <p className="mt-1 text-xs text-subtle">{t.description}</p>}
            <p className="mt-2 text-xs text-subtle">{(t.steps || []).length} passo(s)</p>
            <button className="btn-brand mt-3 py-1.5 text-xs" onClick={() => use(t.id)} disabled={pending}>
              {pending ? "..." : "Usar este"}
            </button>
          </div>
        ))}
        {!templates.length && <p className="text-sm text-subtle">Nenhum template ainda.</p>}
      </div>
    </div>
  );
}

export function SaveAsTemplateButton({ sequenceId }: { sequenceId: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <span className="text-xs font-semibold text-signal">✓ salvo</span>;
  return (
    <button
      className="text-xs text-subtle hover:text-brand"
      disabled={pending}
      onClick={() => start(async () => {
        const res = (await saveAsTemplate(sequenceId)) as { ok?: boolean; error?: string };
        if (res?.ok) setDone(true);
      })}
      title="Salvar esta cadência como template reutilizável"
    >
      salvar como template
    </button>
  );
}
