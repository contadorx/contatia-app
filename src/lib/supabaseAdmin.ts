import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client com SERVICE ROLE — bypassa RLS. USAR SÓ em rotas públicas controladas
// (ex.: rastreio de abertura por token). NUNCA expor no client.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
