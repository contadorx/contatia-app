"use client";

import { useState, useRef, useTransition } from "react";
import Papa from "papaparse";
import { addContact, importContacts } from "@/app/dashboard/contatos/actions";

export default function ContactTools() {
  const [open, setOpen] = useState<"add" | "import" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleAdd(fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await addContact(fd);
      if (res?.error) setMsg(res.error);
      else {
        setMsg(null);
        setOpen(null);
      }
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("Lendo arquivo...");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = (result.data as Record<string, string>[]).map((r) => ({
          name: r.name || r.nome || "",
          email: r.email || r["e-mail"] || "",
          phone: r.phone || r.telefone || r.whatsapp || "",
          company: r.company || r.empresa || r.razao_social || "",
          origin: r.origin || r.origem || "",
        }));
        start(async () => {
          const res = await importContacts(rows);
          if (res?.error) setMsg(res.error);
          else {
            setMsg(`${res?.count} contatos importados.${(res as any)?.invalid ? ` ${(res as any).invalid} com e-mail inválido (marcados; não entram em cadência de e-mail).` : ""}`);
            if (fileRef.current) fileRef.current.value = "";
          }
        });
      },
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        <button className="btn-brand" onClick={() => setOpen(open === "add" ? null : "add")}>
          + Contato
        </button>
        <button className="btn-ghost" onClick={() => setOpen(open === "import" ? null : "import")}>
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
              <label className="label">Empresa</label>
              <input name="company" className="input mt-1" />
            </div>
            <div>
              <label className="label">Origem</label>
              <input name="origin" className="input mt-1" placeholder="Lead-Quente, Parceiro-Prospect..." />
            </div>
          </div>
          <button className="btn-brand" disabled={pending}>
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </form>
      )}

      {open === "import" && (
        <div className="card mt-4 space-y-3 p-5">
          <p className="text-sm text-subtle">
            CSV com cabeçalho. Colunas aceitas: <code>name/nome</code>, <code>email</code>,{" "}
            <code>phone/telefone</code>, <code>company/empresa</code>, <code>origin/origem</code>.
          </p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="text-sm" />
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-subtle">{msg}</p>}
    </div>
  );
}
