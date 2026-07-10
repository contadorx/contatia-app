"use client";

import { useState, useTransition } from "react";
import { createProduct, updateProduct, deleteProduct } from "@/app/dashboard/config/produtos/actions";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Product = { id: string; name: string; kind: string; billing: string; price: number; active: boolean };

export function ProductForm() {
  const [f, setF] = useState({ name: "", kind: "servico", billing: "recorrente", price: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="Ex.: BPO Financeiro, Implantação, Consultoria" /></div>
        <div>
          <label className="label">Tipo</label>
          <select className="input mt-1" value={f.kind} onChange={(e) => up("kind", e.target.value)}>
            <option value="servico">Serviço</option>
            <option value="produto">Produto</option>
          </select>
        </div>
        <div>
          <label className="label">Cobrança</label>
          <select className="input mt-1" value={f.billing} onChange={(e) => up("billing", e.target.value)}>
            <option value="recorrente">Recorrente (mensal)</option>
            <option value="avulso">Avulso (única)</option>
          </select>
        </div>
        <div><label className="label">Preço de referência (R$)</label><input className="input mt-1" type="number" value={f.price} onChange={(e) => up("price", e.target.value)} placeholder="0" /></div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <button className="btn-brand mt-4 py-1.5 text-sm" disabled={pending} onClick={() => start(async () => {
        const res = (await createProduct({ ...f, price: Number(f.price) })) as any;
        if (res?.error) setMsg(res.error); else { setF({ name: "", kind: "servico", billing: "recorrente", price: "" }); setMsg(null); }
      })}>{pending ? "Salvando..." : "Adicionar ao catálogo"}</button>
    </div>
  );
}

export function ProductRow({ p }: { p: Product }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: p.name, kind: p.kind, billing: p.billing, price: String(p.price) });
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (edit) {
    return (
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-2" colSpan={5}>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input py-1 text-sm" style={{ width: 200 }} value={f.name} onChange={(e) => up("name", e.target.value)} />
            <select className="input py-1 text-sm" style={{ width: 110 }} value={f.kind} onChange={(e) => up("kind", e.target.value)}><option value="servico">Serviço</option><option value="produto">Produto</option></select>
            <select className="input py-1 text-sm" style={{ width: 150 }} value={f.billing} onChange={(e) => up("billing", e.target.value)}><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select>
            <input className="input py-1 text-sm" style={{ width: 100 }} type="number" value={f.price} onChange={(e) => up("price", e.target.value)} />
            <button className="btn-brand py-1 text-xs" disabled={pending} onClick={() => start(async () => { await updateProduct(p.id, { ...f, price: Number(f.price) }); setEdit(false); })}>Salvar</button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => setEdit(false)}>cancelar</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3 font-medium">{p.name}{!p.active && <span className="ml-1 text-xs text-subtle">(inativo)</span>}</td>
      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${p.kind === "produto" ? "bg-brand-soft text-brand-dark" : "bg-muted text-subtle"}`}>{p.kind === "produto" ? "Produto" : "Serviço"}</span></td>
      <td className="px-4 py-3 text-subtle">{p.billing === "recorrente" ? "Recorrente" : "Avulso"}</td>
      <td className="px-4 py-3 font-semibold">{brl(p.price)}{p.billing === "recorrente" ? "/mês" : ""}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2 text-xs">
          <button className="text-brand-dark hover:underline" onClick={() => setEdit(true)}>editar</button>
          <button className="text-subtle hover:text-warn" disabled={pending} onClick={() => start(async () => void (await updateProduct(p.id, { active: !p.active })))}>{p.active ? "desativar" : "ativar"}</button>
          <button className="text-subtle hover:text-danger" disabled={pending} onClick={() => start(async () => { if (confirm("Excluir do catálogo?")) await deleteProduct(p.id); })}>excluir</button>
        </div>
      </td>
    </tr>
  );
}
