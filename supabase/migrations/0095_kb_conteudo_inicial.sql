-- ============================================================
-- Contatia — Migration 0095 (Base de conhecimento: conteúdo inicial)
--
-- Popula public.kb_articles com o conjunto inicial de artigos de ajuda,
-- organizados por TEMA (category) e buscáveis (keywords) na Central de ajuda
-- (/dashboard/ajuda). Roda depois da 0035 (que cria a tabela) e da 0094.
--
-- SEGURO PARA RODAR DE NOVO: o DELETE remove apenas os artigos com estes
-- títulos (os "oficiais") antes de reinserir — não toca em artigos que você
-- tenha criado com outros títulos.
--
-- Formatação do corpo (o que a Central de ajuda renderiza):
--   ## Subtítulo   ·   - item de lista   ·   **negrito**   ·   links http(s)
-- ============================================================

begin;

delete from public.kb_articles where title in (
  $$Bem-vindo ao Contatia: como tudo se encaixa$$,
  $$Os primeiros passos (o checklist de configuração)$$,
  $$A tela "Hoje": a sua fila de trabalho$$,
  $$Score e quando um contato fica "Quente"$$,
  $$Trazer contatos: manual e por planilha (CSV)$$,
  $$Visões rápidas e filtros de Contatos$$,
  $$Achar o e-mail de um decisor pelo nome$$,
  $$Testar um e-mail que você já tem$$,
  $$Enriquecer um contato pela Receita (CNPJ)$$,
  $$Inscrever e remover contatos de uma cadência$$,
  $$Enviar um e-mail ou WhatsApp avulso$$,
  $$Empresas: contatos e oportunidades num lugar só$$,
  $$Importar e enriquecer Empresas$$,
  $$Radar: prospectar na base da Receita$$,
  $$Enviar empresas do Radar para a sua base$$,
  $$O que é uma cadência e como montar$$,
  $$Personalizar: variáveis, rapport e teste A/B$$,
  $$Montar uma cadência com IA$$,
  $$Produtos e serviços e as caixas por produto$$,
  $$Automações: "quando isso acontecer, faça aquilo"$$,
  $$Conectar a sua caixa de e-mail$$,
  $$Detecção de respostas e bounces (IMAP)$$,
  $$Saúde do domínio: MX, SPF, DKIM e DMARC$$,
  $$Aquecimento, limite diário e rotação de caixas$$,
  $$Lista de supressão$$,
  $$WhatsApp: os três modos de uso$$,
  $$Propostas rastreadas: um link por contato$$,
  $$Pipeline: o funil dos seus negócios$$,
  $$Caixa de Respostas: WhatsApp e e-mail juntos$$,
  $$Triagem: decidir o que fazer com uma resposta$$,
  $$Agendar e registrar reuniões$$,
  $$Resultados: o que cada aba mostra$$,
  $$Convidar pessoas para a equipe$$,
  $$Papéis e o que cada um enxerga$$,
  $$Planos, limites de uso e faturas$$,
  $$Redefinir a sua senha$$,
  $$Como pedir ajuda no Contatia$$
);

insert into public.kb_articles (title, category, keywords, body, position, published) values

-- ===================== PRIMEIROS PASSOS =====================
($$Bem-vindo ao Contatia: como tudo se encaixa$$, $$Primeiros passos$$, $$visão geral, começar, fluxo, como funciona, introdução$$, $md$O Contatia organiza a sua prospecção do primeiro contato até o negócio fechado. O caminho é sempre o mesmo:

- **Traga empresas e pessoas** — importando os seus contatos, cadastrando na mão ou garimpando no **Radar** (a base da Receita Federal).
- **Monte uma cadência** — a sua sequência de follow-ups (e-mail, WhatsApp, ligação, LinkedIn).
- **Inscreva os contatos** na cadência. A partir daí os toques entram sozinhos na sua fila.
- **Trabalhe a fila em "Hoje"** — o app te diz quem tocar, com a mensagem já pronta.
- **Responda e avance** — as respostas caem na caixa de **Respostas**; os negócios andam no **Pipeline**; as conversas viram **Reuniões**.

## Contatos, Empresas e Oportunidades
São três coisas diferentes que se conversam:

- **Contato** é a pessoa (o decisor).
- **Empresa** é a conta B2B — ela reúne os contatos e as oportunidades daquele CNPJ.
- **Oportunidade** (negócio) é a venda em andamento, que vive no Pipeline.

Não precisa preencher tudo de uma vez. Comece trazendo contatos e criando a primeira cadência — o resto se encaixa conforme você trabalha.$md$, 10, true),

($$Os primeiros passos (o checklist de configuração)$$, $$Primeiros passos$$, $$onboarding, primeiros passos, checklist, começar, ocultar caixa, configurar$$, $md$Na tela **Hoje**, a caixa **"Primeiros passos"** te guia na configuração inicial, com uma barra de progresso. São quatro passos:

- **Conecte um e-mail para enviar** — em Configurações → Canais.
- **Traga contatos** — importe ou cadastre.
- **Crie uma cadência** — a sua sequência de follow-ups.
- **Inscreva contatos na cadência** — para os toques começarem a cair na fila.

O passo atual fica destacado com **"começar →"**. Conforme você completa, a barra avança.

## Como ocultar a caixa
Se não quiser mais ver o checklist, clique em **"✕ não mostrar mais"** no canto da caixa. Ela some em todos os seus dispositivos. A caixa também **desaparece sozinha** quando os quatro passos estão completos.$md$, 20, true),

