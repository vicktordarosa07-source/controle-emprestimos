"use server";

import { randomBytes } from "node:crypto";
import type { UserAttributes } from "@supabase/supabase-js";
import {
  buildParcelas,
  calcularJurosAtraso,
  formatDateOnly,
  parseCustomIntervalDays,
  parseCpf,
  parseDateOnly,
  parseDueFrequency,
  parseEmail,
  parseInstallmentCount,
  parseLateInterestType,
  parseNonNegativeNumber,
  parsePhone,
  parsePositiveNumber,
  parseRequiredText,
} from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

const SITE_URL = "https://gestao-de-emprestimo.vercel.app";

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
  const endereco = parseRequiredText(formData.get("endereco"), "Endereco");
  const telefone = parsePhone(formData.get("telefone"));
  const cpf = parseCpf(formData.get("cpf"));
  const valorTotal = parsePositiveNumber(formData.get("valor"), "Valor total");
  const jurosPercentual = parseNonNegativeNumber(formData.get("juros"), "Juros");
  const jurosAtrasoTipo = parseLateInterestType(formData.get("juros_atraso_tipo"));
  const jurosAtrasoValor = parseNonNegativeNumber(
    formData.get("juros_atraso_valor"),
    "Juro diario por atraso"
  );
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
    .insert({ nome, endereco, telefone, cpf, user_id: user.id })
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
      juros_atraso_tipo: jurosAtrasoTipo,
      juros_atraso_valor: jurosAtrasoValor,
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
  const hoje = new Date();
  const hojeStr = formatDateOnly(hoje);

  const { data: parcela, error: parcelaError } = await supabase
    .from("parcelas")
    .select(
      `
      valor,
      valor_pago,
      data_vencimento,
      emprestimos (
        juros_atraso_tipo,
        juros_atraso_valor
      )
    `
    )
    .eq("id", parcelaId)
    .eq("status", "Pendente")
    .single();

  if (parcelaError || !parcela) {
    throw new Error(`Erro ao buscar parcela: ${parcelaError?.message ?? "parcela nao encontrada"}`);
  }

  const valorParcela = Number(parcela.valor);
  const valorPago = Number(parcela.valor_pago ?? 0);
  const saldoPrincipal = Math.max(valorParcela - valorPago, 0);
  const emprestimo = Array.isArray(parcela.emprestimos)
    ? parcela.emprestimos[0]
    : parcela.emprestimos;
  const jurosAtraso = calcularJurosAtraso({
    saldoPrincipal,
    dataVencimento: String(parcela.data_vencimento),
    hoje,
    tipo: emprestimo?.juros_atraso_tipo === "valor" ? "valor" : "percentual",
    valorDiario: Number(emprestimo?.juros_atraso_valor ?? 0),
  });

  const { error } = await supabase
    .from("parcelas")
    .update({
      status: "Pago",
      data_pagamento: hojeStr,
      valor_pago: valorParcela,
      valor_juros_atraso_pago: jurosAtraso,
    })
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
    .update({
      status: "Pendente",
      data_pagamento: null,
      valor_pago: 0,
      valor_juros_atraso_pago: 0,
    })
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

export async function atualizarCliente(formData: FormData) {
  const { supabase } = await requireUser();
  const clienteId = parseRequiredText(formData.get("cliente_id"), "Cliente");
  const nome = parseRequiredText(formData.get("nome"), "Nome do cliente");
  const endereco = parseRequiredText(formData.get("endereco"), "Endereco");
  const telefone = parsePhone(formData.get("telefone"));
  const cpf = parseCpf(formData.get("cpf"));

  const { error } = await supabase
    .from("clientes")
    .update({ nome, endereco, telefone, cpf })
    .eq("id", clienteId);

  if (error) {
    throw new Error(`Erro ao atualizar cliente: ${error.message}`);
  }

  revalidatePath("/");
}

export async function gerarConviteCadastro(formData: FormData) {
  const { supabase } = await requireUser();
  const email = parseEmail(formData.get("email"));

  const inviteToken = randomBytes(32).toString("base64url");
  const { error } = await supabase.rpc("create_signup_invite", {
    p_email: email,
    p_invite_token: inviteToken,
  });

  if (error) {
    throw new Error(`Erro ao gerar convite: ${error.message}`);
  }

  revalidatePath("/");

  return `${SITE_URL}/?convite=${inviteToken}`;
}

export async function atualizarConta(formData: FormData) {
  const { supabase, user } = await requireUser();
  const email = parseEmail(formData.get("email"));
  const fone = parsePhone(formData.get("fone"));
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const currentEmail = (user.email ?? "").toLocaleLowerCase("pt-BR");
  const emailChanged = email !== currentEmail;
  const passwordChanged = password.length > 0 || confirmPassword.length > 0;
  const updates: UserAttributes = {
    data: {
      fone,
    },
  };

  if (emailChanged) {
    updates.email = email;
  }

  if (passwordChanged) {
    if (password.length < 6) {
      throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
    }

    if (password !== confirmPassword) {
      throw new Error("As senhas digitadas nao conferem.");
    }

    updates.password = password;
  }

  const { error: authError } = await supabase.auth.updateUser(updates, {
    emailRedirectTo: `${SITE_URL}/auth/confirm`,
  });

  if (authError) {
    throw new Error(`Erro ao atualizar conta: ${authError.message}`);
  }

  const { error: profileError } = await supabase.rpc("update_own_profile_contact", {
    p_fone: fone,
  });

  if (profileError) {
    throw new Error(`Erro ao atualizar telefone: ${profileError.message}`);
  }

  revalidatePath("/");

  if (emailChanged) {
    return "Enviamos um link para confirmar o novo e-mail. Depois da confirmação, o e-mail antigo deixa de ser o login desta conta.";
  }

  if (passwordChanged) {
    return "Conta atualizada. Sua senha foi alterada.";
  }

  return "Conta atualizada.";
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
