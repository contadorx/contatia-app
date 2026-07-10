"use client";

import { useState, useTransition } from "react";
import { saveArticle, deleteArticle } from "@/app/dashboard/superadmin/kb/actions";

type Article = { id: string; title: string; category: string; body: string; keywords: string; position: number; published: boolean };

const empty = { title: "", category: "Geral", body: "", keywords: "", position: 0, published: true };

export function KbManager({ rows }: { rows: Article[] }) {
  const [editing, setEditing] = useState<Partial<Article> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (!editing) return;
    setMsg(null);
    start(async () => {
      const r = (await saveArticle(editing as any)) as any;
      if (r?.error) setMsg(r.error);
      else { setEditing(null); setMsg(null); }
    });
  }

  return (
    <div>
      {!editing && (
        <button className="btn-brand mb-4 py-1.5 text-sm" onClick={() => setEditing({ ...empty })}>+ Novo artigo</button>
      )}

      {editing && (
        <div className="card mb-4 p-5">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Título</label><input className="input mt-1" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
              <div><label className="label">Categoria</label><input className="input mt-1" value={editing.category || ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="Geral" /></div>
            </div>
            <div><label className="label">Conteúdo</label><textarea className="input mt-1 min-h-[160px]" value={editing.body || ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Palavras-chave (busca)</label><input className="input mt-1" value={editing.keywords || ""} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="e-mail, smtp, brevo" /></div>
              <div><label className="label">Ordem</label><input className="input mt-1" type="number" value={editing.position ?? 0} onChange={(e) => setEditing({ ...editing, position: Number(e.target.value) })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.published ?? true} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} /> Publicado</label>
          </div>
          {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn-brand py-1.5 text-sm" disabled={pending} onClick={save}>{pending ? "Salvando..." : "Salvar"}</button>
            <button className="btn-ghost py-1.5 text-sm" onClick={() => { setEditing(null); setMsg(null); }}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.id} className="card flex items-center justify-between p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{a.title} {!a.published && <span className="text-xs text-subtle">(rascunho)</span>}</p>
              <p className="text-xs text-subtle">{a.category}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="text-xs text-brand-dark hover:underline" onClick={() => setEditing(a)}>editar</button>
              <DeleteBtn id={a.id} />
            </div>
          </div>
        ))}
        {!rows.length && <p className="card p-6 text-center text-sm text-subtle">Nenhum artigo ainda. Crie o primeiro.</p>}
      </div>
    </div>
  );
}

function DeleteBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button className="text-xs text-subtle hover:text-danger" onClick={() => setConfirm(true)}>excluir</button>;
  return (
    <button className="text-xs font-semibold text-danger" disabled={pending} onClick={() => start(async () => void (await deleteArticle(id)))}>
      confirmar?
    </button>
  );
}
