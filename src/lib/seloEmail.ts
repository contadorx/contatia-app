// ============================================================
// DE ONDE VEIO ESTE E-MAIL, E QUEM O CONFIRMOU
//
// O selo "SMTP validado" só era gravado num dos caminhos — o da descoberta por
// padrões (nome@empresa) confirmada no servidor. Os outros dois caminhos gravavam o
// endereço e nada mais:
//
//   · e-mail PUBLICADO no site (contato@empresa) — achado pela varredura;
//   · e-mail vindo da esteira, no cron.
//
// Como a tela lê `custom.email_check`, um endereço recém-descoberto aparecia como
// "não conferido". A pessoa acabava de rodar a busca, via o e-mail chegar, e a ficha
// dizia que ninguém tinha conferido nada. Parece bug e é pior que bug: é o app
// escondendo o que ele mesmo sabe.
//
// TRÊS ESTADOS, e a diferença entre eles importa:
//
//   valid: true   o servidor do domínio CONFIRMOU que a caixa existe (conversa SMTP).
//   valid: null   o e-mail está PUBLICADO pela própria empresa no site. Não é uma
//                 confirmação técnica, é uma afirmação do dono do domínio — o que em
//                 LGPD é até melhor. Mas não é a mesma coisa, e a tela não vai dizer
//                 que é.
//   valid: false  o servidor respondeu que a caixa NÃO existe.
//
// `null` não é "não sei se serve": é "sei de onde veio, não testei a caixa". Fundir
// isso com "não conferido" é o que apagava a informação.
// ============================================================

export type SeloEmail = {
  valid: boolean | null;
  reason: string;
  checked_at: string;
  origem: "descoberta" | "site" | "manual" | "importacao";
};

export function seloConfirmado(): SeloEmail {
  return {
    valid: true,
    reason: "confirmado pelo servidor do domínio (SMTP)",
    checked_at: new Date().toISOString(),
    origem: "descoberta",
  };
}

export function seloPublicado(fonte?: string | null): SeloEmail {
  return {
    valid: null,
    reason: fonte ? `publicado pela empresa em ${fonte}` : "publicado no site da empresa",
    checked_at: new Date().toISOString(),
    origem: "site",
  };
}

export function seloRecusado(motivo?: string | null): SeloEmail {
  return {
    valid: false,
    reason: motivo || "o servidor do domínio respondeu que a caixa não existe",
    checked_at: new Date().toISOString(),
    origem: "descoberta",
  };
}

/** Texto curto para a ficha. `null` devolve null: sem selo, a tela diz "não conferido". */
export function rotuloSelo(check: any): { texto: string; ok: boolean; alerta: boolean } | null {
  if (!check || typeof check !== "object") return null;
  const quando = check.checked_at
    ? new Date(check.checked_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;
  const sufixo = quando ? ` · ${quando}` : "";
  if (check.valid === true) return { texto: `SMTP validado${sufixo}`, ok: true, alerta: false };
  if (check.valid === false) return { texto: `servidor recusou${sufixo}`, ok: false, alerta: true };
  return { texto: `publicado no site${sufixo}`, ok: false, alerta: false };
}

/** Junta o selo ao `custom` existente sem apagar o resto. */
export function comSelo(customAtual: any, selo: SeloEmail): Record<string, unknown> {
  return { ...((customAtual as any) || {}), email_check: selo };
}