($$A tela "Hoje": a sua fila de trabalho$$, $$Primeiros passos$$, $$hoje, fila, tarefas, toques, atalhos, teclado, envio seguro, lote$$, $md$**Hoje** é onde você trabalha. O título é "O que precisa de você hoje" e a fila mostra os toques do dia — **quem está mais quente vem primeiro**, não em ordem cronológica.

## Filtrar a fila
- Abas: **Hoje + atrasados**, **Próx. 3 dias**, **Todos**.
- Busca por contato/empresa, seletor de canal (E-mail, WhatsApp, Ligação, LinkedIn) e filtros por cadência e por tag.

## Agir
Cada cartão traz a ação do canal: no e-mail você pode **Editar** e **Enviar** ali mesmo; no WhatsApp, enviar (modo automático) ou **Abrir WhatsApp** com a mensagem pronta (modo assistido); na ligação, ver o script e **Registrar**. Todo cartão tem **Respondeu** (pausa a cadência), ✓ (concluir), ↷ (adiar 1 dia) e ✕ (pular).

Dá para agir em massa: **Enviar todos os e-mails** ou marcar todos os WhatsApp/ligações como feitos.

## Atalhos de teclado
↑/↓ (ou j/k) navegam · **Enter** envia/conclui · **r** = respondeu · **z** = adiar · **x** = pular.

## Faixa "Envio Seguro"
Mostra quantos e-mails as suas caixas ainda podem enviar hoje. Se uma caixa está em aquecimento, o limite sobe sozinho a cada dia, e o que passar do teto **entra na fila e sai amanhã** — isso protege a sua reputação de envio.$md$, 30, true),

($$Score e quando um contato fica "Quente"$$, $$Primeiros passos$$, $$score, quente, lead scoring, pontuação, último toque, engajamento$$, $md$O **Score** é uma nota que sobe conforme o contato interage. Ele existe para você priorizar quem está mais perto de comprar.

## Como os pontos são somados
- Respondeu: **+30**
- Reunião marcada: **+20**
- Abriu a proposta ou o e-mail: **+15**
- Clicou num link: **+10**
- Um toque registrado: **+2**
- Um e-mail enviado: **+1**

## "Quente"
Um contato fica **Quente a partir de 25 pontos**. Ele ganha a etiqueta **QUENTE** e sobe no topo da fila e do Pipeline. A visão **Quentes** (em Contatos) junta todos eles.

## A cor do "Último toque"
Em várias telas há a coluna **Último toque**, com cores: verde (até 7 dias), âmbar (até 30 dias), vermelho (mais de 30 dias) e cinza ("nunca"). É o termômetro de quem está esfriando.$md$, 40, true),

-- ===================== CONTATOS =====================
($$Trazer contatos: manual e por planilha (CSV)$$, $$Contatos$$, $$importar, csv, planilha, novo contato, cadastrar, colunas, mapeamento$$, $md$Há dois jeitos de trazer contatos, os dois em **Contatos**.

## Cadastrar um por um
Botão **+ Contato**. Preencha ao menos o **Nome** (obrigatório) e, de preferência, e-mail ou telefone. Há campos para Cargo, Empresa, CNPJ e Origem. Ao salvar, a ficha completa abre para você continuar.

## Importar uma planilha (CSV)
Botão **Importar CSV**. Use um arquivo com **cabeçalho na 1ª linha**.

- O Contatia mostra **"Confira o mapeamento das colunas"** e tenta adivinhar qual coluna é Nome, E-mail, Telefone, Empresa e Origem — você ajusta se precisar.
- Tem uma **prévia das 3 primeiras linhas** e a contagem honesta de quantas linhas têm e-mail ou telefone para trabalhar.
- Clique em **Importar N contato(s)**.

## Atenção
- Se você **não indicar** uma coluna de e-mail nem de telefone, os contatos entram **sem forma de contato** e **não podem receber cadência**. O app avisa antes.
- E-mails com formato inválido são marcados e **não entram em cadência de e-mail**.$md$, 10, true),

($$Visões rápidas e filtros de Contatos$$, $$Contatos$$, $$visões, filtros, a completar, prontos, frios, quentes, tag, produto, cadência$$, $md$Na tela **Contatos**, comece pela **Visão** e afunile nos filtros só quando precisar.

## Visões rápidas
- **Todos** — a base inteira.
- **A completar** — contatos **sem e-mail e sem telefone**. É a sua lista de "arrumar o cadastro".
- **Prontos p/ cadência** — têm e-mail ou telefone e **não estão** em cadência ativa. É de onde você inscreve gente nova.
- **Frios a resgatar** — sem toque há mais de 30 dias (ou nunca) e fora de cadência. Reengajamento.
- **Quentes** — score 25 ou mais.

## Filtros detalhados
Recolhidos no botão **Filtros**. Você combina **Tag**, **Produto**, **Cadência** e **Último toque** (Frios +15d, Frios +30d, Nunca tocados). A busca aceita nome, e-mail ou empresa.

## Atenção
Quem é **SDR ou vendedor** vê só os contatos atribuídos a si; **gestor, admin e dono** veem todos. A lista mostra até 200 por vez — use as visões e filtros para chegar em quem importa.$md$, 20, true),

