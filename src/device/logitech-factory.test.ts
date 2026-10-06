import assert from "node:assert/strict";
import test from "node:test";

import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { hasCapturedFactoryProfiles } from "./logitech-factory.ts";

function format(id: number): NonNullable<MouseStatus["onboardProfileFormat"]> {
  return { id, name: `format ${id}`, base: "0x8100", supported: true, verified: true, writable: true };
}

test("only the captured profile format is offered a factory setup", () => {
  assert.equal(hasCapturedFactoryProfiles(format(8)), true);
});

test("a format whose factory sectors were never captured is not offered one", () => {
  // Format 7 passes supportsFactoryReset(), which is what the button used to be
  // gated on: a PRO X Superlight 2 with no profiles offered the button and then
  // threw "Factory profiles have not been captured for profile format 7" after
  // the user had already confirmed a flash write.
  assert.equal(hasCapturedFactoryProfiles(format(7)), false);
  assert.equal(hasCapturedFactoryProfiles(format(6)), false);
});

test("an unknown or unread format is not offered a factory setup", () => {
  assert.equal(hasCapturedFactoryProfiles(null), false);
  assert.equal(hasCapturedFactoryProfiles(undefined), false);
});
