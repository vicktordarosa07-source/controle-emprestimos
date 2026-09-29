"use client";

import { useRef, useState } from "react";
import { criarCobranca } from "@/app/actions";

const fieldClass = "w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export function NovoEmprestimoModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodicidade, setPeriodicidade] = useState("mensal");
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    try {
      await criarCobranca(formData);
      formRef.current?.reset();
      setPeriodicidade("mensal");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={() => { setError(null); setPeriodicidade("mensal"); setOpen(true); }} className="w-full bg-blue-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-800 sm:w-auto">
        + Nova cobrança
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto bg-white shadow-xl">
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Nova cobrança</p><h2 className="mt-1 text-lg font-bold">Cadastre uma cobrança</h2></div>
                <button onClick={() => setOpen(false)} className="text-xl leading-none text-gray-500 hover:text-gray-700" aria-label="Fechar">×</button>
              </div>
              <form ref={formRef} action={handleSubmit} className="space-y-4">
                {error && <div role="alert" className="border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div>}
                <div><label className="mb-1 block text-sm font-medium">Nome do cliente</label><input name="nome" required maxLength={120} placeholder="Ex: João Silva" className={fieldClass} /></div>
                <div><label className="mb-1 block text-sm font-medium">Descrição (opcional)</label><input name="descricao" maxLength={160} placeholder="Ex: Consultoria de setembro" className={fieldClass} /></div>
                <div><label className="mb-1 block text-sm font-medium">Endereço (opcional)</label><input name="endereco" maxLength={240} placeholder="Rua, número, bairro, cidade" className={fieldClass} /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className="mb-1 block text-sm font-medium">Telefone (opcional)</label><input name="telefone" inputMode="tel" maxLength={20} placeholder="(00) 00000-0000" className={fieldClass} /></div>
                  <div><label className="mb-1 block text-sm font-medium">CPF (opcional)</label><input name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" className={fieldClass} /></div>
                </div>
                <div><label className="mb-1 block text-sm font-medium">Valor total (R$)</label><input name="valor" type="number" step="0.01" min="0.01" required placeholder="Ex: 1000,00" className={fieldClass} /></div>
                <div><label className="mb-1 block text-sm font-medium">Quantidade de cobranças</label><input name="qtd_parcelas" type="number" min="1" max="120" step="1" required placeholder="Ex: 12" className={fieldClass} /><p className="mt-1 text-xs text-gray-500">O valor total será dividido entre as ocorrências, sem juros automáticos.</p></div>
                <div><label className="mb-1 block text-sm font-medium">Primeiro vencimento</label><input name="data_primeiro_vencimento" type="date" required className={fieldClass} /></div>
                <div><label className="mb-1 block text-sm font-medium">Frequência de cobrança</label><select name="periodicidade_vencimento" required value={periodicidade} onChange={(event) => setPeriodicidade(event.target.value)} className={`${fieldClass} bg-white`}>
                  <option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option><option value="personalizado">Intervalo personalizado</option>
                </select></div>
                {periodicidade === "personalizado" && <div><label className="mb-1 block text-sm font-medium">Repetir a cada quantos dias</label><input name="intervalo_personalizado_dias" type="number" min="1" max="365" step="1" required placeholder="Ex: 10" className={fieldClass} /></div>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setOpen(false)} className="flex-1 border border-gray-300 py-2 text-sm font-medium hover:bg-gray-50">Cancelar</button>
                  <button type="submit" disabled={loading} className="flex-1 bg-blue-700 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{loading ? "Salvando..." : "Salvar cobrança"}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
