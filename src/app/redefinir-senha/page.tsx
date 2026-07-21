"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Destino do link de recuperação enviado por e-mail. O cliente Supabase detecta o
// token de recuperação na URL automaticamente e cria uma sessão temporária; aqui o
// usuário só define a nova senha (updateUser).
export default function RedefinirSenha() {
  const router = useRouter();
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  // aguarda o evento de recuperação (o token vem no hash da URL do e-mail)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // caso a sessão já esteja pronta (token processado antes do listener)
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function salvar() {
    setMsg(null);
    if (pass.length < 6) { setMsg("A senha precisa ter ao menos 6 caracteres."); return; }
    if (pass !== pass2) { setMsg("As senhas não conferem."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setLoading(false);
    if (error) { setMsg(error.message); return; }
    setOk(true);
    setTimeout(() => router.push("/dashboard"), 1200);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="card w-full max-w-sm p-8">
        <p className="font-display text-2xl font-bold text-ink">
          Contat<span className="text-brand">ia</span>
        </p>
        <p className="mt-1 text-sm text-subtle">Defina sua nova senha</p>

        {ok ? (
          <p className="mt-6 rounded-lg bg-signal/10 p-3 text-sm text-signal">✓ Senha alterada! Entrando…</p>
        ) : !ready ? (
          <div className="mt-6 space-y-2">
            <p className="text-sm text-subtle">Validando seu link de recuperação…</p>
            <p className="text-xs text-subtle">Se demorar, o link pode ter expirado. <a href="/login" className="text-brand hover:underline">Peça um novo</a>.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div>
              <label className="label">Nova senha</label>
              <input className="input mt-1" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className="label">Repita a nova senha</label>
              <input className="input mt-1" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="••••••••" onKeyDown={(e) => { if (e.key === "Enter") salvar(); }} />
            </div>
            {msg && <p className="text-sm text-danger">{msg}</p>}
            <button className="btn-brand w-full" onClick={salvar} disabled={loading}>{loading ? "..." : "Salvar nova senha"}</button>
          </div>
        )}
      </div>
    </main>
  );
}
