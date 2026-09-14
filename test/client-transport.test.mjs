import assert from "node:assert/strict";
import test from "node:test";

/** A React double that keeps hook state across explicit render passes. */
function fakeReact() {
  const states = [];
  let cursor = 0;
  let pending = [];
  return {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useRef(initial) { return this.useState(() => ({ current: initial }))[0]; },
    useCallback(callback) { return callback; },
    useEffect(callback) { pending.push(callback); },
    render(component) {
      cursor = 0;
      pending = [];
      const tree = component({});
      return {
        tree,
        flush() {
          const effects = pending;
          pending = [];
          for (const effect of effects) effect();
        }
      };
    }
  };
}

/** Load the client bundle with a caller-supplied React double. */
async function loadClient(React) {
  let plugin;
  globalThis.window = { __ModuleLoader__: { load(entry) { plugin = entry.factory((id) => {
    assert.equal(id, "react");
    return React;
  }); } } };
  try { await import(`../lib/client.js?transport=${Date.now()}${Math.random()}`); }
  finally { delete globalThis.window; }
  return plugin;
}

/** Render the Weave settings section and let its refresh settle. */
async function renderCard(React, plugin, passes = 1) {
  const registrations = [];
  plugin.apply({ locale: { bind: () => (key) => key, register: () => () => {} }, effect: (cb) => cb(), slots: { inject(_name, mount) { mount(); }, register(options, component) { registrations.push({ options, component }); } } });
  const component = registrations.find(({ options }) => options.name === "settings.section").component;
  let pass = React.render(component);
  pass.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The card stores what it read in hook state; a second pass shows it.
  for (let index = 1; index < passes; index += 1) pass = React.render(component);
  return pass;
}

test("the settings card posts its endpoints to the host's /api Fetch route", async () => {
  const React = fakeReact();
  const plugin = await loadClient(React);
  const seen = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/dsh-weave");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.credentials, "same-origin");
    const body = JSON.parse(init.body);
    seen.push(body.endpoint);
    const values = {
      ticket: { ticket: "endpoint-ticket" },
      endpoints: { endpoints: [] },
      status: { relayMode: "disabled", peerCount: 0 }
    };
    return new Response(JSON.stringify({ ok: true, value: values[body.endpoint] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const pass = await renderCard(React, plugin, 2);
    assert.deepEqual(seen, ["ticket", "endpoints", "status"], "the refresh reads exactly the endpoints it always did");
    assert.match(JSON.stringify(pass.tree), /endpoint-ticket/, "the envelope's value reaches the card");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("a failed HTTP call reaches the card as a message", async () => {
  const React = fakeReact();
  const plugin = await loadClient(React);
  const previousFetch = globalThis.fetch;
  // Connection's fence answers 401 before the route runs; the card has to show
  // status text rather than an opaque rejection.
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
  try {
    const pass = await renderCard(React, plugin, 2);
    assert.match(JSON.stringify(pass.tree), /HTTP 401/, "a non-2xx response becomes the status in the error");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});