($$Achar o e-mail de um decisor pelo nome$$, $$Contatos$$, $$achar email, descobrir email, decisor, buscar, verificação, smtp, domínio$$, $md$Quando um contato **não tem e-mail**, a ficha dele mostra o buscador **"Achar o e-mail de [nome]"**.

## Como usar
- Informe o **Site da empresa** (pode colar o endereço completo — o app limpa) e clique em **Procurar e-mail**.
- O Contatia testa os padrões usuais (joao.silva@, jsilva@, joao@…) e **confirma com o servidor de e-mail da empresa** se a caixa existe. Se não confirmar nenhum, procura o e-mail que a empresa **publicou no próprio site**.
- Quando encontra e confirma, salva no contato (clique em **Atualizar a ficha**). Dá para expandir **"ver N endereços testados"**.

## Atenção
- **Precisa do sobrenome.** Com só o primeiro nome, testamos um único palpite. Adicione o sobrenome em "Editar dados" para cobrir todos os padrões.
- A busca leva de **5 a 30 segundos** (é uma conversa real com o servidor).
- Alguns domínios **aceitam qualquer endereço** (catch-all) ou **bloqueiam a verificação** (Google/Microsoft). Nesses casos não dá para confiar num palpite — siga por **WhatsApp** ou **LinkedIn**.
- Se aparecer erro de serviço, use o botão **Testar serviço de busca** para o diagnóstico.$md$, 30, true),

($$Testar um e-mail que você já tem$$, $$Contatos$$, $$testar email, verificar caixa, existe, catch-all, função, contato@$$, $md$Às vezes você já tem um endereço (ou desconfia de um, como contabil@empresa.com.br) e só quer saber se a caixa existe. Use o botão **"✓ Testar um e-mail que já tenho"**, logo abaixo do buscador, na ficha do contato.

## O que os resultados querem dizer
- **✓ a caixa existe** — pode usar. Aparece o botão **Usar como e-mail**.
- **✕ a caixa não existe** — o servidor recusou; não envie para lá.
- **? incerto** — o domínio é catch-all (aceita tudo) ou o provedor está lento; não dá para garantir.
- **🔒 o provedor bloqueia a verificação** — a caixa pode até existir, mas não temos como confirmar.

É a ferramenta certa para **e-mails por função** (contato@, comercial@, contabil@), que não seguem o nome da pessoa e por isso o buscador por nome não acha.$md$, 40, true),

($$Enriquecer um contato pela Receita (CNPJ)$$, $$Contatos$$, $$enriquecer, cnpj, receita, cnae, sócios, porte, situação, rapport$$, $md$Na ficha do contato, o card **"Empresa (Receita Federal)"** puxa os dados públicos do CNPJ.

## Como usar
- Clique em **Enriquecer pelo CNPJ** (ou **Atualizar**). Ele traz **CNAE, Porte, Situação, Município/UF e os sócios** (o quadro societário).
- Cada sócio tem um **＋ "Criar contato deste sócio"** — um jeito rápido de multiplicar os decisores daquela empresa.

## Atenção
Se o contato **não tem CNPJ**, preencha primeiro em **"Editar dados"** — sem CNPJ não há o que consultar.

## Rapport
Logo abaixo há o card **Rapport**: LinkedIn e campos livres (como conheci, interesses, aniversário, estilo de comunicação, contexto da última conversa). O que você anota aqui pode ser usado como **variável** nas mensagens da cadência, deixando o follow-up muito mais pessoal.$md$, 50, true),

($$Inscrever e remover contatos de uma cadência$$, $$Contatos$$, $$inscrever, cadência, remover, pausar, retomar, lote, sem email$$, $md$## Inscrever
- **Um contato:** na lista ou na ficha, botão **▶ Inscrever em cadência** e escolha a cadência ativa.
- **Vários de uma vez:** selecione na tabela e use **Inscrever em cadência…** na barra de seleção.

Ao inscrever em lote, o app dá um retorno honesto: quantos entraram, quantos **já estavam** em cadência e quantos ficaram de fora por estarem **sem e-mail/telefone** (esses aparecem na visão "A completar").

## Por que um contato "não entra"
Uma cadência de e-mail precisa de e-mail; um passo de WhatsApp precisa de número. **Sem forma de contato, o contato não pode ser trabalhado** — por isso ele fica de fora, sinalizado com "sem contato — preencher".

## Remover ou pausar
Na ficha, no bloco **Cadências**, cada inscrição tem **pausar**, **retomar** e **remover**. Ao remover, **as tarefas pendentes daquela cadência são canceladas**.

Obs.: quando um lead responde, a cadência dele **pausa sozinha** — você não precisa remover na mão.$md$, 60, true),

($$Enviar um e-mail ou WhatsApp avulso$$, $$Contatos$$, $$avulso, enviar, mensagem, fora da cadência, quicksend$$, $md$Nem tudo precisa de cadência. Na ficha do contato, o botão **"✉ Enviar avulso"** manda um e-mail ou um WhatsApp pontual.

- É **fora da cadência**: não interrompe nem altera a sequência que estiver ativa.
- Usa a **sua caixa de e-mail** (com a assinatura) e fica **registrado na linha do tempo** do contato.

Use para uma resposta rápida, um obrigado, o envio de um material — sem transformar aquilo numa sequência.$md$, 70, true),

