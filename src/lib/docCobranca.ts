// ============================================================
// DOCUMENTO DE COBRANÇA (CPF ou CNPJ) — normalização única
//
// O Asaas exige CPF ou CNPJ para emitir a cobrança. A regra antiga era
// `replace(/\D/g,"")` + "tem 11 ou 14?" — o que passou a ser errado em julho/2026:
// o CNPJ alfanumérico tem letras nas 12 primeiras posições, e o corte por dígitos o
// transformava em algo com menos de 14 caracteres. Resultado: quem tem CNPJ novo não
// conseguiria assinar, com a mensagem inútil "informe o CPF/CNPJ".
//
// CPF continua sendo 11 dígitos, sempre numérico — ele não mudou.
// ============================================================

import { chaveCnpj } from "@/lib/cnpjFormato";

export type TipoDoc = "cpf" | "cnpj" | null;

export function normalizarDoc(raw: string | null | undefined): string {
  return (raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function tipoDoc(raw: string | null | undefined): TipoDoc {
  const v = normalizarDoc(raw);
  if (/^[0-9]{11}$/.test(v)) return "cpf";
  if (chaveCnpj(v)) return "cnpj";
  return null;
}

export const docCompleto = (raw: string | null | undefined) => tipoDoc(raw) !== null;
