"use client";

import { useState, useTransition } from "react";
import { registrarContatoCobranca } from "@/app/actions";

export function ContatoCobrancaForm({ parcelaId }: { parcelaId: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  function submit(data: FormData) {
    startTransition(async () => {
      try {
        await registrarContatoCobranca(data);
        setFeedback("Contato registrado.");
      } catch (error) {
        setFeedback((error as Error).message);
      }
    });
  }

  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="parcela_id" value={parcelaId} />
      <select name="canal" aria-label="Canal de contato" className="min-h-9 border border-gray-300 bg-white px-2 text-xs">
        <option value="manual">Outro contato</option>
        <option value="telefone">Telefone</option>
        <option value="presencial">Presencial</option>
        <option value="outro">Outro</option>
      </select>
      <input name="observacao" maxLength={500} placeholder="Nota (opcional)" className="min-h-9 min-w-36 flex-1 border border-gray-300 px-2 text-xs" />
      <button disabled={pending} className="min-h-9 bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-50">
        {pending ? "Salvando…" : "Registrar contato"}
      </button>
      {feedback ? <span role="status" className="text-xs text-gray-600">{feedback}</span> : null}
    </form>
  );
}
