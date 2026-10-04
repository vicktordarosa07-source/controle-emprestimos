type RecurringPixSubscriptionInput = {
  customerId: string;
  externalReference: string;
  planName: string;
  price: number;
  nextDueDate: string;
};

export function buildRecurringPixSubscriptionPayload(input: RecurringPixSubscriptionInput) {
  return {
    customer: input.customerId,
    billingType: "PIX",
    nextDueDate: input.nextDueDate,
    value: input.price,
    cycle: "MONTHLY",
    description: `Assinatura mensal ${input.planName}`,
    externalReference: input.externalReference,
  };
}

export function asPixImageDataUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(trimmed)) return trimmed.replace(/\s/g, "");
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return `data:image/png;base64,${trimmed.replace(/\s/g, "")}`;
  return null;
}
