"use server";

import { randomBytes } from "node:crypto";
import type { UserAttributes } from "@supabase/supabase-js";
import {
  buildParcelas,
  calcularJurosAtraso,
  formatDateOnly,
  parseCustomIntervalDays,
  parseCpfCnpj,
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
import { decryptAsaasCredential } from "@/lib/asaas-crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildRecurringCheckoutPayload, getAsaasCheckoutUrl } from "@/lib/asaas-checkout";
import { asPixImageDataUrl, buildRecurringPixSubscriptionPayload } from "@/lib/asaas-pix";
import { assertSaasWriteAccess } from "@/lib/saas-access";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://recebify.vercel.app";

function asaasApiUrl(environment: "sandbox" | "production") {
  return environment === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

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

async function requireWriteAccess(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.rpc("has_saas_write_access");
  assertSaasWriteAccess(data, error);
}

export async function criarCobranca(formData: FormData) {
  const { supabase, user } = await requireUser();
  await requireWriteAccess(supabase);
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
  await requireWriteAccess(supabase);
  const { data: linkedCharges, error: chargesError } = await supabase
    .from("asaas_charges")
    .select("id")
    .eq("parcela_id", parcelaId)
    .in("status", ["PENDING", "OVERDUE", "CONFIRMED"])
    .limit(1);
  if (chargesError) throw new Error(`Erro ao verificar cobrança externa: ${chargesError.message}`);
  if (linkedCharges?.length) throw new Error("Esta parcela tem um link de pagamento ativo. Cancele-o no meio de pagamento antes de registrar manualmente, para evitar cobrança duplicada.");
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
  await requireWriteAccess(supabase);
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
  await requireWriteAccess(supabase);
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
    if (linkedCharges?.length) throw new Error("Este cliente tem um link de pagamento ativo. Cancele-o no meio de pagamento antes de registrar recebimento manual.");
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
  await requireWriteAccess(supabase);
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
  await requireWriteAccess(supabase);
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
  await requireWriteAccess(supabase);
  const { error } = await supabase.rpc("arquivar_cobranca", {
    p_emprestimo_id: emprestimoId,
  });
  if (error) throw new Error(`Erro ao arquivar cobrança: ${error.message}`);
  revalidatePath("/");
}

export async function restaurarCobranca(emprestimoId: string) {
  const { supabase } = await requireUser();
  await requireWriteAccess(supabase);
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
    if (password.length < 8) {
      throw new Error("A nova senha deve ter pelo menos 8 caracteres.");
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
  await requireWriteAccess(supabase);
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

const PLAN_CONFIG = {
  starter: { name: "Recebify Essencial", monthlyPrice: process.env.SAAS_STARTER_MONTHLY_BRL },
} as const;

type SaasPixCharge = {
  value: number;
  dueDate: string;
  payload: string;
  imageDataUrl: string | null;
  expirationDate: string | null;
};

async function asaasErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { errors?: { description?: string }[]; message?: string } | null;
  return asaasErrorFromBody(body, fallback);
}

function asaasErrorFromBody(body: { errors?: { description?: string }[]; message?: string } | null, fallback: string) {
  return body?.errors?.find((item) => item.description)?.description ?? body?.message ?? fallback;
}

async function obterCobrancaPixAsaas(base: string, headers: Record<string, string>, subscriptionId: string): Promise<SaasPixCharge | null> {
  const response = await fetch(`${base}/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=100&offset=0`, {
    headers, cache: "no-store",
  });
  if (!response.ok) throw new Error(await asaasErrorMessage(response, "Não foi possível consultar a cobrança Pix no Asaas."));
  const result = await response.json() as { data?: { id?: string; billingType?: string; status?: string; value?: number; dueDate?: string; dateCreated?: string }[] };
  const payment = (result.data ?? [])
    .filter((item) => item.id && item.billingType === "PIX" && ["PENDING", "OVERDUE"].includes(item.status ?? ""))
    .sort((left, right) => String(right.dateCreated ?? right.dueDate ?? "").localeCompare(String(left.dateCreated ?? left.dueDate ?? "")))[0];
  if (!payment?.id) return null;

  const pixResponse = await fetch(`${base}/payments/${encodeURIComponent(payment.id)}/pixQrCode`, { headers, cache: "no-store" });
  if (!pixResponse.ok) {
    if ([400, 404].includes(pixResponse.status)) return null;
    throw new Error(await asaasErrorMessage(pixResponse, "Não foi possível carregar o QR Code Pix."));
  }
  const pix = await pixResponse.json() as { payload?: string; encodedImage?: string; expirationDate?: string };
  if (!pix.payload) return null;
  return {
    value: Number(payment.value ?? 0),
    dueDate: payment.dueDate ?? "",
    payload: pix.payload,
    imageDataUrl: asPixImageDataUrl(pix.encodedImage),
    expirationDate: pix.expirationDate ?? null,
  };
}

async function localizarOuCriarClientePixAsaas(args: {
  base: string;
  headers: Record<string, string>;
  userId: string;
  email: string;
  customerId: string | null;
  formData: FormData;
}) {
  if (args.customerId) return args.customerId;
  const name = parseRequiredText(args.formData.get("pix_name"), "Nome completo");
  if (name.length > 100) throw new Error("O nome deve ter no máximo 100 caracteres.");
  const cpfCnpj = parseCpfCnpj(args.formData.get("pix_cpf_cnpj"));
  const phone = parsePhone(args.formData.get("pix_phone"));
  if (!phone) throw new Error("Informe um telefone com DDD.");
  const postalCode = parseRequiredText(args.formData.get("pix_postal_code"), "CEP").replace(/\D/g, "");
  if (!/^\d{8}$/.test(postalCode)) throw new Error("Informe um CEP válido com 8 dígitos.");
  const address = parseRequiredText(args.formData.get("pix_address"), "Endereço");
  const addressNumber = parseRequiredText(args.formData.get("pix_address_number"), "Número");
  const province = parseRequiredText(args.formData.get("pix_province"), "Bairro");
  if ([address, addressNumber, province].some((value) => value.length > 100)) throw new Error("Revise o endereço informado.");

  const lookupParams = new URLSearchParams({ externalReference: args.userId, limit: "100", offset: "0" });
  const lookupResponse = await fetch(`${args.base}/customers?${lookupParams}`, { headers: args.headers, cache: "no-store" });
  if (!lookupResponse.ok) throw new Error(await asaasErrorMessage(lookupResponse, "Não foi possível localizar o cadastro de cobrança no Asaas."));
  const lookup = await lookupResponse.json() as { data?: { id?: string; externalReference?: string | null; cpfCnpj?: string }[] };
  const existingCustomer = (lookup.data ?? []).find((item) => item.id && item.externalReference === args.userId);
  if (existingCustomer?.id) return existingCustomer.id;

  const createResponse = await fetch(`${args.base}/customers`, {
    method: "POST",
    headers: args.headers,
    body: JSON.stringify({
      name,
      cpfCnpj,
      email: args.email,
      mobilePhone: phone.replace(/\D/g, ""),
      postalCode,
      address,
      addressNumber,
      province,
      externalReference: args.userId,
    }),
    cache: "no-store",
  });
  const customer = await createResponse.json().catch(() => null) as { id?: string; errors?: { description?: string }[]; message?: string } | null;
  if (!createResponse.ok || !customer?.id) throw new Error(asaasErrorFromBody(customer, "Não foi possível cadastrar os dados de cobrança no Asaas."));
  return customer.id;
}

async function localizarAssinaturaPixAsaas(base: string, headers: Record<string, string>, customerId: string, userId: string) {
  const params = new URLSearchParams({ customer: customerId, billingType: "PIX", status: "ACTIVE", externalReference: userId, limit: "100", offset: "0" });
  const response = await fetch(`${base}/subscriptions?${params}`, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(await asaasErrorMessage(response, "Não foi possível verificar assinaturas Pix existentes no Asaas."));
  const result = await response.json() as { data?: { id?: string; externalReference?: string | null }[] };
  return (result.data ?? []).find((item) => item.id && item.externalReference === userId)?.id ?? null;
}

export async function obterAssinaturaSaaS() {
  const { user, supabase } = await requireUser();
  const accessResult = await supabase.rpc("get_own_saas_access");
  const accessRows = !accessResult.error ? accessResult.data as { enforcement_enabled: boolean; can_write: boolean; subscription_status: string | null; access_until: string | null }[] | null : null;
  const access = accessRows?.[0] ?? null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("saas_subscriptions").select("plan_key,status,trial_ends_at,period_ends_at,asaas_customer_id,asaas_subscription_id,asaas_checkout_id,asaas_checkout_url,asaas_billing_type").eq("user_id", user.id).maybeSingle();
  if (error) return { configured: false, billingConfigured: false, liveBillingEnabled: false, environment: "sandbox", subscription: null, plans: [], access };
  return {
    configured: true,
    billingConfigured: Boolean(process.env.ASAAS_PLATFORM_API_KEY && (process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN?.length ?? 0) >= 32),
    liveBillingEnabled: process.env.ASAAS_PLATFORM_LIVE_BILLING_ENABLED === "true",
    subscription: data,
    environment: process.env.ASAAS_PLATFORM_ENV === "production" ? "production" : "sandbox",
    plans: Object.entries(PLAN_CONFIG).map(([key, plan]) => ({ key, name: plan.name, price: plan.monthlyPrice ? Number(plan.monthlyPrice) : null })),
    access,
  };
}

export async function ativarTesteSaaS() {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("activate_own_saas_trial");
  if (error || typeof data !== "string") {
    throw new Error("Não foi possível ativar o teste. Atualize a página ou fale com o suporte.");
  }
  revalidatePath("/");
  return data;
}

export async function assinarPlanoFluxo(formData: FormData, confirmarProducao = false) {
  try {
  const { user } = await requireUser();
  const planKey = String(formData.get("plan_key") ?? "");
  if (planKey !== "starter") throw new Error("Plano inválido.");
  const paymentMethod = String(formData.get("payment_method") ?? "CREDIT_CARD");
  if (paymentMethod !== "PIX" && paymentMethod !== "CREDIT_CARD") throw new Error("Forma de pagamento inválida.");
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
  const { data: existing, error: existingError } = await admin.from("saas_subscriptions")
    .select("asaas_subscription_id,asaas_customer_id,asaas_checkout_id,asaas_checkout_url,asaas_billing_type,status,trial_ends_at")
    .eq("user_id", user.id).maybeSingle();
  if (existingError) throw new Error("A atualização do checkout ainda não foi aplicada no Supabase. Fale com o suporte antes de tentar novamente.");
  if (!existing || existing.status === "pending_trial") throw new Error("Ative primeiro seus 7 dias de teste grátis.");
  if (existing.status === "trialing" && existing.trial_ends_at && new Date(existing.trial_ends_at) > new Date()) {
    throw new Error("Seu teste grátis ainda está ativo. A assinatura ficará disponível quando terminar.");
  }
  if (existing?.asaas_subscription_id && existing.status !== "canceled") {
    if (paymentMethod === "PIX" && existing.asaas_billing_type === "PIX") {
      const base = asaasApiUrl(environment);
      const pixCharge = await obterCobrancaPixAsaas(base, { access_token: apiKey, "User-Agent": "Recebify/1.0" }, existing.asaas_subscription_id);
      return { ok: true as const, paymentMethod: "PIX" as const, pixCharge };
    }
    throw new Error("Já existe uma assinatura ativa ou em andamento. Cancele-a antes de trocar de forma de pagamento.");
  }
  if (existing?.status === "active" && existing.asaas_checkout_id) throw new Error("Pagamento aprovado; aguarde alguns instantes enquanto vinculamos sua assinatura. Não inicie outro checkout.");
  const legacyCheckoutWithPrefilledCustomer = existing?.status === "incomplete"
    && Boolean(existing.asaas_checkout_id && existing.asaas_customer_id);
  if (paymentMethod === "CREDIT_CARD" && existing?.asaas_checkout_id && existing.asaas_checkout_url && existing.status === "incomplete" && !legacyCheckoutWithPrefilledCustomer) {
    return { ok: true as const, plan: PLAN_CONFIG[planKey].name, checkoutUrl: existing.asaas_checkout_url };
  }

  const base = asaasApiUrl(environment);
  const headers = { access_token: apiKey, "Content-Type": "application/json", "User-Agent": "Recebify/1.0" };
  const nextDueDate = formatDateOnly(new Date());

  if (paymentMethod === "PIX") {
    const { data: reserved, error: reserveError } = await admin.rpc("reserve_saas_pix_creation", { p_user_id: user.id });
    if (reserveError) throw new Error("A atualização do Pix ainda não foi aplicada no Supabase. Fale com o suporte antes de tentar novamente.");
    if (reserved !== true) throw new Error("Já existe uma tentativa de Pix em andamento. Aguarde alguns minutos e tente consultar a cobrança.");
    try {
    if (!user.email) throw new Error("Não encontramos um e-mail na sua conta para cadastrar a cobrança.");
    const customerId = await localizarOuCriarClientePixAsaas({
      base, headers, userId: user.id, email: user.email, customerId: existing?.asaas_customer_id ?? null, formData,
    });
    if (existing?.asaas_checkout_id && existing.status === "incomplete") {
      const cancelPrevious = await fetch(`${base}/checkouts/${encodeURIComponent(existing.asaas_checkout_id)}/cancel`, {
        method: "POST", headers, cache: "no-store",
      });
      if (!cancelPrevious.ok) throw new Error("Há um checkout de cartão ainda pendente. Cancele-o no Asaas antes de trocar para Pix.");
    }
    const { error: prepareError } = await admin.from("saas_subscriptions").upsert({
      user_id: user.id, plan_key: planKey, status: "incomplete", trial_ends_at: null, period_ends_at: null,
      asaas_customer_id: customerId, asaas_subscription_id: null, asaas_billing_type: "PIX",
      asaas_checkout_id: null, asaas_checkout_url: null, asaas_environment: environment, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (prepareError) throw new Error("Não foi possível preparar a assinatura Pix no sistema. Tente novamente ou fale com o suporte.");

    let asaasSubscriptionId = await localizarAssinaturaPixAsaas(base, headers, customerId, user.id);
    if (!asaasSubscriptionId) {
      const subscriptionResponse = await fetch(`${base}/subscriptions`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRecurringPixSubscriptionPayload({
          customerId,
          externalReference: user.id,
          planName: PLAN_CONFIG[planKey].name,
          price,
          nextDueDate,
        })),
        cache: "no-store",
      });
      const subscription = await subscriptionResponse.json().catch(() => null) as { id?: string; errors?: { description?: string }[]; message?: string } | null;
      if (!subscriptionResponse.ok || !subscription?.id) {
        throw new Error(asaasErrorFromBody(subscription, "Não foi possível criar a assinatura Pix no Asaas."));
      }
      asaasSubscriptionId = subscription.id;
    }

    const { error: linkError } = await admin.from("saas_subscriptions").update({
      asaas_customer_id: customerId, asaas_subscription_id: asaasSubscriptionId,
      asaas_billing_type: "PIX", asaas_checkout_id: null, asaas_checkout_url: null,
      asaas_environment: environment, updated_at: new Date().toISOString(),
    }).eq("user_id", user.id);
    if (linkError) {
      console.error("Assinatura Pix Recebify criada, mas não foi possível vinculá-la ao usuário", { userId: user.id, subscriptionId: asaasSubscriptionId, message: linkError.message });
      throw new Error("A assinatura foi iniciada, mas não conseguimos vinculá-la à conta. Não tente pagar; fale com o suporte.");
    }
    revalidatePath("/");
    const pixCharge = await obterCobrancaPixAsaas(base, headers, asaasSubscriptionId);
    return { ok: true as const, paymentMethod: "PIX" as const, pixCharge };
    } finally {
      const { error: releaseError } = await admin.rpc("release_saas_pix_creation", { p_user_id: user.id });
      if (releaseError) console.error("Não foi possível liberar a reserva de criação Pix", { userId: user.id, message: releaseError.message });
    }
  }

  if (existing?.asaas_checkout_id && existing.status === "incomplete") {
    const cancelPrevious = await fetch(`${base}/checkouts/${encodeURIComponent(existing.asaas_checkout_id)}/cancel`, {
      method: "POST", headers, cache: "no-store",
    });
    if (!cancelPrevious.ok) throw new Error("Há um checkout anterior ainda não confirmado. Abra-o para continuar ou confira o status no Asaas antes de gerar outro.");
  }
  const checkoutPayload = buildRecurringCheckoutPayload({
    siteUrl: SITE_URL,
    externalReference: user.id,
    planName: PLAN_CONFIG[planKey].name,
    price,
    nextDueDate,
  });
  const checkoutResponse = await fetch(`${base}/checkouts`, {
    method: "POST", headers, body: JSON.stringify(checkoutPayload), cache: "no-store",
  });
  const checkout = await checkoutResponse.json() as { id?: string; link?: string; errors?: { description?: string }[] };
  if (!checkoutResponse.ok || !checkout.id) {
    throw new Error(checkout.errors?.[0]?.description ?? "Não foi possível preparar o checkout seguro do Asaas.");
  }
  const checkoutUrl = getAsaasCheckoutUrl(environment, checkout);
  const { error } = await admin.from("saas_subscriptions").upsert({
    user_id: user.id, plan_key: planKey, status: "incomplete", trial_ends_at: null, period_ends_at: null,
    asaas_customer_id: null, asaas_subscription_id: null, asaas_billing_type: "CREDIT_CARD",
    asaas_checkout_id: checkout.id, asaas_checkout_url: checkoutUrl,
    asaas_environment: environment, updated_at: new Date().toISOString(),
  });
  if (error) {
    await fetch(`${base}/checkouts/${encodeURIComponent(checkout.id)}/cancel`, { method: "POST", headers, cache: "no-store" }).catch(() => undefined);
    console.error("Checkout Recebify criado, mas não foi possível vinculá-lo ao usuário", { userId: user.id, checkoutId: checkout.id, message: error.message });
    throw new Error("O checkout foi iniciado, mas não conseguimos vinculá-lo à conta. Não tente pagar; fale com o suporte.");
  }
  revalidatePath("/");
  return { ok: true as const, plan: PLAN_CONFIG[planKey].name, checkoutUrl };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Não foi possível iniciar a assinatura. Tente novamente.";
    return { ok: false as const, error: message };
  }
}

export async function obterCobrancaPixAssinatura() {
  const { user } = await requireUser();
  const admin = createSupabaseAdminClient();
  const { data: subscription, error } = await admin.from("saas_subscriptions")
    .select("asaas_subscription_id,asaas_billing_type,asaas_environment,status")
    .eq("user_id", user.id).maybeSingle();
  if (error || !subscription?.asaas_subscription_id || subscription.asaas_billing_type !== "PIX") {
    throw new Error("Não há uma assinatura Pix pendente nesta conta.");
  }
  if (subscription.status === "canceled" || subscription.status === "active") {
    throw new Error(subscription.status === "active" ? "O pagamento já foi confirmado." : "Esta assinatura Pix foi cancelada.");
  }
  const apiKey = process.env.ASAAS_PLATFORM_API_KEY;
  if (!apiKey) throw new Error("A conexão de cobrança não está disponível.");
  const environment = subscription.asaas_environment === "production" ? "production" : "sandbox";
  const charge = await obterCobrancaPixAsaas(asaasApiUrl(environment), { access_token: apiKey, "User-Agent": "Recebify/1.0" }, subscription.asaas_subscription_id);
  return { charge };
}

export async function cancelarAssinaturaFluxo() {
  const { user } = await requireUser();
  const admin = createSupabaseAdminClient();
  const { data: subscription, error: lookupError } = await admin.from("saas_subscriptions")
    .select("asaas_subscription_id,asaas_checkout_id,asaas_environment").eq("user_id", user.id).maybeSingle();
  if (lookupError || (!subscription?.asaas_subscription_id && !subscription?.asaas_checkout_id)) throw new Error("Não foi encontrada assinatura ou checkout para cancelar.");
  const environment = subscription.asaas_environment ?? "sandbox";
  const apiKey = process.env.ASAAS_PLATFORM_API_KEY;
  if (!apiKey) throw new Error("A conexão de cobrança do SaaS não está disponível.");
  const base = environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  const headers = { access_token: apiKey, "User-Agent": "Recebify/1.0" };
  const response = subscription.asaas_subscription_id
    ? await fetch(`${base}/subscriptions/${encodeURIComponent(subscription.asaas_subscription_id)}`, { method: "DELETE", headers, cache: "no-store" })
    : await fetch(`${base}/checkouts/${encodeURIComponent(subscription.asaas_checkout_id!)}/cancel`, { method: "POST", headers, cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível confirmar o cancelamento. Verifique o status da assinatura ou fale com o suporte.");
  const { error } = await admin.from("saas_subscriptions").update({ status: "canceled", asaas_checkout_id: null, asaas_checkout_url: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) throw new Error("O pedido de cancelamento foi recebido, mas não foi possível atualizar o status. Fale com o suporte.");
  revalidatePath("/");
}

export async function criarLinkAsaas(parcelaId: string, confirmarCobrancaReal = false) {
  const { supabase, user } = await requireUser();
  await requireWriteAccess(supabase);
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
