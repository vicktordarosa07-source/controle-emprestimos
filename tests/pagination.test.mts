import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllRows } from "../lib/pagination.ts";

test("fetchAllRows pagina além do limite e mantém a ordem recebida", async () => {
  const rows = Array.from({ length: 1_203 }, (_, id) => ({ id }));
  const ranges: [number, number][] = [];
  const result = await fetchAllRows(async (from, to) => {
    ranges.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });

  assert.equal(result.length, rows.length);
  assert.deepEqual(result, rows);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1_000, 1_499]]);
});

test("fetchAllRows propaga erros do banco em vez de retornar lista parcial", async () => {
  await assert.rejects(
    fetchAllRows(async () => ({ data: null, error: { message: "falha" } })),
    /falha/,
  );
});