-- ===================== EMPRESAS =====================
($$Empresas: contatos e oportunidades num lugar só$$, $$Empresas$$, $$empresas, contas, cockpit, oportunidades, excluir, visões$$, $md$Uma **Empresa** é a conta B2B: ela reúne os **contatos** e as **oportunidades** daquele CNPJ. É a visão "por empresa" do seu trabalho.

## Visões rápidas
- **Todas**
- **Sem contato** — empresas sem nenhuma pessoa cadastrada (o próximo passo é achar o decisor).
- **Sem oportunidade** — têm contato, mas nenhum negócio aberto.
- **Com oportunidade aberta** — já têm negócio em andamento.

Filtros por **Tag** e **Produto**, e busca por nome, CNPJ ou domínio.

## O cockpit
A lista mostra Empresa, Local, Último toque, Tags, e os números de **Contatos** e **Oportunidades** (clicáveis, expandem os chips). Dá para aplicar tags, atribuir dono e excluir em lote.

## Atenção ao excluir
Ao apagar uma empresa, **os contatos ligados a ela NÃO são apagados** — eles ficam apenas sem empresa. Você não perde as pessoas.$md$, 10, true),

($$Importar e enriquecer Empresas$$, $$Empresas$$, $$importar empresas, csv, modelo, enriquecer, cnpj, sócios, contato principal$$, $md$## Importar por planilha
Na tela **Empresas**, botão **Importar CSV**. Você pode **baixar o modelo** com o cabeçalho certo:

`cnpj, razao_social, nome_fantasia, cnae, uf, municipio, dominio, contato_principal, email, telefone`

Aceita separador vírgula ou ponto-e-vírgula, e você pode colar o CSV direto. **Se a linha tiver contato/e-mail/telefone, o Contatia cria também o contato vinculado** àquela empresa.

## Enriquecer
Na ficha da empresa, o botão **Enriquecer** puxa os dados da Receita (CNAE, Porte, Situação, Endereço, Natureza jurídica, Capital social, Abertura) e o **quadro de sócios**. Cada sócio pode virar um contato com um clique.

Isso fecha o ciclo: você traz a empresa, enriquece, e já tem os decisores prontos para entrar numa cadência.$md$, 20, true),

-- ===================== RADAR =====================
($$Radar: prospectar na base da Receita$$, $$Radar$$, $$radar, prospecção, receita, cnae, atividade, uf, porte, cnpj, garimpo$$, $md$O **Radar** busca empresas na **base da Receita Federal** por atividade e região — é a sua fonte de leads novos. Está incluído em todos os planos.

## Buscar
- **Por identificação:** razão social, nome fantasia ou CNPJ.
- **Por segmento:** digite a **Atividade** (o app sugere os CNAEs a partir de 3 letras e você vai somando), e filtre por **UF**, **Município** e **Porte** (ME, EPP, Demais).

## Filtros úteis
- **Só empresas com e-mail**
- **Só e-mail empresarial** (ignora gmail/hotmail…)
- **Ocultar já cadastradas** (não repete quem já está na sua base)

Os resultados vêm em lista (Empresa, Atividade, Município, E-mail, Telefone) e você pode **Carregar mais 100**.

## Atenção
Se aparecer um aviso de que a base não está conectada, é uma configuração do ambiente (fale com o suporte). Quando o total for muito grande, refine por UF/município.$md$, 10, true),

($$Enviar empresas do Radar para a sua base$$, $$Radar$$, $$enviar, importar do radar, só empresa, empresa e contato, descartar, já na base$$, $md$Depois de buscar no Radar, selecione as empresas e mande para a sua base.

## Só empresa ou empresa + contato
Na barra de envio você escolhe:
- **Só empresa** (padrão) — grava em **Empresas**; o contato real (o decisor) você acrescenta depois.
- **Empresa + contato** — cria também um contato com o nome da empresa, para já começar a trabalhar.

O retorno mostra quantas foram criadas e quantas já existiam.

## Já na base e descartados
- Empresas que **já estão na sua base** aparecem em cinza com **"✓ já na base"** e não podem ser selecionadas de novo. "Selecionar todos" só marca as novas.
- Não interessou? Clique em **descartar** — a linha fica cinza, marcada como **descartado**, e some das próximas buscas. Mudou de ideia? **reincluir** desfaz.

Isso mantém o Radar limpo: você só vê o que ainda não avaliou.$md$, 20, true),

-- ===================== CADÊNCIAS =====================
($$O que é uma cadência e como montar$$, $$Cadências$$, $$cadência, sequência, follow-up, passos, canais, dias, ativar$$, $md$Uma **cadência** é a sua sequência de follow-ups multicanal — e-mail, WhatsApp, ligação e LinkedIn. Depois de inscrever um contato, os toques **entram sozinhos na fila do "Hoje"**, no ritmo que você definir.

## Começar
Em **Cadências**, há três caminhos: **Com IA**, **Do zero** ou **A partir de um template**.

## Montar os passos
- Dê um **Nome** à cadência e (opcional) o público-alvo e o **Produto** (a cadência envia pela caixa daquele produto).
- Cada **passo** tem um **canal** (E-mail, WhatsApp, Ligação, LinkedIn), o intervalo **"após N dias"** e o conteúdo (assunto + corpo no e-mail; texto nos demais).
- **+ Adicionar passo** para crescer a sequência.

## Ativar
Salve com **Salvar cadência**. Só cadências **ativas** aparecem para inscrição.

## Atenção
Visibilidade por papel: o **gestor** vê as cadências de toda a equipe; **vendedor/SDR** veem só as que criaram.$md$, 10, true),

