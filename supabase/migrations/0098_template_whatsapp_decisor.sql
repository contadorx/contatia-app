-- ============================================================
-- Contatia — Migration 0098 (Templates de cadência + WhatsApp para o decisor)
--
-- AUTOSSUFICIENTE: cria a tabela sequence_templates se ela não existir (a 0014
-- pode não ter sido aplicada no seu banco — foi o erro "relation does not exist"),
-- garante a RLS, e semeia os templates GLOBAIS que aparecem em Cadências →
-- "A partir de um template": as duas cadências prontas da 0014 + a nova de WhatsApp
-- para o decisor.
--
-- delay_days é CUMULATIVO (dias após o passo anterior).
-- Idempotente: cria só se faltar e re-semeia por nome. Roda depois da 0097.
-- ============================================================

begin;

-- 1) Tabela (idempotente) ----------------------------------------------------
create table if not exists public.sequence_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,  -- null = template global (curado)
  name        text not null,
  audience    text,
  description text,
  steps       jsonb not null default '[]'::jsonb,   -- [{channel, delay_days, subject, body}]
  is_global   boolean not null default false,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists seq_templates_tenant_idx on public.sequence_templates(tenant_id);

-- 2) RLS (idempotente) -------------------------------------------------------
alter table public.sequence_templates enable row level security;
drop policy if exists seq_templates_select on public.sequence_templates;
create policy seq_templates_select on public.sequence_templates for select
  using (is_global = true or tenant_id = public.current_tenant_id());
drop policy if exists seq_templates_write on public.sequence_templates;
create policy seq_templates_write on public.sequence_templates for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- 3) Sementes globais (idempotente: remove por nome e reinsere) --------------
delete from public.sequence_templates where is_global = true and name in (
  $$Prospecção consultiva (5 toques)$$,
  $$Reengajamento (3 toques)$$,
  $$WhatsApp — Abordagem ao decisor$$
);

insert into public.sequence_templates (tenant_id, name, audience, description, steps, is_global) values
(
  null,
  $$Prospecção consultiva (5 toques)$$,
  $$Decisor B2B — dono/diretor$$,
  $$Abertura por valor, prova, quebra de objeção e despedida. Multicanal.$$,
  $json$[
    {"channel":"email","delay_days":0,"subject":"Uma ideia para {{empresa}}","body":"Olá {{primeiro_nome}}, vi que a {{empresa}} pode estar deixando dinheiro na mesa em [processo]. Ajudamos empresas parecidas a [resultado]. Faz sentido uma conversa de 15 min esta semana?"},
    {"channel":"whatsapp","delay_days":2,"subject":"","body":"{{primeiro_nome}}, te mandei um e-mail sobre [tema]. Consegue dar uma olhada? Posso resumir em 2 linhas se preferir."},
    {"channel":"email","delay_days":4,"subject":"Como a [empresa similar] resolveu isso","body":"{{primeiro_nome}}, um caso rápido: a [empresa similar] tinha o mesmo desafio e [resultado breve]. Quer que eu mostre como aplicaria na {{empresa}}?"},
    {"channel":"linkedin","delay_days":7,"subject":"","body":"Conexão + nota curta: {{primeiro_nome}}, acompanho o trabalho da {{empresa}} e acho que teríamos uma boa conversa sobre [tema]."},
    {"channel":"email","delay_days":10,"subject":"Fecho o assunto?","body":"{{primeiro_nome}}, imagino que a prioridade agora seja outra — sem problema. Se fizer sentido retomar [tema] mais pra frente, é só me chamar. Abraço."}
  ]$json$::jsonb,
  true
),
(
  null,
  $$Reengajamento (3 toques)$$,
  $$Lead que esfriou$$,
  $$Retomada leve de um contato que não respondeu, com novo ângulo.$$,
  $json$[
    {"channel":"email","delay_days":0,"subject":"Voltando ao assunto, {{primeiro_nome}}","body":"Oi {{primeiro_nome}}, sei que a rotina corre. Retomo aqui porque [novo gatilho/novidade] pode ser relevante pra {{empresa}}. Vale 10 min?"},
    {"channel":"whatsapp","delay_days":3,"subject":"","body":"{{primeiro_nome}}, ainda faz sentido falarmos sobre [tema]? Se não for o momento, me diz que eu te retiro da lista de follow-up."},
    {"channel":"email","delay_days":6,"subject":"Último toque","body":"{{primeiro_nome}}, encerro por aqui pra não incomodar. Deixo meu contato — quando [tema] voltar ao radar da {{empresa}}, é só chamar."}
  ]$json$::jsonb,
  true
),
(
  null,
  $$WhatsApp — Abordagem ao decisor$$,
  $$Decisores com WhatsApp confirmado (sócios/donos) — visão "Com WhatsApp"$$,
  $$Sequência curta de WhatsApp que pede a pessoa pelo nome (funciona até na linha geral da empresa), entrega valor e sai com educação. Edite os trechos entre [colchetes] com a sua oferta antes de ativar.$$,
  $json$[
    {"channel":"whatsapp","delay_days":0,"subject":"","body":"Olá! Falo com {{primeiro_nome}}?\n\nAqui é [Seu Nome], da [Sua Empresa]. Vi a {{empresa}} e queria trocar uma ideia rápida — prometo ser breve. Posso te mandar em 2 linhas do que se trata?"},
    {"channel":"whatsapp","delay_days":2,"subject":"","body":"{{primeiro_nome}}, complementando: a gente ajuda empresas como a {{empresa}} a [seu resultado em uma frase — ex.: vender mais, reduzir custo, ganhar tempo].\n\nFaz sentido eu te mostrar como, em 10 minutos? Me diz um horário que eu te chamo."},
    {"channel":"whatsapp","delay_days":3,"subject":"","body":"Oi {{primeiro_nome}}, só pra não perder o timing: [prova rápida — ex.: um cliente parecido com a {{empresa}} teve tal resultado].\n\nSe fizer sentido, me passa o melhor horário. Se não for o momento, é só me avisar que eu paro por aqui — sem problema."},
    {"channel":"whatsapp","delay_days":3,"subject":"","body":"{{primeiro_nome}}, vou parar de te escrever pra não incomodar. Se um dia quiser retomar, é só responder aqui neste número. Obrigado pela atenção e sucesso à {{empresa}}!"}
  ]$json$::jsonb,
  true
);

commit;
