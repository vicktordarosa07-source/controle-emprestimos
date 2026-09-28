"use client";

import { useState, useTransition } from "react";
import { restaurarCobranca } from "@/app/actions";

export function RestaurarCobrancaButton({ emprestimoId }: { emprestimoId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <div className="space-y-1"><button type="button" disabled={pending} onClick={() => startTransition(async () => { try { await restaurarCobranca(emprestimoId); } catch (reason) { setError((reason as Error).message); } })} className="min-h-9 bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">{pending ? "Restaurando…" : "Restaurar"}</button>{error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}</div>;
}
