"use server";

import {
  buildParcelas,
  formatDateOnly,
  parseDateOnly,
  parseInstallmentCount,
  parseNonNegativeNumber,
  parsePositiveNumber,
  parseRequiredText,
} from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Sessao expirada. Entre novamente para continuar.");
  }

  return { supabase, user };
}

export async function criarEmprestimo(formData: FormData) {
  const { supabase, user } = await requireUser();
  const nome = parseRequiredText(formData.get("nome"), "Nome do cliente");
  const valorTotal = parsePositiveNumber(formData.get("valor"), "Valor total");
  const jurosPercentual = parseNonNegativeNumber(formData.get("juros"), "Juros");
  const qtdParcelas = parseInstallmentCount(formData.get("qtd_parcelas"));
  const dataPrimeiroVencimento = parseDateOnly(
    formData.get("data_primeiro_vencimento"),
    "Data do primeiro vencimento"
  );

  // 1. Cria cliente
  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .insert({ nome, user_id: user.id })
    .select()
    .single();

  if (clienteError || !cliente) {
    throw new Error(`Erro ao criar cliente: ${clienteError?.message}`);
  }

  // 2. Grava empréstimo
  const { data: emprestimo, error: emprestimoError } = await supabase
    .from("emprestimos")
    .insert({
      cliente_id: cliente.id,
      valor_total: valorTotal,
      juros_percentual: jurosPercentual,
      qtd_parcelas: qtdParcelas,
      data_primeiro_vencimento: dataPrimeiroVencimento,
    })
    .select()
    .single();

  if (emprestimoError || !emprestimo) {
    await supabase.from("clientes").delete().eq("id", cliente.id);
    throw new Error(`Erro ao criar empréstimo: ${emprestimoError?.message}`);
  }

  const parcelasParaInserir = buildParcelas({
    emprestimoId: emprestimo.id,
    valorTotal,
    jurosPercentual,
    qtdParcelas,
    dataPrimeiroVencimento,
  });

  const { error: parcelasError } = await supabase
    .from("parcelas")
    .insert(parcelasParaInserir);

  if (parcelasError) {
    await supabase.from("emprestimos").delete().eq("id", emprestimo.id);
    await supabase.from("clientes").delete().eq("id", cliente.id);
    throw new Error(`Erro ao criar parcelas: ${parcelasError.message}`);
  }

  revalidatePath("/");
}

export async function marcarComoPago(parcelaId: string) {
  const { supabase } = await requireUser();
  const hojeStr = formatDateOnly(new Date());

  const { data: parcela, error: parcelaError } = await supabase
    .from("parcelas")
    .select("valor")
    .eq("id", parcelaId)
    .eq("status", "Pendente")
    .single();

  if (parcelaError || !parcela) {
    throw new Error(`Erro ao buscar parcela: ${parcelaError?.message ?? "parcela nao encontrada"}`);
  }

  const { error } = await supabase
    .from("parcelas")
    .update({ status: "Pago", data_pagamento: hojeStr, valor_pago: parcela.valor })
    .eq("id", parcelaId)
    .eq("status", "Pendente");

  if (error) {
    throw new Error(`Erro ao marcar como pago: ${error.message}`);
  }

  revalidatePath("/");
}

export async function reabrirParcela(parcelaId: string) {
  const { supabase } = await requireUser();

  const { error } = await supabase
    .from("parcelas")
    .update({ status: "Pendente", data_pagamento: null, valor_pago: 0 })
    .eq("id", parcelaId)
    .eq("status", "Pago");

  if (error) {
    throw new Error(`Erro ao reabrir parcela: ${error.message}`);
  }

  revalidatePath("/");
}

export async function registrarPagamentoCliente(formData: FormData) {
  const { supabase } = await requireUser();
  const clienteId = parseRequiredText(formData.get("cliente_id"), "Cliente");
  const valorRecebido = parsePositiveNumber(formData.get("valor_pago"), "Valor pago");
  const hojeStr = formatDateOnly(new Date());
  let restanteCentavos = Math.round(valorRecebido * 100);

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", clienteId)
    .single();

  if (clienteError || !cliente) {
    throw new Error("Cliente nao encontrado para este usuario.");
  }

  const { data: emprestimos, error: emprestimosError } = await supabase
    .from("emprestimos")
    .select("id")
    .eq("cliente_id", clienteId);

  if (emprestimosError) {
    throw new Error(`Erro ao buscar emprestimos: ${emprestimosError.message}`);
  }

  const emprestimoIds = (emprestimos ?? []).map((emprestimo) => emprestimo.id);

  if (emprestimoIds.length === 0) {
    throw new Error("Este cliente nao possui emprestimos.");
  }

  const { data: parcelas, error: parcelasError } = await supabase
    .from("parcelas")
    .select("id, valor, valor_pago, numero, data_vencimento")
    .in("emprestimo_id", emprestimoIds)
    .neq("status", "Pago")
    .order("data_vencimento", { ascending: true })
    .order("numero", { ascending: true });

  if (parcelasError) {
    throw new Error(`Erro ao buscar parcelas: ${parcelasError.message}`);
  }

  const abertas = parcelas ?? [];
  const saldoTotalCentavos = abertas.reduce((total, parcela) => {
    const valorCentavos = Math.round(Number(parcela.valor) * 100);
    const pagoCentavos = Math.round(Number(parcela.valor_pago ?? 0) * 100);
    return total + Math.max(valorCentavos - pagoCentavos, 0);
  }, 0);

  if (saldoTotalCentavos <= 0) {
    throw new Error("Este cliente nao possui saldo em aberto.");
  }

  if (restanteCentavos > saldoTotalCentavos) {
    throw new Error(
      `Valor pago maior que o saldo em aberto (${(saldoTotalCentavos / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}).`
    );
  }

  for (const parcela of abertas) {
    if (restanteCentavos <= 0) {
      break;
    }

    const valorCentavos = Math.round(Number(parcela.valor) * 100);
    const pagoAtualCentavos = Math.round(Number(parcela.valor_pago ?? 0) * 100);
    const saldoParcelaCentavos = Math.max(valorCentavos - pagoAtualCentavos, 0);

    if (saldoParcelaCentavos === 0) {
      continue;
    }

    const aplicadoCentavos = Math.min(restanteCentavos, saldoParcelaCentavos);
    const novoPagoCentavos = pagoAtualCentavos + aplicadoCentavos;
    const quitou = novoPagoCentavos >= valorCentavos;

    const { error: updateError } = await supabase
      .from("parcelas")
      .update({
        valor_pago: novoPagoCentavos / 100,
        status: quitou ? "Pago" : "Pendente",
        data_pagamento: quitou ? hojeStr : null,
      })
      .eq("id", parcela.id);

    if (updateError) {
      throw new Error(`Erro ao registrar pagamento: ${updateError.message}`);
    }

    restanteCentavos -= aplicadoCentavos;
  }

  revalidatePath("/");
}
