"use client";

import { useEffect, useState, useTransition } from "react";
import { assinarPlanoFluxo, cancelarAssinaturaFluxo, obterAssinaturaSaaS } from "@/app/actions";

type BillingState = Awaited<ReturnType<typeof obterAssinaturaSaaS>>;

export function SubscriptionPanel() {
  const [state, setState] = useState<BillingState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void obterAssinaturaSaaS().then((value) => { if (active) setState(value); });
    return () => { active = false; };
  }, []);

  function subscribe(formData: FormData) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const live = state?.environment === "production";
        if (live && !window.confirm("Isto criará uma assinatura real do Recebify e poderá gerar cobranças recorrentes. Continuar?")) return;
        const result = await assinarPlanoFluxo(formData, live);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setMessage(`Plano ${result.plan} agendado para ${new Date(`${result.nextDueDate}T12:00:00`).toLocaleDateString("pt-BR")} (${result.environment}). A confirmação de pagamento depende do webhook do Asaas.`);
        const updated = await obterAssinaturaSaaS();
        setState(updated);
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  function cancelSubscription() {
    if (!window.confirm("Cancelar a recorrência do Recebify no Asaas? Cobranças futuras serão interrompidas; pagamentos já recebidos não são estornados.")) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await cancelarAssinaturaFluxo();
        setMessage("Assinatura cancelada no Asaas.");
        setState(await obterAssinaturaSaaS());
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  if (!state) return <section className="border-t border-gray-200 p-4 text-sm text-gray-500">Carregando assinatura…</section>;
  const sub = state.subscription as { plan_key: string; status: string; trial_ends_at: string | null; period_ends_at: string | null; asaas_subscription_id: string | null } | null;
  const expires = sub?.trial_ends_at ?? sub?.period_ends_at;

  return (
    <section className="border-t border-gray-200 p-4">
      <h3 className="font-bold text-gray-950">Plano e assinatura do Recebify</h3>
      {!state.configured ? (
        <p className="mt-2 text-sm text-amber-800">A migração de assinatura ainda não foi aplicada no Supabase.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-700">Status: <strong>{sub?.status ?? "período de avaliação"}</strong>{expires ? ` • até ${new Date(expires).toLocaleDateString("pt-BR")}` : ""}</p>
          <p className="mt-1 text-xs text-gray-600">Trial de 14 dias. Acesso não é bloqueado automaticamente; limites e bloqueio permanecem desativados até configurar e testar a política comercial.</p>
          {!state.billingConfigured ? <p role="status" className="mt-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Assinaturas indisponíveis: falta configurar a chave da plataforma e o token do webhook Asaas na Vercel. Nenhum pagamento será criado até concluir essa configuração.</p> : null}
          {state.environment === "production" && !state.liveBillingEnabled ? <p role="status" className="mt-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Cobranças reais estão bloqueadas até os testes no Sandbox serem concluídos.</p> : null}
          {sub?.asaas_subscription_id && sub.status !== "canceled" ? <button type="button" disabled={pending} onClick={cancelSubscription} className="mt-2 min-h-9 border border-red-300 px-3 text-sm font-bold text-red-800 disabled:opacity-50">Cancelar assinatura</button> : null}
          <div className="mt-3 grid max-w-xl gap-3">
            {state.plans.map((plan) => (
              <form key={plan.key} action={subscribe} className="space-y-2 border border-gray-200 p-3">
                <input type="hidden" name="plan_key" value={plan.key} />
                <p className="font-bold text-gray-950">{plan.name}</p>
                <p className="text-sm text-gray-600">{plan.price === null ? "Preço ainda não configurado" : `${plan.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / mês`}</p>
                <p className="text-xs text-gray-500">Um plano simples para começar. Cancele quando quiser.</p>
                <label className="block text-sm font-medium text-gray-700" htmlFor={`cpf-cnpj-${plan.key}`}>CPF ou CNPJ do titular</label>
                <input id={`cpf-cnpj-${plan.key}`} name="cpfCnpj" autoComplete="off" required maxLength={18} placeholder="Digite o CPF ou CNPJ" className="min-h-10 w-full border border-gray-300 px-3 text-sm" aria-describedby={`cpf-cnpj-help-${plan.key}`} />
                <p id={`cpf-cnpj-help-${plan.key}`} className="text-xs text-gray-500">Necessário para o Asaas emitir a cobrança. O Recebify não armazena o documento.</p>
                <button disabled={pending || !state.billingConfigured || plan.price === null || Boolean(sub?.asaas_subscription_id && sub.status !== "canceled")} className="min-h-10 bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Processando…" : sub?.asaas_subscription_id ? "Assinatura em andamento" : "Assinar"}</button>
              </form>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">Para conciliar pagamentos, configure no Asaas o webhook <code>{process.env.NEXT_PUBLIC_SITE_URL ?? "https://recebify.vercel.app"}/api/webhooks/asaas-plataforma</code> com o token guardado em <code>ASAAS_PLATFORM_WEBHOOK_TOKEN</code> na Vercel.</p>
        </>
      )}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-2 text-sm font-semibold text-emerald-700">{message}</p> : null}
    </section>
  );
}
