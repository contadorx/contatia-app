"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { acceptInvite } from "@/app/convite/[token]/actions";

// Tela de "defina sua senha e entre" para quem abre o link de convite SEM conta.
// Cria a conta com o e-mail do convite (não pede empresa — ela entra num workspace
// existente) e já aceita o convite. Se a confirmação de e-mail estiver ligada no
// Supabase, avisa para confirmar e voltar ao link.
export default function JoinInviteForm({ token, email, tenantName }: { token: string; email: string; tenantName: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    setMsg(null);
    if (!fullName.trim()) return setMsg("Informe seu nome.");
    if (password.length < 6) return setMsg("A senha precisa de ao menos 6 caracteres.");
    start(async () => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (error) {
        setMsg(/registered|already/i.test(error.message)
          ? "Este e-mail já tem uma conta. Use “Entrar” abaixo para aceitar o convite."
          : error.message);
        return;
      }
      if (data.session) {
        const r = (await acceptInvite(token)) as any;
        if (r?.error) { setMsg(r.error); return; }
        router.push("/dashboard");
      } else {
        // confirmação de e-mail ligada no Supabase: ainda não há sessão
        setNeedConfirm(true);
      }
    });
  }

  if (needConfirm) {
    return (
      <div className="mt-4">
        <p className="text-sm font-semibold text-signal">Quase lá!</p>
        <p className="mt-1 text-sm text-subtle">
          Enviamos um e-mail de confirmação para <b className="text-ink">{email}</b>. Confirme e depois
          abra este mesmo link de convite novamente para entrar no workspace.
        </p>
        <p className="mt-2 text-xs text-subtle">
          Se você já tinha conta com este e-mail, use{" "}
          <Link className="text-brand hover:underline" href={`/login?next=/convite/${token}`}>Entrar</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-subtle">
        Você foi convidado para o workspace <b className="text-ink">{tenantName}</b>. Defina sua senha para entrar.
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <label className="label">E-mail</label>
          <input className="input mt-1 bg-muted" value={email} readOnly />
        </div>
        <div>
          <label className="label">Seu nome</label>
          <input className="input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Maria Silva" />
        </div>
        <div>
          <label className="label">Crie uma senha</label>
          <input type="password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {msg && <p className="text-sm text-danger">{msg}</p>}
        <button className="btn-brand w-full" onClick={submit} disabled={pending}>
          {pending ? "..." : "Definir senha e entrar"}
        </button>
        <p className="text-center text-xs text-subtle">
          Já tem conta?{" "}
          <Link className="text-brand hover:underline" href={`/login?next=/convite/${token}`}>Entrar</Link>
        </p>
      </div>
    </div>
  );
}
