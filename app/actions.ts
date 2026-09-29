"use server";

import { createHash, randomBytes } from "node:crypto";
import type { UserAttributes } from "@supabase/supabase-js";
import {
  buildParcelas,
  calcularJurosAtraso,
  parseCustomIntervalDays,
  parseCpf,
  parseDateOnly,
  parseDueFrequency,
  parseEmail,
  parseInstallmentCount,
  parseOptionalText,
  parsePhone,
  parsePositiveNumber,
  parseRequiredText,
} from "@/lib/loan-utils";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { encryptAsaasCredential, decryptAsaasCredential } from "@/lib/asaas-crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://recebify.vercel.app";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Sessao expirada. Entre novamente para continuar.");
  }

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw new Error("Nao foi possivel validar a autenticacao em duas etapas.");
  if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    throw new Error("Confirme o codigo do autenticador antes de continuar.");
  }

  return { supabase, user };
}

export async function criarCobranca(formData: FormData) {
  const { supabase, user } = await requireUser();
  const nome = parseRequiredText(formData.get("nome"), "Nome do cliente");
  const descricao = parseOptionalText(formData.get("descricao"), 160);
  const endereco = parseOptionalText(formData.get("endereco"), 240);
  const telefone = parsePhone(formData.get("telefone"));
  const cpf = parseCpf(formData.get("cpf"));
  const valorTotal = parsePositiveNumber(formData.get("valor"), "Valor total");
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
      juros_percentual: 0,
      qtd_parcelas: qtdParcelas,
      data_primeiro_vencimento: dataPrimeiroVencimento,
      periodicidade_vencimento: periodicidade,
      intervalo_personalizado_dias: intervaloPersonalizadoDias,
      juros_atraso_tipo: "percentual",
      juros_atraso_valor: 0,
      descricao,
    })
    .select()
    .single();

  if (emprestimoError || !emprestimo) {
    await supabase.from("clientes").delete().eq("id", cliente.id);
    throw new Error(`Erro ao criar cobrança: ${emprestimoError?.message}`);
  }

  const parcelasParaInserir = buildParcelas({
    emprestimoId: emprestimo.id,
    valorTotal,
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
    throw new Error(`Erro ao criar cobranças: ${parcelasError.message}`);
  }

  revalidatePath("/");
}

export async function marcarComoPago(parcelaId: string) {
  const { supabase } = await requireUser();
  const { data: linkedCharges, error: chargesError } = await supabase
    .from("asaas_charges")
    .select("id")
    .eq("parcela_id", parcelaId)
    .in("status", ["PENDING", "OVERDUE", "CONFIRMED"])
    .limit(1);
  if (chargesError) throw new Error(`Erro ao verificar cobrança externa: ${chargesError.message}`);
  if (linkedCharges?.length) throw new Error("Esta parcela tem um link Asaas ativo. Cancele-o no Asaas antes de registrar pagamento manual, para evitar cobrança duplicada.");
  const { error } = await supabase.rpc("registrar_pagamento_parcela", {
    p_parcela_id: parcelaId,
  });

  if (error) {
    throw new Error(`Erro ao marcar como pago: ${error.message}`);
  }

  revalidatePath("/");
}

export async function reabrirParcela(parcelaId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("reabrir_parcela", {
    p_parcela_id: parcelaId,
  });

  if (error) {
    throw new Error(`Erro ao reabrir parcela: ${error.message}`);
  }

  revalidatePath("/");
}

