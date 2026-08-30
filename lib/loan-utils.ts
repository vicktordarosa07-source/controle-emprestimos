export type PeriodicidadeVencimento =
  | "semanal"
  | "quinzenal"
  | "mensal"
  | "personalizado";

export type TipoJurosAtraso = "valor" | "percentual";

export type InstallmentInput = {
  emprestimoId: string;
  valorTotal: number;
  jurosPercentual: number;
  qtdParcelas: number;
  dataPrimeiroVencimento: string;
  periodicidade: PeriodicidadeVencimento;
  intervaloPersonalizadoDias: number | null;
};

export type ParcelaInsert = {
  emprestimo_id: string;
  numero: number;
  valor: number;
  valor_pago: number;
  data_vencimento: string;
  status: "Pendente";
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_BILLING_MONTH = 30;

export function parseRequiredText(value: FormDataEntryValue | null, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} e obrigatorio`);
  }

  return value.trim();
}

export function parsePositiveNumber(value: FormDataEntryValue | null, field: string) {
  const raw = parseRequiredText(value, field).replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`${field} deve ser um numero valido`);
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} deve ser maior que zero`);
  }

  return parsed;
}

export function parseNonNegativeNumber(value: FormDataEntryValue | null, field: string) {
  const raw = parseRequiredText(value, field).replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`${field} deve ser um numero valido`);
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} nao pode ser negativo`);
  }

  return parsed;
}

export function parseInstallmentCount(value: FormDataEntryValue | null) {
  const raw = parseRequiredText(value, "Quantidade de parcelas");

  if (!/^\d+$/.test(raw)) {
    throw new Error("Quantidade de parcelas deve ser um numero inteiro");
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 120) {
    throw new Error("Quantidade de parcelas deve ficar entre 1 e 120");
  }

  return parsed;
}

export function parseDueFrequency(value: FormDataEntryValue | null) {
  const raw = parseRequiredText(value, "Vencimento");

  if (
    raw !== "semanal" &&
    raw !== "quinzenal" &&
    raw !== "mensal" &&
    raw !== "personalizado"
  ) {
    throw new Error("Vencimento deve ser semanal, quinzenal, mensal ou personalizado");
  }

  return raw;
}

export function parseLateInterestType(value: FormDataEntryValue | null) {
  const raw = parseRequiredText(value, "Tipo de juro por atraso");

  if (raw !== "valor" && raw !== "percentual") {
    throw new Error("Tipo de juro por atraso deve ser em reais ou percentual");
  }

  return raw;
}

export function parseCustomIntervalDays(
  value: FormDataEntryValue | null,
  periodicidade: PeriodicidadeVencimento
) {
  if (periodicidade !== "personalizado") {
    return null;
  }

  const raw = parseRequiredText(value, "Intervalo personalizado");

  if (!/^\d+$/.test(raw)) {
    throw new Error("Intervalo personalizado deve ser um numero inteiro de dias");
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new Error("Intervalo personalizado deve ficar entre 1 e 365 dias");
  }

  return parsed;
}

export function parseDateOnly(value: FormDataEntryValue | null, field: string) {
  const raw = parseRequiredText(value, field);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${field} deve estar no formato AAAA-MM-DD`);
  }

  const date = new Date(`${raw}T12:00:00`);

  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== raw) {
    throw new Error(`${field} invalida`);
  }

  return raw;
}

export function formatDateOnly(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

export function addMonthsPreservingDueDay(dateOnly: string, months: number) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();

  return formatDateOnly(
    new Date(targetYear, normalizedMonthIndex, Math.min(day, lastDay), 12)
  );
}

export function addDays(dateOnly: string, days: number) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);

  return formatDateOnly(date);
}

