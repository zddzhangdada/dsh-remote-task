import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

// The module resolves its default state directory once, at import time, so the
// environment must be in place before the dynamic import below.
const home = "/tmp/dsh-weave-home-test";
process.env.DSH_HOME = home;
const { DshWeaveTransport } = await import("../lib/index.js");

test("default identity and peer paths follow DSH_HOME", () => {
  const transport = new DshWeaveTransport(undefined, { persistPeers: false });
  assert.equal(transport.identityPath, join(home, "dsh-weave", "identity.json"));
  assert.equal(transport.peersPath, join(home, "dsh-weave", "peers.json"));
});

test("an explicit path still wins over DSH_HOME", () => {
  const transport = new DshWeaveTransport(undefined, { persistPeers: false, identityPath: "/tmp/explicit.json" });
  assert.equal(transport.identityPath, "/tmp/explicit.json");
});
