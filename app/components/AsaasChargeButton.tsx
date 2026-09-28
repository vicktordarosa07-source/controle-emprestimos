"use client";

import { useState, useTransition } from "react";
import { criarLinkAsaas, obterStatusAsaas } from "@/app/actions";

export function AsaasChargeButton({ parcelaId }: { parcelaId: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  function createLink() {
    setError("");
    startTransition(async () => {
      try {
        const connection = await obterStatusAsaas();
        const live = connection.environment === "production";
        if (live && !window.confirm("Isto criará uma cobrança real na sua conta Asaas. O pagador poderá efetuar o pagamento. Continuar?")) return;
        setUrl(await criarLinkAsaas(parcelaId, live));
      }
      catch (reason) { setError((reason as Error).message); }
    });
  }

  return (
    <div className="mt-2 space-y-1">
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center bg-emerald-700 px-3 text-xs font-bold text-white">Abrir cobrança Asaas</a> : <button type="button" onClick={createLink} disabled={pending} className="min-h-9 border border-emerald-700 px-3 text-xs font-bold text-emerald-800 disabled:opacity-50">{pending ? "Gerando link…" : "Gerar link Asaas"}</button>}
      {error ? <p role="alert" className="max-w-52 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
