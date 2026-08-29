export type InstallmentInput = {
  emprestimoId: string;
  valorTotal: number;
  jurosPercentual: number;
  qtdParcelas: number;
  dataPrimeiroVencimento: string;
};

export type ParcelaInsert = {
  emprestimo_id: string;
  numero: number;
  valor: number;
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

export function buildParcelas({
  emprestimoId,
  valorTotal,
  jurosPercentual,
  qtdParcelas,
  dataPrimeiroVencimento,
}: InstallmentInput): ParcelaInsert[] {
  const totalEmCentavos = Math.round(valorTotal * (1 + jurosPercentual / 100) * 100);
  const baseParcela = Math.floor(totalEmCentavos / qtdParcelas);
  const resto = totalEmCentavos % qtdParcelas;

  return Array.from({ length: qtdParcelas }, (_, index) => {
    const valorCentavos = baseParcela + (index < resto ? 1 : 0);

    return {
      emprestimo_id: emprestimoId,
      numero: index + 1,
      valor: valorCentavos / 100,
      data_vencimento: addMonthsPreservingDueDay(dataPrimeiroVencimento, index),
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
