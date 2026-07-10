-- ============================================================
-- Contatia — Migration 0014 (Biblioteca de templates de cadência)
-- Templates reutilizáveis por ICP. Roda depois de 0001-0013. Non-breaking.
-- ============================================================

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

alter table public.sequence_templates enable row level security;

-- vê os templates do próprio tenant + os globais; escreve só nos do tenant
create policy seq_templates_select on public.sequence_templates for select
  using (is_global = true or tenant_id = public.current_tenant_id());
create policy seq_templates_write on public.sequence_templates for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------- Sementes globais (cadências prontas por ICP) ----------
insert into public.sequence_templates (name, audience, description, steps, is_global)
values
(
  'Prospecção consultiva (5 toques)',
  'Decisor B2B — dono/diretor',
  'Abertura por valor, prova, quebra de objeção e despedida. Multicanal.',
  '[
    {"channel":"email","delay_days":0,"subject":"Uma ideia para {{empresa}}","body":"Olá {{primeiro_nome}}, vi que a {{empresa}} pode estar deixando dinheiro na mesa em [processo]. Ajudamos empresas parecidas a [resultado]. Faz sentido uma conversa de 15 min esta semana?"},
    {"channel":"whatsapp","delay_days":2,"subject":"","body":"{{primeiro_nome}}, te mandei um e-mail sobre [tema]. Consegue dar uma olhada? Posso resumir em 2 linhas se preferir."},
    {"channel":"email","delay_days":4,"subject":"Como a [empresa similar] resolveu isso","body":"{{primeiro_nome}}, um caso rápido: a [empresa similar] tinha o mesmo desafio e [resultado breve]. Quer que eu mostre como aplicaria na {{empresa}}?"},
    {"channel":"linkedin","delay_days":7,"subject":"","body":"Conexão + nota curta: {{primeiro_nome}}, acompanho o trabalho da {{empresa}} e acho que teríamos uma boa conversa sobre [tema]."},
    {"channel":"email","delay_days":10,"subject":"Fecho o assunto?","body":"{{primeiro_nome}}, imagino que a prioridade agora seja outra — sem problema. Se fizer sentido retomar [tema] mais pra frente, é só me chamar. Abraço."}
  ]'::jsonb,
  true
),
(
  'Reengajamento (3 toques)',
  'Lead que esfriou',
  'Retomada leve de um contato que não respondeu, com novo ângulo.',
  '[
    {"channel":"email","delay_days":0,"subject":"Voltando ao assunto, {{primeiro_nome}}","body":"Oi {{primeiro_nome}}, sei que a rotina corre. Retomo aqui porque [novo gatilho/novidade] pode ser relevante pra {{empresa}}. Vale 10 min?"},
    {"channel":"whatsapp","delay_days":3,"subject":"","body":"{{primeiro_nome}}, ainda faz sentido falarmos sobre [tema]? Se não for o momento, me diz que eu te retiro da lista de follow-up."},
    {"channel":"email","delay_days":6,"subject":"Último toque","body":"{{primeiro_nome}}, encerro por aqui pra não incomodar. Deixo meu contato — quando [tema] voltar ao radar da {{empresa}}, é só chamar."}
  ]'::jsonb,
  true
);