export async function registrarPagamentoCliente(formData: FormData) {
  const { supabase } = await requireUser();
  const clienteId = parseRequiredText(formData.get("cliente_id"), "Cliente");
  const valorRecebido = parsePositiveNumber(formData.get("valor_pago"), "Valor pago");
  const { data: openInstallments, error: installmentsError } = await supabase
    .from("parcelas")
    .select("id,emprestimos!inner(cliente_id)")
    .eq("status", "Pendente")
    .eq("emprestimos.cliente_id", clienteId);
  if (installmentsError) throw new Error(`Erro ao verificar cobranças externas: ${installmentsError.message}`);
  const installmentIds = (openInstallments ?? []).map((row) => row.id);
  if (installmentIds.length) {
    const { data: linkedCharges, error: chargesError } = await supabase
      .from("asaas_charges")
      .select("id")
      .in("parcela_id", installmentIds)
      .in("status", ["PENDING", "OVERDUE", "CONFIRMED"])
      .limit(1);
    if (chargesError) throw new Error(`Erro ao verificar cobrança externa: ${chargesError.message}`);
    if (linkedCharges?.length) throw new Error("Este cliente tem link Asaas ativo. Cancele-o no Asaas antes de registrar recebimento manual.");
  }
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
  const endereco = parseOptionalText(formData.get("endereco"), 240);
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

export async function registrarContatoCobranca(formData: FormData) {
  const { supabase } = await requireUser();
  const parcelaId = parseRequiredText(formData.get("parcela_id"), "Cobrança");
  const canal = String(formData.get("canal") ?? "manual");
  const observacao = parseOptionalText(formData.get("observacao"), 500);
  const { error } = await supabase.rpc("registrar_contato_cobranca", {
    p_parcela_id: parcelaId,
    p_canal: canal,
    p_observacao: observacao,
  });
  if (error) throw new Error(`Erro ao registrar contato: ${error.message}`);
  revalidatePath("/");
}

export async function arquivarCobranca(emprestimoId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("arquivar_cobranca", {
    p_emprestimo_id: emprestimoId,
  });
  if (error) throw new Error(`Erro ao arquivar cobrança: ${error.message}`);
  revalidatePath("/");
}

export async function restaurarCobranca(emprestimoId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("restaurar_cobranca", {
    p_emprestimo_id: emprestimoId,
  });
  if (error) throw new Error(`Erro ao restaurar cobrança: ${error.message}`);
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

export async function atualizarPreferenciasEmail(formData: FormData) {
  const { supabase } = await requireUser();
  const enabled = formData.get("email_reminders_enabled") === "on";
  const { error } = await supabase.rpc("update_own_email_reminders", {
    p_enabled: enabled,
  });
  if (error) throw new Error(`Erro ao salvar preferencia: ${error.message}`);
  revalidatePath("/");
}

export async function restaurarBackup(formData: FormData) {
  const { supabase } = await requireUser();
  const file = formData.get("backup");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Selecione um arquivo JSON de backup.");
  }
  if (file.size > 5_000_000) throw new Error("O backup deve ter no máximo 5 MB.");

  let backup: unknown;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("O arquivo não contém JSON válido.");
  }
  if (!backup || typeof backup !== "object" || (backup as { formato?: unknown }).formato !== "fluxo-backup-v1") {
    throw new Error("Este não é um backup válido do Recebify.");
  }

  const { data, error } = await supabase.rpc("restore_fluxo_backup", {
    p_backup: backup,
  });
  if (error) throw new Error(`Falha ao restaurar: ${error.message}`);
  revalidatePath("/");
  return data as Record<string, number>;
}

