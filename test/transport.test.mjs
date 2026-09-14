import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshWeaveTransport, apply, createWeaveHandler, handleWeaveRequest } from "../lib/index.js";

test("trusted Iroh peers exchange a DSH Weave message", async () => {
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    const delivered = new Promise((resolve) => receiver.subscribe((frame) => { resolve(frame); return true; }));
    assert.equal((await sender.send({ ticket: receiverTicket, from: "source", to: "target", text: "hello from Iroh" })).delivered, true);
    const received = await delivered;
    assert.equal(received.from, "source"); assert.equal(received.to, "target"); assert.equal(received.text, "hello from Iroh");
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("a claimed Weave frame returns a protocol response without Bridge delivery", async () => {
  const bridgeCalls = [];
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const receiver = new DshWeaveTransport({ get(name) { return name === "dshBridge" ? { deliverExternal(...args) { bridgeCalls.push(args); } } : undefined; }, get dshBridge() { throw new Error("cannot get property dshBridge without inject"); } }, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    receiver.subscribe((frame) => frame.to === "room" ? { claimed: true, result: { cursor: 7, events: [frame.text] } } : false);
    const delivered = await sender.send({ ticket: receiverTicket, from: "client", to: "room", text: "read" });
    assert.deepEqual(delivered.result, { cursor: 7, events: ["read"] });
    assert.equal(bridgeCalls.length, 0);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("a repeated peer message id is acknowledged without repeating effects", async () => {
  let deliveries = 0;
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    receiver.subscribe(() => { deliveries += 1; return { claimed: true, result: { accepted: true } }; });
    const request = { ticket: receiverTicket, from: "source", to: "room", text: "once", id: "stable-message-id" };
    assert.equal((await sender.send(request)).result.accepted, true);
    assert.equal((await sender.send(request)).result.accepted, true);
    assert.equal(deliveries, 1);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("a peer that does not acknowledge is bounded by the configured timeout", async () => {
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false, acknowledgementTimeoutMs: 40 });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    receiver.subscribe(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); return true; });
    await assert.rejects(
      () => sender.send({ ticket: receiverTicket, from: "source", to: "slow", text: "timeout" }),
      /acknowledgement timed out/,
    );
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("Weave owns the reachable workspace session catalog and hides archived entries", async () => {
  const active = { id: "active-session", header: { id: "active-session", createdAt: 20 } };
  const cold = { id: "cold-session", header: { id: "cold-session", createdAt: 15 } };
  const archived = { id: "archived-session", header: { id: "archived-session", createdAt: 10 } };
  const receiver = new DshWeaveTransport({
    agents: { list() { return [{ id: "active-session", status: "idle", session: active }]; } },
    sessions: { list() { return [active]; } },
    sessionTitle: { get(session) { return { title: session.id === "active-session" ? "Active build" : session.id }; } },
    sessionPersistence: {
      async list() { return [active, cold, archived].map((session) => ({ header: session.header, revision: `revision-${session.id}` })); },
      async open(id, access) {
        assert.equal(id, "cold-session"); assert.equal(access, "read");
        return {
          async read() { return { eventState: "shared", events: [{ type: "session/title", data: { title: "Cold build" }, time: 30 }] }; },
          async close() {}
        };
      }
    },
    workspaceRegistry: {
      archivedSessionIds: ["archived-session"],
      list() { return [
        { id: "workspace-live", title: "Release", sessionIds: ["active-session", "cold-session", "archived-session"] },
        { id: "workspace-archived", title: "Old", archived: true, sessionIds: ["active-session"] }
      ]; }
    }
  }, { relayMode: "disabled", persistIdentity: false, persistPeers: false, hostName: "studio-mini" });
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    const catalogs = await sender.remoteSessions();
    assert.equal(catalogs.length, 1); assert.equal(catalogs[0].hostName, "studio-mini");
    assert.equal(catalogs[0].state, "online");
    assert.deepEqual(catalogs[0].workspaces, [{ id: "workspace-live", title: "Release", sessions: [
      { id: "active-session", title: "Active build", state: "idle", running: true, updatedAt: 20 },
      { id: "cold-session", title: "Cold build", state: "offline", running: false, updatedAt: 30 }
    ] }]);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("an unclaimed frame waits for Bridge cold-session delivery", async () => {
  let completed = false;
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const receiver = new DshWeaveTransport({ dshBridge: { async deliverExternal() { await new Promise((resolve) => setTimeout(resolve, 10)); completed = true; } } }, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    await sender.send({ ticket: receiverTicket, from: "source", to: "cold-session", text: "wake" });
    assert.equal(completed, true);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("an unclaimed frame is rejected when Bridge is unavailable", async () => {
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false, acknowledgementTimeoutMs: 500 });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    await assert.rejects(() => sender.send({ ticket: receiverTicket, from: "source", to: "missing", text: "do not drop" }), /no handler claimed/);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("a default Weave identity survives a transport restart", async () => {
  const identityPath = join(await mkdtemp(join(tmpdir(), "dsh-weave-")), "identity.json");
  const first = new DshWeaveTransport(undefined, { relayMode: "disabled", identityPath, persistPeers: false });
  const firstTicket = await first.ticket(); await first.close();
  const second = new DshWeaveTransport(undefined, { relayMode: "disabled", identityPath, persistPeers: false });
  try {
    const firstId = (await import("@number0/iroh")).EndpointTicket.fromString(firstTicket).endpointAddr().id().toString();
    const secondId = (await import("@number0/iroh")).EndpointTicket.fromString(await second.ticket()).endpointAddr().id().toString();
    assert.equal(secondId, firstId);
    assert.equal((await stat(identityPath)).mode & 0o777, 0o600);
  } finally { await second.close(); }
});

test("trusted peer identities survive a transport restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-weave-"));
  const peersPath = join(directory, "peers.json");
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const ticket = await receiver.ticket();
  const first = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, peersPath });
  await first.trust(ticket); await first.close();
  const second = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, peersPath });
  try {
    assert.equal(second.peers().length, 0); await second.start(); assert.equal(second.peers().length, 1);
    assert.equal(second.endpoints().length, 1); assert.equal(second.endpoints()[0].ticket, ticket);
  }
  finally { await Promise.all([receiver.close(), second.close()]); }
});

test("removing a trusted peer removes its saved routing ticket", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-weave-"));
  const peersPath = join(directory, "peers.json");
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, peersPath });
  try {
    const ticket = await receiver.ticket(); const peerId = await sender.trust(ticket);
    assert.equal(await sender.untrust(peerId), true);
    assert.deepEqual(sender.peers(), []); assert.deepEqual(sender.endpoints(), []);
    await sender.close();
    const restarted = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, peersPath });
    try { await restarted.start(); assert.deepEqual(restarted.peers(), []); assert.deepEqual(restarted.endpoints(), []); }
    finally { await restarted.close(); }
  } finally { await receiver.close(); }
});

