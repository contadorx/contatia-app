"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AssignSelect from "@/components/AssignSelect";
import EnrollButton from "@/components/EnrollButton";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { bulkAssign, bulkEnroll } from "@/app/dashboard/contatos/bulk-actions";
import { bulkTag, createTag } from "@/app/dashboard/contatos/tag-actions";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  origin: string | null;
  score: number | null;
  assigned_to: string | null;
  contact_tags?: { tag_id: string; tags: { id: string; name: string; color: string } | null }[];
};
type Member = { id: string; full_name: string | null; email: string };
type Seq = { id: string; name: string };
type Tag = { id: string; name: string; color: string };

export default function ContactsTable({
  contacts,
  sequences,
  members,
  tags = [],
}: {
  contacts: Contact[];
  sequences: Seq[];
  members: Member[];
  tags?: Tag[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [seq, setSeq] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [tagId, setTagId] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const allIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const allChecked = sel.size > 0 && sel.size === contacts.length;

  const seqOpts: SmartOption[] = sequences.map((s) => ({ value: s.id, label: s.name }));
  const assignOpts: SmartOption[] = [
    { value: "__none__", label: "Sem dono" },
    ...members.map((m) => ({ value: m.id, label: m.full_name || m.email })),
  ];
  const tagOpts: SmartOption[] = tags.map((t) => ({ value: t.id, label: t.name }));

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setMsg(null);
  }
  function toggleAll() {
    setSel((s) => (s.size === contacts.length ? new Set() : new Set(allIds)));
    setMsg(null);
  }
  function clear() {
    setSel(new Set());
    setMsg(null);
  }

  function doEnroll() {
    if (!seq) return setMsg("Escolha a cadência.");
    setMsg(null);
    start(async () => {
      const res = (await bulkEnroll([...sel], seq)) as { enrolled?: number; skipped?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setMsg(`✓ ${res.enrolled} inscritos${res.skipped ? `, ${res.skipped} pulados (já em cadência/sem dados)` : ""}.`);
        clear();
        setSeq("");
      }
    });
  }
  function doTag() {
    if (!tagId) return setMsg("Escolha a tag.");
    setMsg(null);
    start(async () => {
      const res = (await bulkTag([...sel], tagId)) as { count?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setMsg(`✓ tag aplicada a ${res.count} contatos.`);
        clear();
        setTagId("");
      }
    });
  }
  function doCreateTag() {
    if (!newTag.trim()) return;
    start(async () => {
      const res = (await createTag(newTag)) as { tag?: Tag; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setNewTag("");
        setShowNewTag(false);
        setMsg("✓ Tag criada.");
        router.refresh();
      }
    });
  }

  if (!contacts.length) {
    return (
      <div className="card p-10 text-center text-sm text-subtle">
        Nenhum contato ainda. Adicione um ou importe seu CSV para começar.
      </div>
    );
  }

  return (
    <div>
      {/* Barra de ações em lote */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 shadow-sm backdrop-blur">
          <span className="text-sm font-semibold">{sel.size} selecionado{sel.size > 1 ? "s" : ""}</span>

          <div className="flex items-center gap-1">
            <SmartSelect
              className="py-1.5 text-sm"
              options={seqOpts}
              value={seq}
              onValueChange={(v) => setSeq(v)}
              placeholder="Inscrever em cadência…"
              clearable
            />
            <button className="btn-brand py-1.5 text-sm" onClick={doEnroll} disabled={pending || !seq}>
              {pending ? "..." : "Inscrever"}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <SmartSelect
              className="py-1.5 text-sm"
              options={assignOpts}
              value={assignTo}
              onValueChange={(v) => setAssignTo(v)}
              placeholder="Atribuir a…"
              clearable
            />
            <button
              className="btn-ghost py-1.5 text-sm"
              onClick={() => start(async () => {
                setMsg(null);
                const res = (await bulkAssign([...sel], assignTo === "__none__" ? null : assignTo || null)) as { count?: number; error?: string };
                if (res?.error) setMsg(res.error);
                else { setMsg(`✓ ${res.count} atribuídos.`); clear(); setAssignTo(""); }
              })}
              disabled={pending || !assignTo}
            >
              Atribuir
            </button>
          </div>

          {tags.length > 0 && (
            <div className="flex items-center gap-1">
              <SmartSelect
                className="py-1.5 text-sm"
                options={tagOpts}
                value={tagId}
                onValueChange={(v) => setTagId(v)}
                placeholder="Aplicar tag…"
                clearable
              />
              <button className="btn-ghost py-1.5 text-sm" onClick={doTag} disabled={pending || !tagId}>Aplicar</button>
            </div>
          )}

          <button className="ml-auto text-xs text-subtle hover:text-ink" onClick={clear}>
            limpar seleção
          </button>
        </div>
      )}
      {msg && <p className="mb-3 text-sm text-signal">{msg}</p>}

      {/* Criar tag — compacto, fora da faixa fixa */}
      <div className="mb-3">
        {!showNewTag ? (
          <button className="text-xs font-medium text-subtle hover:text-brand" onClick={() => setShowNewTag(true)}>
            ＋ Nova tag
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[220px] py-1.5 text-sm"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Nome da tag (ex.: Quente, Decisor, Follow-up)"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") doCreateTag(); }}
            />
            <button className="btn-brand py-1.5 text-sm" onClick={doCreateTag} disabled={pending || !newTag.trim()}>Criar</button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => { setShowNewTag(false); setNewTag(""); }}>cancelar</button>
          </div>
        )}
      </div>

      <div className="card overflow-visible">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-3 py-3">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Selecionar todos" />
              </th>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Contato</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium" title="Quanto o contato está engajado. Quente a partir de 25.">Score</th>
              <th className="px-4 py-3 font-medium">Responsável</th>
              <th className="px-4 py-3 font-medium text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => {
              const checked = sel.has(c.id);
              return (
                <tr key={c.id} className={`border-b border-line last:border-0 hover:bg-muted ${checked ? "bg-brand-soft/40" : ""}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} aria-label={`Selecionar ${c.name}`} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/contatos/${c.id}`} className="text-brand-dark hover:underline">
                      {c.name}
                    </Link>
                    {c.contact_tags && c.contact_tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.contact_tags.map((ct) =>
                          ct.tags ? (
                            <span key={ct.tag_id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${ct.tags.color}22`, color: ct.tags.color }}>
                              {ct.tags.name}
                            </span>
                          ) : null
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-subtle">{c.company || "—"}</td>
                  <td className="px-4 py-3 text-subtle">
                    {c.email ? (
                      c.email
                    ) : c.phone ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {c.phone}
                        <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                          sem e-mail
                        </span>
                      </span>
                    ) : (
                      <span
                        className="cursor-help rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn"
                        title="Abra o contato para procurar o e-mail."
                      >
                        sem e-mail
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.origin ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">{c.origin}</span> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-semibold ${(c.score ?? 0) >= 25 ? "text-warn" : "text-subtle"}`}>{c.score ?? 0}</span>
                  </td>
                  <td className="px-4 py-3">
                    <AssignSelect contactId={c.id} current={c.assigned_to} members={members} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EnrollButton contactId={c.id} sequences={sequences} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">
        <b>Score</b> mede o engajamento do contato (aberturas, cliques, respostas). <span className="font-semibold text-warn">Quente</span> a partir de 25.
      </p>
    </div>
  );
}
