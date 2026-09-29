"use client";

import { useEffect, useState, useTransition } from "react";
import { conectarAsaas, desconectarAsaas, obterStatusAsaas } from "@/app/actions";

type ConnectionStatus = { connected: boolean; environment: string | null };
type WebhookSetup = { url: string; token: string };

export function AsaasSettingsPanel() {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false, environment: null });
  const [loaded, setLoaded] = useState(false);
  const [webhook, setWebhook] = useState<WebhookSetup | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"url" | "token" | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void obterStatusAsaas()
      .then((result) => { if (active) setStatus(result); })
      .catch(() => { if (active) setError("Não foi possível consultar o status da conexão. Tente atualizar a página."); })
      .finally(() => { if (active) setLoaded(true); });
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
      } catch (reason) {
        setError((reason as Error).message);
      }
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
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  }

  async function copy(value: string, field: "url" | "token") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("O navegador bloqueou a cópia automática. Selecione e copie o conteúdo manualmente.");
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="asaas-title">
      <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="grid size-12 place-items-center rounded-xl bg-emerald-100 text-lg font-black tracking-tight text-emerald-800">A</div>
          <div>
            <h3 id="asaas-title" className="text-lg font-bold text-slate-950">Asaas</h3>
            <p className="text-sm text-slate-600">Emita cobranças e receba diretamente na sua conta.</p>
          </div>
        </div>
        {loaded ? (
          <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${status.connected ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
            <span aria-hidden="true" className={`size-2 rounded-full ${status.connected ? "bg-emerald-600" : "bg-slate-500"}`} />
            {status.connected ? "Conectado" : "Não conectado"}
          </span>
        ) : (
          <span role="status" className="text-sm text-slate-500">Verificando conexão…</span>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["1", "Conecte sua conta", "Use uma chave de API criada no próprio painel Asaas."],
            ["2", "Configure o webhook", "Ele avisa o Recebify quando um pagamento for recebido."],
            ["3", "Emita cobranças", "Os valores são processados pela sua conta Asaas."],
          ].map(([number, title, description]) => (
            <div key={number} className="rounded-xl border border-slate-200 p-4">
              <span className="grid size-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{number}</span>
              <h4 className="mt-3 text-sm font-bold text-slate-900">{title}</h4>
              <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
            </div>
          ))}
        </div>

        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p> : null}

        {!loaded ? null : status.connected ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <p className="font-bold text-emerald-950">Sua conta está conectada</p>
                <p className="mt-1 text-sm text-emerald-900">Ambiente: <strong>{status.environment === "production" ? "Produção" : "Sandbox (testes)"}</strong>. A chave fica criptografada no Recebify e não é exibida novamente.</p>
              </div>
              <button type="button" disabled={pending} onClick={disconnect} className="min-h-10 shrink-0 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Remover conexão</button>
            </div>
            {webhook ? (
              <div className="mt-5 rounded-xl border border-amber-300 bg-white p-4">
                <h4 className="font-bold text-slate-950">Último passo: cadastrar o webhook no Asaas</h4>
                <p className="mt-1 text-sm leading-5 text-slate-600">No painel Asaas, adicione um webhook de pagamentos. Selecione os eventos <code className="rounded bg-slate-100 px-1">PAYMENT_RECEIVED</code> e <code className="rounded bg-slate-100 px-1">PAYMENT_OVERDUE</code>. O token só aparece nesta tela agora; guarde-o junto com a URL.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="asaas-webhook-url" className="block text-xs font-bold uppercase tracking-wide text-slate-500">URL do webhook</label>
                    <div className="mt-1 flex gap-2">
                      <input id="asaas-webhook-url" readOnly value={webhook.url} className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800" />
                      <button type="button" onClick={() => void copy(webhook.url, "url")} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">{copied === "url" ? "Copiado" : "Copiar"}</button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="asaas-webhook-token" className="block text-xs font-bold uppercase tracking-wide text-slate-500">Token de autenticação</label>
                    <div className="mt-1 flex gap-2">
                      <input id="asaas-webhook-token" readOnly value={webhook.token} className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-800" />
                      <button type="button" onClick={() => void copy(webhook.token, "token")} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">{copied === "token" ? "Copiado" : "Copiar"}</button>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-amber-900">Não envie esse token por mensagens nem o coloque em código público. Se sair desta tela sem guardá-lo, será necessário refazer a conexão para gerar outro.</p>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-white/80 p-3 text-sm leading-5 text-emerald-950">A confirmação automática depende de o webhook estar cadastrado no painel Asaas com o token recebido ao conectar. Se ainda não o configurou ou perdeu o token, desconecte e conecte novamente — cobranças pendentes impedem a troca por segurança.</p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
            <h4 className="font-bold text-slate-950">Conectar sua conta Asaas</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">A conexão é individual: só sua conta poderá emitir cobranças e receber os valores. Comece pelo Sandbox para testar sem movimentar dinheiro real.</p>
            <form action={connect} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
              <label className="text-sm font-semibold text-slate-700">Chave de API
                <input name="asaas_api_key" type="password" required minLength={16} maxLength={512} autoComplete="off" placeholder="Cole sua chave do Asaas" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Criptografada no servidor; nunca fica visível depois de salvar.</span>
              </label>
              <label className="text-sm font-semibold text-slate-700">Ambiente
                <select name="asaas_environment" defaultValue="sandbox" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100">
                  <option value="sandbox">Sandbox · testes</option><option value="production">Produção · real</option>
                </select>
              </label>
              <button disabled={pending} className="min-h-11 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-50">{pending ? "Validando chave…" : "Conectar Asaas"}</button>
            </form>
          </div>
        )}

        <p className="text-xs leading-5 text-slate-500">A assinatura do Recebify é independente desta integração. Aqui você conecta o Asaas usado para cobrar seus próprios clientes.</p>
      </div>
    </section>
  );
}
