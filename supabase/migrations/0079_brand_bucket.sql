-- Bucket PÚBLICO para imagens de marca (logo + imagens da assinatura de e-mail).
-- Precisa ser público porque o e-mail é aberto FORA do app: o cliente de e-mail
-- (Gmail, Outlook) busca a imagem por uma URL pública. Imagem embutida (base64)
-- é bloqueada pela maioria dos clientes — por isso hospedamos aqui.
--
-- Limite de 512 KB por arquivo e só imagens. O upload em si é feito pelo app com
-- a service role (server action), então não precisamos de policies de escrita —
-- a leitura pública vem de o bucket ser public = true.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand',
  'brand',
  true,
  524288, -- 512 KB
  array['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
