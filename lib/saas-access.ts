export type OwnSaasWriteAccess = {
  canWrite: boolean;
  unavailable: boolean;
};

export function resolveOwnSaasWriteAccess(data: unknown, error: unknown): OwnSaasWriteAccess {
  if (error || !Array.isArray(data) || data.length === 0) {
    return { canWrite: false, unavailable: true };
  }

  const row = data[0] as { can_write?: unknown } | null;
  if (!row || typeof row.can_write !== "boolean") {
    return { canWrite: false, unavailable: true };
  }

  return { canWrite: row.can_write, unavailable: false };
}

export function assertSaasWriteAccess(canWrite: unknown, error: unknown): asserts canWrite is true {
  if (error) {
    throw new Error("Não foi possível confirmar sua assinatura agora. Por segurança, nenhuma alteração foi feita. Tente novamente em instantes.");
  }
  if (canWrite !== true) {
    throw new Error("Seu período de avaliação terminou. Assine um plano para voltar a usar o CredCash. Seus dados permanecem guardados e podem ser exportados.");
  }
}
