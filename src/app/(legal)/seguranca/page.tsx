export const metadata = { title: "Segurança — Contatia" };

// ============================================================
// A seção 10 ("O que ainda não temos") é a mais importante desta página e a mais
// tentadora de apagar. Ela é o que separa uma página de segurança de uma peça de
// marketing: quem avalia um fornecedor descobre as lacunas de qualquer jeito, e
// descobrir depois de assinar destrói a confiança que o resto do texto construiu.
// Se algum item for resolvido, mova para a seção certa — não delete a seção.
// ============================================================

export default function Seguranca() {
  return (
    <>
      <h1>Segurança</h1>
      <p className="atualizado">Última atualização: 31 de julho de 2026</p>

      <p>
        Esta página descreve o que está implementado hoje — e, na seção 10, o que{" "}
        <strong>não</strong> está. Ela é escrita para quem precisa avaliar o Contatia como
        fornecedor.
      </p>

      <h2>1. Isolamento entre workspaces</h2>
      <p>
        A separação entre clientes é feita no <strong>banco de dados</strong>, com Row Level
        Security do PostgreSQL, e não apenas na tela. Cada consulta carrega a identidade de
        quem a fez, e o banco recusa linhas de outro workspace mesmo que a aplicação peça.
      </p>
      <p>
        Isso importa porque muda a consequência de um bug: um erro numa tela vira uma tela
        errada, não um vazamento.
      </p>

      <h2>2. Acesso e identidade</h2>
      <ul>
        <li>Autenticação pelo Supabase Auth. Senha nunca é gravada em texto claro.</li>
        <li>Quatro papéis — dono, admin, gestor, SDR/vendedor — com o que cada um pode fazer definido em um só lugar do código.</li>
        <li>Quem não é gestor enxerga apenas a própria carteira. Esse recorte vale <strong>no banco</strong>, não só na interface.</li>
        <li>Convite por link com validade de 14 dias, revogável.</li>
      </ul>

      <h2>3. Credenciais dos seus canais</h2>
      <p>
        Para enviar em seu nome, guardamos a senha SMTP da sua caixa, o token do Gmail e a
        chave da sua instância de WhatsApp. Elas <strong>nunca</strong> são devolvidas ao
        navegador: só o servidor as usa, na hora do envio.
      </p>
      <p>
        Desde julho/2026, caixas e números podem ser <strong>pessoais</strong>. Nesse caso a
        regra no banco é: você lê a sua, as compartilhadas e as do workspace — a caixa
        privada de um colega <strong>não existe</strong> para você, nem para uma consulta
        feita à mão fora da aplicação. Compartilhar é uma decisão explícita, com aviso de que
        expõe a configuração completa.
      </p>
      <div className="nota">
        <p>
          <strong>Ressalva honesta:</strong> essas credenciais ficam no banco protegidas por
          RLS, e não cifradas em coluna com chave separada. Um comprometimento das chaves de
          serviço do banco as exporia. Cifrar em coluna está no plano.
        </p>
      </div>

      <h2>4. Criptografia</h2>
      <ul>
        <li>TLS em todo o tráfego, sem exceção.</li>
        <li>Criptografia em repouso pela infraestrutura (Supabase/AWS).</li>
        <li>Os serviços no nosso servidor próprio só respondem por HTTPS e com token; o banco da Receita não aceita conexão de fora da máquina.</li>
      </ul>

      <h2>5. O que fica registrado</h2>
      <p>
        Ações destrutivas e de risco vão para um registro que <strong>não pode ser alterado
        nem apagado</strong> pela aplicação — exclusão em massa, importação, envio, mudança de
        permissão, alteração de canal. O registro guarda quem fez, quando, quantos e uma
        amostra do que saiu, e sobrevive à exclusão do próprio registro afetado. Está em
        Resultados → Registro.
      </p>

      <h2>6. Seus dados são seus</h2>
      <ul>
        <li>Exportação de contatos e empresas em CSV, por você, a qualquer momento.</li>
        <li>O CSV exportado sai no mesmo formato que a importação aceita — sem formato proprietário.</li>
        <li>Não usamos o conteúdo da sua operação para treinar modelo de IA, nem para análise entre clientes.</li>
        <li>Após o encerramento: 30 dias para exportar, exclusão em até 90 dias.</li>
      </ul>

      <h2>7. Quem opera não enxerga a sua operação</h2>
      <p>
        O acesso administrativo alcança assinatura, cobrança, consumo agregado e conversas de
        suporte. <strong>Não</strong> alcança a sua carteira, suas mensagens nem seus
        relatórios. Quando um acesso de suporte é necessário, ele é pedido, registrado e
        limitado no tempo.
      </p>

      <h2>8. Terceiros que participam</h2>
      <table>
        <thead><tr><th>Terceiro</th><th>Para quê</th><th>O que recebe</th></tr></thead>
        <tbody>
          <tr><td>Supabase (Canadá)</td><td>Banco, login, arquivos</td><td>Todos os dados operacionais, em repouso</td></tr>
          <tr><td>Vercel (EUA)</td><td>Execução da aplicação</td><td>Dados em trânsito durante o uso</td></tr>
          <tr><td>Asaas (Brasil)</td><td>Cobrança</td><td>Só dados de cobrança do assinante</td></tr>
          <tr><td>Brevo (França)</td><td>E-mails transacionais</td><td>Destinatário e conteúdo</td></tr>
          <tr><td>Servidor próprio (Contabo, Alemanha)</td><td>Base da Receita, descoberta de e-mail, WhatsApp</td><td>Domínio e nome para o teste; número para verificação</td></tr>
          <tr><td>BrasilAPI / ReceitaWS</td><td>Consulta de CNPJ</td><td>Só o CNPJ</td></tr>
          <tr><td>Google</td><td>Gmail e Agenda, se você conectar</td><td>Só o que a sua autorização permite</td></tr>
        </tbody>
      </table>
      <p>
        <strong>Não há provedor de inteligência artificial nesta lista.</strong> Nenhum dado da
        sua operação é enviado a um modelo de IA. Se isso mudar, esta tabela muda antes.
      </p>

      <h2>9. Como o software chega ao ar</h2>
      <ul>
        <li>Verificação de tipos e compilação completa antes de qualquer publicação — build quebrado não sobe.</li>
        <li>Alterações de banco em migrations versionadas e idempotentes, aplicadas na ordem.</li>
        <li>Regras de acesso são testadas contra um PostgreSQL real, com tentativa deliberada de ler o que não se deve. O teste confere o <strong>efeito</strong> (quantas linhas saíram), não a mensagem de erro.</li>
        <li>SQL destrutivo é validado num banco descartável, com usuário sem privilégio, antes de ser entregue.</li>
      </ul>

      <h2>10. O que ainda não temos</h2>
      <p>Com todas as letras, porque isto costuma decidir uma avaliação:</p>
      <ul>
        <li><strong>Sem certificação SOC 2 ou ISO 27001.</strong></li>
        <li><strong>Sem teste de intrusão por terceiro independente.</strong></li>
        <li><strong>Sem autenticação em dois fatores (2FA).</strong> É a lacuna mais relevante da lista e está no plano.</li>
        <li>Sem SSO / login corporativo.</li>
        <li>Sem cifragem em coluna das credenciais de canal (ver seção 3).</li>
        <li>Sem exclusão de conta self-service — hoje é por pedido.</li>
        <li>Sem segregação de funções: a operação é de uma pessoa só.</li>
        <li>Monitoramento de disponibilidade é interno; não há monitor externo independente.</li>
      </ul>

      <h2>11. Achou uma falha?</h2>
      <p>
        Escreva para <a href="mailto:seguranca@contatia.com.br">seguranca@contatia.com.br</a>.
        Respondemos em até <strong>2 dias úteis</strong>.
      </p>
      <p>
        Não tomamos medida legal contra quem reporta de boa-fé. Em troca pedimos o de sempre:
        não acessar dado de terceiro além do necessário para demonstrar a falha, não degradar
        o serviço e não divulgar antes da correção.
      </p>

      <h2>12. Documentos</h2>
      <p>
        As práticas por trás desta página estão em <a href="/politicas">Políticas internas</a>.
        Veja também <a href="/privacidade">Privacidade</a> e <a href="/termos">Termos de Uso</a>.
      </p>
    </>
  );
}
