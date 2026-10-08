import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionsBitField } from "discord.js";
import { validateId, serializePermissions, deserializePermissions } from "../src/client.js";

test("validateId accepts a valid snowflake", () => {
  assert.equal(validateId("123456789012345678", "id"), "123456789012345678");
});

test("validateId rejects non-snowflakes", () => {
  assert.throws(() => validateId("abc", "id"));
  assert.throws(() => validateId("", "id"));
  assert.throws(() => validateId("123", "id"));
  assert.throws(() => validateId(undefined, "id"));
});

test("serialize/deserialize permissions round-trips", () => {
  const names = ["SendMessages", "ViewChannel"];
  const bits = deserializePermissions(names);
  assert.ok(bits instanceof PermissionsBitField);
  const back = serializePermissions(bits);
  for (const n of names) assert.ok(back.includes(n), `${n} missing from round-trip`);
});
