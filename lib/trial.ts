import { formatDateOnly } from "./loan-utils.ts";

export const TRIAL_DAYS = 7;

export function getTrialEnd(createdAt: string | Date) {
  const createdAtDate = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(createdAtDate.getTime())) throw new Error("Data de criação da conta inválida.");
  return new Date(createdAtDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

export function getFirstBillingDate(createdAt: string | Date, now: Date) {
  const endDate = formatDateOnly(getTrialEnd(createdAt));
  const today = formatDateOnly(now);
  return endDate < today ? today : endDate;
}

export function getTrialEndDateOnly(createdAt: string | Date) {
  return formatDateOnly(getTrialEnd(createdAt));
}
