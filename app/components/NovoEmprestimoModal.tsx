"use client";

import { useRef, useState } from "react";
import { criarEmprestimo } from "@/app/actions";

export function NovoEmprestimoModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    try {
      await criarEmprestimo(formData);
      formRef.current?.reset();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="w-full bg-blue-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-800 sm:w-auto"
      >
        + Novo Empréstimo
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto bg-white shadow-xl">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold">Novo Empréstimo</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                  aria-label="Fechar"
                >
                  ×
                </button>
              </div>

              <form ref={formRef} action={handleSubmit} className="space-y-4">
                {error ? (
                  <div className="border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                ) : null}

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Nome do cliente
                  </label>
                  <input
                    name="nome"
                    required
                    maxLength={120}
                    placeholder="Ex: João Silva"
                    className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Valor total (R$)
                  </label>
                  <input
                    name="valor"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="Ex: 1000"
                    className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Juros (%)
                  </label>
                  <input
                    name="juros"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="Ex: 10"
                    className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Qtd. parcelas
                  </label>
                  <input
                    name="qtd_parcelas"
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    required
                    placeholder="Ex: 12"
                    className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Data do 1º vencimento
                  </label>
                  <input
                    name="data_primeiro_vencimento"
                    type="date"
                    required
                    className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 border border-gray-300 py-2 text-sm font-medium hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-blue-700 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    {loading ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
