-- ============================================================
-- Contatia — Migration 0100 (índices de performance)
--
-- POR QUE: a lista de Contatos pede "os 200 melhores por score" numa base de ~78 mil.
-- Sem um índice que já entregue essa ORDEM, o Postgres lê as 78 mil linhas e ordena
-- todas para jogar 78.171 fora. Medido num Postgres 16 com a base do Leandro
-- reproduzida (78.371 contatos, RLS ligada):
--
--     antes:  Index Scan em contacts_tenant_idx + Sort de 78.371 linhas → 290 ms
--     depois: Index Scan em contacts_lista_idx, lendo só 200 linhas     →   1 ms
--
-- 290 ms parece pouco, mas é o piso: com cache frio, cron rodando e importação em
-- paralelo, essa mesma consulta é a que estourava o limite de tempo e devolvia
-- "canceling statement due to statement timeout" — que na tela virava lista vazia.
--
-- Os demais índices atacam as consultas que a mesma página dispara junto
-- (produtos por contato, cadências, fila de hoje) e que também faziam varredura
-- completa por falta de índice na coluna de junção.
--
-- SEGURANÇA: cada índice é criado dentro de um bloco com tratamento de erro — se a
-- tabela ou a coluna não existir neste banco, ele avisa e SEGUE para o próximo, sem
-- abortar a migration. Roda depois de 0001-0099. Idempotente. Non-breaking.
--
-- IMPACTO AO RODAR: CREATE INDEX bloqueia ESCRITA na tabela enquanto constrói
-- (leitura continua normal). Em 78 mil linhas é questão de segundos. Prefira rodar
-- fora do horário de disparo das cadências.
-- ============================================================

do $$
declare
  cmd text;
  cmds text[] := array[

    -- ---------- CONTATOS ----------
    -- A lista principal: ordem score↓, created_at↓ dentro do workspace.
    'create index if not exists contacts_lista_idx
       on public.contacts (tenant_id, score desc, created_at desc)',

    -- Mesma lista para quem NÃO é gestor (a RLS/consulta filtra por assigned_to).
    'create index if not exists contacts_lista_dono_idx
       on public.contacts (tenant_id, assigned_to, score desc, created_at desc)',

    -- Filtro "frio" e visão "resgatar" (último toque antigo ou nunca).
    'create index if not exists contacts_ultimo_toque_idx
       on public.contacts (tenant_id, last_activity_at)',

    -- Dedup e busca por CNPJ (Radar/Prospectar consultam por CNPJ em lote).
    'create index if not exists contacts_cnpj_idx
       on public.contacts (tenant_id, cnpj) where cnpj is not null',

    -- ---------- EMPRESAS ----------
    -- A lista de Empresas ordena por created_at↓ e corta em 300.
    'create index if not exists accounts_lista_idx
       on public.accounts (tenant_id, created_at desc)',

    'create index if not exists accounts_cnpj_lookup_idx
       on public.accounts (tenant_id, cnpj) where cnpj is not null',

    -- ---------- CADÊNCIAS / PRODUTOS ----------
    -- produtosPorContatos() consulta enrollments por contact_id (lista de 200 ids).
    -- Sem este índice era varredura completa de enrollments A CADA carregamento.
    'create index if not exists enrollments_contact_idx
       on public.enrollments (contact_id)',

    -- Filtro "está nesta cadência" e a régua do motor.
    'create index if not exists enrollments_seq_status_idx
       on public.enrollments (sequence_id, status)',

    'create index if not exists enrollments_tenant_status_idx
       on public.enrollments (tenant_id, status)',

    -- produtosPorContatos() também consulta oportunidades pelo contato principal.
    'create index if not exists opportunities_contato_idx
       on public.opportunities (primary_contact_id) where primary_contact_id is not null',

    -- ---------- FILA DE HOJE ----------
    -- A caixa de hoje pede status=pending e due_date <= hoje+3.
    'create index if not exists tasks_fila_idx
       on public.tasks (tenant_id, status, due_date)',

    -- ---------- EVENTOS (relatórios e "quente agora") ----------
    'create index if not exists events_tipo_idx
       on public.events (tenant_id, type, created_at desc)',

    'create index if not exists events_contato_idx
       on public.events (contact_id, created_at desc)',

    -- ---------- SUGESTÕES (contador no topo da lista) ----------
    'create index if not exists contact_suggestions_pend_idx
       on public.contact_suggestions (tenant_id, status)'
  ];
begin
  foreach cmd in array cmds loop
    begin
      execute cmd;
    exception when others then
      raise notice 'pulado (%): %', sqlerrm, left(replace(cmd, E'\n', ' '), 90);
    end;
  end loop;
end $$;

-- ============================================================
-- BUSCA POR TEXTO (nome / empresa / e-mail)
--
-- A caixa de busca usa ILIKE '%termo%'. Índice comum não serve para curinga no
-- começo; quem resolve é o pg_trgm. São TRÊS índices separados (um por coluna), e
-- não um só com as três: a consulta é "nome OU empresa OU e-mail", e só com índices
-- separados o Postgres consegue combiná-los (BitmapOr).
--
-- Medido aqui (78.371 contatos): buscar um contato específico caiu de 397 ms para
-- 2,5 ms QUANDO o planejador usa estes índices. Ressalva honesta: com ORDER BY +
-- LIMIT ele às vezes prefere o caminho antigo e a busca fica em ~400 ms — o que
-- resolve isso é mudar como o app monta a consulta de busca, e fica para depois.
-- Nenhum dos dois casos é o que estourava o tempo limite.
--
-- Se a extensão não puder ser criada, a migration segue sem ela.
-- ============================================================
do $$
begin
  create extension if not exists pg_trgm;

  begin
    execute 'create index if not exists contacts_busca_nome_idx    on public.contacts using gin (name gin_trgm_ops)';
    execute 'create index if not exists contacts_busca_empresa_idx on public.contacts using gin (company gin_trgm_ops)';
    execute 'create index if not exists contacts_busca_email_idx   on public.contacts using gin (email gin_trgm_ops)';
    execute 'create index if not exists accounts_busca_nome_idx    on public.accounts using gin (name gin_trgm_ops)';
  exception when others then
    raise notice 'índice de busca pulado: %', sqlerrm;
  end;
exception when others then
  raise notice 'pg_trgm indisponível (%) — busca segue sem índice de texto', sqlerrm;
end $$;

-- ============================================================
-- Estatísticas atualizadas: sem isso o planejador pode continuar escolhendo o
-- caminho antigo mesmo com o índice novo no lugar.
-- ============================================================
analyze public.contacts;
analyze public.accounts;
analyze public.enrollments;
analyze public.tasks;
analyze public.events;
