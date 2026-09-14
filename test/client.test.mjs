import assert from "node:assert/strict";
import test from "node:test";

test("client contributes a Weave-owned settings section", async () => {
  let plugin;
  globalThis.window = { __ModuleLoader__: { load(entry) { plugin = entry.factory((id) => {
    assert.equal(id, "react");
    return { createElement() {}, useState() {}, useCallback() {}, useEffect() {} };
  }); } } };
  try { await import(`../lib/client.js?test=${Date.now()}`); }
  finally { delete globalThis.window; }
  const registrations = [];
  // The card posts to the host's `/api` Fetch route, so the test stands in for
  // the browser's fetch and for Connection's fence; registration alone makes no
  // call.
  const seen = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/dsh-weave");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.credentials, "same-origin");
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) };
  };
  try {
    plugin.apply({ locale: { bind: () => (key) => key === "title" ? "Weave" : key, register: () => () => {} }, effect: (cb) => cb(),
      slots: { inject(_name, mount) { mount(); }, register(options, component) { registrations.push({ options, component }); } }
    });
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
  assert.deepEqual(seen, [], "registration alone must not call the host");
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, "settings.section");
  assert.equal(registrations[0].options.id, "weave");
  assert.equal(registrations[0].options.label(), "Weave");
});
