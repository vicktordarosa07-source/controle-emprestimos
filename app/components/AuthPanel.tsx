"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

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
    const onlyPhoneDigits = fone.replace(/\D/g, "");

    setError(null);
    setMessage(null);

    if (mode === "signup" && (onlyPhoneDigits.length < 10 || onlyPhoneDigits.length > 15)) {
      setError("Informe um fone valido com DDD.");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: {
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
        setMessage("Cadastro criado. Se o Supabase pedir confirmação de e-mail, confirme antes de entrar.");
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
    <main className="grid min-h-screen place-items-center bg-gray-50 px-4">
      <section className="w-full max-w-md border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-950">
            Controle de Empréstimos
          </h1>
          <p className="mt-2 text-sm font-medium text-gray-600">
            {mode === "login"
              ? "Entre para acessar os clientes, parcelas e pagamentos."
              : "Crie seu acesso para usar o controle de empréstimos."}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 border border-gray-300 p-1">
          <button
            type="button"
            onClick={() => changeMode("login")}
            className={
              mode === "login"
                ? "min-h-10 bg-gray-950 px-3 text-sm font-bold text-white"
                : "min-h-10 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
            }
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => changeMode("signup")}
            className={
              mode === "signup"
                ? "min-h-10 bg-gray-950 px-3 text-sm font-bold text-white"
                : "min-h-10 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
            }
          >
            Cadastrar
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error ? (
            <div className="border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
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
                Fone
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

          <button
            disabled={isPending}
            className="min-h-11 w-full bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
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
