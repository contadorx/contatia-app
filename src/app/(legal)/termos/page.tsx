export const metadata = { title: "Termos de Uso — Contatia" };

// ============================================================
// A cláusula 9 (uso aceitável) não é boilerplate: é a que protege o Contatia de ser
// usado como ferramenta de spam. Como a plataforma DESCOBRE dados de contato, ela é
// exatamente o tipo de produto que atrai esse uso — e o que separa prospecção legítima
// de spam é o respeito ao pedido de saída. Por isso está escrito como obrigação, com
// consequência de suspensão.
// ============================================================

export default function Termos() {
  return (
    <>
      <h1>Termos de Uso</h1>
      <p className="atualizado">Última atualização: 31 de julho de 2026</p>

      <h2>1. Quem presta o serviço</h2>
      <p>
        O Contatia é operado por Leandro Oliveira, em Santo André/SP. Ao criar uma conta ou
        usar a plataforma, você aceita estes termos. Se não concordar, não use o serviço.
      </p>

      <h2>2. Definições</h2>
      <ul>
        <li><strong>Plataforma:</strong> o Contatia, em contatia.com.br e subdomínios.</li>
        <li><strong>Assinante:</strong> a pessoa ou empresa que contrata o plano.</li>
        <li><strong>Usuário:</strong> quem acessa com credencial concedida pelo assinante.</li>
        <li><strong>Workspace:</strong> o ambiente isolado do assinante.</li>
        <li><strong>Contato:</strong> a pessoa cujos dados o assinante trata na plataforma.</li>
        <li><strong>Conteúdo:</strong> tudo que o assinante insere, importa ou gera.</li>
      </ul>

      <h2>3. O que a assinatura dá</h2>
      <p>
        Uma licença de uso não exclusiva, intransferível e revogável, enquanto o plano estiver
        ativo.
      </p>
      <p>
        <strong>O Contatia não é sistema fiscal, contábil ou de assinatura eletrônica</strong>, e
        não substitui a consultoria jurídica sobre a sua operação de prospecção.
      </p>

      <h2>4. Cadastro e acesso</h2>
      <p>
        A credencial é individual e intransferível. O assinante responde pelo que sua equipe faz
        e por manter a lista de usuários atualizada — inclusive por remover quem saiu.
      </p>

      <h2>5. Conteúdo do assinante</h2>
      <p>
        <strong>Os dados são seus.</strong> Não reivindicamos propriedade e não os usamos para
        outro fim que não operar o serviço para você. Você pode exportar contatos e empresas em
        CSV a qualquer momento, sem pedir nada a ninguém.
      </p>

      <h2>6. Prospecção e uso responsável de dados</h2>
      <p>Esta é a cláusula mais importante destes termos.</p>
      <p>
        A plataforma ajuda a descobrir dados de contato de pessoas que ainda não têm relação com
        você. Nessa operação, <strong>quem decide a finalidade é o assinante</strong> — logo, é o
        assinante o controlador dos dados dos contatos, e o Contatia é operador. Ao usar a
        plataforma para prospectar, você declara que:
      </p>
      <ul>
        <li>tem base legal para tratar aqueles dados (em geral, legítimo interesse em contexto B2B);</li>
        <li>identifica quem está falando e por que, na primeira mensagem;</li>
        <li><strong>atende a todo pedido de saída, sem exigir justificativa</strong>;</li>
        <li>não usa a plataforma para comunicação de consumo em massa sem base legal, nem para oferta a pessoa física fora de contexto profissional.</li>
      </ul>
      <p>
        A plataforma mantém uma lista de supressão. <strong>Remover alguém dessa lista para voltar
        a contatá-lo é violação destes termos</strong> e motivo de suspensão imediata.
      </p>

      <h2>7. WhatsApp — risco assumido</h2>
      <p>
        A conexão com o WhatsApp usa <strong>API não-oficial</strong>. O WhatsApp pode bloquear
        números que enviem em volume ou recebam denúncias, e isso <strong>não está sob nosso
        controle</strong>. Ativar esse modo exige aceite explícito dentro do produto.
      </p>
      <p>
        Não nos responsabilizamos por bloqueio, suspensão ou perda do número. Os limites diários e
        o aquecimento existem para reduzir o risco — não para eliminá-lo.
      </p>

      <h2>8. Envio pelos seus canais</h2>
      <p>
        As mensagens saem pela <strong>sua</strong> caixa e pelo <strong>seu</strong> número. O
        Contatia não é o remetente: reputação de domínio, entregabilidade e consequências do
        conteúdo enviado são do assinante.
      </p>

      <h2>9. Uso aceitável</h2>
      <p>É proibido:</p>
      <ul>
        <li>usar para fim ilícito, fraude ou engano sobre quem está falando;</li>
        <li>enviar conteúdo ofensivo, discriminatório ou que viole direito de terceiro;</li>
        <li>compartilhar credencial entre pessoas ou revender acesso;</li>
        <li>tentar contornar limites técnicos, fazer engenharia reversa ou acessar dado de outro workspace;</li>
        <li>importar lista obtida por meio ilícito ou comprada sem base legal;</li>
        <li>usar a plataforma para spam, conforme a cláusula 6.</li>
      </ul>

      <h2>10. Disponibilidade e suporte</h2>
      <p>
        Objetivo de <strong>99,5% de disponibilidade</strong> ao mês, excluídas manutenções
        avisadas, falhas de terceiros (Supabase, Vercel, Google, WhatsApp, Asaas) e problemas
        causados pelo próprio assinante.
      </p>
      <p>
        Descumprido o objetivo em um mês, o assinante pode pedir crédito proporcional na fatura
        seguinte. Suporte por e-mail e dentro da plataforma, em dias úteis.
      </p>

      <h2>11. Planos e pagamento</h2>
      <ul>
        <li>Teste gratuito no período indicado na contratação, sem cartão.</li>
        <li>Cobrança mensal ou anual, via Asaas.</li>
        <li>Atraso: 7 dias de tolerância; depois disso o acesso é suspenso até a confirmação do pagamento.</li>
        <li>Estorno ou contestação suspende o acesso imediatamente.</li>
        <li>Reajuste anual pelo IPCA. Qualquer outra mudança de preço é avisada com 30 dias.</li>
      </ul>

      <h2>12. Prazo, cancelamento e devolução dos dados</h2>
      <ul>
        <li>Sem fidelidade. Renovação automática, cancelável a qualquer tempo.</li>
        <li>Para não renovar, avise com <strong>15 dias</strong> de antecedência.</li>
        <li>Arrependimento em <strong>7 dias</strong> da primeira cobrança, com devolução integral.</li>
        <li>Após o encerramento: <strong>30 dias</strong> para exportar; exclusão em até <strong>90 dias</strong>.</li>
      </ul>

      <h2>13. Números que a plataforma calcula</h2>
      <p>
        Pontuação de contato, previsão de pipeline e metas são <strong>apoio à decisão</strong>,
        não decisão. Dependem do que foi cadastrado e não substituem seu julgamento. Não
        garantimos resultado comercial.
      </p>

      <h2>14. Propriedade intelectual</h2>
      <p>
        O código, o design e a marca Contatia são nossos. O seu conteúdo, sua marca e seus dados
        continuam seus. Sugestões que você mandar podem ser incorporadas ao produto sem que isso
        gere contrapartida.
      </p>

      <h2>15. Limitação de responsabilidade</h2>
      <p>
        Nossa responsabilidade total fica limitada ao valor pago nos <strong>12 meses</strong>
        anteriores ao fato. Não respondemos por lucros cessantes, perda de oportunidade,
        bloqueio de número de WhatsApp, dano à reputação de domínio, nem por consequência do
        conteúdo que o assinante enviou ou da lista que ele importou.
      </p>
      <p>Nada aqui afasta responsabilidade que a lei não permite afastar.</p>

      <h2>16. Proteção de dados</h2>
      <p>
        Tratamos dados conforme a LGPD e a nossa <a href="/privacidade">Política de Privacidade</a>,
        que é parte destes termos. Em relação aos contatos do assinante, o{" "}
        <strong>assinante é o controlador</strong> e o Contatia é <strong>operador</strong>.
      </p>

      <h2>17. Mudanças nestes termos</h2>
      <p>
        Mudanças relevantes são avisadas com <strong>30 dias</strong>. Se não concordar, você pode
        cancelar sem custo antes de entrarem em vigor.
      </p>

      <h2>18. Disposições gerais</h2>
      <p>
        Não há exclusividade. A cessão do contrato depende de concordância. Se uma cláusula cair,
        as demais continuam valendo.
      </p>

      <h2>19. Lei e foro</h2>
      <p>
        Lei brasileira. Fica eleito o foro de <strong>Santo André/SP</strong>, salvo quando a lei
        determinar outro.
      </p>

      <h2>20. Contato</h2>
      <ul>
        <li>Geral: <a href="mailto:contato@contatia.com.br">contato@contatia.com.br</a></li>
        <li>Privacidade: <a href="mailto:privacidade@contatia.com.br">privacidade@contatia.com.br</a></li>
        <li>Segurança: <a href="mailto:seguranca@contatia.com.br">seguranca@contatia.com.br</a></li>
      </ul>
    </>
  );
}
