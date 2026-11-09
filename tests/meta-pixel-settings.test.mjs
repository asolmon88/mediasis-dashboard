import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(path.join(import.meta.dirname, "../src/lib/meta-pixel-settings.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInContext(compiled, vm.createContext({ exports }));

const { buildMetaPixelUpdate, validateMetaPixelId, MAX_META_TOKEN_LENGTH } = exports;

test("validates and normalizes Meta pixel IDs", () => {
  assert.equal(validateMetaPixelId(" 1465410088761576 "), "1465410088761576");
  for (const invalid of ["", "1234", "1234567890123456789012345678901", "pixel-123"]) {
    assert.throws(() => validateMetaPixelId(invalid));
  }
});

test("requires a valid token for a new configuration", () => {
  assert.throws(() => buildMetaPixelUpdate(null, "1465410088761576", null), /token-required/);
  assert.throws(() => buildMetaPixelUpdate(null, "1465410088761576", ""), /invalid-token/);
  assert.throws(() => buildMetaPixelUpdate(null, "1465410088761576", "x".repeat(MAX_META_TOKEN_LENGTH + 1)), /invalid-token/);
});

test("stores a supplied token", () => {
  assert.deepEqual(
    { ...buildMetaPixelUpdate(null, "1465410088761576", "  meta-token  ") },
    { meta_pixel_id_orders: "1465410088761576", meta_token_orders: "meta-token" },
  );
});

test("preserves the saved token when the pixel is unchanged", () => {
  const current = { meta_pixel_id_orders: "1465410088761576", meta_token_orders: "saved-token" };
  assert.deepEqual(
    { ...buildMetaPixelUpdate(current, "1465410088761576", null) },
    { meta_pixel_id_orders: "1465410088761576" },
  );
});

test("requires a replacement token when the pixel changes", () => {
  const current = { meta_pixel_id_orders: "1465410088761576", meta_token_orders: "saved-token" };
  assert.throws(
    () => buildMetaPixelUpdate(current, "2465410088761576", null),
    /token-required-for-pixel-change/,
  );
});
