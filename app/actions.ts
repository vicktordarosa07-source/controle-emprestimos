"use server";

import {
  buildParcelas,
  formatDateOnly,
  parseCustomIntervalDays,
  parseDateOnly,
  parseDueFrequency,
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
  const periodicidade = parseDueFrequency(formData.get("periodicidade_vencimento"));
  const intervaloPersonalizadoDias = parseCustomIntervalDays(
    formData.get("intervalo_personalizado_dias"),
    periodicidade
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
      periodicidade_vencimento: periodicidade,
      intervalo_personalizado_dias: intervaloPersonalizadoDias,
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
    periodicidade,
    intervaloPersonalizadoDias,
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
  const { error } = await supabase.rpc("registrar_pagamento_cliente", {
    p_cliente_id: clienteId,
    p_valor_pago: valorRecebido,
  });

  if (error) {
    throw new Error(`Erro ao registrar pagamento: ${error.message}`);
  }

  revalidatePath("/");
}

export async function aprovarUsuario(formData: FormData) {
  const { supabase } = await requireUser();
  const userId = parseRequiredText(formData.get("user_id"), "Usuario");

  const { error } = await supabase.rpc("approve_user_access", {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`Erro ao aprovar usuario: ${error.message}`);
  }

  revalidatePath("/");
}
