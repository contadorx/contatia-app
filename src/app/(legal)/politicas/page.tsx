export const metadata = { title: "Políticas internas — Contatia" };

export default function Politicas() {
  return (
    <>
      <h1>Políticas internas</h1>
      <p className="atualizado">Última atualização: 31 de julho de 2026</p>

      <p>
        Estas são as práticas que seguimos por dentro. Publicá-las evita a semana perdida entre
        a pergunta de um comitê de compras e a resposta — e nos obriga a manter escrito aquilo
        que de fato praticamos.
      </p>

      <div className="nota">
        <p>
          São descrições do que existe hoje, não de um estado ideal. Onde falta algo, está dito
          que falta.
        </p>
      </div>

      <h2>1. Segurança da informação</h2>
      <p>
        Princípio: proteger o dado que o assinante confia, e o dado das pessoas que ele
        prospecta — este segundo grupo nunca escolheu estar aqui, o que aumenta a
        responsabilidade em vez de diminuí-la.
      </p>
      <ul>
        <li>Isolamento entre workspaces no banco (RLS), não na tela.</li>
        <li>Credencial de canal nunca chega ao navegador.</li>
        <li>Segredo em variável de ambiente, nunca no código nem no cliente.</li>
        <li>Segredo que apareça em canal de conversa é considerado comprometido e rotacionado.</li>
      </ul>

      <h2>2. Controle de acesso</h2>
      <ul>
        <li>Acesso concedido individualmente, por convite nominal com validade.</li>
        <li>Papel define o alcance; quem não é gestor vê só a própria carteira, e isso vale no banco.</li>
        <li>Caixa e número pessoais só são legíveis pelo dono e por quem administra.</li>
        <li>Quem sai da equipe tem o acesso revogado pelo próprio assinante, em Equipe.</li>
        <li><strong>Lacuna:</strong> não há 2FA. É a prioridade da lista.</li>
      </ul>

      <h2>3. Resposta a incidentes</h2>
      <p>
        Consideramos incidente: acesso não autorizado a dado de assinante, vazamento de
        credencial, indisponibilidade acima de 4 horas, ou perda de dado sem backup recuperável.
      </p>
      <ul>
        <li>Contenção primeiro: revogar credencial, suspender o que estiver expondo.</li>
        <li>Comunicação aos assinantes afetados em <strong>até 48 horas</strong> da confirmação, com o que se sabe até então — inclusive quando ainda não se sabe tudo.</li>
        <li>Comunicação à ANPD quando houver risco relevante aos titulares.</li>
        <li>Registro do que houve, da causa e do que mudou para não repetir.</li>
      </ul>

      <h2>4. Gestão de mudanças</h2>
      <ul>
        <li>Nada sobe sem compilação e verificação de tipos limpas.</li>
        <li>Alteração de banco sempre em migration versionada e <strong>idempotente</strong> — rodar duas vezes não pode causar dano.</li>
        <li>SQL destrutivo é validado antes num banco descartável, com usuário sem privilégio.</li>
        <li>Regra de acesso nova é testada com tentativa deliberada de ler o que não se deve, conferindo o efeito e não a mensagem de erro.</li>
        <li>Uma mudança por vez, com verificação entre elas.</li>
      </ul>

      <h2>5. Continuidade e recuperação</h2>
      <ul>
        <li>Backup automático do banco pelo provedor, com retenção conforme o plano contratado.</li>
        <li>Objetivo de recuperação: <strong>4 horas</strong>.</li>
        <li>Dependemos de Supabase e Vercel: uma indisponibilidade deles é uma indisponibilidade nossa, e não temos como encurtá-la.</li>
        <li>O servidor próprio (base da Receita, descoberta de e-mail, WhatsApp) é reconstruível por script versionado. Uma queda dele degrada o enriquecimento, mas não derruba a plataforma.</li>
        <li><strong>Lacuna:</strong> a restauração de backup não é testada em calendário fixo.</li>
      </ul>

      <h2>6. Gestão de fornecedores</h2>
      <ul>
        <li>Todo terceiro que trata dado de assinante está na lista pública em <a href="/seguranca">Segurança</a>.</li>
        <li>Terceiro novo entra na lista <strong>antes</strong> de passar a receber dado.</li>
        <li>Nenhum fornecedor pode usar o dado para fim próprio.</li>
        <li>Hoje <strong>não há provedor de inteligência artificial</strong> tratando conteúdo de assinante. Se um entrar, ele aparece na lista e no aviso de mudança antes de receber qualquer dado.</li>
      </ul>

      <h2>7. Dados de terceiros (prospects)</h2>
      <p>
        Política específica do Contatia, por causa do que a plataforma faz:
      </p>
      <ul>
        <li>Só coletamos dado de origem pública ou publicado pela própria empresa.</li>
        <li>A descoberta de e-mail <strong>confirma</strong> a existência da caixa no servidor do destinatário — não chuta endereço nem envia mensagem no teste.</li>
        <li>Pedido de saída é atendido sem exigir justificativa, sem conta e sem custo.</li>
        <li>A lista de supressão é permanente por decisão de projeto: é a única forma de impedir que uma importação futura recontate quem já pediu para sair.</li>
        <li>Não vendemos nem cedemos base de contatos. O que está no seu workspace é seu.</li>
      </ul>

      <h2>8. Lacunas</h2>
      <p>
        Não temos auditoria independente, SOC 2, ISO 27001 nem teste de intrusão externo. Não
        temos 2FA. A operação é de uma pessoa, então não há segregação de funções.
      </p>
      <p>
        Um documento honesto e incompleto vale mais do que um completo e falso — e é mais fácil
        de corrigir.
      </p>

      <h2>Documentos relacionados</h2>
      <p>
        <a href="/privacidade">Política de Privacidade</a> ·{" "}
        <a href="/termos">Termos de Uso</a> ·{" "}
        <a href="/seguranca">Segurança</a>
      </p>
    </>
  );
}
