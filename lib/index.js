// Stop waiting promptly while still observing a late upstream rejection.
function withSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

import { Endpoint, EndpointTicket, RelayMode, SecretKey } from "@number0/iroh";
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { apply as applyTaskLayer } from "./task-layer.js";

export const DSH_WEAVE_ALPN = "dsh-weave/1";
export const DSH_WEAVE_PROTOCOL_VERSION = 1;
export const DSH_WEAVE_STAGE = "transport-mvp";
export const name = "dsh-weave";
export const inject = ["connection", "tools", "agents", "sessions", "sessionTitle", "sessionPersistence", "workspaceRegistry", "typert"];
export const Config = Schema.object({
  trustedPeers: Schema.array(Schema.string()).default([]),
  secretKey: Schema.array(Schema.number()),
  identityPath: Schema.string(),
  peersPath: Schema.string(),
  persistIdentity: Schema.boolean().default(true),
  persistPeers: Schema.boolean().default(true),
  relayMode: Schema.union(["default", "disabled"]).default("default"),
  hostName: Schema.string(),
  acknowledgementTimeoutMs: Schema.number().min(100).max(120_000).default(10_000),
  shutdownTimeoutMs: Schema.number().min(1).max(30_000).default(1_000),
  maxConcurrentInbound: Schema.number().min(1).max(1_024).default(64),
  recentMessageLimit: Schema.number().min(100).max(100_000).default(10_000),
  recentMessageTtlMs: Schema.number().min(1_000).max(3_600_000).default(300_000),
});

const ALPN_BYTES = [...new TextEncoder().encode(DSH_WEAVE_ALPN)];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_FRAME_BYTES = 64 * 1024;
// A settled duplicate marker is only useful while a retry of the same message
// id can still arrive, so old markers are dropped instead of accumulating.
const DEFAULT_RECENT_MESSAGE_TTL_MS = 5 * 60 * 1000;
const SYSTEM_TARGET = "dsh-weave/system/1";
const encode = (value) => [...encoder.encode(JSON.stringify(value))];
const decode = (bytes) => JSON.parse(decoder.decode(Uint8Array.from(bytes)));
/** Default state directory: `$DSH_HOME`, then `~/.dsh` (explicit config wins). */
const DEFAULT_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");

