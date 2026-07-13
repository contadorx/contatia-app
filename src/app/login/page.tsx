"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setupWorkspace } from "@/app/dashboard/setup-actions";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setMsg(null);
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
            {mode === "in" ? "Entre na sua conta" : "Crie sua conta"}
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
          <div>
            <label className="label">Senha</label>
            <input
              className="input mt-1"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {msg && <p className="text-sm text-danger">{msg}</p>}

          <button className="btn-brand w-full" onClick={submit} disabled={loading}>
            {loading ? "..." : mode === "in" ? "Entrar" : "Criar conta"}
          </button>
        </div>

        <button
          className="mt-4 w-full text-center text-sm text-subtle hover:text-brand"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setMsg(null);
          }}
        >
          {mode === "in" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </div>
    </main>
  );
}
