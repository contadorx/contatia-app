"use client";

import { useState, useTransition } from "react";
import { addTagToAccount, removeTagFromAccount, createTag } from "@/app/dashboard/contatos/tag-actions";

type Tag = { id: string; name: string; color: string };

export default function AccountTags({
  accountId,
  tags,
  allTags,
}: {
  accountId: string;
  tags: Tag[];
  allTags: Tag[];
}) {
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [pending, start] = useTransition();

  const usedIds = new Set(tags.map((t) => t.id));
  const available = allTags.filter((t) => !usedIds.has(t.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${t.color}20`, color: t.color }}>
          {t.name}
          <button className="opacity-60 hover:opacity-100" disabled={pending} onClick={() => start(async () => void (await removeTagFromAccount(accountId, t.id)))}>×</button>
        </span>
      ))}

      {!open ? (
        <button className="rounded-full border border-dashed border-line px-2 py-0.5 text-xs text-subtle hover:text-ink" onClick={() => setOpen(true)}>+ tag</button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1">
          {available.map((t) => (
            <button
              key={t.id}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: `${t.color}20`, color: t.color }}
              disabled={pending}
              onClick={() => start(async () => { await addTagToAccount(accountId, t.id); })}
            >
              + {t.name}
            </button>
          ))}
          <input
            className="input py-0.5 text-xs"
            style={{ width: 120 }}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="nova tag"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTag.trim()) {
                start(async () => {
                  const res = (await createTag(newTag.trim())) as { tag?: { id: string }; id?: string; error?: string };
                  const id = (res as any)?.tag?.id || (res as any)?.id;
                  if (id) await addTagToAccount(accountId, id);
                  setNewTag("");
                });
              }
            }}
          />
          <button className="text-xs text-subtle hover:text-ink" onClick={() => setOpen(false)}>ok</button>
        </span>
      )}
    </div>
  );
}
