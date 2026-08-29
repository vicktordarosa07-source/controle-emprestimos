import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const redirectUrl = new URL("/auth/confirmado", requestUrl.origin);

  try {
    const supabase = await createSupabaseServerClient();
    const result =
      code
        ? await supabase.auth.exchangeCodeForSession(code)
        : tokenHash && type
          ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          : { error: new Error("Link de confirmação inválido.") };

    if (result.error) {
      redirectUrl.searchParams.set("status", "erro");
    } else {
      redirectUrl.searchParams.set("status", "sucesso");
    }
  } catch {
    redirectUrl.searchParams.set("status", "erro");
  }

  return NextResponse.redirect(redirectUrl);
}
