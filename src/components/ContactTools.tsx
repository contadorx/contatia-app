"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addContact, importContacts } from "@/app/dashboard/contatos/actions";
import ImportadorPlanilha, { type CampoImport } from "@/components/ImportadorPlanilha";

// Campos de destino + apelidos de coluna (usados no chute do mapeamento).
// CNPJ e Cargo foram ACRESCENTADOS: o CNPJ é a chave forte para casar a empresa certa —
// sem ele, "Alfa Serviços" de dois estados diferentes viravam a mesma conta.
const CAMPOS: CampoImport[] = [
  { key: "name", label: "Nome", obrigatorio: true, dica: "Maria Souza",
    aliases: ["nome", "name", "nome completo", "contato", "nome do contato", "full name", "responsavel", "socio", "sócio"] },
  { key: "email", label: "E-mail", dica: "maria@empresa.com.br",
    aliases: ["email", "e-mail", "e mail", "email comercial", "e-mail comercial", "mail", "correio", "email 1"] },
  { key: "phone", label: "Telefone / WhatsApp", dica: "11999998888",
    aliases: ["phone", "telefone", "whatsapp", "celular", "telefone comercial", "fone", "tel", "mobile", "telefone 1", "contato telefone"] },
  { key: "company", label: "Empresa", dica: "Padaria Exemplo Ltda",
    aliases: ["company", "empresa", "razao social", "razão social", "razao_social", "organizacao", "organização", "cliente", "conta", "nome fantasia", "fantasia"] },
  { key: "cnpj", label: "CNPJ da empresa", dica: "12.345.678/0001-90",
    aliases: ["cnpj", "cnpj da empresa", "documento", "cnpj empresa"] },
  { key: "role_title", label: "Cargo", dica: "Sócio",
    aliases: ["cargo", "role", "funcao", "função", "titulo", "título", "position", "qualificacao", "qualificação"] },
  { key: "origin", label: "Origem", dica: "Lista Enquadria A",
    aliases: ["origin", "origem", "fonte", "source", "canal", "lista"] },
];

export default function ContactTools() {
  const router = useRouter();
  const [open, setOpen] = useState<"add" | "import" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();


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

  return (
    <div>
      <div className="flex gap-2">
        <button className="btn-brand" onClick={() => setOpen(open === "add" ? null : "add")}>
          + Contato
        </button>
        <button className="btn-ghost" onClick={() => setOpen(open === "import" ? null : "import")}>
          Importar CSV / Excel
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
        <ImportadorPlanilha
          titulo="Importar contatos"
          descricao="Aceita CSV (vírgula ou ponto-e-vírgula) e Excel (.xlsx). A 1ª linha preenchida é o cabeçalho. Na etapa seguinte você confere quais colunas viram nome, e-mail, empresa etc."
          campos={CAMPOS}
          modeloNome="modelo-contatos-contatia.csv"
          onFechar={() => setOpen(null)}
          onImportar={async (linhas) => {
            const res: any = await importContacts(linhas as any);
            if (res?.error) return { error: res.error };
            // Relatório honesto do VÍNCULO: é justamente o número que faltava para
            // perceber que a empresa não estava colando.
            const partes = [`${res.count} contato(s) importado(s).`];
            if (res.comEmpresa) partes.push(`${res.comEmpresa} vinculado(s) a empresa` + (res.empresasCriadas ? ` (${res.empresasCriadas} empresa(s) nova(s))` : "") + ".");
            if (res.semEmpresa) partes.push(`${res.semEmpresa} tinham empresa no arquivo mas não foi possível vincular.`);
            if (res.invalid) partes.push(`${res.invalid} com e-mail inválido (marcados; não entram em cadência de e-mail).`);
            router.refresh();
            return { mensagem: partes.join(" "), aviso: res.aviso };
          }}
        />
      )}

      {msg && <p className="mt-3 text-sm text-subtle">{msg}</p>}
    </div>
  );
}
