"use client";

// ============================================================
// IMPORTADOR ÚNICO — Contatos e Empresas usam ESTE componente
//
// Antes eram dois importadores diferentes, e a diferença não era estética:
//   • Contatos: PapaParse + mapeamento de colunas + prévia. Só 5 campos, só .csv.
//   • Empresas: `linha.split(",")` cru, ordem FIXA de colunas, sem prévia, só .csv.
//     O split cru é um defeito de correção, não de conforto: um nome com vírgula
//     ("Padaria Exemplo, Ltda") desalinhava a linha inteira e o CNPJ ia para a coluna
//     errada — em silêncio.
//
// Agora os dois passam pelo mesmo caminho: mesmo leitor, mesmo mapeamento, mesma prévia,
// mesma contagem antes de confirmar. O que muda entre eles é só a LISTA DE CAMPOS.
// ============================================================

import { useMemo, useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import SmartSelect from "@/components/SmartSelect";
import { lerXlsx, listarAbas, ehXlsx, ehXlsAntigo, type Tabela } from "@/lib/planilha";

export type CampoImport = {
  key: string;
  label: string;
  obrigatorio?: boolean;
  dica?: string;
  aliases: string[];
};

export type ResultadoImport = {
  error?: string;
  mensagem?: string;
  aviso?: string;
};

const norm = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Chuta o mapeamento: 1) apelido exato; 2) a coluna contém o apelido.
// Uma coluna só pode servir a UM campo — sem isso, "email" e "email 2" disputariam a
// mesma coluna e o segundo campo ficaria vazio sem explicação.
function chutarMapeamento(headers: string[], campos: CampoImport[]): Record<string, string> {
  const map: Record<string, string> = {};
  const usadas = new Set<string>();
  const normed = headers.map((h) => ({ h, n: norm(h) }));
  for (const c of campos) {
    let hit = normed.find(({ h, n }) => !usadas.has(h) && c.aliases.includes(n))?.h;
    if (!hit) hit = normed.find(({ h, n }) => !usadas.has(h) && c.aliases.some((a) => n === a))?.h;
    if (!hit) hit = normed.find(({ h, n }) => !usadas.has(h) && c.aliases.some((a) => n.includes(a)))?.h;
    if (hit) { map[c.key] = hit; usadas.add(hit); }
    else map[c.key] = "";
  }
  return map;
}

// CSV salvo pelo Excel em português costuma vir em Windows-1252, não UTF-8. Lido como
// UTF-8 vira "SÃ£o Paulo". Detectamos pelo caractere de substituição (U+FFFD) e
// redecodificamos — senão a base entra inteira com acento quebrado.
function decodificar(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try { return new TextDecoder("windows-1252").decode(buf); } catch { return utf8; }
}

