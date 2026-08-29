"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function criarEmprestimo(formData: FormData) {
  const nome = formData.get("nome") as string;
  const valorTotalStr = formData.get("valor") as string;
  const jurosPercentualStr = formData.get("juros") as string;
  const qtdParcelasStr = formData.get("qtd_parcelas") as string;
  const dataPrimeiroVencimento = formData.get("data_primeiro_vencimento") as string;

  if (!nome || !valorTotalStr || !jurosPercentualStr || !qtdParcelasStr || !dataPrimeiroVencimento) {
    throw new Error("Campos obrigatórios ausentes");
  }

  const valorTotal = parseFloat(valorTotalStr);
  const jurosPercentual = parseFloat(jurosPercentualStr);
  const qtdParcelas = parseInt(qtdParcelasStr, 10);

  if (isNaN(valorTotal) || isNaN(jurosPercentual) || isNaN(qtdParcelas)) {
    throw new Error("Valores numéricos inválidos");
  }

  // 1. Cria cliente
  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .insert({ nome })
    .select()
    .single();

  if (clienteError || !cliente) {
    throw new Error(`Erro ao criar cliente: ${clienteError?.message}`);
  }

  // 2. Calcula valor de cada parcela (valor com juros / qtd_parcelas)
  const valorComJuros = valorTotal * (1 + jurosPercentual / 100);
  const valorParcela = valorComJuros / qtdParcelas;

  // 3. Grava empréstimo
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
    throw new Error(`Erro ao criar empréstimo: ${emprestimoError?.message}`);
  }

  // 4. Gera parcelas com datas somando 1 mês por parcela
  const parcelasParaInserir = [];
  const baseDate = new Date(dataPrimeiroVencimento + "T12:00:00");

  for (let i = 0; i < qtdParcelas; i++) {
    const dataVenc = new Date(baseDate);
    dataVenc.setMonth(baseDate.getMonth() + i);

    const yyyy = dataVenc.getFullYear();
    const mm = String(dataVenc.getMonth() + 1).padStart(2, "0");
    const dd = String(dataVenc.getDate()).padStart(2, "0");
    const dataVencimentoStr = `${yyyy}-${mm}-${dd}`;

    parcelasParaInserir.push({
      emprestimo_id: emprestimo.id,
      numero: i + 1,
      valor: Number(valorParcela.toFixed(2)),
      data_vencimento: dataVencimentoStr,
      status: "Pendente",
    });
  }

  const { error: parcelasError } = await supabase
    .from("parcelas")
    .insert(parcelasParaInserir);

  if (parcelasError) {
    throw new Error(`Erro ao criar parcelas: ${parcelasError.message}`);
  }

  revalidatePath("/");
}

export async function marcarComoPago(parcelaId: string) {
  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  const hojeStr = `${yyyy}-${mm}-${dd}`;

  const { error } = await supabase
    .from("parcelas")
    .update({ status: "Pago", data_pagamento: hojeStr })
    .eq("id", parcelaId);

  if (error) {
    throw new Error(`Erro ao marcar como pago: ${error.message}`);
  }

  revalidatePath("/");
}
