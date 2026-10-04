import assert from "node:assert/strict";
import test from "node:test";
import { parseCpf } from "../lib/loan-utils.ts";

test("CPF continua opcional ao criar ou editar um cliente", () => {
  assert.equal(parseCpf(null), "");
  assert.equal(parseCpf(""), "");
  assert.equal(parseCpf("   "), "");
});

test("CPF informado continua normalizado e exige 11 dígitos", () => {
  assert.equal(parseCpf("123.456.789-01"), "12345678901");
  assert.throws(() => parseCpf("123"), /CPF deve ter 11 digitos/);
});
