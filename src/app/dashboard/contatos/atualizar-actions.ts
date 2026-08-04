"use server";

// ============================================================
// POR QUE O BLOCO ERA PIOR QUE OS CONTROLES INDIVIDUAIS
//
// O relato foi preciso: funcionou para Instagram e LinkedIn, o WhatsApp nem apareceu, e
// a busca de e-mail que funciona no controle individual não funcionava no bloco. A
// conclusão — "o componente individual é mais funcional" — estava certa, e a causa é
// uma só.
//
// A primeira versão do bloco decidia TUDO a partir da foto que a página tirou ao
// carregar: tem e-mail? tem telefone? tem domínio? Só que os passos MUDAM essas
// respostas enquanto rodam:
//
//   · o passo do CNPJ pode preencher o domínio e o telefone;
//   · o passo do site pode preencher telefone e e-mail publicado;
//   · aí o passo de e-mail olhava a foto velha ("não tinha e-mail") e o de WhatsApp
//     nem entrava no plano, porque na foto não havia telefone.
//
// Instagram e LinkedIn funcionavam justamente por serem os únicos que não dependem de
// nada descoberto no meio do caminho — precisam só do domínio, que já existia.
//
// Os controles individuais nunca tiveram esse problema porque cada um é uma requisição
// que lê o contato do banco na hora. O bloco raciocinava sobre memória; eles, sobre o
// estado real.
//
// A CORREÇÃO: cada passo virou uma chamada que RELÊ o contato antes de decidir. O
// cliente só percorre a lista de passos e mostra o que voltou. Não há mais estado do
// lado do navegador para envelhecer.
//
// Continua sendo uma chamada por passo, de propósito: a conversa SMTP sozinha pode levar
// 55s e a rota tem teto de 60s. Tudo numa função só estouraria o limite e derrubaria o
// que já tinha dado certo.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { dominioCorporativo, ehCaixaDeBalcao, dominioDe, pareceEmailDaPessoa } from "@/lib/emailFinder";
// Tipos e a regra dos passos vivem em @/lib/passosContato: arquivo "use server" só pode
// exportar funções async, e `passosPendentes` é síncrona (e usada também pela tela).
import type { PassoId, Tom, EstadoContato, ResultadoPasso } from "@/lib/passosContato";

// Teste barato de existência: só pergunta ao DNS se o nome resolve. Não baixa página,
// não segue redirecionamento — a pergunta é "este endereço existe?", não "o que tem
// nele". Qualquer erro de resolução conta como não existe, que é o efeito prático.
async function dominioResolve(dominio: string): Promise<boolean> {
  if (!dominio) return false;
  try {
    const dns = await import("node:dns");
    const r = dns.promises;
    // A ou AAAA resolve o site; MX resolve domínio que só recebe e-mail. Qualquer um
    // dos três serve para dizer que o nome está vivo.
    const tentativas = await Promise.allSettled([r.resolve4(dominio), r.resolve6(dominio), r.resolveMx(dominio)]);
    return tentativas.some((t) => t.status === "fulfilled" && (t.value as any[])?.length > 0);
  } catch {
    return true;   // na dúvida, NÃO acusa domínio bom de morto
  }
}

