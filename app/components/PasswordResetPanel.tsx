"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function PasswordResetPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirm_password") ?? "");

    setError("");
    setSaved(false);
    if (password.length < 8) {
      setError("Use pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas digitadas não conferem.");
      return;
    }

    startTransition(async () => {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("O link pode ter expirado. Solicite uma nova redefinição de senha.");
        return;
      }
      setSaved(true);
    });
  }

  return (
    <main className="auth-shell grid min-h-screen place-items-center px-4 py-8">
      <section className="w-full max-w-md border border-gray-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="auth-brand mb-6"><span aria-hidden="true" className="auth-brand-mark">C</span><span className="auth-brand-name">CredCash</span></div>
        <h1 className="text-2xl font-bold text-gray-950">Crie uma nova senha</h1>
        <p className="mt-2 text-sm text-gray-600">Escolha uma senha com pelo menos 8 caracteres.</p>
        {saved ? <>
          <p role="status" className="mt-5 border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Senha atualizada. Você já pode entrar no CredCash.</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 w-full items-center justify-center bg-blue-700 px-4 text-sm font-bold text-white">Ir para o CredCash</Link>
        </> : <form onSubmit={submit} className="mt-5 space-y-4">
          {error ? <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
          <label className="block text-sm font-semibold text-gray-800">Nova senha
            <input name="password" type="password" autoComplete="new-password" minLength={8} required className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold text-gray-800">Repita a nova senha
            <input name="confirm_password" type="password" autoComplete="new-password" minLength={8} required className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm" />
          </label>
          <button disabled={pending} className="min-h-11 w-full bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Salvando…" : "Salvar nova senha"}</button>
        </form>}
      </section>
    </main>
  );
}
