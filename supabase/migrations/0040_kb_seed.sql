-- ============================================================
-- Contatia — Migration 0040 (Conteúdo da Base de Conhecimento)
-- Semeia os artigos do widget de ajuda (botão "?" no dashboard).
-- Idempotente: apaga por título e reinsere (pode rodar de novo para atualizar).
-- Roda após 0035. Superadmin edita depois em Superadmin → Base de conhecimento.
-- ============================================================

delete from public.kb_articles where title in (
  'Primeiros passos: do zero ao primeiro envio',
  'A fila "O que precisa de você hoje"',
  'Conectar sua caixa de e-mail (Gmail ou SMTP)',
  'Aquecimento automático: por que o limite diário começa baixo',
  'Entregabilidade: supressão, bounces e saúde do domínio',
  'Criar uma cadência (e gerar com IA)',
  'Teste A/B de assunto e relatório por passo',
  'Importar contatos e usar o Radar de CNPJs',
  'Conectar o WhatsApp (Evolution API)',
  'Link público de agendamento',
  'Pipeline: da conversa ao fechamento',
  'Propostas com rastreio de abertura',
  'Planos, assinatura e CPF/CNPJ da cobrança',
  'Convidar sua equipe e distribuir leads'
);

insert into public.kb_articles (title, category, body, keywords, position) values

('Primeiros passos: do zero ao primeiro envio', 'Primeiros passos',
$body$Bem-vindo! O caminho mais curto até a primeira cadência rodando:

1. Conecte uma caixa de e-mail em Configurações → E-mail (Gmail ou SMTP).
2. Importe seus contatos em Contatos → Importar, ou garimpe empresas novas no Radar.
3. Crie sua cadência em Cadências → Nova (ou use "Gerar com IA" descrevendo seu produto).
4. Inscreva os contatos na cadência.
5. Pronto: todo dia a tela "Hoje" mostra a fila do que precisa de você.

O checklist de ativação na tela inicial acompanha esses passos. Em 10 minutos a máquina está no ar.$body$,
'começar inicio setup onboarding ativação primeiro envio', 1),

('A fila "O que precisa de você hoje"', 'Primeiros passos',
$body$A tela Hoje é o seu dia de trabalho pronto: cada card é um toque da cadência (e-mail ou WhatsApp) esperando sua ação.

O selo de fogo marca quem está QUENTE agora: respondeu, abriu sua proposta ou abriu o e-mail há pouco. Esses sobem para o topo — ataque primeiro, é onde a reunião acontece.

Quando alguém responde, a cadência daquela pessoa pausa sozinha: você nunca manda follow-up para quem já respondeu.

Rotina sugerida: 30 minutos por dia — primeiro os quentes, depois a fila normal, de cima para baixo.$body$,
'fila hoje tarefas quente respondeu abriu', 2),

('Conectar sua caixa de e-mail (Gmail ou SMTP)', 'E-mail',
$body$Configurações → E-mail → Conectar caixa.

GMAIL: clique em "Conectar Gmail" e autorize. O envio sai pela API oficial do Google (melhor entregabilidade) e o Contatia também consegue ler respostas e usar sua agenda no link de agendamento.

SMTP: escolha o provedor (Brevo, Outlook, HostGator ou outro) e preencha servidor, porta e senha. Dica: para volume de prospecção, um relay como o Brevo entrega melhor do que SMTP direto de hospedagem.

Você pode conectar VÁRIAS caixas: o Contatia distribui os envios entre elas automaticamente (rotação), sempre usando a que tem mais folga no dia.$body$,
'conectar email gmail smtp brevo caixa remetente', 1),

