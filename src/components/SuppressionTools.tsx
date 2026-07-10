"use client";

import { useState, useTransition } from "react";
import { addSuppression, removeSuppression } from "@/app/dashboard/config/supressao/actions";

type Row = { id: string; email: string; reason: string; created_at: string };

export function SuppressionTools({ rows, reasonMap }: { rows: Row[]; reasonMap: Record<string, { l: string; c: string }> }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <div className="card p-4">
        <label className="label">Suprimir um e-mail manualmente</label>
        <div className="mt-1 flex gap-2">
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com.br" />
          <button className="btn-brand shrink-0" disabled={pending} onClick={() => start(async () => {
            const r = (await addSuppression(email)) as any;
            if (r?.error) setMsg(r.error); else { setEmail(""); setMsg(null); }
          })}>Adicionar</button>
        </div>
        {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      </div>

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Motivo</th>
              <th className="px-4 py-3 font-medium">Quando</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rc = reasonMap[r.reason] || reasonMap.manual;
              return (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">{r.email}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${rc.c}`}>{rc.l}</span></td>
                  <td className="px-4 py-3 text-xs text-subtle">{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-3 text-right">
                    <RemoveBtn id={r.id} />
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-subtle">Nenhum e-mail suprimido. Bom sinal — sua base está limpa.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">Remova da lista só se tiver certeza de que o e-mail voltou a ser válido (ex.: caixa reativada). Reenviar para um bounce definitivo prejudica sua reputação.</p>
    </div>
  );
}

function RemoveBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="text-xs text-subtle hover:text-danger" disabled={pending} onClick={() => start(async () => void (await removeSuppression(id)))}>
      remover
    </button>
  );
}