function getDataVencimento({
  dataPrimeiroVencimento,
  periodicidade,
  intervaloPersonalizadoDias,
  index,
}: {
  dataPrimeiroVencimento: string;
  periodicidade: PeriodicidadeVencimento;
  intervaloPersonalizadoDias: number | null;
  index: number;
}) {
  if (periodicidade === "mensal") {
    return addMonthsPreservingDueDay(dataPrimeiroVencimento, index);
  }

  const diasPorParcela = {
    semanal: 7,
    quinzenal: 15,
    personalizado: intervaloPersonalizadoDias ?? 0,
  }[periodicidade];

  if (diasPorParcela <= 0) {
    throw new Error("Intervalo personalizado invalido");
  }

  return addDays(dataPrimeiroVencimento, diasPorParcela * index);
}

function getPrazoEmMeses({
  periodicidade,
  intervaloPersonalizadoDias,
  qtdParcelas,
}: {
  periodicidade: PeriodicidadeVencimento;
  intervaloPersonalizadoDias: number | null;
  qtdParcelas: number;
}) {
  if (periodicidade === "mensal") {
    return qtdParcelas;
  }

  const diasPorParcela = {
    semanal: 7,
    quinzenal: 15,
    personalizado: intervaloPersonalizadoDias ?? 0,
  }[periodicidade];

  if (diasPorParcela <= 0) {
    throw new Error("Intervalo personalizado invalido");
  }

  return (diasPorParcela * qtdParcelas) / DAYS_PER_BILLING_MONTH;
}

function calcularTotalComJurosMensal({
  valorTotal,
  jurosPercentual,
  periodicidade,
  intervaloPersonalizadoDias,
  qtdParcelas,
}: {
  valorTotal: number;
  jurosPercentual: number;
  periodicidade: PeriodicidadeVencimento;
  intervaloPersonalizadoDias: number | null;
  qtdParcelas: number;
}) {
  const prazoEmMeses = getPrazoEmMeses({
    periodicidade,
    intervaloPersonalizadoDias,
    qtdParcelas,
  });
  const juros = valorTotal * (jurosPercentual / 100) * prazoEmMeses;

  return valorTotal + juros;
}

export function buildParcelas({
  emprestimoId,
  valorTotal,
  jurosPercentual,
  qtdParcelas,
  dataPrimeiroVencimento,
  periodicidade,
  intervaloPersonalizadoDias,
}: InstallmentInput): ParcelaInsert[] {
  const totalComJuros = calcularTotalComJurosMensal({
    valorTotal,
    jurosPercentual,
    periodicidade,
    intervaloPersonalizadoDias,
    qtdParcelas,
  });
  const totalEmCentavos = Math.round(totalComJuros * 100);
  const baseParcela = Math.floor(totalEmCentavos / qtdParcelas);
  const resto = totalEmCentavos % qtdParcelas;

  return Array.from({ length: qtdParcelas }, (_, index) => {
    const valorCentavos = baseParcela + (index < resto ? 1 : 0);

    return {
      emprestimo_id: emprestimoId,
      numero: index + 1,
      valor: valorCentavos / 100,
      valor_pago: 0,
      data_vencimento: getDataVencimento({
        dataPrimeiroVencimento,
        periodicidade,
        intervaloPersonalizadoDias,
        index,
      }),
      status: "Pendente",
    };
  });
}

export function diasAtraso(dataVencimento: string, hoje: Date) {
  const venc = new Date(`${dataVencimento}T12:00:00`);
  const baseHoje = new Date(hoje);
  baseHoje.setHours(12, 0, 0, 0);

  return Math.floor((baseHoje.getTime() - venc.getTime()) / MS_PER_DAY);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function calcularJurosAtraso({
  saldoPrincipal,
  dataVencimento,
  hoje,
  tipo,
  valorDiario,
}: {
  saldoPrincipal: number;
  dataVencimento: string;
  hoje: Date;
  tipo: TipoJurosAtraso;
  valorDiario: number;
}) {
  const atraso = diasAtraso(dataVencimento, hoje);

  if (atraso <= 0 || saldoPrincipal <= 0 || valorDiario <= 0) {
    return 0;
  }

  if (tipo === "valor") {
    return roundCurrency(valorDiario * atraso);
  }

  return roundCurrency(saldoPrincipal * (valorDiario / 100) * atraso);
}
