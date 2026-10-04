"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { assinarPlanoFluxo, cancelarAssinaturaFluxo, obterAssinaturaSaaS, obterCobrancaPixAssinatura } from "@/app/actions";

type BillingState = Awaited<ReturnType<typeof obterAssinaturaSaaS>>;

export function SubscriptionPanel() {
  const router = useRouter();
  const [state, setState] = useState<BillingState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [paymentMethod, setPaymentMethod] = useState<"CREDIT_CARD" | "PIX">("CREDIT_CARD");
  const [pixCharge, setPixCharge] = useState<Awaited<ReturnType<typeof obterCobrancaPixAssinatura>>["charge"]>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  useEffect(() => {
    let active = true;
    void obterAssinaturaSaaS()
      .then((value) => { if (active) setState(value); })
      .catch(() => { if (active) setError("Não foi possível carregar a assinatura. Atualize a página e tente novamente."); });
    return () => { active = false; };
  }, []);

  function subscribe(formData: FormData) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const live = state?.environment === "production";
        const method = String(formData.get("payment_method") ?? "CREDIT_CARD");
        const confirmation = method === "PIX"
          ? "Será criada uma assinatura real com cobranças Pix mensais. Você precisará pagar cada cobrança; não é débito automático. Continuar?"
          : "Você será redirecionado ao checkout seguro do Asaas para informar o cartão e autorizar uma assinatura mensal real. Continuar?";
        if (live && !window.confirm(confirmation)) return;
        const result = await assinarPlanoFluxo(formData, live);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.paymentMethod === "PIX") {
          setPixCharge(result.pixCharge);
          setCopiedPix(false);
          setState(await obterAssinaturaSaaS());
          if (!result.pixCharge) setMessage("Não há cobrança Pix pendente disponível neste momento. Se acabou de criar, consulte novamente em instantes; se já pagou, aguarde a confirmação do Asaas.");
          return;
        }
        window.location.assign(result.checkoutUrl);
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  function loadPixCharge() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await obterCobrancaPixAssinatura();
        setPixCharge(result.charge);
        setCopiedPix(false);
        const refreshed = await obterAssinaturaSaaS();
        setState(refreshed);
        if (refreshed.subscription?.status === "active") {
          setPixCharge(null);
          setMessage("Pagamento confirmado pelo Asaas. Sua assinatura está ativa.");
          router.refresh();
        } else if (!result.charge) {
          setMessage("Não há cobrança Pix pendente disponível neste momento. Se acabou de criar, tente novamente em instantes; se já pagou, aguarde a confirmação do Asaas.");
        }
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  async function copyPixCode() {
    if (!pixCharge?.payload) return;
    try {
      await navigator.clipboard.writeText(pixCharge.payload);
      setCopiedPix(true);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o código Pix exibido.");
    }
  }

  function cancelSubscription() {
    if (!window.confirm("Cancelar sua assinatura do Recebify? As próximas renovações serão interrompidas. Se houver um período já pago, o acesso continua até o vencimento; pagamentos já recebidos não serão estornados.")) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await cancelarAssinaturaFluxo();
        setPixCharge(null);
        setMessage("Assinatura cancelada.");
        setState(await obterAssinaturaSaaS());
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  if (!state) return <section role={error ? "alert" : "status"} className="border-t border-gray-200 p-4 text-sm text-gray-500">{error || "Carregando assinatura…"}</section>;
  const sub = state.subscription as { plan_key: string; status: string; trial_ends_at: string | null; period_ends_at: string | null; asaas_customer_id: string | null; asaas_subscription_id: string | null; asaas_checkout_id: string | null; asaas_checkout_url: string | null; asaas_billing_type: string | null } | null;
  const expires = state.access?.access_until ?? sub?.trial_ends_at ?? sub?.period_ends_at;
  const hasExistingSubscription = Boolean(sub?.asaas_subscription_id && sub.status !== "canceled");
  const hasPendingCheckout = Boolean(sub?.status === "incomplete" && sub.asaas_checkout_id && sub.asaas_checkout_url);
  const paymentConfirmedLinking = Boolean(sub?.status === "active" && !sub.asaas_subscription_id && sub.asaas_checkout_id);
  const trialActive = sub?.status === "trialing" && Boolean(sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date());
  const trialNotStarted = sub?.status === "pending_trial";
  const statusLabel = sub ? (sub.status === "incomplete"
    ? (sub.asaas_billing_type === "PIX" ? "aguardando pagamento Pix" : hasPendingCheckout ? "aguardando pagamento" : "pagamento não concluído")
    : sub.status === "trialing" && !trialActive ? "teste encerrado"
      : ({ pending_trial: "teste ainda não iniciado", trialing: "em avaliação", active: "ativa", canceled: "cancelada", overdue: "atrasada", past_due: "pagamento atrasado", pending: "pendente", inactive: "inativa" }[sub.status] ?? sub.status)) : "assinatura indisponível";

  return (
    <section className="border-t border-gray-200 p-4">
      <h3 className="font-bold text-gray-950">Plano e assinatura do Recebify</h3>
      {!state.configured ? (
        <p className="mt-2 text-sm text-amber-800">A migração de assinatura ainda não foi aplicada no Supabase.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-700">Status: <strong>{statusLabel}</strong>{expires ? ` • ${sub?.status === "canceled" ? "acesso até" : "até"} ${new Date(expires).toLocaleDateString("pt-BR")}` : ""}</p>
          {trialActive ? <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Seus 7 dias grátis já estão ativos. Ao terminar, você poderá escolher cartão ou Pix para continuar. Não há cobrança automática.</p> : null}
          {trialNotStarted ? <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Ative o teste grátis na tela inicial para começar. O prazo ainda não está correndo.</p> : null}
          {state.access?.enforcement_enabled ? <p className="mt-1 text-xs text-gray-600">{state.access.can_write ? "Acesso para cadastrar e editar está liberado." : "O uso está pausado. Seus dados permanecem guardados e podem ser exportados."}</p> : <p className="mt-1 text-xs text-amber-800">A cobrança do plano ainda não está ativada; o acesso não será bloqueado até a configuração do administrador.</p>}
          {!state.billingConfigured ? <p role="status" className="mt-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">A assinatura online está temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte.</p> : null}
          {state.environment === "production" && !state.liveBillingEnabled ? <p role="status" className="mt-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">A assinatura online está temporariamente indisponível. Fale com o suporte se precisar de ajuda.</p> : null}
          {sub?.asaas_subscription_id && sub.status !== "canceled" ? <button type="button" disabled={pending} onClick={cancelSubscription} className="mt-2 min-h-9 border border-red-300 px-3 text-sm font-bold text-red-800 disabled:opacity-50">Cancelar assinatura</button> : null}
          {!sub?.asaas_subscription_id && hasPendingCheckout ? <button type="button" disabled={pending} onClick={cancelSubscription} className="mt-2 min-h-9 border border-red-300 px-3 text-sm font-bold text-red-800 disabled:opacity-50">Cancelar checkout</button> : null}
          {paymentConfirmedLinking ? <p role="status" className="mt-2 text-sm text-emerald-800">Pagamento confirmado; estamos vinculando sua recorrência. Não inicie outro checkout.</p> : null}
          {sub?.asaas_billing_type === "PIX" && sub.asaas_subscription_id && sub.status !== "active" && sub.status !== "canceled" ? (
            <div className="mt-3 max-w-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-950">Pagamento mensal via Pix</p>
              <p className="mt-1 text-xs text-emerald-900">Cada mês terá uma nova cobrança Pix. O acesso só é confirmado após o Asaas avisar que o pagamento foi recebido.</p>
              {!pixCharge ? <button type="button" disabled={pending} onClick={loadPixCharge} className="mt-3 min-h-9 bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-50">{pending ? "Consultando…" : "Consultar cobrança Pix"}</button> : null}
              {pixCharge ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
                  {pixCharge.imageDataUrl ? <Image src={pixCharge.imageDataUrl} alt="QR Code para pagar a assinatura via Pix" width={220} height={220} unoptimized className="h-[220px] w-[220px] border border-emerald-200 bg-white p-2" /> : null}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-950">{pixCharge.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}{pixCharge.dueDate ? ` • vence em ${new Date(`${pixCharge.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}</p>
                    <label htmlFor="recebify-pix-code" className="mt-2 block text-xs font-semibold text-gray-700">Pix copia e cola</label>
                    <textarea id="recebify-pix-code" readOnly value={pixCharge.payload} rows={4} className="mt-1 w-full break-all border border-gray-300 bg-white p-2 text-xs text-gray-700" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={copyPixCode} className="min-h-9 bg-emerald-700 px-3 text-sm font-bold text-white">{copiedPix ? "Código copiado" : "Copiar código Pix"}</button>
                      <button type="button" disabled={pending} onClick={loadPixCharge} className="min-h-9 border border-emerald-700 px-3 text-sm font-bold text-emerald-900 disabled:opacity-50">Atualizar QR</button>
                    </div>
                    {pixCharge.expirationDate ? <p className="mt-2 text-xs text-gray-600">QR válido até {new Date(pixCharge.expirationDate).toLocaleString("pt-BR")}.</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!trialActive && !trialNotStarted && sub ? <div className="mt-3 grid max-w-xl gap-3">
            {state.plans.map((plan) => (
              <form key={plan.key} action={subscribe} className="space-y-2 border border-gray-200 p-3">
                <input type="hidden" name="plan_key" value={plan.key} />
                <p className="font-bold text-gray-950">{plan.name}</p>
                <p className="text-sm text-gray-600">{plan.price === null ? "Preço ainda não configurado" : `${plan.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / mês`}</p>
                <fieldset disabled={hasExistingSubscription || paymentConfirmedLinking} className="space-y-3 disabled:opacity-70">
                  <legend className="text-sm font-semibold text-gray-800">Forma de pagamento</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-start gap-2 border border-gray-300 p-3 text-sm">
                      <input type="radio" name="payment_method" value="CREDIT_CARD" checked={paymentMethod === "CREDIT_CARD"} onChange={() => setPaymentMethod("CREDIT_CARD")} className="mt-1" />
                      <span><strong className="block text-gray-950">Cartão de crédito</strong><span className="text-xs text-gray-600">Cobrança mensal automática.</span></span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 border border-gray-300 p-3 text-sm">
                      <input type="radio" name="payment_method" value="PIX" checked={paymentMethod === "PIX"} onChange={() => setPaymentMethod("PIX")} className="mt-1" />
                      <span><strong className="block text-gray-950">Pix mensal</strong><span className="text-xs text-gray-600">Você paga cada cobrança; não é débito automático.</span></span>
                    </label>
                  </div>
                  {paymentMethod === "PIX" ? (
                    sub?.asaas_customer_id ? (
                      <p className="border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">Usaremos o cadastro de cobrança já existente no Asaas. O Recebify não guarda os dados pessoais desse cadastro.</p>
                    ) : (
                      <div className="grid gap-3 border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2">
                        <label className="text-sm font-medium text-gray-800 sm:col-span-2">Nome completo<input required name="pix_name" autoComplete="name" maxLength={100} className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <label className="text-sm font-medium text-gray-800">CPF ou CNPJ<input required name="pix_cpf_cnpj" autoComplete="off" inputMode="text" maxLength={18} placeholder="Documento do pagador" className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <label className="text-sm font-medium text-gray-800">Celular com DDD<input required name="pix_phone" autoComplete="tel" inputMode="tel" maxLength={20} placeholder="(00) 90000-0000" className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <label className="text-sm font-medium text-gray-800">CEP<input required name="pix_postal_code" autoComplete="postal-code" inputMode="numeric" maxLength={9} placeholder="00000-000" className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <label className="text-sm font-medium text-gray-800">Endereço<input required name="pix_address" autoComplete="street-address" maxLength={100} className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <label className="text-sm font-medium text-gray-800">Número<input required name="pix_address_number" autoComplete="off" maxLength={20} className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <label className="text-sm font-medium text-gray-800">Bairro<input required name="pix_province" autoComplete="address-level3" maxLength={100} className="mt-1 min-h-10 w-full border border-gray-300 bg-white px-3" /></label>
                        <p className="text-xs text-gray-600 sm:col-span-2">Esses dados são enviados ao Asaas para emitir as cobranças. O Recebify não salva seu CPF/CNPJ nem endereço.</p>
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-gray-500">Você informará os dados do cartão diretamente no checkout seguro do Asaas. A primeira data de cobrança aparece antes de confirmar.</p>
                  )}
                </fieldset>
                <button disabled={pending || !state.billingConfigured || plan.price === null || hasExistingSubscription || paymentConfirmedLinking} className="min-h-10 bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? paymentMethod === "PIX" ? "Preparando Pix…" : "Preparando checkout…" : hasExistingSubscription ? "Assinatura em andamento" : paymentConfirmedLinking ? "Pagamento confirmado" : hasPendingCheckout && paymentMethod === "CREDIT_CARD" ? "Continuar checkout" : hasPendingCheckout ? "Trocar para Pix" : paymentMethod === "PIX" ? "Gerar cobrança Pix" : "Assinar com cartão"}</button>
              </form>
            ))}
          </div> : null}
        </>
      )}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-2 text-sm font-semibold text-emerald-700">{message}</p> : null}
    </section>
  );
}