($$Personalizar: variáveis, rapport e teste A/B$$, $$Cadências$$, $$variáveis, personalizar, primeiro nome, rapport, a/b, teste, spam$$, $md$Mensagem genérica não converte. No construtor da cadência há vários recursos para personalizar.

## Variáveis (dados do contato)
Botões **"Inserir dado do contato"** colocam campos que viram o dado real no envio:
- **Primeiro nome**, **Empresa**, **Cargo**, **Cidade**, **Atividade** (CNAE)
- E os dados de **rapport**: **Interesses** e **Contexto** — o que você anotou na ficha entra na mensagem.

## Teste A/B de assunto
Em passos de e-mail, use **"+ Testar outro assunto (A/B)"**. Cada contato recebe o assunto A ou o B (sorteio 50/50) e você vê nos Resultados qual ganha.

## Testar spam
O botão **🛡️ Testar spam** avalia o e-mail (via SpamAssassin) e mostra uma prévia com dados de exemplo, antes de você salvar. Vale checar os passos de e-mail para não cair na caixa de spam.

Lembrete: a **assinatura do negócio** é anexada automaticamente no envio.$md$, 20, true),

($$Montar uma cadência com IA$$, $$Cadências$$, $$ia, inteligência artificial, gerar, rascunho, opus, contexto$$, $md$A IA monta um rascunho de cadência inteiro para você revisar — economiza o trabalho da folha em branco.

## Como usar
No construtor, preencha o bloco **"Gerar cadência com IA"**:
- **Mercado-alvo**, **Produto/serviço** e a **dor que você resolve**.
- Em **"+ Mais contexto"**: cliente ideal, objetivo, CTA, prova, tom e o que **nunca dizer**.
- Escolha o número de **passos** (3 a 8) e os **canais**.

Clique em **Gerar rascunho**. A IA preenche os passos — **você revisa e edita antes de salvar**.

## Opções avançadas
- **Considerar dados de rapport** — usa as anotações do contato.
- **Qualidade máxima** — usa o **Pacote Opus** (uma cota mensal de cadências em alta qualidade; o app mostra quantas restam no mês).

## Atenção
A geração por IA depende do seu plano. **Durante o período de teste tudo fica liberado**; depois, ela fica disponível nos planos com IA.$md$, 30, true),

($$Produtos e serviços e as caixas por produto$$, $$Cadências$$, $$produtos, serviços, catálogo, caixas, rodízio, receita por produto$$, $md$Em **Configurações → Produtos**, você mantém o catálogo do que vende. Cada item tem Nome, Tipo (Serviço ou Produto), Cobrança (Recorrente ou Avulso) e Preço de referência.

## Por que isso importa
- **Caixas de e-mail do produto (rodízio):** você pode amarrar caixas de envio a um produto. As cadências daquele produto **alternam entre essas caixas**, distribuindo o volume. Sem caixa definida, usam o rodízio geral.
- **Receita por produto:** ao ligar o produto às oportunidades, os **Resultados** mostram quanto cada produto fatura.

Ou seja: o produto conecta a cadência (por onde envia) ao Pipeline (quanto rende).$md$, 40, true),

-- ===================== AUTOMAÇÕES =====================
($$Automações: "quando isso acontecer, faça aquilo"$$, $$Automações$$, $$automação, gatilho, ação, condição, regra, tag, sugestões$$, $md$**Automações** são regras do tipo "quando isso acontecer, faça aquilo". Ficam em **Automações** e estão incluídas em todos os planos.

## Gatilhos (Quando)
Abriu uma proposta · Clicou num link · Respondeu · Recebeu uma tag · Score atingiu um número · Sem atividade há X dias · Terminou uma cadência · Oportunidade ganha/perdida · Chegou a data de retomada, entre outros.

## Ações (Então)
Inscrever numa cadência (com opção de encerrar a atual antes) · Pausar cadências · Mover de estágio · Marcar como quente · Aplicar uma tag · Trocar o responsável · Suprimir (parar em definitivo).

## Condições (Só dispara se…)
Restrinja por produto, responsável ou por ter/não ter uma tag.

## Sugestões prontas
Há exemplos agrupados em **Sinais quentes**, **Reciclagem**, **Pós-venda** e **Higiene** — clique em **Adicionar** e o formulário vem pré-preenchido.

## Atenção (importante)
Gatilhos de **evento** (abriu, clicou, respondeu) disparam **na hora**. Gatilhos de **tempo** ("sem atividade", "terminou a cadência", "oportunidade perdida/ganha") são verificados **uma vez por dia** — não espere reação instantânea neles.$md$, 10, true),

-- ===================== E-MAIL E ENTREGABILIDADE =====================
($$Conectar a sua caixa de e-mail$$, $$E-mail e entregabilidade$$, $$smtp, conectar, caixa, gmail, brevo, outlook, hostgator, senha de app$$, $md$Para enviar pelas cadências, conecte uma caixa em **Configurações → Canais → + Conectar caixa de e-mail**.

## O jeito rápido
Digite o **E-mail remetente**. O Contatia **detecta o provedor pelo domínio** e preenche host, porta e SSL. Informe o **Nome de exibição** e a **senha (ou senha de app)**, clique em **Testar conexão** e depois **Conectar**.

## Ajustes do servidor
Se o provedor não for reconhecido, escolha um **preset**: **Brevo (recomendado)**, **Gmail (senha de app)**, **Outlook / Microsoft 365** ou **HostGator / cPanel**. Você também pode informar host, porta e usuário na mão.

## Gmail / Google Workspace
Se aparecer o card do Google, dá para conectar por **OAuth** ("Conectar Gmail"), sem senha de app.

## Atenção
- Gmail e Outlook normalmente exigem **senha de app** (não a senha normal), com verificação em duas etapas ativada.
- Se der erro, a mensagem traz a dica (SSL/porta, host ou autenticação).$md$, 10, true),

