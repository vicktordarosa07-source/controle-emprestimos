"use client";

import { useState, useTransition } from "react";
import { marcarComoPago, reabrirParcela } from "@/app/actions";

type Props = {
  parcelaId: string;
  status?: "Pendente" | "Pago" | string;
};

export function MarcarPagoButton({ parcelaId, status = "Pendente" }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPago = status === "Pago";

  function handleClick() {
    const message = isPago
      ? "Reabrir esta parcela como pendente?"
      : "Confirmar pagamento desta parcela?";

    if (!window.confirm(message)) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        if (isPago) {
          await reabrirParcela(parcelaId);
          return;
        }

        await marcarComoPago(parcelaId);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className={
          isPago
            ? "w-full sm:w-auto border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            : "w-full sm:w-auto bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        }
      >
        {isPending ? "Salvando..." : isPago ? "Desfazer pagamento" : "Confirmar pagamento"}
      </button>
      {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
