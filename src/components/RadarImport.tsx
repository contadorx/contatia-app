"use client";

import { useState, useTransition } from "react";
import { importRadarCsv } from "@/app/dashboard/radar/actions";

export default function RadarImport() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  }
  function importar() {
    setMsg(null);
    start(async () => {
      const res = (await importRadarCsv(csv)) as { inserted?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setMsg(`✓ ${res.inserted} empresas importadas.`);
        setCsv("");
      }
    });
  }

  if (!open)
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Importar base (CSV)
      </button>
    );

  return (
    <div className="card p-5">
      <p className="text-sm font-semibold">Importar base de garimpo (CSV)</p>
      <p className="mt-1 text-xs text-subtle">
        Colunas reconhecidas: cnpj, razao_social, nome_fantasia, cnae, uf, municipio, situacao_cadastral, porte, tier, contato_principal, email, telefone. Separador , ou ;
      </p>
      <input type="file" accept=".csv,text/csv" className="mt-3 text-sm" onChange={onFile} />
      <textarea className="input mt-3 min-h-[100px] font-mono text-[11px]" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="ou cole o CSV aqui…" />
      {msg && <p className="mt-2 text-sm text-subtle">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={importar} disabled={pending || !csv.trim()}>
          {pending ? "Importando..." : "Importar"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(false)}>
          Fechar
        </button>
      </div>
    </div>
  );
}
