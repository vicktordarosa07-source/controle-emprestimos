"use client";

import { useState } from "react";
import { criarEmprestimo } from "@/app/actions";

export function NovoEmprestimoModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    try {
      await criarEmprestimo(formData);
      setOpen(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg shadow transition"
      >
        + Novo Empréstimo
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-auto">
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

              <form action={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Nome do cliente
                  </label>
                  <input
                    name="nome"
                    required
                    placeholder="Ex: João Silva"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    min="0"
                    required
                    placeholder="Ex: 1000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    step="1"
                    required
                    placeholder="Ex: 12"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 border border-gray-300 rounded-lg py-2 font-medium hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 font-semibold"
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