('Aquecimento automático: por que o limite diário começa baixo', 'E-mail',
$body$Caixa nova enviando 100 e-mails no primeiro dia = spam na certa. Por isso toda caixa conectada entra em AQUECIMENTO: começa enviando cerca de 10/dia e sobe sozinha ao longo de aproximadamente 2 semanas até o seu limite.

Você vê o estágio na própria caixa em Configurações → E-mail ("Aquecendo: hoje pode enviar X").

Não tente burlar o aquecimento — a reputação do seu domínio vale mais do que uma semana de pressa. Se precisar de mais volume agora, conecte uma segunda caixa: os limites se somam com a rotação.$body$,
'warmup aquecimento limite diario cap reputação', 2),

('Entregabilidade: supressão, bounces e saúde do domínio', 'E-mail',
$body$Três proteções trabalham por você:

SUPRESSÃO AUTOMÁTICA: e-mails que devolveram (bounce), marcaram spam ou pediram descadastro entram numa lista de bloqueio e nunca mais recebem — mesmo que você tente. Veja em Configurações → E-mail → Lista de supressão.

VERIFICAÇÃO NA ENTRADA: contatos importados ou capturados têm o domínio verificado; endereços inválidos são marcados e pulados no envio.

SAÚDE DO DOMÍNIO: o painel em Configurações → E-mail checa seus registros MX, SPF, DKIM e DMARC — os quatro que decidem se você cai na caixa de entrada. Se algum estiver faltando, corrija no seu provedor de DNS antes de escalar o volume.$body$,
'supressao bounce spam dmarc spf dkim entregabilidade dominio', 3),

('Criar uma cadência (e gerar com IA)', 'Cadências',
$body$Uma cadência é a sequência de toques que roda sozinha: e-mail no dia 0, follow-up no dia 3, WhatsApp no dia 6...

MANUAL: Cadências → Nova → adicione os passos (canal, dia, mensagem). Use variáveis como {{primeiro_nome}} e {{empresa}} para personalizar.

COM IA: clique em "Gerar com IA", descreva o que você vende e para quem — a IA monta a sequência completa (assuntos, corpos e intervalos). Revise e ajuste o tom antes de ativar; a IA é o rascunho, você é o dono da voz.

Regra de ouro embutida: quando o contato responde, a cadência dele pausa automaticamente.$body$,
'cadencia sequencia criar ia gerar passos followup', 1),

('Teste A/B de assunto e relatório por passo', 'Cadências',
$body$No primeiro e-mail da cadência você pode cadastrar DOIS assuntos (A e B). O sistema sorteia 50/50 entre os inscritos e mostra qual gera mais resposta.

Para ver: Cadências → sua cadência → "Ver desempenho por passo". O relatório mostra enviados, respostas e taxa POR PASSO da sequência, com a quebra A/B e o vencedor.

Como usar: deixe rodar até ter pelo menos uns 30 envios por variação. Aí troque o assunto perdedor por um desafiante novo e repita. Duas rodadas de A/B costumam dobrar a taxa de resposta de uma cadência fria.$body$,
'ab teste assunto relatorio passo taxa resposta', 2),

('Importar contatos e usar o Radar de CNPJs', 'Contatos & Radar',
$body$IMPORTAR: Contatos → Importar → cole ou envie seu CSV (nome, e-mail, telefone, empresa). Endereços inválidos são detectados e descartados na entrada.

RADAR: a máquina de encontrar clientes novos. Busque empresas brasileiras por atividade (CNAE), região e porte usando dados públicos da Receita — e transforme cada CNPJ em contato com um clique. Ideal para montar a lista da sua cadência fria sem comprar lista de terceiros.

SUGESTÕES: quando alguém desconhecido responde num e-mail seu, o Contatia sugere criar o contato em Contatos → Sugestões. Aprovar leva 1 clique.$body$,
'importar csv contatos radar receita cnpj cnae lista', 1),

('Conectar o WhatsApp (Evolution API)', 'WhatsApp',
$body$O WhatsApp entra como canal da cadência: o toque aparece na sua fila e o envio sai da sua instância.

Conectar: Configurações → WhatsApp → informe a URL e a chave da sua instância Evolution → leia o QR Code com o celular do número que vai enviar.

Boas práticas que protegem seu número:
- Use o WhatsApp como segundo ou terceiro toque da cadência, nunca o primeiro contato frio em massa.
- Personalize a mensagem (nome, empresa) — mensagens idênticas em série são o padrão que gera bloqueio.
- Volume baixo e constante vence rajada.

Quando o contato responde, o Contatia detecta e pausa a cadência dele.$body$,
'whatsapp evolution conectar qr instancia numero', 1),

