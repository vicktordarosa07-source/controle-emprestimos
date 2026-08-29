"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPwaButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-ignore iOS
      window.navigator.standalone === true;
    setIsStandalone(isStandaloneMode);
    if (isStandaloneMode) return;

    const ua = window.navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua);
    // @ts-ignore
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    setIsIos(ios && isSafari);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isStandalone) return null;

  if (isIos) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowIosHelp(!showIosHelp)}
          className="border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
        >
          📲 Instalar App
        </button>
        {showIosHelp ? (
          <div className="absolute right-0 top-12 z-50 w-72 border border-gray-200 bg-white p-4 text-sm shadow-lg">
            <p className="font-bold text-gray-950">Instalar no iPhone:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-gray-700">
              <li>
                Toque em <span className="font-bold">Compartilhar ⎙</span> (barra inferior do Safari)
              </li>
              <li>
                Toque em <span className="font-bold">Adicionar à Tela de Início</span>
              </li>
              <li>Toque em Adicionar</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIosHelp(false)}
              className="mt-3 w-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              Fechar
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // Android/Desktop: só mostra quando o navegador liberar o prompt
  // Para não confundir, mostra sempre um botão mas desabilitado até o prompt chegar
  if (!deferredPrompt) {
    return (
      <button
        type="button"
        disabled
        title="Aguarde o navegador liberar a instalação - ou use o menu ⋮ > Instalar app"
        className="cursor-not-allowed border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-bold text-gray-500"
      >
        📲 Instalar App
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") setDeferredPrompt(null);
      }}
      className="border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
    >
      📲 Instalar App
    </button>
  );
}
