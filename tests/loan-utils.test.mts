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
import { getFirstBillingDate, getTrialEnd, getTrialEndDateOnly } from "../lib/trial.ts";

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

test("trial começa na criação da conta e assinatura vencida agenda a primeira cobrança para hoje", () => {
  const createdAt = "2026-09-22T12:00:00.000Z";
  assert.equal(getTrialEnd(createdAt).toISOString(), "2026-09-29T12:00:00.000Z");
  assert.equal(getTrialEndDateOnly(createdAt), "2026-09-29");
  assert.equal(getFirstBillingDate(createdAt, new Date("2026-09-25T15:00:00.000Z")), "2026-09-29");
  assert.equal(getFirstBillingDate(createdAt, new Date("2026-10-01T15:00:00.000Z")), "2026-10-01");
});
