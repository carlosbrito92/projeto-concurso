import assert from "node:assert/strict";
import { test } from "node:test";
import { destinoSeguro } from "../src/lib/destino.ts";

const H = "concurso-engine.vercel.app";

test("destinoSeguro: caminho relativo e URL do próprio host passam", () => {
  assert.equal(destinoSeguro("/simulado/abc", H), "/simulado/abc");
  assert.equal(destinoSeguro(`https://${H}/painel?x=1`, H), "/painel?x=1");
});

test("destinoSeguro: outro host, protocolo estranho ou vazio caem no padrão", () => {
  assert.equal(destinoSeguro("https://evil.example/painel", H), "/painel");
  assert.equal(destinoSeguro("//evil.example", H), "/painel");
  assert.equal(destinoSeguro("/\\evil.example", H), "/painel");
  assert.equal(destinoSeguro("javascript:alert(1)", H), "/painel");
  assert.equal(destinoSeguro(undefined, H), "/painel");
  assert.equal(destinoSeguro(`https://${H}`, H), "/");
});
