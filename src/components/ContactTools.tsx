"use client";

import { useMemo, useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { addContact, importContacts } from "@/app/dashboard/contatos/actions";

// Campos de destino + apelidos comuns de coluna (usados no chute do mapeamento).
const TARGETS = [
  { key: "name", label: "Nome", aliases: ["nome", "name", "nome completo", "contato", "nome do contato", "full name", "responsavel"] },
  { key: "email", label: "E-mail", aliases: ["email", "e-mail", "e mail", "email comercial", "e-mail comercial", "mail", "correio", "email 1"] },
  { key: "phone", label: "Telefone / WhatsApp", aliases: ["phone", "telefone", "whatsapp", "celular", "telefone comercial", "fone", "tel", "mobile", "telefone 1", "contato telefone"] },
  { key: "company", label: "Empresa", aliases: ["company", "empresa", "razao social", "razão social", "razao_social", "organizacao", "organização", "cliente", "conta", "nome fantasia"] },
  { key: "origin", label: "Origem", aliases: ["origin", "origem", "fonte", "source", "canal"] },
] as const;

type MapKey = (typeof TARGETS)[number]["key"];
type Mapping = Record<MapKey, string>;
const EMPTY_MAP: Mapping = { name: "", email: "", phone: "", company: "", origin: "" };

const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Chuta o mapeamento: 1) casamento exato de apelido; 2) por conteúdo (a coluna contém o apelido).
function guessMapping(headers: string[]): Mapping {
  const map: Mapping = { ...EMPTY_MAP };
  const used = new Set<string>();
  const normed = headers.map((h) => ({ h, n: norm(h) }));
  for (const t of TARGETS) {
    const aliases = t.aliases as readonly string[];
    let hit = normed.find(({ h, n }) => !used.has(h) && aliases.includes(n))?.h;
    if (!hit) hit = normed.find(({ h, n }) => !used.has(h) && aliases.some((a) => n.includes(a) || a.includes(n)))?.h;
    if (hit) { map[t.key] = hit; used.add(hit); }
  }
  return map;
}