function asaasApiUrl(environment: "sandbox" | "production") {
  return environment === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

export async function conectarAsaas(formData: FormData) {
  const { user } = await requireUser();
  const credential = String(formData.get("asaas_api_key") ?? "").trim();
  const environment = formData.get("asaas_environment") === "production" ? "production" : "sandbox";
  if (credential.length < 16 || credential.length > 512) throw new Error("Chave Asaas inválida.");

  const admin = createSupabaseAdminClient();
  const { data: previousConnection } = await admin.from("asaas_connections").select("user_id").eq("user_id", user.id).maybeSingle();
  if (previousConnection) {
    const { count, error: pendingError } = await admin.from("asaas_charges").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).in("status", ["PENDING", "OVERDUE", "CONFIRMED"]);
    if (pendingError) throw new Error("Não foi possível verificar cobranças pendentes da conexão anterior.");
    if ((count ?? 0) > 0) throw new Error("Cancele ou aguarde as cobranças Asaas pendentes antes de trocar a chave, para não perder a conciliação do webhook.");
  }

  const url = asaasApiUrl(environment);
  const validation = await fetch(`${url}/customers?limit=1`, {
    headers: { access_token: credential, accept: "application/json", "User-Agent": "Recebify/1.0" },
    cache: "no-store",
  });
  if (!validation.ok) throw new Error("O Asaas rejeitou a chave ou o ambiente selecionado. Confira no próprio painel Asaas.");

  const webhookToken = randomBytes(32).toString("hex");
  const encrypted = encryptAsaasCredential(credential);
  const { error } = await admin.from("asaas_connections").upsert({
    user_id: user.id,
    environment,
    ...encrypted,
    webhook_token_hash: createHash("sha256").update(webhookToken).digest("hex"),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Não foi possível guardar a conexão Asaas com segurança.");

  revalidatePath("/");
  return {
    environment,
    webhookToken,
    webhookUrl: `${SITE_URL}/api/webhooks/asaas`,
  };
}

export async function obterStatusAsaas() {
  const { user } = await requireUser();
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("asaas_connections").select("environment").eq("user_id", user.id).maybeSingle();
    if (error) return { connected: false, environment: null as string | null };
    return { connected: Boolean(data), environment: data?.environment ?? null };
  } catch {
    return { connected: false, environment: null as string | null };
  }
}

const PLAN_CONFIG = {
  starter: { name: "Recebify Essencial", monthlyPrice: process.env.SAAS_STARTER_MONTHLY_BRL },
} as const;

export async function obterAssinaturaSaaS() {
  const { user } = await requireUser();
  const admin = createSupabaseAdminClient();
  let { data, error } = await admin.from("saas_subscriptions").select("plan_key,status,trial_ends_at,period_ends_at,asaas_subscription_id").eq("user_id", user.id).maybeSingle();
  if (error) return { configured: false, billingConfigured: false, liveBillingEnabled: false, environment: "sandbox", subscription: null, plans: [] };
  if (!data) {
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = await admin.from("saas_subscriptions").insert({ user_id: user.id, plan_key: "trial", status: "trialing", trial_ends_at: trialEndsAt }).select("plan_key,status,trial_ends_at,period_ends_at,asaas_subscription_id").single();
    data = result.data;
    error = result.error;
  }
  return {
    configured: true,
    billingConfigured: Boolean(process.env.ASAAS_PLATFORM_API_KEY && (process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN?.length ?? 0) >= 32),
    liveBillingEnabled: process.env.ASAAS_PLATFORM_LIVE_BILLING_ENABLED === "true",
    subscription: error ? null : data,
    environment: process.env.ASAAS_PLATFORM_ENV === "production" ? "production" : "sandbox",
    plans: Object.entries(PLAN_CONFIG).map(([key, plan]) => ({ key, name: plan.name, price: plan.monthlyPrice ? Number(plan.monthlyPrice) : null })),
  };
}

export async function assinarPlanoFluxo(formData: FormData, confirmarProducao = false) {
  const { user } = await requireUser();
  const planKey = String(formData.get("plan_key") ?? "");
  if (planKey !== "starter") throw new Error("Plano inválido.");
  const priceRaw = PLAN_CONFIG[planKey].monthlyPrice;
  const price = Number(priceRaw);
  if (!priceRaw || !Number.isFinite(price) || price <= 0) throw new Error("O preço deste plano ainda não foi configurado pelo administrador do SaaS.");

  const apiKey = process.env.ASAAS_PLATFORM_API_KEY;
  const environment = process.env.ASAAS_PLATFORM_ENV === "production" ? "production" : "sandbox";
  if (!apiKey) throw new Error("A cobrança da assinatura Recebify ainda não foi configurada.");
  if (environment === "production" && process.env.ASAAS_PLATFORM_LIVE_BILLING_ENABLED !== "true") {
    throw new Error("A cobrança real do Recebify está bloqueada até a habilitação explícita do administrador.");
  }
  if (environment === "production" && confirmarProducao !== true) {
    throw new Error("Confirme explicitamente a criação da assinatura em produção.");
  }
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("saas_subscriptions").select("asaas_subscription_id,status").eq("user_id", user.id).maybeSingle();
  if (existing?.asaas_subscription_id && existing.status !== "canceled") throw new Error("Já existe uma assinatura ativa ou em andamento. Cancele-a antes de trocar de plano.");

  const profile = await admin.from("profiles").select("email,fone").eq("id", user.id).maybeSingle();
  if (!profile.data?.email) throw new Error("Não há e-mail cadastrado para a conta.");
  const base = environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  const headers = { access_token: apiKey, "Content-Type": "application/json", "User-Agent": "Recebify/1.0" };
  const customerLookup = new URL(`${base}/customers`);
  customerLookup.searchParams.set("externalReference", user.id);
  customerLookup.searchParams.set("limit", "1");
  const lookupResponse = await fetch(customerLookup, { headers, cache: "no-store" });
  if (!lookupResponse.ok) throw new Error("Não foi possível consultar clientes da conta Asaas da plataforma.");
  const lookup = await lookupResponse.json() as { data?: { id: string }[] };
  let customerId = lookup.data?.[0]?.id;
  if (!customerId) {
    const customerResponse = await fetch(`${base}/customers`, {
      method: "POST", headers,
      body: JSON.stringify({ name: profile.data.email, email: profile.data.email, mobilePhone: profile.data.fone || undefined, externalReference: user.id }),
      cache: "no-store",
    });
    const customer = await customerResponse.json() as { id?: string; errors?: { description?: string }[] };
    if (!customerResponse.ok || !customer.id) throw new Error(customer.errors?.[0]?.description ?? "Falha ao criar cliente da assinatura.");
    customerId = customer.id;
  }

  const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(due).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  const nextDueDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const subscriptionsUrl = new URL(`${base}/subscriptions`);
  subscriptionsUrl.searchParams.set("externalReference", user.id);
  subscriptionsUrl.searchParams.set("limit", "10");
  const subscriptionsResponse = await fetch(subscriptionsUrl, { headers, cache: "no-store" });
  if (!subscriptionsResponse.ok) throw new Error("Não foi possível verificar assinaturas anteriores no Asaas.");
  const subscriptions = await subscriptionsResponse.json() as { data?: { id: string; status?: string }[] };
  let providerSubscriptionId = subscriptions.data?.find((item) => item.status !== "INACTIVE")?.id;
  if (!providerSubscriptionId) {
    const subscriptionResponse = await fetch(`${base}/subscriptions`, {
      method: "POST", headers,
      body: JSON.stringify({
        customer: customerId, billingType: "UNDEFINED", value: price,
        nextDueDate, cycle: "MONTHLY", description: `Recebify ${PLAN_CONFIG[planKey].name}`,
        externalReference: user.id,
      }),
      cache: "no-store",
    });
    const providerSubscription = await subscriptionResponse.json() as { id?: string; errors?: { description?: string }[] };
    if (!subscriptionResponse.ok || !providerSubscription.id) throw new Error(providerSubscription.errors?.[0]?.description ?? "Falha ao agendar a assinatura no Asaas.");
    providerSubscriptionId = providerSubscription.id;
  }
  const { error } = await admin.from("saas_subscriptions").upsert({
    user_id: user.id, plan_key: planKey, status: "trialing", trial_ends_at: `${nextDueDate}T00:00:00-03:00`,
    asaas_customer_id: customerId, asaas_subscription_id: providerSubscriptionId,
    asaas_environment: environment, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Assinatura criada no Asaas, mas não foi possível salvar no Recebify. Contate o suporte antes de repetir.");
  revalidatePath("/");
  return { plan: PLAN_CONFIG[planKey].name, nextDueDate, environment };
}

export async function cancelarAssinaturaFluxo() {
  const { user } = await requireUser();
  const admin = createSupabaseAdminClient();
  const { data: subscription, error: lookupError } = await admin.from("saas_subscriptions")
    .select("asaas_subscription_id,asaas_environment").eq("user_id", user.id).maybeSingle();
  if (lookupError || !subscription?.asaas_subscription_id) throw new Error("Não foi encontrada assinatura recorrente para cancelar.");
  const environment = subscription.asaas_environment ?? "sandbox";
  const apiKey = process.env.ASAAS_PLATFORM_API_KEY;
  if (!apiKey) throw new Error("A conexão de cobrança do SaaS não está disponível.");
  const base = environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  const response = await fetch(`${base}/subscriptions/${encodeURIComponent(subscription.asaas_subscription_id)}`, {
    method: "DELETE", headers: { access_token: apiKey, "User-Agent": "Recebify/1.0" }, cache: "no-store",
  });
  if (!response.ok) throw new Error("O Asaas não confirmou o cancelamento. Verifique a assinatura no painel Asaas antes de tentar novamente.");
  const { error } = await admin.from("saas_subscriptions").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) throw new Error("Cancelamento recebido pelo Asaas, mas não foi possível atualizar o status local.");
  revalidatePath("/");
}

export async function desconectarAsaas() {
  const { user } = await requireUser();
  const admin = createSupabaseAdminClient();
  const { count, error: pendingError } = await admin.from("asaas_charges").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("status", ["PENDING", "OVERDUE", "CONFIRMED"]);
  if (pendingError) throw new Error("Não foi possível verificar cobranças pendentes.");
  if ((count ?? 0) > 0) throw new Error("Cancele ou aguarde as cobranças Asaas pendentes antes de remover a conexão.");
  const { error } = await admin.from("asaas_connections").delete().eq("user_id", user.id);
  if (error) throw new Error("Não foi possível remover a conexão Asaas.");
  revalidatePath("/");
}

export async function criarLinkAsaas(parcelaId: string, confirmarCobrancaReal = false) {
  const { supabase, user } = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(parcelaId)) throw new Error("Cobrança inválida.");
  const { data: parcela, error: parcelaError } = await supabase
    .from("parcelas")
    .select("id,numero,valor,valor_pago,valor_juros_atraso_pago,data_vencimento,status,emprestimos!inner(descricao,juros_atraso_tipo,juros_atraso_valor,clientes!inner(id,nome,cpf,telefone,asaas_customer_id))")
    .eq("id", parcelaId)
    .maybeSingle();
  if (parcelaError || !parcela) throw new Error("Cobrança não encontrada nesta conta.");
  if (parcela.status === "Pago") throw new Error("Esta cobrança já está paga.");
  const saldoPrincipal = Math.round((Number(parcela.valor) - Number(parcela.valor_pago ?? 0)) * 100) / 100;
  if (saldoPrincipal <= 0) throw new Error("Esta cobrança não possui saldo em aberto.");
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
  const todayString = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

  const admin = createSupabaseAdminClient();
  const { data: connection, error: connectionError } = await admin
    .from("asaas_connections")
    .select("environment,credential_ciphertext,credential_iv,credential_tag")
    .eq("user_id", user.id)
    .maybeSingle();
  if (connectionError || !connection) throw new Error("Conecte sua conta Asaas nas configurações antes de gerar o link.");
  if (connection.environment === "production" && confirmarCobrancaReal !== true) {
    throw new Error("Confirme explicitamente a criação de uma cobrança real.");
  }

  const { data: existing, error: existingError } = await admin
    .from("asaas_charges")
    .select("invoice_url,status")
    .eq("user_id", user.id)
    .eq("parcela_id", parcelaId)
    .in("status", ["PENDING", "OVERDUE", "CONFIRMED"])
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error("Não foi possível verificar links anteriores.");
  if (existing?.invoice_url) return existing.invoice_url;

  const apiKey = decryptAsaasCredential(connection);
  const baseUrl = asaasApiUrl(connection.environment);
  const loan = parcela.emprestimos as unknown as {
    descricao: string | null;
    juros_atraso_tipo: "valor" | "percentual" | null;
    juros_atraso_valor: number | null;
    clientes: { id: string; nome: string; cpf: string | null; telefone: string | null; asaas_customer_id: string | null };
  };
  const calculatedInterest = calcularJurosAtraso({
    saldoPrincipal,
    dataVencimento: parcela.data_vencimento,
    hoje: new Date(`${todayString}T12:00:00`),
    tipo: loan.juros_atraso_tipo ?? "percentual",
    valorDiario: Number(loan.juros_atraso_valor ?? 0),
  });
  const interest = Math.max(Math.round((calculatedInterest - Number(parcela.valor_juros_atraso_pago ?? 0)) * 100) / 100, 0);
  const saldo = Math.round((saldoPrincipal + interest) * 100) / 100;
  const client = loan.clientes;
  let customerId = client.asaas_customer_id;

  if (!customerId) {
    const search = new URL(`${baseUrl}/customers`);
    search.searchParams.set("externalReference", client.id);
    search.searchParams.set("limit", "1");
    const foundResponse = await fetch(search, { headers: { access_token: apiKey, "User-Agent": "Recebify/1.0" }, cache: "no-store" });
    const foundBody = await foundResponse.json() as { data?: { id: string }[] };
    customerId = foundBody.data?.[0]?.id ?? null;
    if (!customerId) {
      const customerResponse = await fetch(`${baseUrl}/customers`, {
        method: "POST",
        headers: { access_token: apiKey, "Content-Type": "application/json", "User-Agent": "Recebify/1.0" },
        body: JSON.stringify({
          name: client.nome,
          cpfCnpj: client.cpf || undefined,
          mobilePhone: client.telefone?.replace(/\D/g, "") || undefined,
          externalReference: client.id,
        }),
        cache: "no-store",
      });
      const customerBody = await customerResponse.json() as { id?: string; errors?: { description?: string }[] };
      if (!customerResponse.ok || !customerBody.id) {
        throw new Error(customerBody.errors?.[0]?.description ?? "O Asaas não conseguiu cadastrar este cliente.");
      }
      customerId = customerBody.id;
    }
    const { error: saveCustomerError } = await supabase.from("clientes").update({ asaas_customer_id: customerId }).eq("id", client.id);
    if (saveCustomerError) throw new Error("Cliente criado no Asaas, mas não foi possível salvar o vínculo. Reconecte e tente novamente.");
  }

  // Recupera cobranças anteriores ainda ativas caso a requisição original tenha
  // chegado ao Asaas, mas a conexão tenha caído antes do registro local.
  const priorPaymentsUrl = new URL(`${baseUrl}/payments`);
  priorPaymentsUrl.searchParams.set("externalReference", parcelaId);
  priorPaymentsUrl.searchParams.set("customer", customerId);
  priorPaymentsUrl.searchParams.set("limit", "10");
  const priorResponse = await fetch(priorPaymentsUrl, {
    headers: { access_token: apiKey, "User-Agent": "Recebify/1.0" },
    cache: "no-store",
  });
  if (!priorResponse.ok) throw new Error("Não foi possível verificar cobranças existentes no Asaas.");
  const priorData = await priorResponse.json() as {
    data?: { id: string; status: string; invoiceUrl?: string; value: number }[];
  };
  const priorActive = priorData.data?.find((item) => ["PENDING", "OVERDUE", "CONFIRMED"].includes(item.status));
  if (priorActive?.id && priorActive.invoiceUrl) {
    const { error: recordError } = await admin.from("asaas_charges").upsert({
      user_id: user.id, parcela_id: parcelaId, asaas_payment_id: priorActive.id,
      amount: priorActive.value, interest, status: priorActive.status, invoice_url: priorActive.invoiceUrl,
    }, { onConflict: "user_id,asaas_payment_id" });
    if (recordError) throw new Error("Cobrança ativa encontrada no Asaas, mas falhou ao salvar sua referência.");
    return priorActive.invoiceUrl;
  }
  if (priorData.data?.some((item) => item.status === "RECEIVED")) {
    throw new Error("O Asaas já marcou uma cobrança desta parcela como recebida. Confira o histórico ou aguarde a conciliação antes de criar outra.");
  }

  const dueDate = parcela.data_vencimento < todayString
    ? todayString
    : parcela.data_vencimento;
  const paymentResponse = await fetch(`${baseUrl}/payments`, {
    method: "POST",
    headers: { access_token: apiKey, "Content-Type": "application/json", "User-Agent": "Recebify/1.0" },
    body: JSON.stringify({
      customer: customerId,
      billingType: "UNDEFINED",
      value: saldo,
      dueDate,
      description: `${loan.descricao || "Cobrança Recebify"} - parcela ${parcela.numero}`.slice(0, 500),
      externalReference: parcela.id,
    }),
    cache: "no-store",
  });
  const payment = await paymentResponse.json() as { id?: string; invoiceUrl?: string; status?: string; errors?: { description?: string }[] };
  if (!paymentResponse.ok || !payment.id || !payment.invoiceUrl) {
    throw new Error(payment.errors?.[0]?.description ?? "O Asaas não conseguiu gerar a cobrança.");
  }

  const { error: saveChargeError } = await admin.from("asaas_charges").insert({
    user_id: user.id,
    parcela_id: parcelaId,
    asaas_payment_id: payment.id,
    amount: saldo,
    interest,
    status: payment.status ?? "PENDING",
    invoice_url: payment.invoiceUrl,
  });
  if (saveChargeError) throw new Error("Link gerado, mas não foi possível registrar a conciliação no Recebify.");
  revalidatePath("/");
  return payment.invoiceUrl;
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
