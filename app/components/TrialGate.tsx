"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import nextDynamic from "next/dynamic";
import { ativarTesteSaaS } from "@/app/actions";
import { TRIAL_DAYS, type TrialGateMode } from "@/lib/trial";
import { SignOutButton } from "./AuthPanel";

const SubscriptionPanel = nextDynamic(
  () => import("./SubscriptionPanel").then((module) => module.SubscriptionPanel),
  { loading: () => <p role="status" className="p-5 text-sm text-slate-500">Carregando formas de pagamento…</p> },
);

type Props = { mode: Exclude<TrialGateMode, null>; email: string };

export function TrialGate({ mode, email }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function activate() {
    setError("");
    startTransition(async () => {
      try {
        await ativarTesteSaaS();
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Não foi possível iniciar o teste.");
      }
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-lg font-extrabold text-slate-950">Recebify</p><p className="text-sm text-slate-500">{email}</p></div>
          <SignOutButton />
        </header>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft sm:p-10">
          <div aria-hidden="true" className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          </div>
          {mode === "pending" ? (
            <>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Seu acesso está pronto</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Ative {TRIAL_DAYS} dias grátis para começar</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">O prazo só começa quando você ativar o teste. Durante {TRIAL_DAYS} dias, use as ferramentas do Recebify sem pagar. Depois, o uso fica pausado até você escolher um plano e confirmar o pagamento.</p>
              <p className="mt-3 text-sm font-semibold text-slate-700">Sem cobrança automática ao fim do teste.</p>
              <button type="button" disabled={pending} onClick={activate} className="mt-6 min-h-12 rounded-xl bg-blue-700 px-6 font-bold text-white hover:bg-blue-800 disabled:opacity-60">{pending ? "Ativando…" : `Ativar meus ${TRIAL_DAYS} dias grátis`}</button>
            </>
          ) : mode === "unavailable" ? (
            <>
              <h1 className="text-2xl font-extrabold text-slate-950">Não foi possível confirmar seu acesso</h1>
              <p className="mt-3 text-sm text-slate-600">Por segurança, o sistema está temporariamente pausado. Atualize a página em instantes; se continuar, fale com o suporte.</p>
              <button type="button" onClick={() => router.refresh()} className="mt-6 min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white">Tentar novamente</button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold text-slate-950">{mode === "expired" ? "Seus 7 dias de teste terminaram" : "Seu acesso está pausado"}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">Suas cobranças continuam guardadas. Para voltar a usar o Recebify, escolha a forma de pagamento abaixo. O acesso é liberado após a confirmação pelo Asaas.</p>
              <a href="/api/export?formato=json" className="mt-4 inline-block text-sm font-semibold text-blue-700 underline">Baixar uma cópia dos meus dados</a>
            </>
          )}
          {error ? <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p> : null}
        </section>
        {mode === "expired" || mode === "payment" ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft"><SubscriptionPanel /></div> : null}
      </div>
    </main>
  );
}
