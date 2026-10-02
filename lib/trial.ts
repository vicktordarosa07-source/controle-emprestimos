import { formatDateOnly } from "./loan-utils.ts";

export const TRIAL_DAYS = 7;

function resolveTrialDays(trialDays: number) {
  return Number.isInteger(trialDays) && trialDays >= 0 && trialDays <= 365
    ? trialDays
    : TRIAL_DAYS;
}

export function getTrialEnd(createdAt: string | Date, trialDays = TRIAL_DAYS) {
  const createdAtDate = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(createdAtDate.getTime())) throw new Error("Data de criação da conta inválida.");
  return new Date(createdAtDate.getTime() + resolveTrialDays(trialDays) * 24 * 60 * 60 * 1000);
}

export function getFirstBillingDate(createdAt: string | Date, now: Date, trialDays = TRIAL_DAYS) {
  const endDate = formatDateOnly(getTrialEnd(createdAt, trialDays));
  const today = formatDateOnly(now);
  return endDate < today ? today : endDate;
}

export function getTrialEndDateOnly(createdAt: string | Date, trialDays = TRIAL_DAYS) {
  return formatDateOnly(getTrialEnd(createdAt, trialDays));
}
