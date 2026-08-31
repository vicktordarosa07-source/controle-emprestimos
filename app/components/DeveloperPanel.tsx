"use client";

import { useRef, useState, useTransition } from "react";
import { gerarConviteCadastro } from "@/app/actions";

type SignupInvite = {
  id: string;
  email: string;
  used_at: string | null;
  created_at: string;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export function DeveloperPanel({ invites }: { invites: SignupInvite[] }) {
  const [isPending, startTransition] = useTransition();
  const [generatedLink, setGeneratedLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleAction(formData: FormData) {
    setError(null);
    setGeneratedLink("");

    startTransition(async () => {
      try {
        const link = await gerarConviteCadastro(formData);
        setGeneratedLink(link);
        formRef.current?.reset();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <details className="border border-gray-950 bg-white shadow-sm">
      <summary className="cursor-pointer list-none p-4 marker:hidden">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-gray-950">Developer</h2>
          <span className="text-sm font-semibold text-gray-500">
            Convites de cadastro
          </span>
        </div>
      </summary>

      <div className="space-y-4 border-t border-gray-200 p-4">
        <form ref={formRef} action={handleAction} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                E-mail autorizado
              </label>
              <input
                name="email"
                type="email"
                required
                placeholder="usuario@email.com"
                className="mt-1 min-h-11 w-full border border-gray-300 px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <button
              disabled={isPending}
              className="min-h-11 self-end border border-gray-950 bg-gray-950 px-5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? "Gerando..." : "Gerar link único"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        {generatedLink ? (
          <div className="space-y-2 border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-bold text-emerald-900">
              Link único gerado
            </p>
            <input
              readOnly
              value={generatedLink}
              className="min-h-10 w-full border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-950"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}

        <div className="overflow-hidden border border-gray-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-gray-100 text-xs font-bold uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {invites.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-gray-500" colSpan={3}>
                    Nenhum convite gerado.
                  </td>
                </tr>
              ) : (
                invites.map((invite) => (
                  <tr key={invite.id}>
                    <td className="px-3 py-2 font-semibold text-gray-950">
                      {invite.email}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          invite.used_at
                            ? "font-bold text-emerald-700"
                            : "font-bold text-blue-700"
                        }
                      >
                        {invite.used_at ? "Usado" : "Disponivel"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {formatDateTime(invite.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