($$Detecção de respostas e bounces (IMAP)$$, $$E-mail e entregabilidade$$, $$imap, respostas, bounce, pausar cadência, recebimento, 993$$, $md$Cada caixa nova já vem com a **detecção de respostas (IMAP)** ligada. Ela faz duas coisas importantes:

- Quando o lead **responde**, o Contatia detecta e **pausa a cadência** dele automaticamente.
- Captura **bounces** (e-mails que voltam), para você não continuar mandando para caixa que não existe.

A verificação roda **uma vez por dia**.

## Atenção (gotcha comum)
O IMAP só funciona em caixas que **recebem** e-mail. Serviço de **envio puro** (como o Brevo) **não tem IMAP** — nesse caso, aponte a detecção para a **caixa real que recebe as respostas**. Se você deixar em branco, o app tenta o mesmo host do SMTP na porta 993 (SSL).$md$, 20, true),

($$Saúde do domínio: MX, SPF, DKIM e DMARC$$, $$E-mail e entregabilidade$$, $$domínio, spf, dkim, dmarc, mx, dns, entregabilidade, reputação$$, $md$Em **Configurações → Canais**, o painel **Saúde do domínio** checa se o seu domínio está configurado para entregar bem.

## O que ele verifica
Informe o **Domínio** e clique em **Checar domínio**. Ele mostra quatro linhas, com nota de 0 a 4:
- **MX** — recebe e-mail
- **SPF** — autoriza quem envia
- **DKIM** — assina os e-mails
- **DMARC** — política de proteção

## Saúde de envio (30 dias)
Logo abaixo, o engajamento real: e-mails enviados, cliques, respostas, **bounces** e quantos endereços estão na lista de supressão.

## Atenção
- Os registros **SPF/DKIM/DMARC se configuram no seu provedor de DNS**, não dentro do app. O painel só diz o que falta.
- Uma taxa de **bounce acima de 3%** (com volume relevante) gera aviso — pause e limpe a base antes de continuar, para não queimar o domínio.$md$, 30, true),

($$Aquecimento, limite diário e rotação de caixas$$, $$E-mail e entregabilidade$$, $$aquecimento, warmup, limite, rotação, múltiplas caixas, volume$$, $md$Enviar muito de uma caixa nova derruba a reputação. O Contatia protege isso automaticamente.

## Aquecimento (warmup)
Uma caixa recém-conectada começa com um limite baixo, que **sobe sozinho a cada dia**. Na lista de caixas você vê "Aquecendo: hoje envia N e-mails. Sobe até M/dia".

## Limite diário
Cada caixa tem um teto por dia. O que passar do teto **entra na fila e sai no dia seguinte** — é a faixa "Envio Seguro" na tela Hoje.

## Rotação (2 ou mais caixas)
Com duas ou mais caixas conectadas, a **rotação** distribui os envios entre elas, somando os limites. Isso aumenta o volume seguro total sem sobrecarregar uma única caixa. Também dá para amarrar caixas específicas a um **produto** (veja o artigo de Produtos).$md$, 40, true),

($$Lista de supressão$$, $$E-mail e entregabilidade$$, $$supressão, bloqueio, descadastro, bounce, spam, opt-out$$, $md$A **Lista de supressão** guarda os e-mails que **não devem mais receber** envios: os que devolveram (bounce), os que marcaram como spam e os que pediram descadastro.

Endereços nessa lista ficam **bloqueados** automaticamente — o Contatia não envia para eles, mesmo que estejam numa cadência. Isso protege a sua reputação e respeita quem pediu para sair.

Você acessa pelo card **"Lista de supressão"** em Configurações → Canais.$md$, 50, true),

-- ===================== WHATSAPP =====================
($$WhatsApp: os três modos de uso$$, $$WhatsApp$$, $$whatsapp, evolution, assistido, api oficial, qr, banimento, conectar$$, $md$O WhatsApp entra nas cadências e na caixa de Respostas. Em **Configurações → Canais**, há três modos:

- **Link do WhatsApp (assistido)** — o padrão, **risco zero**. O Contatia prepara a mensagem e você a envia pelo **seu próprio WhatsApp** (o botão "Abrir WhatsApp" já abre a conversa com o texto pronto).
- **API não-oficial (Evolution)** — permite **envio automático e captura** das respostas dentro do app. Exige aceitar o **risco de banimento** do número e é recomendável usar um **número secundário**. A conexão é por **QR Code**.
- **API oficial da Meta** — no roadmap.

## Atenção
No modo Evolution, se as respostas pararem de chegar, use **"Reativar recebimento"**. E fique de olho no aviso de WhatsApp desconectado na tela Hoje — enquanto desconectado, os envios automáticos ficam **pausados**.$md$, 10, true),

-- ===================== PROPOSTAS =====================
($$Propostas rastreadas: um link por contato$$, $$Propostas$$, $$proposta, documento, pdf, link, rastreado, abertura, quente$$, $md$Em **Propostas & documentos** você gera um **link rastreado por destinatário**. Quando o contato abre, ele **fica quente** e você é avisado.

## Criar
Botão **+ Documento**. Escolha **Subir PDF** (até 15 MB) ou **Usar link**, dê um Nome e o Tipo (Proposta, Apresentação, Resumo de 1 página, Case). O arquivo fica **privado** — o Contatia gera o link.

## Gerar o link do contato
No documento, use **"Gerar link para…"**, escolha o contato e clique em **Gerar link para [nome]**. **Cada contato recebe um link único** — assim você sabe exatamente quem abriu. Copie e mande.

## Acompanhar
A tabela **"Envios & aberturas"** mostra Documento, Contato, número de **Aberturas** e a **1ª abertura**.

## Atenção
- PDFs subidos têm **retenção limitada** pela política do plano: a linha mostra "Disponível até [data]" e o arquivo expira depois (o registro do documento continua).
- Se aparecer que o rastreio está indisponível, é uma configuração do ambiente — fale com o suporte.$md$, 10, true),