export default function ImportadorPlanilha({
  titulo,
  descricao,
  campos,
  modeloNome,
  onImportar,
  onFechar,
}: {
  titulo: string;
  descricao: string;
  campos: CampoImport[];
  modeloNome: string;
  onImportar: (linhas: Record<string, string>[]) => Promise<ResultadoImport>;
  onFechar: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [tabela, setTabela] = useState<Tabela | null>(null);
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({});
  const [abas, setAbas] = useState<string[]>([]);
  const [abaAtual, setAbaAtual] = useState(0);
  const [bufXlsx, setBufXlsx] = useState<ArrayBuffer | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);

  function aplicar(t: Tabela) {
    if (!t.headers.length || !t.rows.length) {
      setErro("Não achei colunas com dados nesse arquivo. A 1ª linha preenchida precisa ser o cabeçalho.");
      return;
    }
    setTabela(t);
    setMapeamento(chutarMapeamento(t.headers, campos));
  }

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(null); setMsg(null); setTabela(null); setAbas([]); setBufXlsx(null);
    setNomeArquivo(file.name);

    // .xls antigo é binário (BIFF), formato completamente diferente do .xlsx. Dizer isso
    // é melhor do que tentar ler e devolver lixo ou um erro incompreensível.
    if (ehXlsAntigo(file.name)) {
      setErro("Arquivo .xls antigo não é lido aqui. Abra no Excel e salve como .xlsx (ou CSV UTF-8) — leva 10 segundos.");
      return;
    }

    if (ehXlsx(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buf = reader.result as ArrayBuffer;
          const nomes = listarAbas(buf);
          setBufXlsx(buf); setAbas(nomes); setAbaAtual(0);
          aplicar(lerXlsx(buf, 0));
        } catch (err: any) {
          setErro(`Não consegui ler a planilha: ${err?.message || "arquivo inválido"}.`);
        }
      };
      reader.onerror = () => setErro("Falha ao ler o arquivo.");
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV / TXT
    const reader = new FileReader();
    reader.onload = () => {
      const texto = decodificar(reader.result as ArrayBuffer);
      const r = Papa.parse<Record<string, string>>(texto, { header: true, skipEmptyLines: "greedy" });
      const headers = (r.meta.fields || []).filter(Boolean) as string[];
      const rows = (r.data || []).filter((l) => Object.values(l).some((v) => (v || "").trim()));
      aplicar({ headers, rows });
    };
    reader.onerror = () => setErro("Falha ao ler o arquivo.");
    reader.readAsArrayBuffer(file);
  }

  function trocarAba(i: number) {
    if (!bufXlsx) return;
    setAbaAtual(i);
    setErro(null);
    try { aplicar(lerXlsx(bufXlsx, i)); } catch (e: any) { setErro(`Não consegui ler essa aba: ${e?.message}.`); }
  }

  function recomeçar() {
    setTabela(null); setAbas([]); setBufXlsx(null); setNomeArquivo(null);
    setErro(null); setMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const obrigatorios = campos.filter((c) => c.obrigatorio);
  const faltamObrigatorios = obrigatorios.filter((c) => !mapeamento[c.key]);

  const linhasMapeadas = useMemo(() => {
    if (!tabela) return [];
    return tabela.rows
      .map((r) => {
        const o: Record<string, string> = {};
        for (const c of campos) {
          const col = mapeamento[c.key];
          o[c.key] = ((col && r[col]) || "").trim();
        }
        return o;
      })
      .filter((o) => campos.some((c) => o[c.key]));   // descarta linha totalmente vazia
  }, [tabela, mapeamento, campos]);

  const aproveitaveis = useMemo(
    () => (obrigatorios.length ? linhasMapeadas.filter((o) => obrigatorios.every((c) => o[c.key])).length : linhasMapeadas.length),
    [linhasMapeadas, obrigatorios]
  );

  function baixarModelo() {
    const cab = campos.map((c) => c.label).join(";");
    const exemplo = campos.map((c) => c.dica || "").join(";");
    // BOM + ponto-e-vírgula: é assim que o Excel em português abre o arquivo já em
    // colunas, sem passar pelo assistente de importação.
    const blob = new Blob(["﻿" + cab + "\r\n" + exemplo + "\r\n"], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = modeloNome;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function importar() {
    if (!linhasMapeadas.length) { setErro("Nenhuma linha aproveitável com esse mapeamento."); return; }
    setErro(null); setMsg(null);
    start(async () => {
      try {
        const r = await onImportar(linhasMapeadas);
        if (r?.error) { setErro(r.error); return; }
        setMsg([r.mensagem, r.aviso].filter(Boolean).join(" "));
        recomeçar();
      } catch (e: any) {
        setErro(`A importação foi interrompida (${e?.message || "falha de conexão"}). Confira a lista antes de repetir — parte pode ter entrado.`);
      }
    });
  }

  return (
    <div className="card mt-4 space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">{titulo}</h3>
        <button className="text-sm text-subtle hover:text-ink" onClick={onFechar}>fechar</button>
      </div>

      {!tabela ? (
        <>
          <p className="text-sm text-subtle">{descricao}</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn-brand cursor-pointer px-4">
              Escolher arquivo
              <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={aoEscolherArquivo} />
            </label>
            <button className="text-sm text-brand hover:underline" onClick={baixarModelo}>baixar modelo</button>
            <span className="text-xs text-subtle">CSV ou Excel (.xlsx)</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              Confira o mapeamento das colunas
              {nomeArquivo && <span className="ml-2 font-normal text-subtle">· {nomeArquivo}</span>}
            </p>
            <button className="text-xs text-subtle hover:text-ink" onClick={recomeçar}>trocar arquivo</button>
          </div>

          {abas.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-muted/40 px-3 py-2">
              <span className="text-xs text-subtle">Aba da planilha:</span>
              {abas.map((nome, i) => (
                <button
                  key={nome + i}
                  onClick={() => trocarAba(i)}
                  className={`rounded-md px-2 py-1 text-xs ${i === abaAtual ? "bg-brand text-white" : "bg-white text-ink hover:bg-muted"}`}
                >
                  {nome}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map((c) => (
              <div key={c.key}>
                <label className="label">
                  {c.label}{c.obrigatorio ? " *" : " (opcional)"}
                </label>
                <div className="mt-1">
                  <SmartSelect
                    className="py-1.5 text-sm"
                    clearable
                    placeholder="— não importar —"
                    value={mapeamento[c.key] || ""}
                    onValueChange={(v) => setMapeamento((m) => ({ ...m, [c.key]: v }))}
                    options={tabela.headers.map((h) => ({ value: h, label: h }))}
                  />
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="label mb-1">Prévia (3 primeiras linhas, já mapeadas)</p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="border-b border-line bg-muted/50 text-left text-subtle">
                  <tr>{campos.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {linhasMapeadas.slice(0, 3).map((r, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {campos.map((c) => (
                        <td key={c.key} className="max-w-[160px] truncate px-2 py-1.5 text-subtle" title={r[c.key]}>
                          {r[c.key] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <b>{aproveitaveis}</b> de <b>{tabela.rows.length}</b> linhas serão importadas.
            {aproveitaveis < tabela.rows.length && obrigatorios.length > 0 && (
              <span className="text-subtle"> As demais estão sem {obrigatorios.map((c) => c.label.toLowerCase()).join("/")} e são descartadas.</span>
            )}
          </div>

          {faltamObrigatorios.length > 0 && (
            <p className="rounded-lg bg-warn/10 p-2.5 text-xs text-warn">
              ⚠ Escolha a coluna de <b>{faltamObrigatorios.map((c) => c.label).join(", ")}</b> — sem ela nada é importado.
            </p>
          )}

          <div className="flex gap-2">
            <button className="btn-brand px-4" disabled={pending || !!faltamObrigatorios.length || !aproveitaveis} onClick={importar}>
              {pending ? "Importando…" : `Importar ${aproveitaveis}`}
            </button>
            <button className="btn-ghost" onClick={recomeçar} disabled={pending}>Cancelar</button>
          </div>
        </>
      )}

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
    </div>
  );
}