test("duplicate suppression keeps a bounded window of settled markers", async () => {
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false, recentMessageLimit: 3 });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    receiver.subscribe(() => ({ claimed: true, result: { accepted: true } }));
    const request = (id) => ({ ticket: receiverTicket, from: "source", to: "room", text: id, id });
    for (const id of ["bounded-1", "bounded-2", "bounded-3", "bounded-4", "bounded-5"]) await sender.send(request(id));
    assert.equal(receiver.recentMessages.size, 3);
    for (const entry of receiver.recentMessages.values()) {
      assert.equal(typeof entry.then, "undefined");
      assert.equal(typeof entry.settledAt, "number");
    }
    receiver.recentMessages.set("stale:marker", { result: undefined, settledAt: Date.now() - 10 * 60 * 1000 });
    await sender.send(request("bounded-6"));
    assert.equal(receiver.recentMessages.has("stale:marker"), false);
    assert.equal((await sender.send(request("bounded-5"))).result.accepted, true);
    assert.equal(receiver.recentMessages.size, 3);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("concurrent start and ticket calls bind a single endpoint", async () => {
  let binds = 0;
  const config = { persistIdentity: false, persistPeers: false };
  // #start() reads relayMode exactly once per bind attempt.
  Object.defineProperty(config, "relayMode", { get() { binds += 1; return "disabled"; } });
  const transport = new DshWeaveTransport(undefined, config);
  try {
    const first = transport.start(); const second = transport.start(); const pendingTicket = transport.ticket();
    assert.equal(first, second);
    const [endpoint, sameEndpoint] = await Promise.all([first, second]);
    assert.equal(endpoint, sameEndpoint);
    assert.equal(binds, 1);
    assert.equal(await transport.start(), endpoint);
    assert.equal(await pendingTicket, await transport.ticket());
    assert.equal(binds, 1);
  } finally { await transport.close(); }
});

