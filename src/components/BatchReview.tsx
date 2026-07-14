"use client";

import { useState, useTransition } from "react";
import { enrichBatch, importBatch } from "@/app/dashboard/contatos/lote/[id]/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type Item = {
  name: string;
  role?: string | null;
  company?: string | null;
  company_official?: string | null;
  domain?: string | null;
  cnpj?: string | null;
  company_phone?: string | null;
  match?: string | null;
  linkedin_url?: string | null;
};

export function BatchReview({
  batchId,
  items,
  cadences,
  jaImportado,
}: {
  batchId: string;
  items: Item[];
  cadences: { id: string; name: string }[];
  jaImportado: boolean;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set(items.map((_, i) => i)));
  const [cad, setCad] = useState("");
  const [msg, setMsg] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [pending, start] = useTransition();

  const comDominio = items.filter((i) => i.domain).length;
  const semDominio = items.length - comDominio;
  const cadOpts: SmartOption[] = cadences.map((c) => ({ value: c.id, label: c.name }));

  function alternar(i: number) {
    const s = new Set(sel);
    s.has(i) ? s.delete(i) : s.add(i);
    setSel(s);
  }

  function cruzar() {
    setMsg(null);
    start(async () => {
      const r = (await enrichBatch(batchId)) as any;
      if (r?.error) setMsg({ t: "err", m: r.error });
      else {
        setMsg({ t: "ok", m: `${r.achados} de ${r.total} empresas encontradas na Receita.` });
        window.location.reload();
      }
    });
  }

  function importar() {
    if (!sel.size) { setMsg({ t: "err", m: "Selecione ao menos um lead." }); return; }
    setMsg(null);
    start(async () => {
      const r = (await importBatch(batchId, Array.from(sel), cad || undefined)) as any;
      if (r?.error) setMsg({ t: "err", m: r.error });
      else {
        setMsg({
          t: "ok",
          m: `${r.criados} contatos criados${r.duplicados ? ` · ${r.duplicados} já existiam` : ""}${
            r.semDominio ? ` · ${r.semDominio} sem domínio (vão por WhatsApp)` : ""
          }. Procurando os e-mails dos que têm domínio.`,
        });
      }
    });
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-subtle">Leads capturados</p>
          <p className="font-display text-2xl font-bold">{items.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-subtle">Com domínio</p>
          <p className="font-display text-2xl font-bold text-signal">{comDominio}</p>
          <p className="text-xs text-subtle">vão para a busca do e-mail</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-subtle">Sem domínio</p>
          <p className="font-display text-2xl font-bold text-warn">{semDominio}</p>
          <p className="text-xs text-subtle">seguem por WhatsApp</p>
        </div>
      </div>

      {msg && (
        <p className={`mt-4 rounded-lg p-3 text-sm ${
          msg.t === "ok" ? "bg-signal/10 text-signal" : msg.t === "err" ? "bg-danger/10 text-danger" : "bg-brand-soft text-brand-dark"
        }`}>{msg.m}</p>
      )}

      {!jaImportado && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={cruzar} disabled={pending}>
            {pending ? "Cruzando…" : "🔎 Cruzar com a base da Receita"}
          </button>
          <span className="text-xs text-subtle">Traz CNPJ, telefone e o domínio de cada empresa.</span>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={sel.size === items.length && items.length > 0}
                  onChange={(e) => setSel(e.target.checked ? new Set(items.map((_, i) => i)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 font-semibold">Pessoa</th>
              <th className="px-3 py-2 font-semibold">Empresa</th>
              <th className="px-3 py-2 font-semibold">CNPJ</th>
              <th className="px-3 py-2 font-semibold">Domínio</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-2.5">
                  <input type="checkbox" checked={sel.has(i)} onChange={() => alternar(i)} disabled={jaImportado} />
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-medium">{it.name}</p>
                  {it.role && <p className="max-w-[240px] truncate text-xs text-subtle">{it.role}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <p>{it.company_official || it.company || "—"}</p>
                  {it.company_official && it.company && it.company_official !== it.company && (
                    <p className="text-xs text-subtle">no LinkedIn: {it.company}</p>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{it.cnpj || <span className="text-subtle">—</span>}</td>
                <td className="px-3 py-2.5">
                  {it.domain
                    ? <span className="rounded-full bg-signal/10 px-2 py-0.5 text-xs font-semibold text-signal">{it.domain}</span>
                    : <span className="text-xs text-warn">sem domínio</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!jaImportado && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Inscrever na cadência</label>
            <SmartSelect
              className="mt-1 max-w-[240px]"
              options={cadOpts}
              value={cad}
              onValueChange={(v) => setCad(v)}
              placeholder="Não inscrever agora"
              clearable
            />
          </div>
          <button className="btn-brand" onClick={importar} disabled={pending || !sel.size}>
            {pending ? "Importando…" : `Importar ${sel.size} contatos`}
          </button>
        </div>
      )}

      {jaImportado && (
        <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-subtle">Este lote já foi importado.</p>
      )}
    </div>
  );
}
