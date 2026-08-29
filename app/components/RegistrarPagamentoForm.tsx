"use client";

import { useRef, useState, useTransition } from "react";
import { registrarPagamentoCliente } from "@/app/actions";

type Props = {
  clienteId: string;
  saldoAberto: number;
};

export function RegistrarPagamentoForm({ clienteId, saldoAberto }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleAction(formData: FormData) {
    const valorPago = String(formData.get("valor_pago") ?? "").trim();

    if (!window.confirm(`Registrar pagamento de R$ ${valorPago}?`)) {
      return;
    }

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        await registrarPagamentoCliente(formData);
        formRef.current?.reset();
        setSuccess("Pagamento registrado.");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <form ref={formRef} action={handleAction} className="space-y-2">
      <input type="hidden" name="cliente_id" value={clienteId} />
      <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
        Valor pago
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="valor_pago"
          type="number"
          min="0.01"
          max={saldoAberto.toFixed(2)}
          step="0.01"
          required
          placeholder="Ex: 500"
          className="min-h-10 flex-1 border border-gray-300 px-3 text-sm font-semibold outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        />
        <button
          disabled={isPending}
          className="min-h-10 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "Registrando..." : "Registrar pagamento"}
        </button>
      </div>
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
      {success ? (
        <p className="text-xs font-semibold text-emerald-700">{success}</p>
      ) : null}
    </form>
  );
}
