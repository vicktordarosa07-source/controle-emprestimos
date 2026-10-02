import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function sameSecret(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

type Payload = {
  id?: string;
  event?: string;
  payment?: { subscription?: string; customer?: string };
  subscription?: { id?: string; customer?: string; externalReference?: string | null };
  checkout?: { id?: string; customer?: string | null };
};

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const expected = process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN ?? "";
  const supplied = request.headers.get("asaas-access-token") ?? "";
  if (expected.length < 32 || !sameSecret(expected, supplied)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: "Evento muito grande." }, { status: 413 });
  let payload: Payload;
  try { payload = JSON.parse(body) as Payload; }
  catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!payload.id || !payload.event) return Response.json({ ignored: true }, { status: 200 });

  const admin = createSupabaseAdminClient();
  let data: unknown;
  let error: { message: string } | null = null;

  if (["CHECKOUT_PAID", "CHECKOUT_CANCELED", "CHECKOUT_EXPIRED"].includes(payload.event)) {
    if (!payload.checkout?.id) return Response.json({ ignored: true }, { status: 200 });
    const result = await admin.rpc("process_saas_checkout_webhook", {
      p_event_id: payload.id,
      p_checkout_id: payload.checkout.id,
      p_event_type: payload.event,
      p_customer_id: payload.checkout.customer ?? null,
    });
    data = result.data;
    error = result.error;
  } else if (["SUBSCRIPTION_CREATED", "SUBSCRIPTION_DELETED"].includes(payload.event)) {
    if (!payload.subscription?.id) return Response.json({ ignored: true }, { status: 200 });
    const externalReference = payload.event === "SUBSCRIPTION_CREATED" && isUuid(payload.subscription.externalReference)
      ? payload.subscription.externalReference
      : null;
    const result = await admin.rpc("process_saas_billing_webhook", {
      p_event_id: payload.id,
      p_subscription_id: payload.subscription.id,
      p_event_type: payload.event,
      p_customer_id: payload.subscription.customer ?? null,
      p_external_reference: externalReference,
    });
    data = result.data;
    error = result.error;
  } else if (["PAYMENT_RECEIVED", "PAYMENT_OVERDUE"].includes(payload.event)) {
    if (!payload.payment?.subscription) return Response.json({ ignored: true }, { status: 200 });
    const result = await admin.rpc("process_saas_billing_webhook", {
      p_event_id: payload.id,
      p_subscription_id: payload.payment.subscription,
      p_event_type: payload.event,
      p_customer_id: payload.payment.customer ?? null,
      p_external_reference: null,
    });
    data = result.data;
    error = result.error;
  } else {
    return Response.json({ ignored: true }, { status: 200 });
  }

  if (error) {
    console.error("Falha ao processar webhook da assinatura", { eventId: payload.id, message: error.message });
    return Response.json({ error: "Falha temporária no processamento." }, { status: 500 });
  }
  return Response.json({ received: true, result: data }, { status: 200 });
}
