-- ============================================================
-- Contatia — Migration 0121 (o agente passa a saber O QUE vende, e de quem)
--
-- O BURACO, encontrado depois do deploy: o playbook descrevia a ESTRATÉGIA — etapas,
-- argumentos, objeções, preços — e em lugar nenhum dizia o que a empresa É nem o que o
-- produto É. Um agente com tática e sem descrição não responde "o que vocês fazem?",
-- que é a primeira pergunta de qualquer lead.
--
-- É uma falha de desenho, não de configuração: o prompt montava "Você é Ana, do time X,
-- conduza a venda" e passava direto para as etapas. O modelo teria que INFERIR o produto
-- a partir dos argumentos — e inferir produto é exatamente onde ele inventa.
--
-- O QUE **NÃO** ENTRA AQUI, de propósito:
--   `tenants` já tem `name`, `legal_name`, `segment`, `website`, `phone` e
--   `contact_email`, preenchidos em Config → Identidade e marca. Duplicar isso criaria
--   dois lugares para a mesma verdade e um deles ficaria velho. O prompt passa a LER de
--   lá; aqui entra só o que nenhum campo existente cobre.
--
--   E `kb_articles` NÃO vira fonte do agente, apesar de a espec sugerir. A tabela não
--   tem `tenant_id`: é a central de ajuda da própria Contatia, global. Ligá-la ao agente
--   faria o assistente de um cliente citar a documentação da plataforma no meio de uma
--   conversa de venda dele. Só faria sentido quando a Contatia vende a Contatia.
--
-- O QUE ENTRA:
--
-- agent_config.empresa_descricao — "o que a gente faz", em uma ou duas frases, do jeito
--   que você diria a um desconhecido. `segment` é uma palavra ("Contabilidade"); isto é
--   a frase.
--
-- agent_playbooks.descricao  — o que o produto É, antes de por que comprá-lo.
-- agent_playbooks.para_quem  — para quem serve (o ICP em palavras).
-- agent_playbooks.nao_serve  — para quem NÃO serve. O campo mais subestimado dos três:
--   sem ele o agente qualifica todo mundo como cliente e queima tempo — e reputação —
--   vendendo para quem vai cancelar no primeiro mês.
--
-- Roda depois de 0001-0120. Idempotente. Non-breaking.
-- ============================================================

alter table public.agent_config add column if not exists empresa_descricao text;

comment on column public.agent_config.empresa_descricao is
  'O que a empresa faz, em uma ou duas frases, como voce diria a um desconhecido. Vai no topo do prompt de todo turno. O resto do perfil (nome, segmento, site) o agente le de tenants - nao duplique aqui.';

alter table public.agent_playbooks add column if not exists descricao text;
alter table public.agent_playbooks add column if not exists para_quem text;
alter table public.agent_playbooks add column if not exists nao_serve text;

comment on column public.agent_playbooks.descricao is
  'O que o produto E, em linguagem simples - antes de qualquer argumento de por que compra-lo. Sem isto o agente infere o produto a partir dos argumentos, e inferir produto e onde ele inventa.';
comment on column public.agent_playbooks.para_quem is
  'Para quem este produto serve: porte, ramo, situacao. O ICP em palavras.';
comment on column public.agent_playbooks.nao_serve is
  'Para quem NAO serve. Evita o agente qualificar todo mundo como cliente e vender para quem cancela no primeiro mes.';
