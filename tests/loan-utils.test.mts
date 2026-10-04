import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParcelas,
  calcularJurosAtraso,
  addDays,
  diasAtraso,
  formatDateOnly,
  parseCustomIntervalDays,
  parseCpfCnpj,
  parseDateOnly,
  parseInstallmentCount,
} from "../lib/loan-utils.ts";
import { resolveTrialGate } from "../lib/trial.ts";
import { buildRecurringCheckoutPayload, getAsaasCheckoutUrl } from "../lib/asaas-checkout.ts";
import { asPixImageDataUrl, buildRecurringPixSubscriptionPayload } from "../lib/asaas-pix.ts";
import { assertSaasWriteAccess, resolveOwnSaasWriteAccess } from "../lib/saas-access.ts";

test("parcelas rateiam centavos sem perder o valor total", () => {
  const parcelas = buildParcelas({
    emprestimoId: "cobranca-1",
    valorTotal: 100,
    qtdParcelas: 3,
    dataPrimeiroVencimento: "2026-01-31",
    periodicidade: "mensal",
    intervaloPersonalizadoDias: null,
  });
  assert.deepEqual(parcelas.map((parcela) => parcela.valor), [33.34, 33.33, 33.33]);
  assert.equal(parcelas.reduce((sum, parcela) => sum + Math.round(parcela.valor * 100), 0), 10000);
  assert.deepEqual(parcelas.map((parcela) => parcela.data_vencimento), ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("intervalo customizado valida limites e aplica dias corridos", () => {
  assert.equal(parseCustomIntervalDays("45", "personalizado"), 45);
  assert.throws(() => parseCustomIntervalDays("0", "personalizado"));
  const parcelas = buildParcelas({
    emprestimoId: "cobranca-2", valorTotal: 10, qtdParcelas: 2,
    dataPrimeiroVencimento: "2026-05-01", periodicidade: "personalizado",
    intervaloPersonalizadoDias: 45,
  });
  assert.equal(parcelas[1].data_vencimento, "2026-06-15");
});

test("validadores rejeitam data impossível e parcela fora do intervalo", () => {
  assert.throws(() => parseDateOnly("2026-02-30", "Vencimento"));
  assert.throws(() => parseInstallmentCount("121"));
  assert.equal(parseInstallmentCount("120"), 120);
});

test("CPF/CNPJ da assinatura aceita formatos pontuados e CNPJ alfanumérico", () => {
  assert.equal(parseCpfCnpj("123.456.789-01"), "12345678901");
  assert.equal(parseCpfCnpj("12.ABC.345/01DE-35"), "12ABC34501DE35");
  assert.throws(() => parseCpfCnpj("123"));
});

test("juros diário não cobra antes do vencimento e arredonda moeda", () => {
  const base = { saldoPrincipal: 100, dataVencimento: "2026-01-01", hoje: new Date("2026-01-04T12:00:00"), valorDiario: 0.5 };
  assert.equal(calcularJurosAtraso({ ...base, tipo: "valor" }), 1.5);
  assert.equal(calcularJurosAtraso({ ...base, tipo: "percentual" }), 1.5);
  assert.equal(calcularJurosAtraso({ ...base, dataVencimento: "2026-01-04", tipo: "valor" }), 0);
});

test("datas de vencimento usam o calendário de São Paulo independentemente do fuso do servidor", () => {
  assert.equal(formatDateOnly(new Date("2026-09-29T02:30:00.000Z")), "2026-09-28");
  assert.equal(formatDateOnly(new Date("2026-09-29T03:00:00.000Z")), "2026-09-29");
  assert.equal(addDays("2026-09-29", 7), "2026-10-06");
  assert.equal(diasAtraso("2026-09-28", new Date("2026-09-29T02:30:00.000Z")), 0);
  assert.equal(diasAtraso("2026-09-27", new Date("2026-09-29T02:30:00.000Z")), 1);
});

test("checkout recorrente usa cartão no Asaas e fornece callbacks de retorno", () => {
  const payload = buildRecurringCheckoutPayload({
    siteUrl: "https://recebify.vercel.app",
    externalReference: "user-example",
    planName: "Recebify Essencial",
    price: 5,
    nextDueDate: "2026-10-02",
  });

  assert.deepEqual(payload.billingTypes, ["CREDIT_CARD"]);
  assert.deepEqual(payload.chargeTypes, ["RECURRENT"]);
  assert.equal(payload.externalReference, "user-example");
  assert.equal(Object.hasOwn(payload, "customer"), false);
  assert.equal(Object.hasOwn(payload, "customerData"), false);
  assert.equal(payload.subscription.cycle, "MONTHLY");
  assert.equal(payload.items[0].value, 5);
  assert.equal(new URL(payload.callback.successUrl).searchParams.get("checkout"), "success");
  assert.equal(new URL(payload.callback.cancelUrl).searchParams.get("checkout"), "cancelled");
  assert.equal(new URL(payload.callback.expiredUrl).searchParams.get("checkout"), "expired");
});

test("checkout só aceita URL HTTPS oficial do Asaas para o ambiente escolhido", () => {
  assert.equal(
    getAsaasCheckoutUrl("production", { id: "checkout-1", link: "https://asaas.com/checkoutSession/show/checkout-1" }),
    "https://asaas.com/checkoutSession/show/checkout-1",
  );
  assert.equal(
    getAsaasCheckoutUrl("production", { id: "checkout-1", link: "https://www.asaas.com/abc/checkoutSession/show?id=checkout-1" }),
    "https://www.asaas.com/abc/checkoutSession/show?id=checkout-1",
  );
  assert.equal(
    getAsaasCheckoutUrl("sandbox", { id: "checkout-2", link: "https://sandbox.asaas.com/xyz/checkoutSession/show/checkout-2" }),
    "https://sandbox.asaas.com/xyz/checkoutSession/show/checkout-2",
  );
  assert.equal(
    getAsaasCheckoutUrl("sandbox", { id: "checkout-2" }),
    "https://sandbox.asaas.com/checkoutSession/show?id=checkout-2",
  );
  assert.throws(() => getAsaasCheckoutUrl("production", { id: "checkout-3", link: "https://evil.example/checkoutSession/show/checkout-3" }));
  assert.throws(() => getAsaasCheckoutUrl("production", { id: "checkout-3", link: "https://sandbox.asaas.com/checkoutSession/show/checkout-3" }));
  assert.throws(() => getAsaasCheckoutUrl("production", { id: "checkout-3", link: "https://www.asaas.com/account/checkout-3" }));
});

test("assinatura Pix configura cobrança recorrente mensal sem débito automático", () => {
  assert.deepEqual(buildRecurringPixSubscriptionPayload({
    customerId: "cus_test_123",
    externalReference: "user-example",
    planName: "Recebify Essencial",
    price: 29.9,
    nextDueDate: "2026-10-03",
  }), {
    customer: "cus_test_123",
    billingType: "PIX",
    nextDueDate: "2026-10-03",
    value: 29.9,
    cycle: "MONTHLY",
    description: "Assinatura mensal Recebify Essencial",
    externalReference: "user-example",
  });
});

test("normaliza imagem QR Pix em base64 e rejeita conteúdo não-imagem", () => {
  assert.equal(asPixImageDataUrl("aGVsbG8="), "data:image/png;base64,aGVsbG8=");
  assert.equal(asPixImageDataUrl("data:image/png;base64,aGVsbG8="), "data:image/png;base64,aGVsbG8=");
  assert.equal(asPixImageDataUrl("javascript:alert(1)"), null);
  assert.equal(asPixImageDataUrl(null), null);
});

test("cadeado distingue teste não iniciado, vencido e acesso pago", () => {
  const base = { enforcementEnabled: true, canWrite: false, unavailable: false };
  assert.equal(resolveTrialGate({ ...base, subscriptionStatus: "pending_trial" }), "pending");
  assert.equal(resolveTrialGate({ ...base, subscriptionStatus: "trialing" }), "expired");
  assert.equal(resolveTrialGate({ ...base, subscriptionStatus: "incomplete" }), "payment");
  assert.equal(resolveTrialGate({ ...base, subscriptionStatus: "canceled" }), "payment");
  assert.equal(resolveTrialGate({ ...base, canWrite: true, subscriptionStatus: "active" }), null);
  assert.equal(resolveTrialGate({ ...base, canWrite: true, subscriptionStatus: "trialing" }), null);
  assert.equal(resolveTrialGate({ ...base, unavailable: true, subscriptionStatus: "pending_trial" }), "unavailable");
  assert.equal(resolveTrialGate({ ...base, enforcementEnabled: false, subscriptionStatus: "pending_trial" }), null);
});

test("consulta de acesso SaaS bloqueia gravações se o RPC falha ou retorna dados incompletos", () => {
  assert.deepEqual(resolveOwnSaasWriteAccess(null, new Error("offline")), { canWrite: false, unavailable: true });
  assert.deepEqual(resolveOwnSaasWriteAccess([], null), { canWrite: false, unavailable: true });
  assert.deepEqual(resolveOwnSaasWriteAccess([{ can_write: "true" }], null), { canWrite: false, unavailable: true });
  assert.deepEqual(resolveOwnSaasWriteAccess([{ can_write: true }], null), { canWrite: true, unavailable: false });
  assert.deepEqual(resolveOwnSaasWriteAccess([{ can_write: false }], null), { canWrite: false, unavailable: false });
});

test("ações SaaS falham fechadas diante de falha ou acesso negado", () => {
  assert.throws(() => assertSaasWriteAccess(true, new Error("offline")), /não foi possível confirmar/i);
  assert.throws(() => assertSaasWriteAccess(false, null), /período de avaliação terminou/i);
  assert.throws(() => assertSaasWriteAccess(undefined, null), /período de avaliação terminou/i);
  assert.doesNotThrow(() => assertSaasWriteAccess(true, null));
});
