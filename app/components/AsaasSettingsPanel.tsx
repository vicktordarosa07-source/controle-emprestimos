"use client";

import { useEffect, useState, useTransition } from "react";
import { conectarAsaas, desconectarAsaas, obterStatusAsaas } from "@/app/actions";

export function AsaasSettingsPanel() {
  const [status, setStatus] = useState<{ connected: boolean; environment: string | null }>({ connected: false, environment: null });
  const [webhook, setWebhook] = useState<{ url: string; token: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void obterStatusAsaas().then((result) => { if (active) setStatus(result); });
    return () => { active = false; };
  }, []);

  function connect(formData: FormData) {
    setError("");
    setWebhook(null);
    startTransition(async () => {
      try {
        const result = await conectarAsaas(formData);
        setStatus({ connected: true, environment: result.environment });
        setWebhook({ url: result.webhookUrl, token: result.webhookToken });
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  function disconnect() {
    if (!window.confirm("Remover a chave Asaas salva neste Recebify? As cobranças já criadas continuarão na sua conta Asaas.")) return;
    setError("");
    startTransition(async () => {
      try {
        await desconectarAsaas();
        setStatus({ connected: false, environment: null });
        setWebhook(null);
      } catch (reason) { setError((reason as Error).message); }
    });
  }

  return (
    <section className="border-t border-gray-200 p-4">
      <h3 className="font-bold text-gray-950">Conectar Asaas para receber cobranças</h3>
      <p className="mt-1 text-sm text-gray-600">A conexão é individual e a chave fica criptografada no backend. Comece pelo Sandbox. A conta conectada recebe diretamente os valores.</p>
      {status.connected ? <p className="mt-2 text-sm font-bold text-emerald-800">Conectada: {status.environment === "production" ? "Produção" : "Sandbox"}</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
      {!status.connected ? (
        <form action={connect} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="text-sm font-semibold text-gray-700">Chave API do Asaas
            <input name="asaas_api_key" type="password" required minLength={16} maxLength={512} autoComplete="off" className="mt-1 min-h-11 w-full border border-gray-300 px-3" />
          </label>
          <label className="text-sm font-semibold text-gray-700">Ambiente
            <select name="asaas_environment" defaultValue="sandbox" className="mt-1 min-h-11 w-full border border-gray-300 bg-white px-3">
              <option value="sandbox">Sandbox</option><option value="production">Produção</option>
            </select>
          </label>
          <button disabled={pending} className="min-h-11 bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Validando…" : "Conectar"}</button>
        </form>
      ) : (
        <button type="button" disabled={pending} onClick={disconnect} className="mt-3 min-h-10 border border-red-300 px-4 text-sm font-bold text-red-800 disabled:opacity-50">Remover conexão</button>
      )}
      {webhook ? (
        <div className="mt-4 space-y-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-bold">Configure o webhook no painel Asaas — token mostrado apenas agora</p>
          <p>URL: <code className="break-all">{webhook.url}</code></p>
          <p>Token de autenticação: <code className="break-all">{webhook.token}</code></p>
          <p>Selecione os eventos de pagamento; a conciliação só marca como recebido quando o Asaas enviar PAYMENT_RECEIVED. Guarde o token antes de sair desta tela.</p>
        </div>
      ) : null}
    </section>
  );
}
