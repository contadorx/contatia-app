"use client";

// ============================================================
// Importar EMPRESAS — usa o mesmo importador de Contatos.
//
// Antes esta tela tinha caminho próprio: textarea, ordem fixa de colunas, split cru por
// vírgula, sem prévia. Duas telas para o mesmo problema divergiam com o tempo, e a de
// Empresas ficou com o pior comportamento (um nome com vírgula desalinhava a linha).
// Agora só a LISTA DE CAMPOS é diferente.
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImportadorPlanilha, { type CampoImport } from "@/components/ImportadorPlanilha";
import { importEmpresas } from "@/app/dashboard/contas/actions";

const CAMPOS: CampoImport[] = [
  { key: "razao", label: "Razão social", dica: "Padaria Exemplo Ltda",
    aliases: ["razao social", "razão social", "razao_social", "razao", "empresa", "nome", "name", "company"] },
  { key: "fantasia", label: "Nome fantasia", dica: "Padaria do Bairro",
    aliases: ["nome fantasia", "nome_fantasia", "fantasia", "apelido", "trade name"] },
  { key: "cnpj", label: "CNPJ", dica: "12.345.678/0001-90",
    aliases: ["cnpj", "documento", "cnpj da empresa"] },
  { key: "cnae", label: "CNAE", dica: "4721-1/02",
    aliases: ["cnae", "cnae fiscal", "cnae_fiscal", "atividade", "codigo cnae"] },
  { key: "uf", label: "UF", dica: "SP",
    aliases: ["uf", "estado", "sigla uf"] },
  { key: "municipio", label: "Município", dica: "Santo André",
    aliases: ["municipio", "município", "cidade", "city"] },
  { key: "dominio", label: "Domínio / site", dica: "padaria.com.br",
    aliases: ["dominio", "domínio", "site", "website", "url", "web"] },
  { key: "contato", label: "Contato principal", dica: "Maria Souza",
    aliases: ["contato principal", "contato_principal", "contato", "responsavel", "responsável", "socio", "sócio", "nome do contato"] },
  { key: "email", label: "E-mail", dica: "contato@padaria.com.br",
    aliases: ["email", "e-mail", "e mail", "email comercial", "mail"] },
  { key: "telefone", label: "Telefone / WhatsApp", dica: "11999998888",
    aliases: ["telefone", "fone", "phone", "celular", "whatsapp", "tel"] },
];

export default function AccountImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return <button className="btn-outline" onClick={() => setOpen(true)}>Importar CSV / Excel</button>;
  }

  return (
    <ImportadorPlanilha
      titulo="Importar empresas"
      descricao="Aceita CSV (vírgula ou ponto-e-vírgula) e Excel (.xlsx). Se a linha tiver contato/e-mail/telefone, o contato é criado e já vinculado à empresa. Precisa de razão social, nome fantasia OU CNPJ."
      campos={CAMPOS}
      modeloNome="modelo-empresas-contatia.csv"
      onFechar={() => setOpen(false)}
      onImportar={async (linhas) => {
        const r: any = await importEmpresas(linhas as any);
        if (r?.error) return { error: r.error };
        const partes = [`${r.empresas} empresa(s) criada(s).`];
        if (r.jaExistiam) partes.push(`${r.jaExistiam} já existiam e foram reaproveitadas.`);
        if (r.completadas) partes.push(`${r.completadas} tiveram campos vazios preenchidos.`);
        if (r.contatos) partes.push(`${r.contatos} contato(s) criado(s).`);
        router.refresh();
        return { mensagem: partes.join(" "), aviso: r.aviso };
      }}
    />
  );
}