// Lê o contato e devolve só o que as decisões precisam. select("*") porque as colunas
// de rede nascem na 0110 e nomeá-las derrubaria a consulta antes da migration.
async function lerEstado(supabase: any, id: string): Promise<EstadoContato | null> {
  const { data } = await supabase
    .from("contacts")
    .select("*, accounts(domain, website)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const c = data as any;

  // ============================================================
  // ESCOLHER O DOMÍNIO QUE ESTÁ VIVO, NÃO O PRIMEIRO DA FILA
  //
  // Havia três candidatos e a regra era "o primeiro que não for vazio". Na Ribeiro
  // Contabilidade o primeiro era `asseconassessoria.com.br`, gravado pelo
  // enriquecimento a partir do e-mail da Receita — e esse domínio não existe mais. O
  // bloco então buscava tudo nele, não achava nada, e ainda o REGRAVAVA no contato
  // (a busca de e-mail salva o domínio que recebe), desfazendo a correção manual a
  // cada rodada.
  //
  // Agora os candidatos são testados no DNS e vence o primeiro que RESPONDE. Domínio
  // morto deixa de ganhar de domínio vivo só por estar num campo mais à esquerda.
  //
  // Custa uma consulta de DNS por candidato, em paralelo, e só quando há mais de um.
  // ============================================================
  const candidatos = Array.from(
    new Set(
      [c.company_domain, c.accounts?.domain, c.accounts?.website, dominioCorporativo(c.email)]
        .map((x: any) => dominioDe(x) || "")
        .filter(Boolean)
    )
  ) as string[];

  // Guardados para a mensagem: quando o escolhido não existe, o operador precisa ver
  // QUAIS opções o app tinha. Sem isso viramos adivinhação — que foi o que aconteceu.
  const candidatosBrutos = candidatos.join(", ");
  let dominio = candidatos[0] || "";
  if (candidatos.length > 1) {
    const vivos = await Promise.all(candidatos.map((d) => dominioResolve(d)));
    const i = vivos.findIndex(Boolean);
    // Se nenhum responde, fica com o primeiro mesmo: a mensagem do passo do site precisa
    // de um nome para dizer "este aqui não existe".
    if (i >= 0) dominio = candidatos[i];
  }
  return {
    temCnpj: !!(c.cnpj || c.accounts?.cnpj),
    enriquecido: !!(c.custom as any)?.enriched_at,
    dominio,
    temEmail: !!c.email,
    emailDeBalcao: ehCaixaDeBalcao(c.email),
    // Compara o domínio DO E-MAIL com o domínio escolhido (o que responde no DNS).
    // Só acusa quando os dois existem e divergem: sem domínio da empresa não há com o
    // que comparar, e acusar aí seria inventar problema.
    emailForaDoDominio: (() => {
      const doEmail = dominioDe(c.email) || "";
      return !!(doEmail && dominio && doEmail !== dominio);
    })(),
    // No domínio certo, não é caixa de balcão — e ainda assim é de outra pessoa. Sem
    // este teste o bloco parava aqui achando que já tinha o e-mail do decisor.
    emailDeOutraPessoa: !!c.email && !ehCaixaDeBalcao(c.email) && !pareceEmailDaPessoa(c.email, c.name),
    temTelefone: !!c.phone,
    waStatus: c.wa_status || null,
    temRede: !!(c.instagram || c.linkedin),
    candidatos: candidatosBrutos,

    // Os VALORES. Nenhuma decisão usa estes campos — eles existem para a tela mostrar
    // o que acabou de ser descoberto, com link, sem obrigar a rolar a página e abrir
    // painel recolhido para ver.
    email: c.email || null,
    emailConferido: (c.custom as any)?.email_check?.valid === true,
    emailConferidoEm: (c.custom as any)?.email_check?.checked_at || null,
    telefone: c.phone || null,
    waCheckedAt: c.wa_checked_at || null,
    instagram: c.instagram || null,
    linkedin: c.linkedin || null,
    enriquecidoEm: (c.custom as any)?.enriched_at || null,
  };
}

export async function estadoDoContato(contactId: string): Promise<{ estado?: EstadoContato; error?: string }> {
  const supabase = createClient();
  const estado = await lerEstado(supabase, contactId);
  return estado ? { estado } : { error: "Contato não encontrado." };
}


export async function rodarPasso(contactId: string, passo: PassoId): Promise<ResultadoPasso> {
  const supabase = createClient();
  const antes = await lerEstado(supabase, contactId);
  if (!antes) return { passo, texto: "contato não encontrado", tom: "erro", error: "Contato não encontrado." };

  const fim = async (texto: string, tom: Tom): Promise<ResultadoPasso> => {
    const estado = (await lerEstado(supabase, contactId)) || antes;
    return { passo, texto, tom, estado };
  };

  try {
    if (passo === "cnpj") {
      if (!antes.temCnpj) return fim("sem CNPJ para consultar", "pulado");
      if (antes.enriquecido) return fim("já enriquecido — não repeti", "pulado");
      const { enrichContact } = await import("./actions");
      const r: any = await enrichContact(contactId);
      if (r?.error) return fim(r.error, "erro");
      return fim("dados cadastrais atualizados na base da Receita", "ok");
    }

    if (passo === "site") {
      if (!antes.dominio) return fim("sem domínio corporativo para visitar", "pulado");
      const [{ capturarDoSiteLote }, { capturarRedesDoSite }] = await Promise.all([
        import("./web-capture-actions"),
        import("./social-actions"),
      ]);
      const [web, redes]: any[] = await Promise.all([
        capturarDoSiteLote([contactId]),
        capturarRedesDoSite([contactId]),
      ]);
      if (web?.error || redes?.error) return fim(web?.error || redes?.error, "erro");
      const achou: string[] = [];
      if (web?.achou) achou.push("e-mail ou telefone");
      if (web?.whats) achou.push("WhatsApp confirmado pelo wa.me");
      if (redes?.comIg) achou.push("Instagram");
      if (redes?.comLi) achou.push("LinkedIn");
      // ============================================================
      // O BLOCO USA O MESMO CAMINHO DO BOTÃO QUE FUNCIONA
      //
      // O botão "Buscar WhatsApp no site" trazia o número e o bloco não. Eram dois
      // códigos fazendo a mesma coisa por caminhos diferentes — e só um estava certo.
      // Em vez de consertar o segundo, o bloco passa a CHAMAR o primeiro quando a
      // captura em lote não trouxe WhatsApp. Um caminho, um comportamento.
      // ============================================================
      if (!web?.whats) {
        const { atualizarWhatsAppDoSite } = await import("./wa-actions");
        const w: any = await atualizarWhatsAppDoSite(contactId);
        if (w?.ok && w?.numero) achou.push(`WhatsApp ${w.numero}`);
      }

      if (achou.length) return fim(achou.join(" · "), "ok");

      // ============================================================
      // "NÃO ACHEI" TEM DUAS CAUSAS MUITO DIFERENTES
      //
      // O site existe e simplesmente não publica e-mail/rede — nada a fazer.
      // Ou o domínio NÃO EXISTE, e aí a mensagem "não publica esses dados" manda o
      // operador procurar o que nunca esteve lá.
      //
      // Caso real: a Receita guardava `asseconassessoria.com.br` para a Ribeiro
      // Contabilidade; o domínio morreu. A tela dizia "não publica", o operador olhava
      // de novo, e nada explicava que o endereço estava errado. Um teste de DNS custa
      // milissegundos e separa as duas coisas.
      // ============================================================
      const existe = await dominioResolve(antes.dominio);
      if (existe) return fim(`${antes.dominio} responde, mas não publica e-mail nem redes`, "nada");

      // ============================================================
      // DOMÍNIO MORTO NÃO PODE FICAR GUARDADO
      //
      // Enquanto `company_domain` apontar para um domínio que não resolve, ele volta a
      // ser candidato em toda rodada e disputa com o bom. A busca de e-mail ainda
      // REGRAVA o domínio que recebe, então o morto se reinstala sozinho.
      //
      // Se não existe, apagamos do contato. Não é perda de informação: é remoção de
      // informação errada — e o candidato vivo (o domínio do e-mail, por exemplo)
      // passa a vencer na próxima leitura.
      // ============================================================
      await supabase.from("contacts").update({ company_domain: null } as any).eq("id", contactId);

      return fim(
        `${antes.dominio} NÃO EXISTE (o DNS não responde) — apaguei esse domínio do contato para ele parar ` +
        `de atrapalhar. Candidatos que o app tinha: ${antes.candidatos || "nenhum"}. ` +
        `Se o site certo não estiver nessa lista, preencha em Editar dados.`,
        "erro"
      );
    }

    if (passo === "email") {
      // AQUI estava o defeito. `temEmail` e `emailDeBalcao` vêm de `antes`, que foi lido
      // AGORA — não da foto da página. Se o passo do site acabou de gravar um
      // `contato@`, este passo enxerga isso e roda em modo revisão, procurando o
      // endereço do decisor. Antes ele via "não tinha e-mail" e se comportava errado.
      // ============================================================
      // "JÁ TEM O E-MAIL DO DECISOR" ERA UMA SUPOSIÇÃO
      //
      // Este atalho parava a busca com três condições, e só sabia checar duas: domínio
      // certo e não ser caixa de balcão. A terceira — que o endereço é DA PESSOA da
      // ficha — ele apenas supunha. Resultado: `rogerio@empresa.com.br` numa ficha do
      // Felipe passava, o bloco parava, e o e-mail do Felipe nunca era procurado. O
      // botão individual não tinha a suposição, procurava, e achava. Era essa a
      // diferença entre os dois caminhos, e não a busca em si — ela é a mesma função.
      //
      // Agora a terceira condição é verificada de verdade (`emailDeOutraPessoa`), e a
      // mensagem diz o que foi conferido, em vez de afirmar algo que ninguém apurou.
      // ============================================================
      if (antes.temEmail && !antes.emailDeBalcao && !antes.emailForaDoDominio && !antes.emailDeOutraPessoa) {
        return fim(`${antes.email} confere com o nome e com o domínio — não procurei outro`, "pulado");
      }
      if (!antes.dominio) return fim("sem domínio para procurar", "pulado");

      const motivo = !antes.temEmail
        ? "sem e-mail"
        : antes.emailForaDoDominio ? `${antes.email} é de outro domínio`
        : antes.emailDeBalcao ? `${antes.email} é caixa compartilhada`
        : `${antes.email} não parece ser desta pessoa`;

      const { buscarEmailAgora } = await import("./discovery-actions");
      const r: any = await buscarEmailAgora(contactId, antes.dominio, antes.temEmail);
      if (r?.error) return fim(r.error, "erro");
      if (r?.ok && r?.email) return fim(`${motivo} → achei ${r.email}`, "ok");
      // Sem confirmação, o endereço antigo FICA. Dizer por que se procurou evita a
      // leitura de que o app estragou algo que estava certo.
      return fim(`${motivo}; ${r?.detalhe || r?.titulo || "nenhum endereço confirmado pelo servidor"}`, "nada");
    }

    // whatsapp
    if (!antes.temTelefone) return fim("sem telefone para verificar", "pulado");
    if (antes.waStatus === "valid") return fim("já confirmado — não repeti", "pulado");
    if (antes.waStatus === "invalid") return fim("já verificado: este número não tem WhatsApp", "pulado");
    const { verificarWhatsAppLote } = await import("./wa-actions");
    const r: any = await verificarWhatsAppLote([contactId]);
    if (r?.error) return fim(r.error, "erro");
    if (r?.comWa) return fim("número tem WhatsApp", "ok");
    if (r?.semWa) return fim("número não tem WhatsApp", "nada");
    if (r?.enfileirados) return fim("entrou na fila — o robô confere em até 1h", "pulado");
    return fim("sem resposta da verificação", "nada");
  } catch (e: any) {
    return { passo, texto: e?.message || "falhou no meio do caminho", tom: "erro" };
  }
}
