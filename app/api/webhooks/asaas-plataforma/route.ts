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
  payment?: { subscription?: string };
  subscription?: { id?: string };
};

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
  const subscriptionId = payload.payment?.subscription ?? payload.subscription?.id;
  if (!payload.id || !payload.event || !subscriptionId) return Response.json({ ignored: true }, { status: 200 });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("process_saas_billing_webhook", {
    p_event_id: payload.id,
    p_subscription_id: subscriptionId,
    p_event_type: payload.event,
  });
  if (error) {
    console.error("Falha ao processar webhook da assinatura", { eventId: payload.id, message: error.message });
    return Response.json({ error: "Falha temporária no processamento." }, { status: 500 });
  }
  return Response.json({ received: true, result: data }, { status: 200 });
}
