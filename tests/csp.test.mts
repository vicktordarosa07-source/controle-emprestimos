import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy } from "../lib/csp.ts";

test("production CSP permits only nonce-authorized scripts and configured Supabase origin", () => {
  const policy = buildContentSecurityPolicy("fixedNonce", "https://project.supabase.co/rest/v1");
  assert.match(policy, /script-src 'self' 'nonce-fixedNonce' 'strict-dynamic'/);
  assert.match(policy, /connect-src 'self' https:\/\/project\.supabase\.co/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
});

test("invalid or insecure Supabase origins cannot expand production CSP", () => {
  const policy = buildContentSecurityPolicy("fixedNonce", "http://untrusted.example");
  assert.match(policy, /connect-src 'self'(?:;|$)/);
  assert.doesNotMatch(policy, /untrusted\.example/);
});

test("development CSP allows local auth and React diagnostics", () => {
  const policy = buildContentSecurityPolicy("fixedNonce", "http://localhost:54321", true);
  assert.match(policy, /connect-src 'self' http:\/\/localhost:54321/);
  assert.match(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});
