export type AsaasEnvironment = "sandbox" | "production";

type RecurringCheckoutInput = {
  siteUrl: string;
  externalReference: string;
  planName: string;
  price: number;
  nextDueDate: string;
};

export function buildRecurringCheckoutPayload(input: RecurringCheckoutInput) {
  const origin = new URL(input.siteUrl).origin;
  const callbackUrl = (result: "success" | "cancelled" | "expired") => {
    const url = new URL("/", origin);
    url.searchParams.set("view", "configuracoes");
    url.searchParams.set("checkout", result);
    url.hash = "assinatura";
    return url.toString();
  };

  return {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: 1440,
    externalReference: input.externalReference,
    callback: {
      successUrl: callbackUrl("success"),
      cancelUrl: callbackUrl("cancelled"),
      expiredUrl: callbackUrl("expired"),
    },
    items: [{
      name: input.planName,
      description: `Assinatura mensal ${input.planName}`,
      quantity: 1,
      value: input.price,
    }],
    subscription: {
      cycle: "MONTHLY",
      nextDueDate: input.nextDueDate,
    },
  };
}

export function getAsaasCheckoutUrl(
  environment: AsaasEnvironment,
  checkout: { id?: unknown; link?: unknown },
) {
  const id = typeof checkout.id === "string" ? checkout.id : "";
  if (!id) throw new Error("O Asaas não retornou o identificador do checkout.");

  const expectedHost = environment === "sandbox" ? "sandbox.asaas.com" : "asaas.com";
  const fallback = `https://${expectedHost}/checkoutSession/show?id=${encodeURIComponent(id)}`;
  const candidate = typeof checkout.link === "string" && checkout.link ? checkout.link : fallback;
  const url = new URL(candidate);

  if (url.protocol !== "https:" || url.hostname !== expectedHost || !url.pathname.startsWith("/checkoutSession/show")) {
    throw new Error("O Asaas retornou um endereço de checkout inválido.");
  }

  return url.toString();
}
