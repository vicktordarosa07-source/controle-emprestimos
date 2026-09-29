"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const AUTH_CONFIRM_REDIRECT_URL =
  `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://recebify.vercel.app"}/auth/confirm`;

export function AuthPanel() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const fone = String(formData.get("fone") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");
    const onlyPhoneDigits = fone.replace(/\D/g, "");

    setError(null);
    setMessage(null);

    if (mode === "signup" && (onlyPhoneDigits.length < 10 || onlyPhoneDigits.length > 15)) {
      setError("Informe um telefone válido com DDD.");
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("As senhas digitadas não conferem.");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: AUTH_CONFIRM_REDIRECT_URL,
                data: {
                  fone,
                },
              },
            })
          : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setError(result.error.message);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Cadastro criado. Confirme seu e-mail para entrar.");
        return;
      }

      router.refresh();
    });
  }

  function changeMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  return (
    <main className="auth-shell">
      <section className="auth-layout">
        <div className="auth-intro">
          <div className="auth-brand">
            <span aria-hidden="true" className="auth-brand-mark">R</span>
            <span className="auth-brand-name">Recebify</span>
          </div>
          <div className="auth-copy">
            <h1>{mode === "login" ? "Acesse sua conta" : "Crie seu acesso"}</h1>
            <p>
            {mode === "login"
              ? "Entre para gerenciar clientes, cobranças e pagamentos."
              : "Crie seu acesso para organizar cobranças e vencimentos."}
            </p>
          </div>
          <div className="auth-aside-line" aria-hidden="true" />
        </div>

        <div className="auth-form-side">
          <div className="auth-form-card">
        <div className="auth-tabs mb-6">
          <button
            type="button"
            onClick={() => changeMode("login")}
            aria-pressed={mode === "login"}
            className={
              mode === "login"
                ? "min-h-10 px-3 text-sm font-bold text-gray-900"
                : "min-h-10 px-3 text-sm font-bold text-gray-600 hover:bg-white/70"
            }
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => changeMode("signup")}
            aria-pressed={mode === "signup"}
            className={
              mode === "signup"
                ? "min-h-10 px-3 text-sm font-bold text-gray-900"
                : "min-h-10 px-3 text-sm font-bold text-gray-600 hover:bg-white/70"
            }
          >
            Cadastrar
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {error}
            </div>
          ) : null}
          {message ? (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
              {message}
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="min-h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {mode === "signup" ? (
            <div>
              <label className="mb-1 block text-sm font-semibold" htmlFor="fone">
                Telefone
              </label>
              <input
                id="fone"
                name="fone"
                type="tel"
                required
                minLength={10}
                maxLength={20}
                autoComplete="tel"
                placeholder="Ex: (11) 99999-9999"
                className="min-h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="min-h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {mode === "signup" ? (
            <div>
              <label className="mb-1 block text-sm font-semibold" htmlFor="confirm_password">
                Repetir senha
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className="min-h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          ) : null}

          <button
            disabled={isPending}
            className="min-h-12 w-full rounded-xl bg-blue-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"
          >
            {isPending
              ? mode === "signup"
                ? "Cadastrando..."
                : "Entrando..."
              : mode === "signup"
                ? "Cadastrar"
                : "Entrar"}
          </button>
        </form>
          </div>
        </div>
      </section>
    </main>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await supabase.auth.signOut();
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {isPending ? "Saindo..." : "Sair"}
    </button>
  );
}
