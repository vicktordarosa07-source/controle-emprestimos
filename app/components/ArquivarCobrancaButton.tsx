"use client";

import { useState, useTransition } from "react";
import { arquivarCobranca } from "@/app/actions";

export function ArquivarCobrancaButton({ emprestimoId }: { emprestimoId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function archive() {
    if (!window.confirm("Arquivar esta cobrança? Ela sairá dos totais, mas poderá ser restaurada na Lixeira.")) return;
    setError("");
    startTransition(async () => {
      try { await arquivarCobranca(emprestimoId); }
      catch (reason) { setError((reason as Error).message); }
    });
  }

  return <div className="space-y-1"><button type="button" onClick={archive} disabled={pending} className="min-h-9 border border-red-200 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">{pending ? "Arquivando…" : "Arquivar cobrança"}</button>{error ? <p className="text-xs text-red-700">{error}</p> : null}</div>;
}
