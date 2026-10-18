import assert from "node:assert/strict";
import test from "node:test";
import { formatCloudflareRegistrantPhone } from "./registrant-phone.ts";

test("formats Costa Rican and US phone numbers for Cloudflare Registrar", () => {
  assert.equal(formatCloudflareRegistrantPhone("+50683117124"), "+506.83117124");
  assert.equal(formatCloudflareRegistrantPhone("+14155552671"), "+1.4155552671");
});

test("rejects an invalid registrant phone before sending a registration", () => {
  assert.throws(() => formatCloudflareRegistrantPhone("83117124"));
});
