-- ============================================================
-- Contatia — Migration 0114 (limite de envio POR HORA + horário comercial)
--
-- POR QUE: o limite que existia era só o do DIA. Quem hospeda o e-mail em cPanel
-- (HostGator, Locaweb, KingHost…) não é limitado por dia — é limitado por HORA. Estourar
-- esse teto não devolve "limite atingido": o servidor passa a recusar a conexão
-- ("too many messages per hour"), e o que estava no meio do lote falha em bloco. Pior,
-- a caixa entra numa contenção que dura a hora inteira.
--
-- Ou seja: o freio existia no provedor e não existia aqui. A conta do dia podia estar
-- perfeita (80 de 200) e ainda assim o envio quebrar, porque as 80 saíram em 4 minutos.
--
-- O QUE ENTRA:
--   email_accounts.hourly_cap  int → teto por hora DESTA caixa (null = sem teto próprio)
--   tenants.hourly_cap         int → teto por hora do WORKSPACE INTEIRO (null = sem teto)
--
-- Os dois valem ao mesmo tempo, e o menor manda. Isso não é redundância: várias caixas
-- podem morar no MESMO cPanel — cada uma respeita o seu teto e a soma respeita o do
-- servidor. Com uma caixa só, basta preencher um dos dois.
--
-- A CONTAGEM É POR JANELA MÓVEL de 60 minutos (não "das 14h às 15h"), porque é assim
-- que o cPanel conta. Contar por hora cheia deixaria passar 2× o limite na virada:
-- 100 às 14h59 e 100 às 15h01.
--
-- Idempotente. Non-breaking: sem valor preenchido, nada muda — o envio segue só com o
-- limite diário, exatamente como hoje.
-- ============================================================

alter table public.email_accounts add column if not exists hourly_cap int;
alter table public.tenants        add column if not exists hourly_cap int;

-- Teto de sanidade nos dois lados. O piso é 1 (zero seria "não envie nunca" escrito
-- de um jeito que parece "sem limite" — a confusão mais cara possível num campo destes).
alter table public.email_accounts drop constraint if exists email_accounts_hourly_cap_ck;
alter table public.email_accounts
  add constraint email_accounts_hourly_cap_ck
  check (hourly_cap is null or (hourly_cap >= 1 and hourly_cap <= 5000));

alter table public.tenants drop constraint if exists tenants_hourly_cap_ck;
alter table public.tenants
  add constraint tenants_hourly_cap_ck
  check (hourly_cap is null or (hourly_cap >= 1 and hourly_cap <= 20000));

comment on column public.email_accounts.hourly_cap is
  'Teto de e-mails por janela móvel de 60 min desta caixa. null = sem teto próprio (vale só o do workspace e o diário).';
comment on column public.tenants.hourly_cap is
  'Teto de e-mails por janela móvel de 60 min somando TODAS as caixas do workspace. null = sem teto geral.';

-- A conta da janela móvel lê events por (type, created_at). O índice de 0100 já cobre
-- essa consulta — a janela de 60 min é um recorte mais estreito do mesmo filtro que a
-- contagem do dia já fazia, então não há consulta nova a indexar.


-- ============================================================
-- HORÁRIO COMERCIAL DA FILA
--
-- Limite por hora responde "quantos"; isto responde "quando". Prospecção que chega às
-- 3h da manhã de domingo é lida como robô — pelo destinatário e pelo filtro dele.
--
-- Vale para a FILA (o "Enviar todos", que decide sozinho o que sai). O envio de uma
-- tarefa específica, e o envio das marcadas, continuam saindo na hora em que você
-- clica: ali quem escolheu foi uma pessoa, e a tela avisa que está fora do horário em
-- vez de recusar.
--
-- `envio_horario_on` nasce FALSE de propósito: uma migration não pode mudar o
-- comportamento de quem já usa o sistema. Os horários já vêm preenchidos (8h–18h,
-- seg–sex) para que ligar seja um clique, não um formulário.
--
-- Horas em hora cheia local de Brasília (UTC-3 fixo, a mesma convenção do resto do app).
-- `envio_dias` no mesmo formato de booking_days: 0=dom … 6=sáb.
-- ============================================================
alter table public.tenants add column if not exists envio_horario_on boolean not null default false;
alter table public.tenants add column if not exists envio_hora_inicio int default 8;
alter table public.tenants add column if not exists envio_hora_fim    int default 18;
alter table public.tenants add column if not exists envio_dias        text default '1,2,3,4,5';

alter table public.tenants drop constraint if exists tenants_envio_horas_ck;
alter table public.tenants
  add constraint tenants_envio_horas_ck
  check (
    (envio_hora_inicio is null or (envio_hora_inicio >= 0 and envio_hora_inicio <= 23))
    and (envio_hora_fim is null or (envio_hora_fim >= 1 and envio_hora_fim <= 24))
    -- fim > início: janela que vira a meia-noite não existe aqui de propósito. "Das 22h
    -- às 6h" para prospecção fria é exatamente o horário que se quer evitar, e suportar
    -- isso dobraria a lógica de "quando abre a próxima janela".
    and (envio_hora_inicio is null or envio_hora_fim is null or envio_hora_fim > envio_hora_inicio)
  );

comment on column public.tenants.envio_horario_on is
  'true = a fila ("Enviar todos") só dispara dentro do horário comercial abaixo. Envio manual de uma tarefa não é afetado.';
comment on column public.tenants.envio_hora_inicio is 'Hora local (Brasília) em que a fila pode começar a enviar. 8 = 08:00.';
comment on column public.tenants.envio_hora_fim is 'Hora local (Brasília) em que a fila para. 18 = para às 18:00 (17:59 ainda envia).';
comment on column public.tenants.envio_dias is 'Dias em que a fila envia, 0=dom..6=sáb, separados por vírgula. Padrão: 1,2,3,4,5.';