('Link público de agendamento', 'Reuniões',
$body$Seu link de "marque uma reunião comigo" — o fechamento da prospecção sem ping-pong de horários.

Ativar: Configurações → Captação → Agendamento → defina dias da semana, janela de horário e duração → salve e copie o link.

O visitante vê só horários realmente livres: o Contatia bloqueia suas reuniões já marcadas e, se você conectou o Gmail, também os compromissos do seu Google Calendar. A reunião criada já entra com lembretes anti-no-show e, com Gmail conectado, vai direto para a sua agenda com convite ao participante.

Use o link na assinatura do e-mail e no final das mensagens da cadência.$body$,
'agendamento link publico reuniao calendario horarios', 1),

('Pipeline: da conversa ao fechamento', 'Pipeline & Propostas',
$body$O pipeline é o mapa dos seus negócios em andamento: cada card é uma oportunidade, cada coluna uma etapa (novo → conversando → proposta → fechado).

Arraste os cards entre etapas conforme a venda avança. O valor de cada oportunidade soma no topo — você vê quanto tem "na mesa" em cada fase.

Dica de uso: crie a oportunidade no momento em que marcar a reunião (a partir do contato ou da própria reunião). Pipeline bom é pipeline atualizado no dia — 2 minutos depois de cada conversa.$body$,
'pipeline funil oportunidade kanban etapas negocio', 1),

('Propostas com rastreio de abertura', 'Pipeline & Propostas',
$body$Envie a proposta pelo Contatia e saiba o momento exato em que o cliente abriu.

Como: na oportunidade ou no contato → Propostas → envie o PDF pelo link rastreado. Quando o cliente abre, você recebe o sinal ABRIU PROPOSTA na fila — é a hora de ligar, com a proposta fresca na tela dele.

Os arquivos ficam guardados pelo prazo do seu plano (veja em Configurações → Negócio → Retenção). O registro do envio permanece no histórico do contato mesmo depois.$body$,
'proposta pdf rastreio abriu documento docsend', 2),

('Planos, assinatura e CPF/CNPJ da cobrança', 'Conta & Planos',
$body$Assinar: menu Gestão → Planos → escolha o plano → Assinar. O valor é por usuário ativo do workspace (preço do plano vezes o número de usuários), cobrado mensalmente via Asaas — você escolhe boleto, Pix ou cartão no link de pagamento.

CPF/CNPJ: o Asaas exige o documento do responsável para emitir a cobrança. Se o seu cadastro ainda não tem, a tela pede na hora da assinatura e salva para as próximas. Você também pode preencher antes em Configurações → Negócio.

Trocar de plano: na mesma tela, clique em "Trocar para este" — a assinatura anterior é cancelada automaticamente (sem cobrança dupla) e a nova entra no lugar.

Só o dono do workspace pode contratar ou trocar de plano.$body$,
'plano assinatura pagamento asaas cpf cnpj boleto pix cartao trocar', 1),

('Convidar sua equipe e distribuir leads', 'Conta & Planos',
$body$Convidar: Gestão → Equipe → Convidar → envie o link de convite. Quem entra pelo link já cai no seu workspace com o papel de parceiro (vendedor).

Distribuição de leads: com o roteamento ativo, os contatos novos que chegam (web-to-lead, Radar, importação) são distribuídos automaticamente entre os vendedores em rodízio (round-robin) — cada um vê a própria fila na tela Hoje.

Lembre: o valor da assinatura é por usuário ativo. Ao adicionar um vendedor, a mensalidade do próximo ciclo é recalculada.$body$,
'equipe convite time vendedor round robin distribuir', 2);
