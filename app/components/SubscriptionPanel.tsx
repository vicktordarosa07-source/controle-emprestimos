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
        if (live && !window.confirm("Você será redirecionado ao checkout seguro do Asaas para informar o cartão e autorizar uma assinatura mensal real. Continuar?")) return;
        const result = await assinarPlanoFluxo(formData, live);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        window.location.assign(result.checkoutUrl);
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  function cancelSubscription() {
    if (!window.confirm("Cancelar sua assinatura do Recebify? As próximas cobranças serão interrompidas; pagamentos já recebidos não serão estornados.")) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await cancelarAssinaturaFluxo();
        setMessage("Assinatura cancelada.");
        setState(await obterAssinaturaSaaS());
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  if (!state) return <section className="border-t border-gray-200 p-4 text-sm text-gray-500">Carregando assinatura…</section>;
  const sub = state.subscription as { plan_key: string; status: string; trial_ends_at: string | null; period_ends_at: string | null; asaas_subscription_id: string | null; asaas_checkout_id: string | null; asaas_checkout_url: string | null } | null;
  const expires = state.access?.access_until ?? sub?.trial_ends_at ?? sub?.period_ends_at;
  const hasExistingSubscription = Boolean(sub?.asaas_subscription_id && sub.status !== "canceled");
  const hasPendingCheckout = Boolean(sub?.status === "incomplete" && sub.asaas_checkout_id && sub.asaas_checkout_url);
  const paymentConfirmedLinking = Boolean(sub?.status === "active" && !sub.asaas_subscription_id && sub.asaas_checkout_id);
  const statusLabel = sub ? (sub.status === "incomplete"
    ? (hasPendingCheckout ? "aguardando pagamento" : "pagamento não concluído")
    : ({ trialing: "em avaliação", active: "ativa", canceled: "cancelada", overdue: "atrasada", past_due: "pagamento atrasado", pending: "pendente", inactive: "inativa" }[sub.status] ?? sub.status)) : "período de avaliação";

  return (
    <section className="border-t border-gray-200 p-4">
      <h3 className="font-bold text-gray-950">Plano e assinatura do Recebify</h3>
      {!state.configured ? (
        <p className="mt-2 text-sm text-amber-800">A migração de assinatura ainda não foi aplicada no Supabase.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-700">Status: <strong>{statusLabel}</strong>{expires && sub?.status !== "canceled" ? ` • até ${new Date(expires).toLocaleDateString("pt-BR")}` : ""}</p>
          {state.access?.enforcement_enabled ? <p className="mt-1 text-xs text-gray-600">{state.access.can_write ? "Acesso para cadastrar e editar está liberado." : "Acesso em modo de consulta. Seus dados e exportações continuam disponíveis."}</p> : <p className="mt-1 text-xs text-amber-800">A cobrança do plano ainda não está ativada; o acesso não será bloqueado até a configuração do administrador.</p>}
          {!state.billingConfigured ? <p role="status" className="mt-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">A assinatura online está temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte.</p> : null}
          {state.environment === "production" && !state.liveBillingEnabled ? <p role="status" className="mt-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">A assinatura online está temporariamente indisponível. Fale com o suporte se precisar de ajuda.</p> : null}
          {sub?.asaas_subscription_id && sub.status !== "canceled" ? <button type="button" disabled={pending} onClick={cancelSubscription} className="mt-2 min-h-9 border border-red-300 px-3 text-sm font-bold text-red-800 disabled:opacity-50">Cancelar assinatura</button> : null}
          {!sub?.asaas_subscription_id && hasPendingCheckout ? <button type="button" disabled={pending} onClick={cancelSubscription} className="mt-2 min-h-9 border border-red-300 px-3 text-sm font-bold text-red-800 disabled:opacity-50">Cancelar checkout</button> : null}
          {paymentConfirmedLinking ? <p role="status" className="mt-2 text-sm text-emerald-800">Pagamento confirmado; estamos vinculando sua recorrência. Não inicie outro checkout.</p> : null}
          <div className="mt-3 grid max-w-xl gap-3">
            {state.plans.map((plan) => (
              <form key={plan.key} action={subscribe} className="space-y-2 border border-gray-200 p-3">
                <input type="hidden" name="plan_key" value={plan.key} />
                <p className="font-bold text-gray-950">{plan.name}</p>
                <p className="text-sm text-gray-600">{plan.price === null ? "Preço ainda não configurado" : `${plan.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / mês`}</p>
                <p className="text-xs text-gray-500">Um plano simples para começar. Cancele quando quiser.</p>
                <p className="text-xs text-gray-500">Seus dados de cobrança e cartão serão informados diretamente no checkout seguro do Asaas.</p>
                <button disabled={pending || !state.billingConfigured || plan.price === null || hasExistingSubscription || paymentConfirmedLinking} className="min-h-10 bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Preparando checkout…" : hasExistingSubscription ? "Assinatura em andamento" : paymentConfirmedLinking ? "Pagamento confirmado" : hasPendingCheckout ? "Continuar pagamento" : "Assinar"}</button>
              </form>
            ))}
          </div>
        </>
      )}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-2 text-sm font-semibold text-emerald-700">{message}</p> : null}
    </section>
  );
}
