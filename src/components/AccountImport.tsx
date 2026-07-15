"use client";

import { useState, useTransition } from "react";
import { importEmpresasCsv } from "@/app/dashboard/contas/actions";

const TEMPLATE_HEADER = "cnpj,razao_social,nome_fantasia,cnae,uf,municipio,dominio,contato_principal,email,telefone";
const TEMPLATE_EXAMPLE = "12345678000190,Padaria Exemplo Ltda,Padaria do Bairro,4721-1/02,SP,São Paulo,padaria.com.br,Maria Souza,contato@padaria.com.br,11999990000";

export default function AccountImport() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMsg(null); setErro(null);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  }

  function baixarModelo() {
    const blob = new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_EXAMPLE}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-empresas-contatia.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const linhas = csv.split(/\r?\n/).filter((l) => l.trim());
  const nRegistros = Math.max(linhas.length - 1, 0);

  function importar() {
    setMsg(null); setErro(null);
    start(async () => {
      const r: any = await importEmpresasCsv(csv);
      if (r?.error) { setErro(r.error); return; }
      const partes = [`${r.empresas} empresa(s) importada(s)`];
      if (r.contatos) partes.push(`${r.contatos} contato(s) criado(s)`);
      setMsg(partes.join(" · ") + ".");
      setCsv(""); setFileName(null);
    });
  }

  if (!open) {
    return (
      <button className="btn-outline" onClick={() => setOpen(true)}>
        Importar CSV
      </button>
    );
  }

  return (
    <div className="card w-full p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">Importar empresas (CSV)</h3>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
      </div>
      <p className="mt-1 text-sm text-subtle">
        Suba uma lista de empresas. Se o arquivo tiver contato/e-mail/telefone, o contato é criado e vinculado à empresa. Aceita vírgula ou ponto-e-vírgula.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="btn-brand cursor-pointer px-4">
          Escolher arquivo CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
        <button className="text-sm text-brand hover:underline" onClick={baixarModelo}>baixar modelo</button>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setShowPaste((s) => !s)}>
          {showPaste ? "− fechar colar" : "ou colar o CSV"}
        </button>
      </div>

      {fileName && <p className="mt-2 text-xs text-subtle">{fileName} · {nRegistros} empresa(s) para importar</p>}

      {showPaste && (
        <textarea
          className="input mt-3 h-32 w-full font-mono text-xs"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="Cole aqui o conteúdo do CSV (a 1ª linha é o cabeçalho)…"
        />
      )}

      <div className="mt-3">
        <button className="btn-brand px-4" onClick={importar} disabled={pending || !csv.trim()}>
          {pending ? "Importando…" : "Importar"}
        </button>
      </div>

      {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
      {msg && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
    </div>
  );
}
