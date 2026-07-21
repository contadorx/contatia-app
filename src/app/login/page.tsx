"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setupWorkspace } from "@/app/dashboard/setup-actions";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setMsg(null);
    if (mode === "reset") {
      if (!email.trim()) { setMsg("Informe seu e-mail."); setLoading(false); return; }
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      // não revelamos se o e-mail existe (segurança) — mensagem sempre igual
      setMsg(error ? error.message : "Se este e-mail tiver conta, enviamos um link para redefinir a senha. Confira sua caixa (e o spam).");
      setLoading(false);
      return;
    }
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else {
        const next = new URLSearchParams(window.location.search).get("next");
        router.push(next || "/dashboard");
      }
    } else {
      if (!fullName.trim() || !company.trim()) {
        setMsg("Informe seu nome e o nome da empresa.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim(), company: company.trim() } },
      });
      if (error) {
        setMsg(error.message);
      } else if (data.session) {
        // cadastro com sessão (confirmação de e-mail desligada): cria o workspace e entra
        await setupWorkspace(company.trim());
        const next = new URLSearchParams(window.location.search).get("next");
        router.push(next || "/dashboard");
      } else {
        // confirmação de e-mail ligada: cria o workspace quando ela entrar (a tela do
        // dashboard oferece criar caso não exista)
        setMsg("Conta criada! Confirme o e-mail e depois entre — aí configuramos seu workspace.");
      }
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6">
          <p className="font-display text-2xl font-bold text-ink">
            Contat<span className="text-brand">ia</span>
          </p>
          <p className="mt-1 text-sm text-subtle">
            {mode === "in" ? "Entre na sua conta" : mode === "up" ? "Crie sua conta" : "Recuperar senha"}
          </p>
        </div>

        <div className="space-y-3">
          {mode === "up" && (
            <>
              <div>
                <label className="label">Seu nome</label>
                <input
                  className="input mt-1"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Maria Silva"
                />
              </div>
              <div>
                <label className="label">Nome da empresa</label>
                <input
                  className="input mt-1"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Agência Nova"
                />
                <p className="mt-1 text-xs text-subtle">Será o nome do seu workspace. Dá pra mudar depois.</p>
              </div>
            </>
          )}
          <div>
            <label className="label">E-mail</label>
            <input
              className="input mt-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@suaempresa.com.br"
            />
          </div>
          {mode !== "reset" && (
            <div>
              <label className="label">Senha</label>
              <input
                className="input mt-1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              {mode === "in" && (
                <button type="button" className="mt-1 text-xs text-subtle hover:text-brand" onClick={() => { setMode("reset"); setMsg(null); }}>
                  Esqueci minha senha
                </button>
              )}
            </div>
          )}
          {mode === "reset" && (
            <p className="text-xs text-subtle">Digite o e-mail da sua conta e enviaremos um link para criar uma senha nova.</p>
          )}

          {msg && <p className={`text-sm ${mode === "reset" ? "text-ink" : "text-danger"}`}>{msg}</p>}

          <button className="btn-brand w-full" onClick={submit} disabled={loading}>
            {loading ? "..." : mode === "in" ? "Entrar" : mode === "up" ? "Criar conta" : "Enviar link de recuperação"}
          </button>
        </div>

        {mode === "reset" ? (
          <button className="mt-4 w-full text-center text-sm text-subtle hover:text-brand" onClick={() => { setMode("in"); setMsg(null); }}>
            ← Voltar ao login
          </button>
        ) : (
          <button
            className="mt-4 w-full text-center text-sm text-subtle hover:text-brand"
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}
          >
            {mode === "in" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
          </button>
        )}
      </div>
    </main>
  );
}
