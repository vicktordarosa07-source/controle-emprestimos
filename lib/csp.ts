export function buildContentSecurityPolicy(nonce: string, supabaseUrl?: string, isDev = false) {
  const connectSources = ["'self'"];

  if (supabaseUrl) {
    try {
      const origin = new URL(supabaseUrl);
      if (origin.protocol === "https:" || (isDev && origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) {
        connectSources.push(origin.origin);
      }
    } catch {
      // Invalid configuration must not widen the browser's network access.
    }
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // The MFA QR uses an inline background-image, and React may set element styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