test("close aborts in-flight inbound work and clears per-peer state", async () => {
  let dispatching; const started = new Promise((resolve) => { dispatching = resolve; });
  let release; const blocked = new Promise((resolve) => { release = resolve; });
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false, acknowledgementTimeoutMs: 2_000 });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false, shutdownTimeoutMs: 200 });
  try {
    const senderTicket = await sender.ticket(); const receiverTicket = await receiver.ticket();
    await sender.trust(receiverTicket); await receiver.trust(senderTicket);
    receiver.subscribe(async () => { dispatching(); await blocked; return true; });
    const acknowledgement = sender.send({ ticket: receiverTicket, from: "source", to: "room", text: "in flight" }).then(() => "delivered", (error) => error.message);
    await started;
    assert.equal(receiver.inbound.size, 1); assert.equal(receiver.recentMessages.size, 1); assert.equal(receiver.hostStates.size, 1);
    await receiver.close();
    assert.equal(receiver.inbound.size, 0); assert.equal(receiver.recentMessages.size, 0);
    assert.equal(receiver.hostStates.size, 0); assert.equal(receiver.remoteSessionStates.size, 0);
    release();
    assert.notEqual(await acknowledgement, "delivered");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(receiver.recentMessages.size, 0);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test("an invalid stored identity fails loud instead of creating a new peer identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-weave-"));
  const identityPath = join(directory, "identity.json");
  const secretKey = [1, 2, 3];
  await writeFile(identityPath, `${JSON.stringify({ version: 1, secretKey })}\n`, "utf8");
  const transport = new DshWeaveTransport(undefined, { relayMode: "disabled", identityPath, peersPath: join(directory, "peers.json") });
  try {
    await assert.rejects(() => transport.start(), /is invalid: expected 32 secret-key bytes/);
    assert.deepEqual(JSON.parse(await readFile(identityPath, "utf8")).secretKey, secretKey);
  } finally { await transport.close(); }
});

test("the settings route is published on the Connection /api Fetch seam", async () => {
  const calls = { injected: [], routes: [], disposed: [] };
  const ctx = {
    get: () => undefined,
    provide() {},
    effect(callback) { const dispose = callback(); calls.disposed.push(dispose); return dispose; },
    inject(deps, callback) {
      calls.injected.push([...deps]);
      // Model the real contract: the callback reads only the services it
      // declared, while the framework methods every ctx carries stay
      // available.  Handing it an ambient `webCtx` is how the old
      // per-plugin RPC channel stayed invisible to this test.
      callback({
        effect: (registration) => registration(),
        ...Object.fromEntries(deps.map((name) => [name, name === "connection"
          ? { fetch: { register(route) { calls.routes.push(route); return () => {}; } } }
          : undefined]))
      });
    },
    tools: { register() {} }
  };

  apply(ctx, { relayMode: "disabled", persistIdentity: false, persistPeers: false });

  assert.deepEqual(calls.injected, [["connection"]], "the seam is declared, never read as an ambient property");
  // The card's transport is a Fetch route under `/api` — the single path this
  // deployment mounts and fences — not a per-plugin RPC channel.
  assert.deepEqual(calls.routes.map((route) => [route.path, route.methods, route.requestBody]), [
    ["/api/dsh-weave", ["POST"], "buffered"]
  ]);
  for (const dispose of calls.disposed) await dispose?.();
});

