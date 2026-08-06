-- ============================================================
-- Contatia — Migration 0112 (a tarefa lembra que foi editada à mão)
--
-- POR QUE: editar a cadência não muda quem já está inscrito — o texto é renderizado e
-- gravado DENTRO de cada tarefa no momento da inscrição. Isso é bom (envio rápido e
-- previsível) e cria um buraco: consertar o texto da cadência não conserta as 260
-- mensagens que já estão na fila.
--
-- O conserto é uma ação de "reaplicar o texto novo nas tarefas pendentes". Só que ela
-- tem um risco óbvio: passar por cima do que a pessoa escreveu à mão na fila, para
-- AQUELE contato, e que quase sempre é o texto melhor da lista.
--
-- Por isso a tarefa passa a lembrar. `body_editado` é marcado quando o operador salva
-- um texto próprio (na fila ou no envio), e a reaplicação pula essas por padrão —
-- oferecendo, com todas as letras, a opção de incluí-las.
--
-- Idempotente. Non-breaking: sem a coluna o app continua funcionando, só não distingue
-- editadas de geradas (e a tela avisa isso).
-- ============================================================

alter table public.tasks add column if not exists body_editado boolean not null default false;

-- Índice não é necessário: a coluna só é lida junto de enrollment_id/status, que já
-- estão cobertos por tasks_assigned_idx e pelas consultas por enrollment.

comment on column public.tasks.body_editado is
  'true = o texto desta tarefa foi escrito/ajustado por uma pessoa; a reaplicação do texto da cadência pula estas por padrão.';
