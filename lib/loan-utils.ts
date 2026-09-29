export type PeriodicidadeVencimento =
  | "semanal"
  | "quinzenal"
  | "mensal"
  | "personalizado";

export type TipoJurosAtraso = "valor" | "percentual";

export type InstallmentInput = {
  emprestimoId: string;
  valorTotal: number;
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
export function parseRequiredText(value: FormDataEntryValue | null, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} e obrigatorio`);
  }

  return value.trim();
}

export function parseOptionalText(value: FormDataEntryValue | null, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";

  if (text.length > maxLength) {
    throw new Error(`O texto deve ter no maximo ${maxLength} caracteres`);
  }

  return text;
}

export function parseCpf(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");

  if (!/^\d{11}$/.test(digits)) {
    throw new Error("CPF deve ter 11 digitos");
  }

  return digits;
}

export function parseCpfCnpj(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim().toLocaleUpperCase("pt-BR") : "";
  const document = raw.replace(/[.\-/\s]/g, "");

  if (!/^\d{11}$/.test(document) && !/^[A-Z0-9]{12}\d{2}$/.test(document)) {
    throw new Error("Informe um CPF com 11 dígitos ou um CNPJ válido.");
  }

  return document;
}

export function parsePhone(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");

  if (digits.length < 10 || digits.length > 15) {
    throw new Error("Telefone deve ter DDD e entre 10 e 15 digitos");
  }

  return raw.trim();
}

export function parseEmail(value: FormDataEntryValue | null) {
  const email = parseRequiredText(value, "E-mail").toLocaleLowerCase("pt-BR");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail valido");
  }

  return email;
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

  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${field} invalida`);
  }

  return raw;
}

export function formatDateOnly(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addMonthsPreservingDueDay(dateOnly: string, months: number) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonthIndex, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function addDays(dateOnly: string, days: number) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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

export function buildParcelas({
  emprestimoId,
  valorTotal,
  qtdParcelas,
  dataPrimeiroVencimento,
  periodicidade,
  intervaloPersonalizadoDias,
}: InstallmentInput): ParcelaInsert[] {
  const totalEmCentavos = Math.round(valorTotal * 100);
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
  const todayInSaoPaulo = formatDateOnly(hoje);
  const [year, month, day] = todayInSaoPaulo.split("-").map(Number);
  const [dueYear, dueMonth, dueDay] = dataVencimento.split("-").map(Number);
  const todayUtc = Date.UTC(year, month - 1, day);
  const dueUtc = Date.UTC(dueYear, dueMonth - 1, dueDay);
  return Math.floor((todayUtc - dueUtc) / MS_PER_DAY);
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
