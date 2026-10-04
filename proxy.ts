import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "./lib/csp";
import { getSupabaseEnv } from "./lib/supabase-config";

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  function nextResponse() {
    requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.headers.set("Content-Security-Policy", csp);
    return next;
  }

  let response = nextResponse();

  try {
    const { url, anonKey } = getSupabaseEnv();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = nextResponse();
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    await supabase.auth.getUser();
  } catch {
    return response;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