export class DshWeaveTransport {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.identityPath = config.identityPath ?? join(DEFAULT_HOME, "dsh-weave", "identity.json");
    this.peersPath = config.peersPath ?? join(DEFAULT_HOME, "dsh-weave", "peers.json");
    this.hostName = config.hostName ?? hostname();
    this.endpoint = undefined;
    this.starting = undefined;
    this.trustedPeers = new Set();
    this.peerTickets = new Map();
    this.hostStates = new Map();
    this.remoteSessionStates = new Map();
    this.ready = this.#loadPeers(config.trustedPeers ?? []);
    this.listeners = new Set();
    this.recentMessages = new Map();
    // In-flight accept task -> AbortController, so close() can abort and await them.
    this.inbound = new Map();
    this.saveTail = Promise.resolve();
    this.closed = false;
    this.lifetime = new AbortController();
  }
  /** 本机显示名；远程设备下一次拉会话目录时看到新名字。 */
  setHostName(name) {
    this.hostName = String(name ?? "").trim() || hostname();
  }

  start() {
    if (this.closed) return Promise.reject(new Error("dsh-weave transport is closed"));
    if (this.endpoint) return Promise.resolve(this.endpoint);
    // The guard must run synchronously: a caller must never pass the check and
    // then await while another caller binds a second endpoint.
    if (!this.starting) this.starting = this.#start().catch((error) => { this.starting = undefined; throw error; });
    return this.starting;
  }
  async #start() {
    await this.ready;
    if (this.closed) throw new Error("dsh-weave transport is closed");
    const builder = Endpoint.builder();
    builder.applyN0(); builder.alpns([ALPN_BYTES]);
    if (this.config.relayMode === "disabled") builder.relayMode(RelayMode.disabled());
    builder.secretKey(await this.#secretKey());
    const endpoint = await builder.bind();
    if (this.closed) { await endpoint.close(); throw new Error("dsh-weave transport closed while starting"); }
    this.endpoint = endpoint; void this.#acceptLoop(); return endpoint;
  }
  async #secretKey() {
    if (Array.isArray(this.config.secretKey) && this.config.secretKey.length === 32) return this.config.secretKey;
    if (this.config.persistIdentity === false) return SecretKey.generate().toBytes();
    let saved;
    try {
      saved = JSON.parse(await readFile(this.identityPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (saved !== undefined) {
      if (!Array.isArray(saved?.secretKey) || saved.secretKey.length !== 32 || !saved.secretKey.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        throw new Error(`dsh-weave identity ${this.identityPath} is invalid: expected 32 secret-key bytes; delete that file only to create a new peer identity`);
      }
      await chmod(dirname(this.identityPath), 0o700); await chmod(this.identityPath, 0o600);
      return saved.secretKey;
    }
    const secretKey = SecretKey.generate().toBytes();
    await mkdir(dirname(this.identityPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.identityPath), 0o700);
    const temporary = `${this.identityPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, secretKey })}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.identityPath); await chmod(this.identityPath, 0o600);
    return secretKey;
  }
  async #loadPeers(configuredPeers) {
    for (const peerId of configuredPeers) if (typeof peerId === "string" && peerId) this.trustedPeers.add(peerId);
    if (this.config.persistPeers === false) return;
    let saved;
    try {
      saved = JSON.parse(await readFile(this.peersPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return;
    }
    if (Array.isArray(saved?.peerIds)) for (const peerId of saved.peerIds) if (typeof peerId === "string" && peerId) this.trustedPeers.add(peerId);
    if (Array.isArray(saved?.tickets)) for (const entry of saved.tickets) {
      if (!entry || typeof entry.peerId !== "string" || typeof entry.ticket !== "string") continue;
      try {
        const ticketPeer = EndpointTicket.fromString(entry.ticket).endpointAddr().id().toString();
        if (ticketPeer !== entry.peerId) continue;
        this.trustedPeers.add(entry.peerId); this.peerTickets.set(entry.peerId, entry.ticket);
      } catch {
        // A malformed persisted ticket leaves the peer trusted but unaddressed: it stays
        // in `trustedPeers` above only when the entry named a peer id, and pairing again
        // writes a fresh ticket from the Weave settings page.
      }
    }
    // Re-hardening an already readable file is best effort: a filesystem that
    // rejects chmod must not abort startup.
    try { await chmod(dirname(this.peersPath), 0o700); await chmod(this.peersPath, 0o600); } catch {}
  }
  async #savePeers() {
    if (this.config.persistPeers === false) return;
    const save = this.saveTail.then(async () => {
      await mkdir(dirname(this.peersPath), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.peersPath), 0o700);
      const temporary = `${this.peersPath}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ version: 2, peerIds: this.peers(), tickets: this.endpoints() })}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.peersPath); await chmod(this.peersPath, 0o600);
    });
    this.saveTail = save.catch(() => {});
    return save;
  }
  async close() {
    this.closed = true;
    this.lifetime.abort();
    this.starting = undefined;
    const endpoint = this.endpoint;
    this.endpoint = undefined;
    for (const controller of this.inbound.values()) controller.abort();
    if (endpoint && !endpoint.isClosed()) await endpoint.close();
    if (this.inbound.size) {
      let timer;
      await Promise.race([
        Promise.allSettled([...this.inbound.keys()]),
        new Promise((resolve) => { timer = setTimeout(resolve, this.config.shutdownTimeoutMs ?? 1_000); timer.unref?.(); })
      ]).finally(() => clearTimeout(timer));
    }
    this.inbound.clear();
    this.recentMessages.clear();
    this.hostStates.clear();
    this.remoteSessionStates.clear();
  }
  async ticket() { return EndpointTicket.fromAddr((await this.start()).addr()).toString(); }
  async trust(ticket) { await this.ready; const id = EndpointTicket.fromString(ticket).endpointAddr().id().toString(); this.trustedPeers.add(id); this.peerTickets.set(id, ticket); await this.#savePeers(); return id; }
  async untrust(peerId) {
    await this.ready;
    if (typeof peerId !== "string" || !peerId) throw new Error("a peer id is required");
    const removed = this.trustedPeers.delete(peerId) || this.peerTickets.delete(peerId);
    this.peerTickets.delete(peerId); this.hostStates.delete(peerId);
    for (const key of this.remoteSessionStates.keys()) if (key.startsWith(`${peerId}:`)) this.remoteSessionStates.delete(key);
    await this.#savePeers();
    return removed;
  }
  /** Parse a legacy endpoint ticket without changing trust. Migration use only. */
  identify(ticket) { return EndpointTicket.fromString(ticket).endpointAddr().id().toString(); }
  peers() { return [...this.trustedPeers].sort(); }
  endpoints() { return [...this.peerTickets].map(([peerId, ticket]) => ({ peerId, ticket })).sort((a, b) => a.peerId.localeCompare(b.peerId)); }
  hosts() { return this.peers().map((hostId) => ({ hostId, addressKnown: this.peerTickets.has(hostId), state: this.peerTickets.has(hostId) ? (this.hostStates.get(hostId) ?? "unknown") : "unpaired" })); }
  sessionStatus(hostId, sessionId) {
    const hostState = this.hostStates.get(hostId) ?? "unknown";
    if (hostState === "offline") return { sessionId: String(sessionId), state: "host-offline", live: false };
    const state = this.remoteSessionStates.get(`${hostId}:${sessionId}`) ?? "unknown";
    return { sessionId: String(sessionId), state, live: state === "idle" || state === "running" };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async sendTo({ hostId, from, to, text, id, timeoutMs, signal }) {
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    await withSignal(this.ready, signal);
    signal.throwIfAborted();
    const ticket = this.peerTickets.get(hostId);
    if (!ticket) throw new Error(`trusted host ${hostId} has no current endpoint ticket; pair it again in Weave settings`);
    const previousState = this.hostStates.get(hostId);
    this.hostStates.set(hostId, "connecting");
    try {
      const result = await this.send({ ticket, from, to, text, id, timeoutMs, signal });
      this.hostStates.set(hostId, "online");
      return result;
    } catch (error) {
      if (!this.closed) this.hostStates.set(hostId, signal.aborted ? (previousState ?? "unknown") : "offline");
      throw error;
    }
  }
  async sessionCatalog() {
    const agents = this.ctx?.get?.("agents") ?? this.ctx?.agents;
    const sessions = this.ctx?.get?.("sessions") ?? this.ctx?.sessions;
    const persistence = this.ctx?.get?.("sessionPersistence") ?? this.ctx?.sessionPersistence;
    const titles = this.ctx?.get?.("sessionTitle") ?? this.ctx?.sessionTitle;
    const registry = this.ctx?.get?.("workspaceRegistry") ?? this.ctx?.workspaceRegistry;
    const archived = new Set(registry?.archivedSessionIds ?? []);
    const live = new Map((sessions?.list?.() ?? []).map((session) => [String(session.id), session]));
    const liveAgents = new Map((agents?.list?.() ?? []).map((agent) => [String(agent.id), agent]));
    const snapshots = persistence ? await persistence.list() : [...live.values()].map((session) => session.header);
    const headers = snapshots.map((snapshot) => snapshot.header ?? snapshot);
    const items = [];
    for (const header of headers ?? []) {
      const id = String(header.id); const active = live.get(id);
      if (archived.has(id)) continue;
      let title = active ? titles?.get?.(active)?.title : undefined;
      let updatedAt = header.createdAt ?? 0;
      if (!title && persistence) {
        try {
          let events;
          if (typeof persistence.inspect === "function") {
            events = (await persistence.inspect(header.id)).events;
          } else {
            const handle = await persistence.open(header.id, "read");
            try { events = (await handle.read()).events; }
            finally { await handle.close(); }
          }
          title = [...events].reverse().find((event) => event.type === "session/title")?.data?.title;
          updatedAt = events.at(-1)?.time ?? updatedAt;
        } catch {
          // A listing row still belongs to the catalog without a readable title or
          // timestamp: this peer's log is unreadable, which the row shows as `offline`.
        }
      }
      const activeAgent = liveAgents.get(id);
      items.push({ id, title: title || id, state: activeAgent?.status ?? "offline", running: Boolean(activeAgent), updatedAt });
    }
    const sessionsById = new Map(items.map((session) => [session.id, session]));
    const workspaces = (registry?.list?.() ?? []).filter((workspace) => workspace.archived !== true).map((workspace) => ({
      id: String(workspace.id), title: String(workspace.title),
      sessions: workspace.sessionIds.map((id) => sessionsById.get(String(id))).filter(Boolean)
    })).filter((workspace) => workspace.sessions.length > 0);
    // acceptsNewSession 是能力声明：老版本对端不认 weave-link:new 这个地址，
    // 发过去会被当成普通会话 id，消息就丢了。发送端据此决定要不要开新会话。
    return { hostName: this.hostName, workspaces, acceptsNewSession: true };
  }
  async remoteSessions(timeoutMs = 3_000, { signal } = {}) {
    signal?.throwIfAborted();
    const catalogs = await Promise.all(this.endpoints().map(async ({ peerId }) => {
      try {
        const sent = await this.sendTo({ hostId: peerId, from: "weave-session-catalog", to: SYSTEM_TARGET, text: JSON.stringify({ kind: "session.catalog" }), timeoutMs, signal });
        if (!sent?.result || !Array.isArray(sent.result.workspaces)) return undefined;
        for (const workspace of sent.result.workspaces) for (const session of workspace.sessions ?? []) this.remoteSessionStates.set(`${peerId}:${session.id}`, session.state ?? (session.running ? "idle" : "offline"));
        return { hostId: peerId, hostName: String(sent.result.hostName || peerId.slice(0, 8)), state: "online", workspaces: sent.result.workspaces, acceptsNewSession: sent.result.acceptsNewSession === true };
      } catch { signal?.throwIfAborted(); return undefined; }
    }));
    return catalogs.filter(Boolean);
  }
  async send({ ticket, from, to, text, id = crypto.randomUUID(), timeoutMs = this.config.acknowledgementTimeoutMs ?? 10_000, signal }) {
    if (typeof text !== "string" || text.trim() === "") throw new Error("dsh-weave text must not be empty");
    const deadline = new AbortController();
    signal = AbortSignal.any([this.lifetime.signal, deadline.signal, ...(signal ? [signal] : [])]);
    signal.throwIfAborted();
    const timer = setTimeout(() => deadline.abort(new Error(`dsh-weave acknowledgement timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    let connection;
    const close = () => connection?.close(0n, []);
    signal.addEventListener("abort", close, { once: true });
    try {
      const endpoint = await withSignal(this.start(), signal);
      signal.throwIfAborted();
      const address = EndpointTicket.fromString(ticket).endpointAddr(); const peerId = address.id().toString();
      if (!this.trustedPeers.has(peerId)) throw new Error(`peer ${peerId} is not trusted; call trust(ticket) first`);
      await withSignal(endpoint.connect(address, ALPN_BYTES).then((connected) => {
        connection = connected;
        if (signal.aborted) close();
      }), signal);
      signal.throwIfAborted();
      const stream = await withSignal(connection.openBi(), signal);
      signal.throwIfAborted();
      await withSignal(stream.send.writeAll(encode({ kind: "dsh-weave/message", version: 1, id, from, to, text })), signal);
      await withSignal(stream.send.finish(), signal);
      const acknowledgement = decode(await withSignal(stream.recv.readToEnd(MAX_FRAME_BYTES), signal));
      signal.throwIfAborted();
      if (acknowledgement?.ok !== true || acknowledgement.id !== id) throw new Error(acknowledgement?.error ?? "peer rejected message");
      return { id, peerId, delivered: true, result: acknowledgement.result };
    } finally { clearTimeout(timer); signal.removeEventListener("abort", close); close(); }
  }
  async #acceptLoop() {
    const endpoint = this.endpoint; if (!endpoint) return;
    try { while (!endpoint.isClosed()) {
      const maximum = this.config.maxConcurrentInbound ?? 64;
      if (this.inbound.size >= maximum) await Promise.race(this.inbound.keys());
      const incoming = await endpoint.acceptNext(); if (!incoming) return;
      const controller = new AbortController();
      const task = this.#accept(incoming, controller.signal).finally(() => this.inbound.delete(task));
      this.inbound.set(task, controller);
    } }
    catch (error) { if (!endpoint.isClosed()) console.warn("dsh-weave accept loop stopped", error); }
  }
  async #accept(incoming, signal) {
    let connection; let stream; let messageId;
    try {
      connection = await (await incoming.accept()).connect();
      const disconnected = new AbortController();
      connection.closed().then(() => disconnected.abort(), () => disconnected.abort());
      signal = AbortSignal.any([signal, disconnected.signal]);
      const peerId = connection.remoteId().toString(); stream = await connection.acceptBi();
      if (signal.aborted) return;
      if (!this.trustedPeers.has(peerId)) throw new Error(`peer ${peerId} is not trusted`);
      this.hostStates.set(peerId, "online");
      const message = decode(await stream.recv.readToEnd(MAX_FRAME_BYTES));
      messageId = message?.id;
      if (message?.kind !== "dsh-weave/message" || message.version !== 1 || ![message.id, message.from, message.to, message.text].every((value) => typeof value === "string" && value)) throw new Error("invalid dsh-weave frame");
      if (signal.aborted) return;
      const received = Object.freeze({ ...message, peerId, receivedAt: Date.now() });
      const dedupeKey = `${peerId}:${message.id}`;
      const cached = this.recentMessages.get(dedupeKey);
      if (cached !== undefined) {
        const duplicateResult = typeof cached.then === "function" ? await cached : cached.result;
        if (signal.aborted) return;
        await stream.send.writeAll(encode({ ok: true, id: message.id, result: duplicateResult })); await stream.send.finish();
        return;
      }
      const processing = this.#dispatch(received, signal).then(
        // A settled marker keeps duplicate suppression without retaining the settled promise.
        (result) => { if (!this.closed) this.recentMessages.set(dedupeKey, { result, settledAt: Date.now() }); return result; },
        (error) => { this.recentMessages.delete(dedupeKey); throw error; },
      );
      this.recentMessages.set(dedupeKey, processing);
      this.#evictRecentMessages();
      const result = await processing;
      if (signal.aborted) return;
      await stream.send.writeAll(encode({ ok: true, id: message.id, result })); await stream.send.finish();
    } catch (error) {
      if (signal.aborted) return;
      this.ctx?.logger?.warn?.("dsh-weave rejected incoming frame", error);
      if (stream && typeof messageId === "string") {
        try { await stream.send.writeAll(encode({ ok: false, id: messageId, error: String(error?.message ?? error) })); await stream.send.finish(); }
        catch {
          // The failure ack is best effort: the peer already lost this stream, so there
          // is no second channel on which the rejection could be reported.
        }
      }
    }
    finally {
      if (connection) {
        // QUIC discards unread stream data when a connection closes, so let the
        // peer read the acknowledgement and close first. The wait is bounded so
        // a peer that never closes cannot hold an inbound slot forever.
        if (!signal.aborted) {
          // Only the fact that the peer closed matters here, not its close reason.
          const peerClosed = connection.closed().catch(() => undefined);
          let closeTimer;
          await withSignal(Promise.race([
            peerClosed,
            new Promise((resolve) => { closeTimer = setTimeout(resolve, this.config.acknowledgementTimeoutMs ?? 10_000); closeTimer.unref?.(); }),
          ]), signal).catch(() => {}).finally(() => clearTimeout(closeTimer));
        }
        connection.close(0n, []);
      }
    }
  }
  #evictRecentMessages() {
    const now = Date.now();
    for (const [key, entry] of this.recentMessages) {
      if (typeof entry.then === "function") continue;
      if (now - entry.settledAt >= (this.config.recentMessageTtlMs ?? DEFAULT_RECENT_MESSAGE_TTL_MS)) this.recentMessages.delete(key);
    }
    const limit = this.config.recentMessageLimit ?? 10_000;
    while (this.recentMessages.size > limit) {
      const next = this.recentMessages.entries().next().value;
      if (!next || typeof next[1].then === "function") return;
      this.recentMessages.delete(next[0]);
    }
  }
  async #dispatch(received, signal) {
      signal?.throwIfAborted();
      const message = received;
      let claimed = false; let result;
      if (message.to === SYSTEM_TARGET) {
        let payload; try { payload = JSON.parse(message.text); }
        // A system-target frame whose text is not JSON is simply not a system command;
        // it falls through to the ordinary listeners and the Bridge below.
        catch {}
        if (payload?.kind === "session.catalog") { claimed = true; result = await this.sessionCatalog(); }
      }
      for (const listener of this.listeners) {
        signal?.throwIfAborted();
        const outcome = await withSignal(listener(received, { signal }), signal);
        if (outcome === true) claimed = true;
        else if (outcome && typeof outcome === "object" && outcome.claimed === true) { claimed = true; result = outcome.result; }
      }
      const bridge = typeof this.ctx?.get === "function" ? this.ctx.get("dshBridge") : this.ctx?.dshBridge;
      if (!claimed && bridge) await bridge.deliverExternal(`weave:${message.peerId}:${message.from}`, message.to, message.text, { id: message.id, transport: "weave", signal });
      if (!claimed && !bridge) throw new Error(`no handler claimed Weave target ${message.to} and dsh-bridge is unavailable`);
      return result;
  }
}

/**
 * Build the `/api/dsh-weave` endpoint handler over one transport.
 * @param weave - the transport the settings card reads and mutates.
 * @returns the handler answering one decoded settings request.
 */
export function createWeaveHandler(weave) {
  return async (endpoint, payload) => {
    if (endpoint === "ticket") return { ok: true, value: { ticket: await weave.ticket() } };
    if (endpoint === "peers") return { ok: true, value: { peers: weave.peers() } };
    if (endpoint === "endpoints") return { ok: true, value: { endpoints: weave.hosts() } };
    if (endpoint === "status") return { ok: true, value: { relayMode: weave.config.relayMode ?? "default", peerCount: weave.peers().length } };
    if (endpoint === "trust") return { ok: true, value: { peerId: await weave.trust(payload?.args?.ticket) } };
    if (endpoint === "untrust") return { ok: true, value: { removed: await weave.untrust(payload?.args?.peerId) } };
    throw new Error(`unknown dsh-weave endpoint: ${endpoint}`);
  };
}

/** JSON response carrying one RPC result envelope. */
function envelopeResponse(envelope) {
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

/** One RPC failure envelope; the shape the settings card reads. */
function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

/**
 * Answer one settings-card POST.
 *
 * Connection's `/api` route has already applied the browser fence, so this only
 * has to decode the envelope, dispatch the endpoint, and always answer 200 with
 * an RPC result: a thrown handler would surface in the browser as an opaque
 * transport failure instead of a message a human can act on.
 * @param handler - the endpoint handler.
 * @param request - the incoming request.
 * @returns the response carrying the RPC result.
 */
export async function handleWeaveRequest(handler, request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return envelopeResponse(failure("bad-request", "request body is not JSON"));
  }
  const endpoint = payload?.endpoint;
  if (typeof endpoint !== "string" || endpoint === "") {
    return envelopeResponse(failure("bad-request", "endpoint must be a non-empty string"));
  }
  try {
    return envelopeResponse(await handler(endpoint, payload));
  } catch (error) {
    return envelopeResponse(failure("internal", error?.message ?? String(error)));
  }
}

export function apply(ctx, config) {
  const weave = new DshWeaveTransport(ctx, config);
  // This must be a Cordis service, rather than a plain accessor.  Consumers
  // such as dsh-chat use inject(["dshWeave"]) so their protocol listeners
  // are active even when no UI has been opened yet.
  ctx.provide("dshWeave", weave);
  // 远程任务层：任务、心跳、会话卡和右侧面板都复用同一个 Weave 通道，
  // 所以这里不再单独装 dsh-weave-link，而是一个插件内完成。
  applyTaskLayer(ctx, { timeoutMs: config?.acknowledgementTimeoutMs ?? 15_000 });
  const handler = createWeaveHandler(weave);
  // The settings route lives under `/api`, the one prefix Connection mounts and
  // fences for the browser: a per-plugin `connection.rpc.handle("/dsh-weave")`
  // produces no reachable route here and falls through to the static carrier's
  // 405.  Tickets include live addressing information and must not be recovered
  // from an old room record after an endpoint restart.
  ctx.inject(["connection"], (connectionCtx) => {
    connectionCtx.effect(() => connectionCtx.connection.fetch.register({
      path: "/api/dsh-weave",
      methods: ["POST"],
      requestBody: "buffered",
      fetch: (request) => handleWeaveRequest(handler, request)
    }), "dsh-weave: settings route");
  });
  ctx.tools.register(defineTool({
    name: "weave_ticket",
    description: "Create the local DSH Weave Iroh ticket for an out-of-band peer pairing.",
    parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: { ticket: { type: "string", required: true } } }, render: (_args, value) => [{ type: "text", text: value.ticket }] },
    async execute() { return { ticket: await weave.ticket() }; }
  }));
  ctx.tools.register(defineTool({
    name: "weave_trust",
    description: "Explicitly trust a DSH Weave peer ticket before sending that node a message.",
    parameters: { ticket: { type: "string", required: true, description: "The peer's Iroh endpoint ticket received out of band." } },
    output: { schema: { type: "object", additionalProperties: false, properties: { peerId: { type: "string", required: true } } }, render: (_args, value) => [{ type: "text", text: `Trusted ${value.peerId}` }] },
    async execute(args) { return { peerId: await weave.trust(args.ticket) }; }
  }));
  ctx.tools.register(defineTool({
    name: "weave_peers",
    description: "List trusted DSH Weave peer identities in this host.",
    parameters: {},
    output: { schema: { type: "array", items: { type: "string" } }, render: (_args, value) => [{ type: "text", text: value.join("\n") || "No trusted peers." }] },
    async execute() { return weave.peers(); }
  }));
  ctx.effect(() => async () => weave.close(), "dsh-weave.transport");
}
