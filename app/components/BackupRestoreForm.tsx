"use client";

import { useRef, useState, useTransition } from "react";
import { restaurarBackup } from "@/app/actions";

export function BackupRestoreForm() {
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function submit(formData: FormData) {
    setMessage("");
    setError("");
    startTransition(async () => {
      try {
        const result = await restaurarBackup(formData);
        const count = Object.values(result).reduce((sum, value) => sum + value, 0);
        setMessage(`Importação concluída: ${count} registros restaurados.`);
        form.current?.reset();
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  }

  return (
    <form ref={form} action={submit} className="mt-3 space-y-3">
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="text-sm font-semibold text-gray-700">Arquivo de backup do Recebify (.json)
          <input type="file" name="backup" accept="application/json,.json" required className="mt-1 block w-full text-sm" />
        </label>
        <button disabled={pending} className="min-h-10 border border-red-300 px-4 text-sm font-bold text-red-800 hover:bg-red-50 disabled:opacity-50">{pending ? "Importando…" : "Importar backup"}</button>
      </div>
    </form>
  );
}
