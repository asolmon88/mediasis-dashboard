import assert from "node:assert/strict";
import test from "node:test";
import { parseTilopayLifecycle } from "./lifecycle.ts";

const reference = "DOM-06fa0ea542284509abf7cc";
const authorization = { orderNumber: `TPC028168-${reference}`, code: 1, amount: "10.20", currency: "USD", id_tilopay: 5988105, capture: "Authorize" };
const capture = { orderNumber: `C-TPC028168-${reference}`, code: 1101, amount: "10.20", currency: "USD", id_tilopay: 5988106, capture: "Capture" };

test("separates merchant-prefixed authorization and capture", () => {
  const result = parseTilopayLifecycle([capture, authorization], reference, 1020, "USD");
  assert.equal(result.authorization?.id_tilopay, 5988105);
  assert.equal(result.capture?.id_tilopay, 5988106);
});

test("missing rows remain unconfirmed", () => {
  assert.deepEqual(parseTilopayLifecycle([], reference, 1020, "USD"), { authorization: null, capture: null });
});

test("rejects conflicting duplicate transactions and mismatched totals", () => {
  assert.throws(() => parseTilopayLifecycle([authorization, { ...authorization, id_tilopay: 9 }], reference, 1020, "USD"));
  assert.throws(() => parseTilopayLifecycle([{ ...capture, amount: "20.00" }], reference, 1020, "USD"));
  assert.throws(() => parseTilopayLifecycle([{ ...capture, currency: "CRC" }], reference, 1020, "USD"));
  assert.throws(() => parseTilopayLifecycle([authorization, { ...capture, code: 3 }], reference, 1020, "USD"));
});

test("ignores unrelated order references", () => {
  assert.deepEqual(parseTilopayLifecycle([{ ...capture, orderNumber: "C-TPC-other" }], reference, 1020, "USD"), { authorization: null, capture: null });
});
