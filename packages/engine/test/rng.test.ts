import assert from "node:assert/strict";
import { test } from "node:test";
import { criarRng, embaralhar, hashSemente } from "../src/rng.ts";

test("mesma semente produz a mesma sequência; sementes diferentes divergem", () => {
  const a = criarRng("x"), b = criarRng("x"), c = criarRng("y");
  const sa = Array.from({ length: 5 }, () => a());
  assert.deepEqual(sa, Array.from({ length: 5 }, () => b()));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c()));
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test("hashSemente é estável (regressão: muda se o algoritmo mudar)", () => {
  assert.equal(hashSemente("abc"), 440920331);
  assert.equal(hashSemente(123), hashSemente("123"));
});

test("embaralhar é permutação e não altera a entrada", () => {
  const entrada = [1, 2, 3, 4, 5, 6, 7, 8];
  const copia = entrada.slice();
  const saida = embaralhar(entrada, criarRng(7));
  assert.deepEqual(entrada, copia);
  assert.deepEqual([...saida].sort(), copia);
});