export default function ContactTools() {
  const router = useRouter();
  const [open, setOpen] = useState<"add" | "import" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // etapa de importação: arquivo lido → prévia + mapeamento
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAP);

  async function handleAdd(fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await addContact(fd);
      if (res?.error) setMsg(res.error);
      else {
        setMsg(null);
        setOpen(null);
        if ((res as any)?.id) router.push(`/dashboard/contatos/${(res as any).id}`);
      }
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = (result.meta.fields || []).filter(Boolean) as string[];
        const rows = (result.data as Record<string, string>[]) || [];
        if (!headers.length || !rows.length) { setMsg("Não consegui ler colunas nesse arquivo. Confirme que é um CSV com cabeçalho na 1ª linha."); return; }
        setParsed({ headers, rows });
        setMapping(guessMapping(headers));
      },
      error: () => setMsg("Falha ao ler o arquivo."),
    });
  }

  // quantas linhas ficam realmente aproveitáveis com o mapeamento atual
  const stats = useMemo(() => {
    if (!parsed) return { total: 0, comContato: 0 };
    const comContato = parsed.rows.filter((r) => (mapping.email && r[mapping.email]?.trim()) || (mapping.phone && r[mapping.phone]?.trim())).length;
    return { total: parsed.rows.length, comContato };
  }, [parsed, mapping]);

  function resetImport() {
    setParsed(null);
    setMapping(EMPTY_MAP);
    if (fileRef.current) fileRef.current.value = "";
  }

  function doImport() {
    if (!parsed) return;
    const rows = parsed.rows
      .map((r) => {
        const g = (col: string) => ((col && r[col]) || "").trim();
        return {
          name: g(mapping.name),
          email: g(mapping.email),
          phone: g(mapping.phone),
          company: g(mapping.company),
          origin: g(mapping.origin),
        };
      })
      .filter((r) => r.name || r.email || r.phone); // descarta linhas totalmente vazias
    if (!rows.length) { setMsg("Nenhuma linha aproveitável com esse mapeamento. Confira as colunas escolhidas."); return; }
    start(async () => {
      const res = await importContacts(rows);
      if (res?.error) setMsg(res.error);
      else {
        const invalid = (res as any)?.invalid ? ` ${(res as any).invalid} com e-mail inválido (marcados; não entram em cadência de e-mail).` : "";
        setMsg(`${res?.count} contatos importados.${invalid}`);
        resetImport();
        setOpen(null);
        router.refresh();
      }
    });
  }

  const semContato = !mapping.email && !mapping.phone;

  return (
    <div>
      <div className="flex gap-2">
        <button className="btn-brand" onClick={() => setOpen(open === "add" ? null : "add")}>
          + Contato
        </button>
        <button className="btn-ghost" onClick={() => { setOpen(open === "import" ? null : "import"); if (open !== "import") resetImport(); }}>
          Importar CSV
        </button>
      </div>

      {open === "add" && (
        <form action={handleAdd} className="card mt-4 space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Nome *</label>
              <input name="name" className="input mt-1" required />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input name="email" type="email" className="input mt-1" />
            </div>
            <div>
              <label className="label">Telefone / WhatsApp</label>
              <input name="phone" className="input mt-1" />
            </div>
            <div>
              <label className="label">Cargo</label>
              <input name="role_title" className="input mt-1" placeholder="Sócio, Diretor Financeiro..." />
            </div>
            <div>
              <label className="label">Empresa</label>
              <input name="company" className="input mt-1" />
            </div>
            <div>
              <label className="label">CNPJ da empresa</label>
              <input name="cnpj" className="input mt-1" placeholder="00.000.000/0000-00" />
            </div>
            <div>
              <label className="label">Origem</label>
              <input name="origin" className="input mt-1" placeholder="Lead-Quente, Parceiro-Prospect..." />
            </div>
          </div>
          <p className="text-xs text-subtle">Ao salvar, abrimos a ficha completa para você incluir rapport, LinkedIn e enriquecer pelo CNPJ.</p>
          <button className="btn-brand" disabled={pending}>
            {pending ? "Salvando..." : "Salvar e abrir ficha"}
          </button>
        </form>
      )}

      {open === "import" && (
        <div className="card mt-4 space-y-3 p-5">
          {!parsed ? (
            <>
              <p className="text-sm text-subtle">Selecione um CSV com cabeçalho na 1ª linha. Na próxima etapa você confere e ajusta quais colunas viram nome, e-mail, telefone etc.</p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="text-sm" />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Confira o mapeamento das colunas</p>
                <button className="text-xs text-subtle hover:text-ink" onClick={resetImport}>trocar arquivo</button>
              </div>

              {/* mapeamento: cada campo ↔ uma coluna do arquivo */}
              <div className="grid gap-3 sm:grid-cols-2">
                {TARGETS.map((t) => (
                  <div key={t.key}>
                    <label className="label">{t.label}{t.key === "name" ? "" : " (opcional)"}</label>
                    <select
                      className="input mt-1 py-1.5 text-sm"
                      value={mapping[t.key]}
                      onChange={(e) => setMapping((m) => ({ ...m, [t.key]: e.target.value }))}
                    >
                      <option value="">— não importar —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* prévia das 3 primeiras linhas */}
              <div>
                <p className="label mb-1">Prévia (3 primeiras linhas)</p>
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="border-b border-line bg-muted/50 text-left text-subtle">
                      <tr>{parsed.headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 3).map((r, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          {parsed.headers.map((h) => <td key={h} className="max-w-[160px] truncate px-2 py-1.5 text-subtle" title={r[h]}>{r[h] || "—"}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* contagem honesta ANTES de confirmar */}
              <div className="rounded-lg bg-muted p-3 text-sm">
                <b>{stats.comContato}</b> de <b>{stats.total}</b> linhas têm e-mail ou telefone para trabalhar.
                {stats.comContato < stats.total && (
                  <span className="text-subtle"> As demais entram como contato, mas sem forma de contato até você completar.</span>
                )}
              </div>
              {semContato && (
                <p className="rounded-lg bg-warn/10 p-2.5 text-xs text-warn">⚠ Nenhuma coluna de e-mail ou telefone escolhida — os contatos entrarão sem forma de contato e não poderão receber cadência.</p>
              )}

              <div className="flex gap-2">
                <button className="btn-brand" disabled={pending} onClick={doImport}>
                  {pending ? "Importando..." : `Importar ${stats.total} contato(s)`}
                </button>
                <button className="btn-ghost" onClick={resetImport} disabled={pending}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-subtle">{msg}</p>}
    </div>
  );
}
