"use client";

import { useTransition } from "react";
import { marcarComoPago } from "@/app/actions";

export function MarcarPagoButton({ parcelaId }: { parcelaId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await marcarComoPago(parcelaId);
      } catch (e) {
        alert((e as Error).message);
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="w-full sm:w-auto bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
    >
      {isPending ? "Salvando..." : "Marcar como pago"}
    </button>
  );
}
