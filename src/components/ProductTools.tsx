"use client";

import { useState, useTransition } from "react";
import { createProduct, updateProduct, deleteProduct } from "@/app/dashboard/config/produtos/actions";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Account = { id: string; from_email: string; display_name?: string | null };
type Product = { id: string; name: string; kind: string; billing: string; price: number; active: boolean; email_account_id?: string | null; email_accounts?: { from_email: string } | null };

const boxLabel = (a: Account) => a.display_name ? `${a.display_name} <${a.from_email}>` : a.from_email;

export function ProductForm({ accounts = [] }: { accounts?: Account[] }) {
  const [f, setF] = useState({ name: "", kind: "servico", billing: "recorrente", price: "", email_account_id: "" });
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
        <div>
          <label className="label">Caixa de e-mail deste produto</label>
          <select className="input mt-1" value={f.email_account_id} onChange={(e) => up("email_account_id", e.target.value)} disabled={!accounts.length}>
            <option value="">{accounts.length ? "Usar rodízio (padrão)" : "Nenhuma caixa conectada"}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{boxLabel(a)}</option>)}
          </select>
        </div>
      </div>
      <p className="mt-2 text-xs text-subtle">As cadências deste produto enviam por esta caixa (a cadência pode sobrescrever). Sem caixa, o envio usa o rodízio entre as caixas ativas.</p>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <button className="btn-brand mt-4 py-1.5 text-sm" disabled={pending} onClick={() => start(async () => {
        const res = (await createProduct({ ...f, price: Number(f.price) })) as any;
        if (res?.error) setMsg(res.error); else { setF({ name: "", kind: "servico", billing: "recorrente", price: "", email_account_id: "" }); setMsg(null); }
      })}>{pending ? "Salvando..." : "Adicionar ao catálogo"}</button>
    </div>
  );
}

export function ProductRow({ p, accounts = [] }: { p: Product; accounts?: Account[] }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: p.name, kind: p.kind, billing: p.billing, price: String(p.price), email_account_id: p.email_account_id || "" });
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (edit) {
    return (
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-2" colSpan={5}>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input py-1 text-sm" style={{ width: 180 }} value={f.name} onChange={(e) => up("name", e.target.value)} />
            <select className="input py-1 text-sm" style={{ width: 110 }} value={f.kind} onChange={(e) => up("kind", e.target.value)}><option value="servico">Serviço</option><option value="produto">Produto</option></select>
            <select className="input py-1 text-sm" style={{ width: 130 }} value={f.billing} onChange={(e) => up("billing", e.target.value)}><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select>
            <input className="input py-1 text-sm" style={{ width: 90 }} type="number" value={f.price} onChange={(e) => up("price", e.target.value)} />
            <select className="input py-1 text-sm" style={{ width: 200 }} value={f.email_account_id} onChange={(e) => up("email_account_id", e.target.value)} disabled={!accounts.length} title="Caixa de e-mail do produto">
              <option value="">Caixa: rodízio</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{boxLabel(a)}</option>)}
            </select>
            <button className="btn-brand py-1 text-xs" disabled={pending} onClick={() => start(async () => { await updateProduct(p.id, { ...f, price: Number(f.price) }); setEdit(false); })}>Salvar</button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => setEdit(false)}>cancelar</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3 font-medium">
        {p.name}{!p.active && <span className="ml-1 text-xs text-subtle">(inativo)</span>}
        {(() => {
          const ea: any = (p as any).email_accounts;
          const boxEmail = Array.isArray(ea) ? ea[0]?.from_email : ea?.from_email;
          return <span className="block text-xs text-subtle">{boxEmail ? `Caixa: ${boxEmail}` : "Caixa: rodízio"}</span>;
        })()}
      </td>
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
