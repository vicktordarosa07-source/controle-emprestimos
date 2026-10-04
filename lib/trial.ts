export const TRIAL_DAYS = 7;

export type TrialGateMode = "pending" | "expired" | "payment" | "unavailable" | null;

export function resolveTrialGate(args: {
  enforcementEnabled: boolean;
  canWrite: boolean;
  unavailable: boolean;
  subscriptionStatus: string | null;
}): TrialGateMode {
  if (args.unavailable) return "unavailable";
  if (!args.enforcementEnabled || args.canWrite) return null;
  if (args.subscriptionStatus === "pending_trial") return "pending";
  if (args.subscriptionStatus === "trialing") return "expired";
  return "payment";
}
