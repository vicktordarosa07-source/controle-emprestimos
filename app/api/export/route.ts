import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const backup = new URL(request.url).searchParams.get("formato") === "json";
  try {
    if (backup) {
      const [clientes, emprestimos, parcelas, pagamentos, itens, contatos] = await Promise.all([
        allRows((from, to) => supabase.from("clientes").select("*").range(from, to)),
        allRows((from, to) => supabase.from("emprestimos").select("*").range(from, to)),
        allRows((from, to) => supabase.from("parcelas").select("*").range(from, to)),
        allRows((from, to) => supabase.from("pagamentos").select("*").range(from, to)),
        allRows((from, to) => supabase.from("pagamento_itens").select("*").range(from, to)),
        allRows((from, to) => supabase.from("cobranca_contatos").select("*").range(from, to)),
      ]);
      const body = JSON.stringify({
        formato: "fluxo-backup-v1",
        exportado_em: new Date().toISOString(),
        tabelas: { clientes, emprestimos, parcelas, pagamentos, pagamento_itens: itens, cobranca_contatos: contatos },
      }, null, 2);
      return new Response(body, { headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="fluxo-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      } });
    }

    if (new URL(request.url).searchParams.get("tipo") === "pagamentos") {
      const rows = await allRows<Record<string, unknown>>((from, to) => supabase
        .from("pagamentos")
        .select("valor_total, recebido_em, tipo, clientes(nome, cpf), pagamento_itens(valor_principal, valor_juros, parcelas(numero))")
        .order("recebido_em", { ascending: true })
        .range(from, to));
      const headers = ["Data", "Tipo", "Cliente", "CPF", "Valor líquido", "Parcelas", "Principal", "Juros"];
      const brlNumber = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const lines = [headers, ...rows.map((row) => {
        const client = row.clientes as Record<string, unknown>;
        const items = row.pagamento_itens as Record<string, unknown>[];
        const amount = Number(row.valor_total ?? 0) * (row.tipo === "estorno" ? -1 : 1);
        return [row.recebido_em, row.tipo, client.nome, client.cpf, brlNumber(amount), items.map((item) => {
          const installment = item.parcelas as Record<string, unknown> | null;
          return installment?.numero ?? "";
        }).join(", "), brlNumber(items.reduce((sum, item) => sum + Number(item.valor_principal ?? 0), 0)), brlNumber(items.reduce((sum, item) => sum + Number(item.valor_juros ?? 0), 0))];
      })];
      const csv = `\uFEFF${lines.map((line) => line.map(cell).join(";")).join("\r\n")}`;
      return new Response(csv, { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fluxo-pagamentos-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      } });
    }

    const rows = await allRows<Record<string, unknown>>((from, to) => supabase
      .from("parcelas")
      .select("id, numero, valor, valor_pago, valor_juros_atraso_pago, data_vencimento, data_pagamento, status, emprestimos!inner(id, descricao, periodicidade_vencimento, clientes!inner(nome, cpf, telefone))")
      .is("emprestimos.deleted_at", null)
      .is("emprestimos.clientes.deleted_at", null)
      .order("data_vencimento", { ascending: true })
      .range(from, to));
    const headers = ["Cliente", "CPF", "Telefone", "Cobrança", "Parcela", "Vencimento", "Valor", "Pago", "Juros pagos", "Status", "Data do pagamento"];
    const lines = [headers, ...rows.map((row) => {
      const loan = row.emprestimos as Record<string, unknown>;
      const client = loan.clientes as Record<string, unknown>;
      const brlNumber = (value: unknown) => Number(value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return [client.nome, client.cpf, client.telefone, loan.descricao, row.numero, row.data_vencimento, brlNumber(row.valor), brlNumber(row.valor_pago), brlNumber(row.valor_juros_atraso_pago), row.status, row.data_pagamento];
    })];
    const csv = `\uFEFF${lines.map((line) => line.map(cell).join(";")).join("\r\n")}`;
    return new Response(csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fluxo-cobrancas-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    } });
  } catch (error) {
    return Response.json({ error: `Falha na exportação: ${(error as Error).message}` }, { status: 500 });
  }
}
