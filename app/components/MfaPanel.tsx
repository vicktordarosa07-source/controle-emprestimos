"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Factor = { id: string; friendly_name?: string | null; status: "verified" | "unverified"; factor_type?: string };

export function MfaPanel({ challengeOnly = false }: { challengeOnly?: boolean }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (!active) return;
      if (listError) { setError(listError.message); return; }
      const verified = data.totp.find((item) => item.status === "verified");
      setFactor(verified ?? null);
    });
    return () => { active = false; };
  }, [supabase]);

  function beginEnrollment() {
    setError("");
    startTransition(async () => {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "CredCash",
      });
      if (enrollError) { setError(enrollError.message); return; }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
    });
  }

  function verifyCode(removeAfter = false) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const id = challengeOnly ? factor?.id : factorId || factor?.id;
      if (!id) { setError("Fator autenticador não encontrado."); return; }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: id });
      if (challengeError) { setError(challengeError.message); return; }
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: id, challengeId: challenge.id, code: code.replace(/\s/g, "") });
      if (verifyError) { setError(verifyError.message); return; }

      if (removeAfter) {
        const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: id });
        if (removeError) { setError(removeError.message); return; }
        setFactor(null);
        setMessage("Autenticação em duas etapas desativada.");
      } else if (challengeOnly) {
        router.refresh();
      } else {
        setFactor({ id, friendly_name: "CredCash", status: "verified", factor_type: "totp" });
        setQrCode("");
        setSecret("");
        setMessage("Autenticação em duas etapas ativada.");
      }
      setCode("");
    });
  }

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
      {challengeOnly ? (
        <>
          <p className="text-sm text-gray-700">Digite o código atual do seu aplicativo autenticador para continuar.</p>
          <div className="flex gap-2"><input aria-label="Código de autenticação" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} className="min-h-11 border border-gray-300 px-3" /><button type="button" disabled={pending || code.length < 6} onClick={() => verifyCode()} className="min-h-11 bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Verificando…" : "Verificar"}</button></div>
        </>
      ) : factor ? (
        <>
          <p className="text-sm font-semibold text-emerald-800">Ativa{factor.friendly_name ? `: ${factor.friendly_name}` : ""}</p>
          <p className="text-sm text-gray-700">Para desativar, confirme com um código do autenticador.</p>
          <div className="flex gap-2"><input aria-label="Código para desativar autenticação" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} className="min-h-11 border border-gray-300 px-3" /><button type="button" disabled={pending || code.length < 6} onClick={() => verifyCode(true)} className="min-h-11 border border-gray-300 px-4 text-sm font-bold text-gray-800 disabled:opacity-50">Desativar</button></div>
        </>
      ) : qrCode ? (
        <>
          <p className="text-sm text-gray-700">Leia o QR no aplicativo autenticador e confirme o código gerado.</p>
          {/* Supabase returns an SVG QR; render it as a data URL without injecting SVG markup. */}
          <div role="img" aria-label="QR para configurar autenticação TOTP" style={{ backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}")` }} className="size-48 border border-gray-200 bg-contain bg-center bg-no-repeat p-2" />
          <p className="break-all text-xs text-gray-600">Chave manual: <code>{secret}</code></p>
          <div className="flex gap-2"><input aria-label="Código do autenticador" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} className="min-h-11 border border-gray-300 px-3" /><button type="button" disabled={pending || code.length < 6} onClick={() => verifyCode()} className="min-h-11 bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Confirmando…" : "Ativar"}</button></div>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={beginEnrollment} className="min-h-10 bg-gray-950 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Preparando…" : "Configurar autenticador"}</button>
      )}
    </div>
  );
}
