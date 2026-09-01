"use client";

import { useRef, useState, useTransition } from "react";
import { atualizarConta } from "@/app/actions";

type Props = {
  email: string;
  fone: string;
};

export function AccountSettingsPanel({ email, fone }: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleAction(formData: FormData) {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        const result = await atualizarConta(formData);
        setMessage(result);
        formRef.current?.reset();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <details className="border border-gray-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none p-4 marker:hidden">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-gray-950">Configuração de conta</h2>
          <span className="text-sm font-semibold text-gray-500">
            E-mail, telefone e senha
          </span>
        </div>
      </summary>

      <form ref={formRef} action={handleAction} className="space-y-4 border-t border-gray-200 p-4">
        {error ? (
          <div className="border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
              E-mail
            </label>
            <input
              name="email"
              type="email"
              required
              defaultValue={email}
              autoComplete="email"
              className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
              Número de telefone
            </label>
            <input
              name="fone"
              type="tel"
              required
              defaultValue={fone}
              autoComplete="tel"
              placeholder="(00) 00000-0000"
              className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
              Nova senha
            </label>
            <input
              name="password"
              type="password"
              minLength={6}
              autoComplete="new-password"
              placeholder="Deixe em branco para manter"
              className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
              Repetir nova senha
            </label>
            <input
              name="confirm_password"
              type="password"
              minLength={6}
              autoComplete="new-password"
              placeholder="Repita apenas se alterar"
              className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            disabled={isPending}
            className="min-h-11 border border-blue-700 bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {isPending ? "Salvando..." : "Salvar configuração"}
          </button>
        </div>
      </form>
    </details>
  );
}