test("the settings route answers an RPC envelope for every input", async () => {
  const seen = [];
  const handler = async (endpoint, payload) => {
    seen.push({ endpoint, args: payload?.args });
    if (endpoint === "boom") throw new Error("weave handler failed");
    return { ok: true, value: { endpoint } };
  };

  const ok = await handleWeaveRequest(handler, { json: async () => ({ endpoint: "status", args: { a: 1 } }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/json");
  assert.deepEqual(await ok.json(), { ok: true, value: { endpoint: "status" } });
  assert.deepEqual(seen, [{ endpoint: "status", args: { a: 1 } }]);

  // A body that is not JSON, one without an endpoint, and a throwing handler
  // are all answered as envelopes: a throw here would surface in the browser as
  // an opaque transport failure instead of a message a human can act on.
  const notJson = await handleWeaveRequest(handler, { json: async () => { throw new Error("bad json"); } });
  assert.equal(notJson.status, 200);
  const notJsonEnvelope = await notJson.json();
  assert.equal(notJsonEnvelope.ok, false);
  assert.deepEqual(notJsonEnvelope.error.details, {});

  const noEndpoint = await handleWeaveRequest(handler, { json: async () => ({ args: {} }) });
  assert.equal(noEndpoint.status, 200);
  const noEndpointEnvelope = await noEndpoint.json();
  assert.equal(noEndpointEnvelope.ok, false);
  assert.match(noEndpointEnvelope.error.message, /endpoint/);

  const emptyEndpoint = await handleWeaveRequest(handler, { json: async () => ({ endpoint: "" }) });
  assert.equal(emptyEndpoint.status, 200);
  assert.equal((await emptyEndpoint.json()).ok, false);

  const thrown = await handleWeaveRequest(handler, { json: async () => ({ endpoint: "boom" }) });
  assert.equal(thrown.status, 200);
  const thrownEnvelope = await thrown.json();
  assert.equal(thrownEnvelope.ok, false);
  assert.match(thrownEnvelope.error.message, /weave handler failed/);
});

test("the settings handler answers the same endpoints and values as before", async () => {
  const trusted = [];
  const weave = {
    config: { relayMode: "disabled" },
    async ticket() { return "ticket-value"; },
    peers() { return ["peer-a"]; },
    hosts() { return [{ hostId: "peer-a", addressKnown: true, state: "unknown" }]; },
    async trust(ticket) { trusted.push(ticket); return "peer-b"; },
    async untrust(peerId) { trusted.push(peerId); return true; }
  };
  const handler = createWeaveHandler(weave);

  assert.deepEqual(await handler("ticket", {}), { ok: true, value: { ticket: "ticket-value" } });
  assert.deepEqual(await handler("peers", {}), { ok: true, value: { peers: ["peer-a"] } });
  assert.deepEqual(await handler("endpoints", {}), { ok: true, value: { endpoints: [{ hostId: "peer-a", addressKnown: true, state: "unknown" }] } });
  assert.deepEqual(await handler("status", {}), { ok: true, value: { relayMode: "disabled", peerCount: 1 } });
  assert.deepEqual(await handler("trust", { args: { ticket: "other" } }), { ok: true, value: { peerId: "peer-b" } });
  assert.deepEqual(await handler("untrust", { args: { peerId: "peer-b" } }), { ok: true, value: { removed: true } });
  assert.deepEqual(trusted, ["other", "peer-b"]);
  // An unknown endpoint propagates for the route's envelope to turn into an
  // error result; the route is the only layer that must never throw.
  await assert.rejects(() => handler("nope", {}), /unknown dsh-weave endpoint: nope/);
});

test("cancelling an outbound Iroh request closes the peer's pending handler", { timeout: 5_000 }, async () => {
  const sender = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const receiver = new DshWeaveTransport(undefined, { relayMode: "disabled", persistIdentity: false, persistPeers: false });
  const entered = Promise.withResolvers(); const stopped = Promise.withResolvers();
  try {
    const a = await sender.ticket(); const b = await receiver.ticket();
    await sender.trust(b); await receiver.trust(a);
    receiver.subscribe((_frame, { signal }) => { entered.resolve(); signal.addEventListener("abort", () => stopped.resolve(), { once: true }); return stopped.promise.then(() => true); });
    const controller = new AbortController();
    const pending = sender.sendTo({ hostId: sender.identify(b), from: "test", to: "wait", text: "read", signal: controller.signal });
    await entered.promise;
    controller.abort(new Error("cancel remote read"));
    await assert.rejects(pending, /cancel remote read/);
    await stopped.promise;
    assert.notEqual(sender.hosts()[0].state, "offline", "cancellation is not evidence that a peer is offline");
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});
