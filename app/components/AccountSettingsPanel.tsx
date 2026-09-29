"use client";

import { useRef, useState, useTransition } from "react";
import { atualizarConta, atualizarPreferenciasEmail } from "@/app/actions";
import { MfaPanel } from "./MfaPanel";
import { BackupRestoreForm } from "./BackupRestoreForm";
import { SubscriptionPanel } from "./SubscriptionPanel";

type Props = {
  email: string;
  fone: string;
  emailRemindersEnabled: boolean;
};

export function AccountSettingsPanel({ email, fone, emailRemindersEnabled }: Props) {
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
    <div className="space-y-4">
      <section id="dados-da-conta" className="settings-section scroll-mt-24 border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-4">
        <h3 className="font-bold text-gray-950">Dados da conta</h3>
        <p className="mt-1 text-sm text-gray-600">Atualize suas informações de acesso e contato.</p>
      </div>
      <form ref={formRef} action={handleAction} className="space-y-4 p-4">
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
      </section>

      <section id="lembretes-email" className="settings-section scroll-mt-24 border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-gray-950">Resumo diário por e-mail</h3>
        <p className="mt-1 text-sm text-gray-600">Enviado para {email}; inclui cobranças vencidas e próximas. O envio só funciona após configurar Resend e o cron da Vercel.</p>
        <form action={atualizarPreferenciasEmail} className="mt-3 flex items-center justify-between gap-4">
          <label className="flex items-start gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" name="email_reminders_enabled" defaultChecked={emailRemindersEnabled} className="mt-1 size-4" />
            Quero receber o resumo diário
          </label>
          <button className="min-h-10 bg-gray-950 px-4 text-sm font-bold text-white">Salvar preferência</button>
        </form>
      </section>

      <div id="assinatura" className="settings-section scroll-mt-24 border border-gray-200 bg-white shadow-sm"><SubscriptionPanel /></div>

      <section id="seguranca" className="settings-section scroll-mt-24 border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-gray-950">Autenticação em duas etapas</h3>
        <p className="mt-1 text-sm text-gray-600">Configure um aplicativo autenticador (TOTP). O desafio será solicitado nas próximas sessões.</p>
        <div className="mt-3"><MfaPanel /></div>
      </section>

      <section id="backup" className="settings-section scroll-mt-24 border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-gray-950">Restaurar backup</h3>
        <p className="mt-1 text-sm text-amber-800">A restauração não sobrescreve registros: qualquer ID já existente cancela toda a operação. Faça isso de preferência em uma conta vazia.</p>
        <BackupRestoreForm />
      </section>
    </div>
  );
}
