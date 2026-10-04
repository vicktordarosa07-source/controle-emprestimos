"use client";

import { useId, useRef, useState, useTransition } from "react";
import { arquivarCobranca } from "@/app/actions";

export function ArquivarCobrancaButton({ emprestimoId }: { emprestimoId: string }) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function openConfirmation() {
    setError("");
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }

  function archive() {
    setError("");
    startTransition(async () => {
      try {
        await arquivarCobranca(emprestimoId);
        dialogRef.current?.close();
      }
      catch (reason) { setError((reason as Error).message); }
    });
  }

  return (
    <div className="space-y-1">
      <button type="button" onClick={openConfirmation} disabled={pending} aria-haspopup="dialog" aria-controls={dialogId} className="min-h-9 border border-red-200 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
        Arquivar cobrança
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        className="m-auto w-[min(32rem,calc(100%-2rem))] border border-gray-200 bg-white p-0 text-gray-950 shadow-2xl backdrop:bg-gray-950/40"
      >
        <div className="space-y-4 p-5">
          <div>
            <h2 id={titleId} className="text-lg font-bold">Arquivar cobrança?</h2>
            <p id={descriptionId} className="mt-2 text-sm text-gray-600">
              Ela sairá das cobranças ativas, mas poderá ser restaurada pela Lixeira. Nenhum pagamento será alterado.
            </p>
          </div>
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialogRef.current?.close()} disabled={pending} autoFocus className="min-h-10 border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50">
              Manter ativa
            </button>
            <button type="button" onClick={archive} disabled={pending} className="min-h-10 bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50">
              {pending ? "Arquivando…" : "Confirmar arquivamento"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