-- ===================== PIPELINE =====================
($$Pipeline: o funil dos seus negócios$$, $$Pipeline e negócios$$, $$pipeline, funil, negócio, oportunidade, estágio, arrastar, valor$$, $md$O **Pipeline** mostra os seus negócios do primeiro toque ao fechamento. Você **arrasta o cartão** entre os estágios.

## Criar o funil
Se ainda não houver estágios, clique em **"Criar funil padrão"** — ele cria: **Novo · Contatado · Respondeu · Reunião · Proposta · Fechado · Perdido** (você pode renomear).

## Criar um negócio
Botão **+ Negócio**: dê um **Título**, o **Valor recorrente (R$/mês)** e, se quiser, a Empresa e o Contato. O negócio nasce no primeiro estágio.

## Trabalhar
- **Arraste** o cartão entre as colunas para mover o estágio.
- Edite pelo ✎ (título, valor, contato, empresa, produto).
- O topo mostra "N negócios abertos · R$ X/mês em potencial", e cada coluna soma o valor. Cartões quentes ganham a etiqueta **QUENTE**.

Obs.: vendedores e SDRs veem **só os próprios negócios**; gestor/dono veem todos.$md$, 10, true),

-- ===================== RESPOSTAS =====================
($$Caixa de Respostas: WhatsApp e e-mail juntos$$, $$Respostas$$, $$respostas, caixa, inbox, whatsapp, email, responder, não lidas$$, $md$**Respostas** é a caixa única das suas conversas — **WhatsApp e e-mail no mesmo lugar**. As conversas ficam à esquerda (com selo WA ou @) e a conversa aberta à direita.

## Não lidas
O item **Respostas** no menu mostra um contador de não lidas. Ao **abrir** uma conversa, ela é marcada como lida.

## Responder
- **E-mail:** sai sempre pela sua caixa, com a assinatura. **Atenção:** é preciso ter o **contato vinculado** — se for uma conversa solta, use "Cadastrar contato" antes.
- **WhatsApp:** no modo automático, responde pela instância (Ctrl/⌘+Enter envia); no modo assistido, abre o seu WhatsApp.

## Outras ações
Ver contato / cadastrar contato; no WhatsApp, **Bloquear** (vira opt-out) e **Excluir**. Quando um lead responde, a cadência dele **pausa sozinha**.$md$, 10, true),

($$Triagem: decidir o que fazer com uma resposta$$, $$Respostas$$, $$triagem, decisão, intenção, suprimir, retomada, inscrever, ignorar$$, $md$Algumas respostas pedem uma decisão sua. Dentro da conversa aparece a barra **"Precisa de decisão"** (a triagem foi unida à caixa de Respostas).

## A sugestão de intenção
O Contatia lê palavras-chave e **sugere** a intenção: **Pediu para parar**, **Quer adiar**, **Sinal de interesse** ou **Resposta (avaliar)**. É só uma sugestão — **a decisão é sua**.

## As ações
- **Suprimir** — encerra tudo em definitivo (para quem pediu para não receber mais).
- **Inscrever numa cadência** — encerra a atual e coloca numa nova (ex.: quem demonstrou interesse).
- **Anotar retomada** — escolhe uma data para voltar a falar; anota, encerra a atual e agenda.
- **ignorar** — tira da fila de decisão sem mudar nada.

Assim nenhuma resposta importante fica sem destino.$md$, 20, true),

-- ===================== REUNIÕES =====================
($$Agendar e registrar reuniões$$, $$Reuniões$$, $$reunião, agendar, calendário, google calendar, status, faltou, resultado$$, $md$Em **Reuniões** você agenda, confirma e **registra o resultado**. Os lembretes viram tarefas na sua fila e reduzem faltas.

## Agendar
Use o formulário (escolhendo o contato). Você alterna entre **Calendário** e **Lista/Agenda**.

## Status
Uma reunião pode estar **Agendada, Confirmada, Realizada, Faltou** ou **Remarcada**. As passadas pedem que você **registre o resultado**.

## Google Calendar
Com o **Gmail conectado** em Configurações → E-mail, cada reunião agendada vira **automaticamente um evento no seu Google Calendar**, com convite para o contato. As sincronizadas mostram "✓ no Google Calendar".

## Atenção
Se você conectou o Gmail **antes desta atualização**, **reconecte uma vez** para liberar o acesso à agenda. O admin vê todas as agendas; SDRs veem conforme as permissões de agenda do workspace.$md$, 10, true),

-- ===================== RESULTADOS =====================
($$Resultados: o que cada aba mostra$$, $$Resultados$$, $$resultados, relatórios, métricas, metas, funil, produtividade, cadências, cliques$$, $md$**Resultados** reúne os números do seu trabalho (as antigas "Métricas" entram aqui). No topo você escolhe o **período**, o corte de "frio" e, se for gestor, o **vendedor**.

## As abas
- **Visão geral** — metas (receita recorrente e atividades), negócios em aberto, receita fechada, taxa de ganho, funil, atividade (toques, e-mails, respostas, reuniões, faltas), ticket médio, tempo de fechamento, motivos de perda e receita por produto.
- **Carteira parada** — contatos frios e fora de cadência.
- **Pipeline aging** — negócios abertos parados há muito tempo.
- **Empresas vazias** — sem contato ou sem oportunidade.
- **Quentes sem ação** — score alto, mas esfriando.
- **Produtividade** — números por vendedor.
- **Cobertura** — % em cadência, carteira fria.
- **Cadências** — inscritos, ativos, respostas, taxa de resposta.
- **Cliques em links** — links mais clicados e últimos cliques.

## Atenção
Respeita a visibilidade: **gestor** vê a equipe (e filtra por vendedor); **vendedor** vê só a própria carteira.$md$, 10, true),

