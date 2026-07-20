"use client";

import { useState, useTransition } from "react";
import { createProduct, updateProduct, deleteProduct } from "@/app/dashboard/config/produtos/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Account = { id: string; from_email: string; display_name?: string | null };
type Product = { id: string; name: string; kind: string; billing: string; price: number; active: boolean; email_account_id?: string | null; email_accounts?: { from_email: string } | null; pool?: { id: string; from_email: string }[] };

const boxLabel = (a: Account) => a.display_name ? `${a.display_name} <${a.from_email}>` : a.from_email;

const KIND_OPTS: SmartOption[] = [
  { value: "servico", label: "Serviço" },
  { value: "produto", label: "Produto" },
];
const BILLING_OPTS: SmartOption[] = [
  { value: "recorrente", label: "Recorrente (mensal)" },
  { value: "avulso", label: "Avulso (única)" },
];
const BILLING_OPTS_SHORT: SmartOption[] = [
  { value: "recorrente", label: "Recorrente" },
  { value: "avulso", label: "Avulso" },
];
const accountOpts = (accounts: Account[]): SmartOption[] => accounts.map((a) => ({ value: a.id, label: boxLabel(a) }));

export function ProductForm({ accounts = [] }: { accounts?: Account[] }) {
  const [f, setF] = useState({ name: "", kind: "servico", billing: "recorrente", price: "" });
  const [boxes, setBoxes] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="Ex.: BPO Financeiro, Implantação, Consultoria" /></div>
        <div>
          <label className="label">Tipo</label>
          <div className="mt-1">
            <SmartSelect options={KIND_OPTS} value={f.kind} onValueChange={(v) => up("kind", v)} />
          </div>
        </div>
        <div>
          <label className="label">Cobrança</label>
          <div className="mt-1">
            <SmartSelect options={BILLING_OPTS} value={f.billing} onValueChange={(v) => up("billing", v)} />
          </div>
        </div>
        <div><label className="label">Preço de referência (R$)</label><input className="input mt-1" type="number" value={f.price} onChange={(e) => up("price", e.target.value)} placeholder="0" /></div>
        <div className="sm:col-span-2">
          <label className="label">Caixas de e-mail deste produto (rodízio)</label>
          <div className="mt-1">
            <SmartSelect
              multiple
              options={accountOpts(accounts)}
              values={boxes}
              onValuesChange={setBoxes}
              disabled={!accounts.length}
              placeholder={accounts.length ? "Usar rodízio geral (padrão)" : "Nenhuma caixa conectada"}
            />
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-subtle">Escolha uma ou várias caixas: as cadências deste produto fazem <b>rodízio</b> entre elas (a cadência pode sobrescrever). Sem caixa, o envio usa o rodízio geral entre todas as caixas ativas.</p>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <button className="btn-brand mt-4 py-1.5 text-sm" disabled={pending} onClick={() => start(async () => {
        const res = (await createProduct({ ...f, price: Number(f.price), email_account_ids: boxes })) as any;
        if (res?.error) setMsg(res.error); else { setF({ name: "", kind: "servico", billing: "recorrente", price: "" }); setBoxes([]); setMsg(null); }
      })}>{pending ? "Salvando..." : "Adicionar ao catálogo"}</button>
    </div>
  );
}

export function ProductRow({ p, accounts = [] }: { p: Product; accounts?: Account[] }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: p.name, kind: p.kind, billing: p.billing, price: String(p.price) });
  const [boxes, setBoxes] = useState<string[]>((p.pool || []).map((b) => b.id));
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (edit) {
    return (
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-2" colSpan={5}>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input py-1 text-sm" style={{ width: 180 }} value={f.name} onChange={(e) => up("name", e.target.value)} />
            <div style={{ width: 110 }}>
              <SmartSelect className="py-1 text-sm" options={KIND_OPTS} value={f.kind} onValueChange={(v) => up("kind", v)} />
            </div>
            <div style={{ width: 130 }}>
              <SmartSelect className="py-1 text-sm" options={BILLING_OPTS_SHORT} value={f.billing} onValueChange={(v) => up("billing", v)} />
            </div>
            <input className="input py-1 text-sm" style={{ width: 90 }} type="number" value={f.price} onChange={(e) => up("price", e.target.value)} />
            <div style={{ minWidth: 220, flex: 1 }} title="Caixas de e-mail do produto (rodízio)">
              <SmartSelect
                multiple
                className="py-1 text-sm"
                options={accountOpts(accounts)}
                values={boxes}
                onValuesChange={setBoxes}
                disabled={!accounts.length}
                placeholder="Caixas: rodízio geral"
              />
            </div>
            <button className="btn-brand py-1 text-xs" disabled={pending} onClick={() => start(async () => { await updateProduct(p.id, { ...f, price: Number(f.price), email_account_ids: boxes }); setEdit(false); })}>Salvar</button>
            <button className="text-xs text-subtle hover:text-ink" onClick={() => setEdit(false)}>cancelar</button>
          </div>
        </td>
      </tr>
    );
  }

  const poolEmails = (p.pool || []).map((b) => b.from_email).filter(Boolean);
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3 font-medium">
        {p.name}{!p.active && <span className="ml-1 text-xs text-subtle">(inativo)</span>}
        <span className="block text-xs text-subtle">
          {poolEmails.length
            ? `Caixas (rodízio): ${poolEmails.join(", ")}`
            : "Caixas: rodízio geral"}
        </span>
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
