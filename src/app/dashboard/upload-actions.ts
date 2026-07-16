"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Upload de imagem de marca (logo + imagens da assinatura/e-mail) para o bucket
// PÚBLICO 'brand'. Retorna a URL pública, que é o que entra no <img> do e-mail.
// Feito com a service role (bypassa RLS) — mas só depois de autenticar o usuário
// e validar tipo + tamanho.

const MAX_BYTES = 512 * 1024; // 512 KB
const TIPOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function uploadBrandImage(
  form: FormData
): Promise<{ url?: string; error?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada — recarregue e tente de novo." };

  const { data: prof } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  const tenantId = (prof as any)?.tenant_id as string | undefined;
  if (!tenantId) return { error: "Sem workspace." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Nenhum arquivo recebido." };

  const ext = TIPOS[file.type];
  if (!ext) return { error: "Formato não suportado. Use PNG, JPG, GIF, WEBP ou SVG." };
  if (file.size > MAX_BYTES)
    return { error: `Imagem muito grande (${Math.round(file.size / 1024)} KB). O limite é 512 KB.` };

  const admin = createAdminClient();
  if (!admin) return { error: "Upload indisponível (configuração do servidor)." };

  const kindRaw = (form.get("kind") as string) || "img";
  const kind = kindRaw.replace(/[^a-z0-9]/gi, "").slice(0, 12) || "img";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${tenantId}/${kind}-${Date.now()}-${rand}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from("brand").upload(path, bytes, {
    contentType: file.type,
    upsert: true,
    cacheControl: "31536000",
  });
  if (upErr)
    return { error: "Falha no upload: " + upErr.message + " (o bucket 'brand' foi criado no Supabase?)" };

  const { data } = admin.storage.from("brand").getPublicUrl(path);
  if (!data?.publicUrl) return { error: "Não foi possível obter o link público da imagem." };
  return { url: data.publicUrl };
}
