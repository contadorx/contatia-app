// ============================================================
// OS TIPOS E A REGRA DOS PASSOS — módulo neutro
//
// Mora aqui, e não junto das server actions, por uma razão do Next: arquivo com
// `"use server"` só pode exportar funções ASSÍNCRONAS. `passosPendentes` é síncrona e
// pura, e é usada dos dois lados — o servidor para decidir, a tela para desenhar o que
// falta. Duplicar a regra em dois arquivos seria pedir para elas divergirem.
// ============================================================

export type PassoId = "cnpj" | "site" | "email" | "whatsapp";
export type Tom = "ok" | "nada" | "erro" | "pulado";

export type EstadoContato = {
  temCnpj: boolean;
  enriquecido: boolean;
  dominio: string;
  temEmail: boolean;
  emailDeBalcao: boolean;
  // e-mail cujo domínio NÃO é o domínio (vivo) da empresa — herança de cadastro antigo
  emailForaDoDominio: boolean;
  temTelefone: boolean;
  waStatus: string | null;
  temRede: boolean;
  // Todos os domínios que o app considerou, em ordem. Só para a mensagem de erro —
  // nenhuma decisão usa isto.
  candidatos?: string;

  // ============================================================
  // OS VALORES, NÃO SÓ OS "TEM / NÃO TEM"
  //
  // O quadro de canais dizia "E-mail: do decisor" e "WhatsApp: confirmado". Certo e
  // inútil: depois de descobrir, a pergunta seguinte é sempre "qual?", e para
  // responder era preciso rolar até o cabeçalho, abrir o painel recolhido das redes,
  // e daí copiar na mão. Muitos cliques para ver o que o app acabou de achar.
  //
  // Estes campos NÃO participam de nenhuma decisão — `passosPendentes` continua
  // olhando só os booleanos acima. São para a tela mostrar o valor e o link.
  // ============================================================
  email?: string | null;
  emailConferido?: boolean;      // servidor do domínio confirmou (selo SMTP)
  emailConferidoEm?: string | null;
  telefone?: string | null;
  waCheckedAt?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  enriquecidoEm?: string | null;
};

export type ResultadoPasso = {
  passo: PassoId;
  texto: string;
  tom: Tom;
  estado?: EstadoContato;   // estado DEPOIS do passo — quem chamou usa para redesenhar
  error?: string;
};

// A ordem é fixa e não é arbitrária: cada passo pode destravar o seguinte. O CNPJ traz o
// domínio; o domínio abre o site; o site traz o telefone; o telefone permite o WhatsApp.
export const ORDEM_PASSOS: PassoId[] = ["cnpj", "site", "email", "whatsapp"];

export const ROTULO_PASSO: Record<PassoId, string> = {
  cnpj: "CNPJ",
  site: "site",
  email: "e-mail",
  whatsapp: "WhatsApp",
};

// Quais passos ainda fazem sentido, dado um estado. Quatro regras, cada uma achada
// testando:
//
// · CNPJ não enriquecido pode CRIAR o domínio, então site e e-mail entram no plano
//   mesmo sem domínio agora — passam a ser possíveis depois do primeiro passo;
// · o site só entra se ainda falta algo que ele saiba dar. Num contato completo,
//   visitá-lo é gastar tempo para reescrever o que já está lá;
// · ter `contato@` não é ter o e-mail do decisor — vale procurar mesmo assim;
// · e-mail num domínio DIFERENTE do da empresa também não serve. Caso real: a ficha
//   tinha `rogerio@asseconassessoria.com.br` numa empresa cujo domínio é
//   `contabilribeiro.com.br` — outra pessoa, noutro domínio, e ainda por cima um
//   domínio morto. Como "rogerio" não é caixa de balcão, o bloco concluía "já tem o
//   e-mail do decisor" e parava. O controle individual achava o certo porque o
//   operador digitava o domínio na mão;
// · WhatsApp `invalid` é resposta, não ausência dela. Já sabemos que o número não tem.
export function passosPendentes(e: EstadoContato): PassoId[] {
  const podeTerDominio = !!e.dominio || (e.temCnpj && !e.enriquecido);
  const faltaAlgoDoSite = !e.temEmail || !e.temTelefone || !e.temRede;
  const waRespondido = e.waStatus === "valid" || e.waStatus === "invalid";
  return [
    e.temCnpj && !e.enriquecido ? "cnpj" : null,
    podeTerDominio && faltaAlgoDoSite ? "site" : null,
    (!e.temEmail || e.emailDeBalcao || e.emailForaDoDominio) && podeTerDominio ? "email" : null,
    e.temTelefone && !waRespondido ? "whatsapp" : null,
  ].filter(Boolean) as PassoId[];
}
