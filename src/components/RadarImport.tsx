"use client";

import { useState, useTransition } from "react";
import { importRadarCsv } from "@/app/dashboard/radar/actions";

// Colunas reconhecidas pelo importador (espelha o server em radar/actions.ts).
const RECOGNIZED: { key: string; label: string; names: string[] }[] = [
  { key: "cnpj", label: "CNPJ", names: ["cnpj"] },
  { key: "razao", label: "Razão social", names: ["razao_social", "razão social", "razao", "nome"] },
  { key: "fantasia", label: "Nome fantasia", names: ["nome_fantasia", "fantasia"] },
  { key: "cnae", label: "Atividade (CNAE)", names: ["cnae", "cnae_fiscal"] },
  { key: "uf", label: "UF", names: ["uf", "estado"] },
  { key: "municipio", label: "Município", names: ["municipio", "município", "cidade"] },
  { key: "bairro", label: "Bairro", names: ["bairro", "distrito"] },
  { key: "situacao", label: "Situação", names: ["situacao_cadastral", "situacao", "situação"] },
  { key: "porte", label: "Porte", names: ["porte"] },
  { key: "tier", label: "Prioridade", names: ["tier"] },
  { key: "contato", label: "Contato", names: ["contato_principal", "contato", "responsavel"] },
  { key: "email", label: "E-mail", names: ["email", "e-mail"] },
  { key: "telefone", label: "Telefone", names: ["telefone", "fone", "phone"] },
];

// Cabeçalho canônico + uma linha de exemplo para o modelo baixável.
const TEMPLATE_HEADER = "cnpj,razao_social,nome_fantasia,cnae,uf,municipio,bairro,situacao_cadastral,porte,tier,contato_principal,email,telefone";
const TEMPLATE_EXAMPLE = "12345678000190,Padaria Exemplo Ltda,Padaria do Bairro,4721-1/02,SP,São Paulo,Centro,ATIVA,ME,T2,Maria Souza,contato@padaria.com.br,11999990000";

export default function RadarImport() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  }

  function baixarModelo() {
    const blob = new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_EXAMPLE}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-radar-contatia.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // --- detecção de cabeçalho (client) ---
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim());
  const temDados = linhas.length >= 2;
  const delim = linhas[0]?.includes(";") ? ";" : ",";
  const cabec = temDados ? linhas[0].split(delim).map((h) => h.trim().toLowerCase()) : [];
  const detectadas = RECOGNIZED.filter((r) => r.names.some((n) => cabec.includes(n)));
  const temChaves = detectadas.some((d) => d.key === "cnpj") || detectadas.some((d) => d.key === "razao");
  const nRegistros = temDados ? linhas.length - 1 : 0;

  function importar() {
    setMsg(null);
    start(async () => {
      const res = (await importRadarCsv(csv)) as { inserted?: number; error?: string };
      if (res?.error) setMsg(res.error);
      else {
        setMsg(`✓ ${res.inserted} empresas importadas.`);
        setCsv("");
        setFileName(null);
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
      <p className="text-sm font-semibold">Importar base de garimpo</p>
      <p className="mt-1 text-xs text-subtle">
        Baixe o modelo, preencha com suas empresas e suba o arquivo. Aceita CSV separado por vírgula ou ponto-e-vírgula.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost py-1.5 text-sm" onClick={baixarModelo}>
          ⬇ Baixar modelo de planilha
        </button>
        <label className="btn-brand cursor-pointer py-1.5 text-sm">
          Escolher arquivo CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
        {fileName && <span className="text-xs text-subtle">{fileName}</span>}
      </div>

      {/* detecção de cabeçalho */}
      {temDados && (
        <div className="mt-3 rounded-xl border border-line bg-muted/40 p-3">
          <p className="text-xs font-semibold">Detectamos {detectadas.length} coluna(s) · {nRegistros} empresa(s) para importar</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detectadas.map((d) => (
              <span key={d.key} className="rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">✓ {d.label}</span>
            ))}
            {!detectadas.length && <span className="text-xs text-subtle">Nenhuma coluna reconhecida — confira o cabeçalho no modelo.</span>}
          </div>
          {detectadas.length > 0 && !temChaves && (
            <p className="mt-2 text-[11px] font-semibold text-warn">Inclua ao menos <b>cnpj</b> ou <b>razao_social</b> para identificar cada empresa.</p>
          )}
        </div>
      )}

      {/* colar como alternativa (opcional, sem monospace) */}
      <button type="button" className="mt-3 text-xs font-medium text-brand hover:underline" onClick={() => setShowPaste((s) => !s)}>
        {showPaste ? "− Fechar colar CSV" : "ou colar o CSV manualmente"}
      </button>
      {showPaste && (
        <textarea
          className="input mt-2 min-h-[90px] text-xs"
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
          placeholder="Cole aqui o conteúdo do CSV (a 1ª linha é o cabeçalho)…"
        />
      )}

      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}

      <div className="mt-3 flex gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={importar} disabled={pending || !csv.trim()}>
          {pending ? "Importando..." : nRegistros ? `Importar ${nRegistros} empresa(s)` : "Importar"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(false)}>
          Fechar
        </button>
      </div>
    </div>
  );
}
