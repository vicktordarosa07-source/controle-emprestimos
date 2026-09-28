import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type AsaasWebhook = {
  id?: string;
  event?: string;
  payment?: { id?: string; value?: number; paymentDate?: string | null };
};

export async function POST(request: Request) {
  const suppliedToken = request.headers.get("asaas-access-token") ?? "";
  if (!suppliedToken || suppliedToken.length > 512) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return Response.json({ error: "Evento muito grande." }, { status: 413 });

  let payload: AsaasWebhook;
  try { payload = JSON.parse(rawBody) as AsaasWebhook; }
  catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!payload.id || !payload.event || !payload.payment?.id) {
    return Response.json({ error: "Evento incompleto." }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const tokenHash = createHash("sha256").update(suppliedToken).digest("hex");
    const { data: connection, error: connectionError } = await admin
      .from("asaas_connections")
      .select("user_id")
      .eq("webhook_token_hash", tokenHash)
      .maybeSingle();
    if (connectionError || !connection) return Response.json({ error: "Não autorizado." }, { status: 401 });

    const date = payload.payment.paymentDate?.slice(0, 10);
    const { data, error } = await admin.rpc("process_asaas_webhook", {
      p_user_id: connection.user_id,
      p_event_id: payload.id,
      p_payment_id: payload.payment.id,
      p_event_type: payload.event,
      p_value: Number(payload.payment.value ?? 0),
      p_received_on: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    });
    if (error) {
      console.error("Falha ao processar webhook Asaas", { eventId: payload.id, message: error.message });
      return Response.json({ error: "Falha temporária no processamento." }, { status: 500 });
    }
    // Asaas considera apenas HTTP 200 como confirmação de recebimento.
    return Response.json({ received: true, result: data }, { status: 200 });
  } catch (error) {
    console.error("Webhook Asaas indisponível", (error as Error).message);
    return Response.json({ error: "Webhook indisponível." }, { status: 500 });
  }
}
