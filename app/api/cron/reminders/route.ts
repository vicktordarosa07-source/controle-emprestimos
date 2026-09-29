import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DueRow = {
  id: string;
  numero: number;
  valor: number;
  valor_pago: number | null;
  data_vencimento: string;
  emprestimos: { descricao: string | null; clientes: { user_id: string; nome: string } | null } | null;
};

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function saoPauloDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!cronSecret || !safeEqual(authorization, `Bearer ${cronSecret}`)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!supabaseUrl || !serviceKey || !resendKey || !from) {
    return Response.json({ error: "Integração de lembretes não configurada." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("status", "approved")
    .eq("email_reminders_enabled", true);
  if (profilesError) return Response.json({ error: "Falha ao carregar destinatários." }, { status: 500 });
  if (!profiles?.length) return Response.json({ sent: 0, optedInUsers: 0 });

  const today = saoPauloDate(new Date());
  const limitDate = saoPauloDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const rows: DueRow[] = [];
  for (let fromIndex = 0; ; fromIndex += 1000) {
    const { data, error } = await supabase
      .from("parcelas")
      .select("id,numero,valor,valor_pago,data_vencimento,emprestimos!inner(descricao,clientes!inner(user_id,nome))")
      .neq("status", "Pago")
      .lte("data_vencimento", limitDate)
      .is("emprestimos.deleted_at", null)
      .is("emprestimos.clientes.deleted_at", null)
      .order("data_vencimento", { ascending: true })
      .range(fromIndex, fromIndex + 999);
    if (error) return Response.json({ error: "Falha ao carregar vencimentos." }, { status: 500 });
    rows.push(...((data ?? []) as unknown as DueRow[]));
    if ((data ?? []).length < 1000) break;
  }

  let sent = 0;
  const failures: string[] = [];
  for (const profile of profiles) {
    if (!profile.email) continue;
    const userRows = rows.filter((row) => row.emprestimos?.clientes?.user_id === profile.id);
    if (userRows.length === 0) continue;
    const { data: claimed, error: claimError } = await supabase.rpc("claim_email_reminder", {
      p_user_id: profile.id,
      p_send_date: today,
    });
    if (claimError) { failures.push(profile.id); continue; }
    if (!claimed) continue;
    const lines = userRows.map((row) => {
      const client = escapeHtml(row.emprestimos?.clientes?.nome ?? "Cliente");
      const description = escapeHtml(row.emprestimos?.descricao ?? "Cobrança");
      const amount = Math.max(Number(row.valor) - Number(row.valor_pago ?? 0), 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const date = new Date(`${row.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR");
      const label = row.data_vencimento < today ? "Atrasada" : row.data_vencimento === today ? "Vence hoje" : "Próxima";
      return `<li><strong>${client}</strong> — ${description}, parcela ${row.numero}: ${amount}, vence ${date} (${label}).</li>`;
    }).join("");
    let delivered = false;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [profile.email],
          subject: `Recebify: ${userRows.length} cobrança(s) exigem atenção`,
          html: `<main style="font-family:Arial,sans-serif;color:#172033"><h1>Resumo de cobranças</h1><p>Vencidas e com vencimento nos próximos 7 dias:</p><ul>${lines}</ul><p>Você pode desativar este resumo nas configurações do Recebify.</p></main>`,
        }),
        cache: "no-store",
      });
      delivered = response.ok;
    } catch { delivered = false; }
    await supabase.from("email_reminder_deliveries")
      .update({ status: delivered ? "sent" : "failed", updated_at: new Date().toISOString() })
      .eq("user_id", profile.id).eq("send_date", today);
    if (delivered) sent += 1;
    else failures.push(profile.id);
  }
  return Response.json({ sent, optedInUsers: profiles.length, failed: failures.length }, { status: 200 });
}
