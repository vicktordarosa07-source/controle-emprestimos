"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const AUTH_CONFIRM_REDIRECT_URL =
  `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://credcash.vercel.app"}/auth/confirm`;

const AUTH_BENEFITS = [
  { label: "Veja cobranças em aberto, vencidas e pagas.", icon: "ledger" },
  { label: "Registre pagamentos parciais e consulte o histórico.", icon: "payment" },
  { label: "Exporte seus relatórios e mantenha uma cópia dos dados.", icon: "chart" },
] as const;

function AuthBenefitIcon({ icon }: { icon: (typeof AUTH_BENEFITS)[number]["icon"] }) {
  return (
    <span className="auth-benefit-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" focusable="false">
        {icon === "ledger" ? <>
          <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </> : icon === "payment" ? <>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="M4 9.5h16" />
        </> : <>
          <path className="auth-benefit-chart-base" d="M4 20h17" />
          <path className="auth-benefit-chart-bar" d="M6 18v-5h3v5zM11 18V9h3v9zM16 18V5h3v13z" />
        </>}
      </svg>
    </span>
  );
}

export function AuthPanel() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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

    if (mode === "recover") {
      const redirectTo = `${AUTH_CONFIRM_REDIRECT_URL}?next=${encodeURIComponent("/auth/redefinir-senha")}`;
      startTransition(async () => {
        const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (recoveryError) {
          setError("Não foi possível enviar o link agora. Confira o e-mail e tente novamente.");
          return;
        }
        setMessage("Se houver uma conta com esse e-mail, enviaremos instruções para redefinir a senha.");
      });
      return;
    }

    if (mode === "signup" && password.length < 8) {
      setError("Crie uma senha com pelo menos 8 caracteres.");
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

  function changeMode(nextMode: "login" | "signup" | "recover") {
    setMode(nextMode);
    setError(null);
    setMessage(null);
    setShowPassword(false);
  }

  return (
    <main className="auth-shell auth-login-shell">
      <section className="auth-layout">
        <div className="auth-intro">
          <div className="auth-brand">
            <span className="auth-brand-name">CredCash</span>
            <span className="auth-brand-rule" aria-hidden="true" />
          </div>
          <div className="auth-copy">
            <h1>{mode === "login" ? "Acesse sua conta" : mode === "signup" ? "Crie seu acesso" : "Redefina sua senha"}</h1>
            <p>
            {mode === "login"
              ? "Organize cobranças, parcelas e recebimentos em um só lugar."
              : mode === "signup"
                ? "Crie seu acesso para acompanhar vencimentos e pagamentos."
                : "Informe seu e-mail e enviaremos um link seguro para criar outra senha."}
            </p>
          </div>
          {mode !== "recover" ? <ul className="auth-benefits" aria-label="Recursos do CredCash">
            {AUTH_BENEFITS.map((benefit) => <li key={benefit.label}>
              <AuthBenefitIcon icon={benefit.icon} />
              <span>{benefit.label}</span>
            </li>)}
          </ul> : null}
        </div>

        <div className="auth-form-side">
          <div className="auth-form-card">
        {mode !== "recover" ? <div className="auth-tabs mb-10" role="group" aria-label="Acesso à conta">
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
        </div> : null}

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
              placeholder="seu@email.com"
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

          {mode !== "recover" ? <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="password">
              Senha
            </label>
            <div className="auth-password-control">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="min-h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
              >
                {showPassword ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7" /><path d="M9.9 5.3A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9.5 6.3a1.4 1.4 0 0 1 0 1.4 15 15 0 0 1-3.1 3.6M6.2 6.3a15.3 15.3 0 0 0-3.7 5 1.4 1.4 0 0 0 0 1.4C3.5 14.5 7 19 12 19c1.4 0 2.7-.4 3.8-1" /></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>}
              </button>
            </div>
          </div> : null}

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
                minLength={8}
                autoComplete="new-password"
                className="min-h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          ) : null}

          <button
            disabled={isPending}
            className="auth-primary-button min-h-12 w-full bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {isPending
              ? mode === "signup"
                ? "Cadastrando..."
                : mode === "recover" ? "Enviando..." : "Entrando..."
              : mode === "signup"
                ? "Cadastrar"
                : mode === "recover" ? "Enviar link de redefinição" : "Entrar"}
          </button>
        </form>
        <div className="auth-form-footer">
          {mode === "login" ? <button type="button" onClick={() => changeMode("recover")} className="auth-forgot-link">Esqueci minha senha</button> : mode === "recover" ? <button type="button" onClick={() => changeMode("login")} className="auth-forgot-link">Voltar para entrar</button> : null}
        </div>
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