-- ===================== EQUIPE E PERMISSÕES =====================
($$Convidar pessoas para a equipe$$, $$Equipe e permissões$$, $$equipe, convidar, convite, papel, link, 14 dias$$, $md$Em **Equipe** você vê o placar do time e convida gente.

## Convidar
Botão **Convidar pessoa**: informe o **e-mail** e o **Papel** (Vendedor, SDR, Gestor ou Admin) e clique em **Gerar convite**. Sai um **link** que você manda para a pessoa; ele vale **14 dias**. Convites pendentes podem ser copiados de novo ou revogados.

## Atenção
Para convidar é preciso ser **Dono** ou **Admin**. O **Gestor** acompanha e gerencia a operação, mas não emite convites.

Há ainda ferramentas para **dividir contatos sem dono** e **limpar duplicados**, úteis quando o time cresce.$md$, 10, true),

($$Papéis e o que cada um enxerga$$, $$Equipe e permissões$$, $$papéis, permissões, dono, admin, gestor, sdr, vendedor, visibilidade$$, $md$Cada pessoa tem um **papel**, que define o que ela pode fazer e o que enxerga.

- **Dono** — controle total, incluindo **cobrança e plano**.
- **Admin** — administra o workspace e a equipe, mas **não** mexe na cobrança.
- **Gestor** — metas, métricas e pipeline **de todos**.
- **SDR** — prospecção e primeiros toques; vê **só o que é dele**.
- **Vendedor** — trabalha a própria carteira; vê **só o que é dele**.

## O que isso muda na prática
A **visibilidade** segue o papel: SDR e vendedor veem apenas os contatos, negócios e reuniões atribuídos a eles; gestor, admin e dono veem tudo. Por isso, ao dividir a carteira, atribua o **dono** de cada contato — é o que faz cada vendedor ver a sua parte.$md$, 20, true),

-- ===================== PLANOS E COBRANÇA =====================
($$Planos, limites de uso e faturas$$, $$Planos e cobrança$$, $$planos, cobrança, asaas, limites, usuários, contatos, cadências, fatura$$, $md$Em **Planos** você contrata e acompanha a assinatura. **Você paga por usuário ativo** do workspace — o valor se ajusta ao adicionar ou remover pessoas. A cobrança é mensal via **Asaas** (boleto, Pix ou cartão).

## O que é limitado
O plano define tetos de **Usuários, Contatos, Cadências e Caixas de e-mail**. O app mostra barras de uso, **avisa a partir de 80%** e **bloqueia ao atingir 100%**, sempre com o atalho para mudar de plano. A geração por **IA** depende do plano — mas **durante o teste tudo fica liberado**.

## Faturas
A **Central de faturas** lista Descrição, Vencimento, Valor e Status (Paga, Em aberto, Vencida, Cancelada), com link **"Pagar →"**. O estado da assinatura pode ser: ativa, período de teste, aguardando pagamento, em atraso ou cancelada.

## Atenção
Apenas o **Dono** contrata, troca ou cancela o plano.$md$, 10, true),

-- ===================== CONTA E AJUDA =====================
($$Redefinir a sua senha$$, $$Conta e ajuda$$, $$senha, esqueci, recuperar, redefinir, login, acesso$$, $md$Esqueceu a senha? É rápido.

- Na tela de **login**, clique em **"Esqueci minha senha"**.
- Informe o seu e-mail e clique em **Enviar link de recuperação**. Por segurança, a mensagem é neutra: "Se este e-mail tiver conta, enviamos um link…".
- Abra o e-mail e clique no link. Na tela **Redefinir senha**, digite a **nova senha** (mínimo 6 caracteres) e repita para confirmar.
- Clique em **Salvar nova senha** — você já entra no painel.

## Atenção
O link de recuperação **expira**. Se aparecer que ele venceu, é só pedir um novo na tela de login.$md$, 10, true),

($$Como pedir ajuda no Contatia$$, $$Conta e ajuda$$, $$ajuda, suporte, chamado, chat, central de ajuda, contato$$, $md$Há três caminhos para tirar dúvidas, do mais rápido ao mais humano.

- **Botão de ajuda (?)** — no canto inferior direito de qualquer tela. Abre um **chat com a IA** que responde na hora; quando não resolve, ela **encaminha para o time** e você recebe a resposta por e-mail.
- **Central de ajuda** — no menu (Gestão → Central de ajuda). Traz estes artigos, organizados por **tema** e com **busca instantânea**. Comece por aqui: a maioria das dúvidas tem resposta imediata.
- **Suporte** — para abrir um **chamado** e acompanhar as respostas do time, com histórico. Fica no menu, em Gestão → Suporte.

Dica: procure na Central de ajuda antes de abrir um chamado — costuma ser mais rápido.$md$, 20, true)

;

commit;

-- ============================================================
-- Fim. 37 artigos em 15 temas. Rode no SQL Editor do Supabase
-- (ou via CLI). Depois, confira em /dashboard/ajuda.
-- ============================================================
