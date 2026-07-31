export const metadata = { title: "Política de Privacidade — Contatia" };

// ============================================================
// ATENÇÃO A QUEM FOR EDITAR ESTE TEXTO
//
// O Contatia tem um problema de privacidade que a maioria dos SaaS não tem: além dos
// dados de QUEM ASSINA, ele trata dados de pessoas que NUNCA falaram com a gente — os
// prospects. Sócios de empresa, com nome vindo da base pública da Receita, telefone
// raspado de site e e-mail descoberto por teste no servidor do destinatário.
//
// Esconder isso seria mentir num documento em que mentir tem consequência legal. As
// seções 4, 5 e 9 existem exatamente por causa disso e não devem ser suavizadas.
// ============================================================

export default function Privacidade() {
  return (
    <>
      <h1>Política de Privacidade</h1>
      <p className="atualizado">Última atualização: 31 de julho de 2026</p>

      <p>
        Esta política explica o que o Contatia faz com dados pessoais: os seus, os da sua
        equipe e — este é o ponto que exige mais atenção — os das pessoas que você
        prospecta usando a plataforma.
      </p>

      <div className="nota">
        <p>
          <strong>Leia a seção 4 se você recebeu uma mensagem e quer saber de onde veio o seu
          contato.</strong> Ela explica a origem do dado e como pedir para não ser mais contatado.
          O pedido é atendido sem precisar de conta e sem custo.
        </p>
      </div>

      <h2>1. Quem opera</h2>
      <p>
        O Contatia é operado por Leandro Oliveira, em Santo André/SP. Contato:{" "}
        <a href="mailto:privacidade@contatia.com.br">privacidade@contatia.com.br</a>.
      </p>
      <p>
        Ainda <strong>não temos um Encarregado (DPO) formalmente nomeado</strong>. Até que
        haja, os pedidos de titular chegam no e-mail acima e são respondidos pela mesma
        pessoa que opera a plataforma.
      </p>

      <h2>2. Três papéis diferentes</h2>
      <p>Confundir estes papéis é o erro mais comum na leitura de uma política como esta:</p>
      <table>
        <thead>
          <tr><th>Situação</th><th>Nosso papel</th><th>O que significa</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Dados do seu cadastro e da sua equipe</td>
            <td><strong>Controlador</strong></td>
            <td>Decidimos por que e como tratar. Você trata conosco diretamente.</td>
          </tr>
          <tr>
            <td>Seus contatos, empresas, mensagens e histórico</td>
            <td><strong>Operador</strong></td>
            <td>Tratamos seguindo a sua instrução. O controlador é você.</td>
          </tr>
          <tr>
            <td>Visitantes do site e quem nos escreve</td>
            <td><strong>Controlador</strong></td>
            <td>Usamos só para responder e para o funcionamento do site.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Uma consequência prática: quando alguém que você prospectou pede exclusão,{" "}
        <strong>o controlador é você</strong>. Nós ajudamos e cumprimos, mas a decisão e a
        responsabilidade pela lista são de quem prospecta.
      </p>

      <h2>3. Que dados tratamos</h2>
      <ul>
        <li><strong>Cadastro:</strong> nome, e-mail, telefone, empresa, CNPJ, dados de cobrança.</li>
        <li><strong>Equipe:</strong> nome, e-mail, papel e o que cada pessoa faz na plataforma.</li>
        <li><strong>Uso:</strong> registro de ações (quem apagou o quê, quem enviou o quê e quando), erros e métricas de funcionamento.</li>
        <li><strong>Sua operação:</strong> contatos, empresas, oportunidades, cadências, tarefas e o conteúdo das mensagens que você envia e recebe pela plataforma.</li>
        <li><strong>Credenciais de canal:</strong> senha SMTP da sua caixa, token do Gmail, chave da sua instância de WhatsApp.</li>
      </ul>
      <p>
        Não pedimos dado sensível (saúde, biometria, opinião política, religião) e a
        plataforma não é feita para isso. Não é destinada a menores de 18 anos.
      </p>

      <h2>4. Dados de pessoas que você prospecta</h2>
      <p>
        Esta é a parte que distingue o Contatia de um CRM comum, e a que mais exige clareza.
        A plataforma ajuda a <strong>descobrir</strong> dados de contato de pessoas que ainda
        não têm relação com você. Isso é feito assim:
      </p>
      <table>
        <thead>
          <tr><th>Dado</th><th>De onde vem</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Empresa, CNPJ, CNAE, endereço, situação cadastral</td>
            <td>Base pública de CNPJ da Receita Federal, distribuída pela própria Receita para uso livre.</td>
          </tr>
          <tr>
            <td>Nome dos sócios e administradores</td>
            <td>Mesma base pública (quadro societário). <strong>São dados pessoais</strong>, ainda que de origem pública.</td>
          </tr>
          <tr>
            <td>Telefone e e-mail publicados</td>
            <td>Leitura do site da própria empresa — só o que ela publicou abertamente.</td>
          </tr>
          <tr>
            <td>E-mail corporativo não publicado</td>
            <td>
              Teste de padrões (nome@dominio, n.sobrenome@dominio…) contra o servidor de
              e-mail do destinatário. <strong>Só é gravado o que o servidor confirma que existe.</strong>{" "}
              Nenhuma mensagem é enviada nesse teste e nada é adivinhado.
            </td>
          </tr>
          <tr>
            <td>Se o telefone tem WhatsApp</td>
            <td>Consulta à sessão de WhatsApp do próprio assinante. Não lemos conversas.</td>
          </tr>
        </tbody>
      </table>

      <h3>Base legal</h3>
      <p>
        O tratamento de dado de origem pública se apoia no art. 7º, §3º da LGPD; a
        prospecção B2B, no <strong>legítimo interesse</strong> (art. 7º, IX), com a
        ressalva do art. 10: o interesse legítimo não se sobrepõe aos direitos do titular.
      </p>
      <p>
        Na prática isso significa que <strong>o direito de oposição vence</strong>. Quem
        pede para não ser contatado é retirado, e nenhuma justificativa comercial muda isso.
      </p>

      <h3>Como pedir para sair</h3>
      <p>
        Escreva para <a href="mailto:privacidade@contatia.com.br">privacidade@contatia.com.br</a>{" "}
        com o e-mail ou telefone que recebeu a mensagem. Você não precisa ter conta, nem
        explicar o motivo. O que acontece:
      </p>
      <ul>
        <li>o endereço entra numa <strong>lista de supressão</strong> que bloqueia envios futuros;</li>
        <li>o contato é marcado como recusado e sai das cadências em andamento;</li>
        <li>respondemos em <strong>até 15 dias</strong>;</li>
        <li>se o pedido for de exclusão e não só de parar o contato, encaminhamos ao assinante responsável pela lista — que é o controlador daquele dado — e acompanhamos o cumprimento.</li>
      </ul>
      <p>
        Responder <em>&ldquo;sair&rdquo;</em>, <em>&ldquo;remover&rdquo;</em> ou{" "}
        <em>&ldquo;descadastrar&rdquo;</em> a um e-mail ou WhatsApp nosso também funciona:
        a plataforma reconhece esses pedidos e interrompe a régua automaticamente.
      </p>

      <h2>5. Para que usamos</h2>
      <table>
        <thead><tr><th>Finalidade</th><th>Base legal</th></tr></thead>
        <tbody>
          <tr><td>Operar a plataforma e cumprir o contrato</td><td>Execução de contrato</td></tr>
          <tr><td>Cobrança, nota fiscal e obrigações fiscais</td><td>Obrigação legal</td></tr>
          <tr><td>Segurança, registro de ações e prevenção a abuso</td><td>Legítimo interesse</td></tr>
          <tr><td>Suporte e comunicação sobre o serviço</td><td>Execução de contrato</td></tr>
          <tr><td>Prospecção B2B feita pelos assinantes</td><td>Legítimo interesse do assinante (art. 7º, IX)</td></tr>
          <tr><td>Novidades e conteúdo de marketing nosso</td><td>Consentimento (com descadastro em todo envio)</td></tr>
        </tbody>
      </table>

      <h2>6. Com quem compartilhamos</h2>
      <p>Não vendemos dados. Os terceiros abaixo participam do funcionamento do serviço:</p>
      <table>
        <thead><tr><th>Terceiro</th><th>Para quê</th><th>O que recebe</th></tr></thead>
        <tbody>
          <tr><td>Supabase</td><td>Banco de dados, login e arquivos</td><td>Todos os dados operacionais, em repouso</td></tr>
          <tr><td>Vercel</td><td>Execução da aplicação</td><td>Dados em trânsito durante o uso</td></tr>
          <tr><td>Asaas</td><td>Cobrança da assinatura</td><td>Só dados de cobrança do assinante</td></tr>
          <tr><td>Brevo</td><td>E-mails transacionais nossos</td><td>Destinatário e conteúdo da mensagem</td></tr>
          <tr><td>Servidor próprio (Contabo, Alemanha)</td><td>Base da Receita, descoberta de e-mail e WhatsApp</td><td>Domínio e nome para o teste de e-mail; número para a verificação de WhatsApp</td></tr>
          <tr><td>BrasilAPI / ReceitaWS</td><td>Consulta de CNPJ</td><td>Só o CNPJ consultado</td></tr>
          <tr><td>Google</td><td>Envio por Gmail e agenda, quando você conecta</td><td>Só o que a sua autorização permite</td></tr>
        </tbody>
      </table>
      <p>
        <strong>Não usamos provedor de inteligência artificial</strong> para tratar o conteúdo
        da sua operação. Se isso mudar, esta seção é atualizada antes — e com aviso.
      </p>
      <p>
        A infraestrutura fica fora do Brasil (Canadá, Estados Unidos e Alemanha). A LGPD
        permite a transferência internacional; usamos fornecedores com cláusulas contratuais
        de proteção de dados.
      </p>

      <h2>7. Envio pelo seu próprio canal</h2>
      <p>
        Quando você conecta a sua caixa de e-mail ou o seu WhatsApp, as mensagens saem{" "}
        <strong>por você, não por nós</strong>: o destinatário vê o seu endereço e a resposta
        volta para a sua caixa. Guardamos a credencial para conseguir enviar em seu nome, e
        ela fica sob as restrições da seção 8.
      </p>
      <p>
        O WhatsApp é conectado por uma <strong>API não-oficial</strong>. Isso é dito com todas
        as letras dentro do produto, porque implica risco de bloqueio do número pelo WhatsApp.
        A escolha é sua e exige aceite explícito.
      </p>

      <h2>8. Segurança</h2>
      <p>
        O isolamento entre workspaces é feito no banco de dados (Row Level Security do
        PostgreSQL), e não apenas na tela. Credenciais de canal só são legíveis por quem é
        dono delas e por quem administra o workspace. Os detalhes técnicos, e o que ainda{" "}
        <em>não</em> temos, estão em <a href="/seguranca">Segurança</a>.
      </p>

      <h2>9. Por quanto tempo guardamos</h2>
      <ul>
        <li><strong>Sua operação:</strong> enquanto o contrato estiver ativo.</li>
        <li><strong>Após o encerramento:</strong> 30 dias para você exportar; exclusão em até 90 dias.</li>
        <li><strong>Registro de ações:</strong> 6 meses após o encerramento, para apurar incidente e disputa.</li>
        <li><strong>Cobrança e fiscal:</strong> pelo prazo que a lei exige.</li>
        <li><strong>Lista de supressão:</strong> <strong>por tempo indeterminado, de propósito.</strong> É a única forma de garantir que quem pediu para sair não volte numa importação futura. Ela guarda o mínimo — o endereço e a data.</li>
      </ul>

      <h2>10. Seus direitos</h2>
      <p>
        Confirmação, acesso, correção, anonimização, portabilidade, eliminação, informação
        sobre compartilhamento e revogação de consentimento — art. 18 da LGPD. Escreva para{" "}
        <a href="mailto:privacidade@contatia.com.br">privacidade@contatia.com.br</a>;{" "}
        <strong>respondemos em até 15 dias.</strong>
      </p>
      <p>
        A plataforma calcula pontuação de contatos e previsão de pipeline. Esses números{" "}
        <strong>não decidem nada sozinhos</strong> — ordenam a fila para uma pessoa decidir. Ainda
        assim, você pode pedir revisão (art. 20).
      </p>

      <h2>11. Cookies</h2>
      <p>
        Usamos apenas os cookies necessários para manter você logado e para o funcionamento
        básico. <strong>Não usamos cookies de publicidade nem rastreamento entre sites.</strong>
      </p>

      <h2>12. Mudanças</h2>
      <p>
        Alterações relevantes são avisadas por e-mail ou dentro da plataforma antes de valer.
        A data no topo indica a última revisão.
      </p>

      <h2>13. Contato</h2>
      <ul>
        <li>Privacidade e pedidos de titular: <a href="mailto:privacidade@contatia.com.br">privacidade@contatia.com.br</a></li>
        <li>Segurança e vulnerabilidades: <a href="mailto:seguranca@contatia.com.br">seguranca@contatia.com.br</a></li>
        <li>Geral: <a href="mailto:contato@contatia.com.br">contato@contatia.com.br</a></li>
      </ul>
      <p>
        Você também pode reclamar à ANPD (<a href="https://www.gov.br/anpd" target="_blank" rel="noreferrer">gov.br/anpd</a>).
      </p>
    </>
  );
}
