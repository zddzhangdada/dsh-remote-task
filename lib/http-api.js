/**
 * 浏览器端（右侧面板 / 设置页 / 会话卡）读取状态用的本机 HTTP 接口。
 *
 * 只监听本机 Web 服务里已经存在的端口，不额外开端口。写操作要求同源，
 * 或者带上启动时注入到 index.html 的一次性 token。
 */
import { randomUUID } from "node:crypto";

const ROUTE_PREFIX = "/__dsh/weave-link";

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求体太大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function sameOrigin(req) {
  const origin = String(req.headers?.origin ?? "");
  if (!origin) return false;
  try {
    return new URL(origin).host === String(req.headers?.host ?? "");
  } catch {
    return false;
  }
}

function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    sessionId: task.sessionId,
    workspacePath: task.workspacePath,
    instruction: task.instruction,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastHeartbeatAt: task.lastHeartbeatAt,
    lastProgressAt: task.lastProgressAt,
    stuck: Boolean(task.stuck),
    asks: task.asks,
    retries: task.retries ?? 0,
    maxRetries: task.maxRetries ?? 2,
    failure: task.failure ?? null,
    targets: (task.targets ?? []).map((target) => ({
      peerId: target.peerId,
      alias: target.alias ?? "",
      hostName: target.hostName ?? "",
      sessionId: target.sessionId,
      sessionTitle: target.sessionTitle ?? "",
      newSession: Boolean(target.newSession),
      deliveredAt: target.deliveredAt ?? 0
    })),
    result: task.result ?? { text: "", files: [] },
    lastEvent: Array.isArray(task.events) && task.events.length > 0 ? task.events[task.events.length - 1] : null
  };
}

function taskDetail(task) {
  return {
    ...taskSummary(task),
    events: Array.isArray(task.events) ? task.events.slice(-200) : [],
    messages: Array.isArray(task.messages) ? task.messages.slice(-200) : []
  };
}

/** 一个会话里所有任务拼成一条时间线；面板只显示这一条，不按任务分叉。 */
function timelineOf(tasks) {
  const rows = [];
  for (const task of tasks) {
    const device = (task.targets ?? []).map((target) => target.alias || target.hostName || target.peerId).join("、") || "未指定设备";
    for (const message of Array.isArray(task.messages) ? task.messages : []) {
      const role = message.role === "local" ? "me" : "peer";
      if (role === "peer" && /^\s*\[?任务(完成|失败)\s*#/.test(String(message.text ?? ""))) continue;
      rows.push({
        at: Number(message.at) || 0,
        kind: role,
        text: String(message.text ?? ""),
        from: message.from || device,
        taskId: task.id,
        taskTitle: task.title
      });
    }
    for (const event of Array.isArray(task.events) ? task.events : []) {
      if (event.kind === "result" || event.kind === "created") continue;
      rows.push({
        at: Number(event.at) || 0,
        kind: "event",
        text: String(event.text ?? ""),
        taskId: task.id,
        taskTitle: task.title
      });
    }
    if ((task.status === "done" || task.status === "failed") && task.result?.text) {
      rows.push({
        at: Number(task.updatedAt) || Date.now(),
        kind: "result",
        text: String(task.result.text),
        err: task.status === "failed",
        taskId: task.id,
        taskTitle: task.title
      });
    }
  }
  return rows.sort((a, b) => a.at - b.at).slice(-500);
}

/** 把内存里的入站消息整理成面板能直接渲染的列表。 */
function inboxRows(inbox, sessionId) {
  const rows = Array.isArray(inbox) ? inbox : [];
  return rows
    .filter((item) => !sessionId || !item.to || item.to === sessionId || item.to === "weave-link:new")
    .slice(-100)
    .map((item) => ({
      at: Number(item.at) || 0,
      from: String(item.from || ""),
      peerId: String(item.peerId || ""),
      text: String(item.text || ""),
      to: String(item.to || "")
    }));
}

export function registerHttpApi(ctx, { service, settings, timeoutMs, inbox = [] }) {
  const server = typeof ctx.get === "function" ? ctx.get("webServer") : ctx.webServer;
  if (!server || typeof server.register !== "function") {
    ctx.logger?.warn?.("dsh-weave-link: 当前宿主没有 Web 服务，面板接口不注册");
    return () => {};
  }

  const token = randomUUID();
  const disposers = [];
  let deviceCache = { at: 0, value: [] };
  let deviceInFlight = null;

  const offInject = ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "global", name: "__DSH_WEAVE_LINK_TOKEN__", value: token });
  });
  if (typeof offInject === "function") disposers.push(offInject);

  async function devices({ force = false } = {}) {
    const age = Date.now() - deviceCache.at;
    if (!force && age < 5_000) return deviceCache.value;
    if (!deviceInFlight) {
      deviceInFlight = service
        .listDevices({ force })
        .then((value) => {
          deviceCache = { at: Date.now(), value };
          return value;
        })
        .catch((error) => {
          ctx.logger?.debug?.("dsh-weave-link: 读取设备失败", error);
          return deviceCache.value;
        })
        .finally(() => {
          deviceInFlight = null;
        });
    }
    // 先用旧值顶着，刷新在后台跑；面板轮询不会被一次慢探测卡住。
    if (force) return deviceInFlight;
    return deviceCache.value;
  }

  function workspaceOf(sessionId) {
    try {
      const session = ctx.sessions?.get?.(sessionId);
      const cwd = session?.header?.cwd;
      return typeof cwd === "string" ? cwd : "";
    } catch {
      return "";
    }
  }

  /** 设置页的“项目”下拉：DSH 已登记的工作区。 */
  function projects() {
    try {
      return (ctx.workspaceRegistry?.list?.() ?? [])
        .filter((workspace) => workspace.archived !== true && workspace.path)
        .map((workspace) => ({
          id: String(workspace.id ?? ""),
          title: String(workspace.title ?? workspace.path ?? ""),
          path: String(workspace.path ?? "")
        }));
    } catch {
      return [];
    }
  }

  async function state(url) {
    const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
    const taskId = String(url.searchParams.get("taskId") ?? "").trim();
    const wantDevices = url.searchParams.get("devices") !== "0";
    const wantTasks = url.searchParams.get("tasks") !== "0";
    const taskRows = wantTasks ? service.store.list(sessionId || undefined) : [];
    const tasks = taskRows.map(taskSummary);
    let task = null;
    if (taskId) {
      const found = service.store.get(taskId);
      if (found && (!sessionId || found.sessionId === sessionId)) task = taskDetail(found);
    }
    return {
      ok: true,
      serverTime: Date.now(),
      settings: settings.get(),
      inboxPath: settings.inboxPath(sessionId),
      defaultWorkspace: settings.defaultWorkspaceInfo(),
      projects: projects(),
      tasks,
      task,
      timeline: wantTasks ? timelineOf(taskRows) : [],
      inbox: inboxRows(inbox, sessionId),
      devices: wantDevices ? await devices() : []
    };
  }

  function requireWrite(req) {
    const supplied = String(req.headers?.["x-dsh-weave-link-token"] ?? "");
    if (supplied && supplied === token) return;
    if (!sameOrigin(req)) throw Object.assign(new Error("拒绝跨站写入"), { statusCode: 403 });
  }

  function route(method, path, handler) {
    const dispose = server.register({
      kind: "exact",
      path,
      handler: async (req, res) => {
        try {
          if (method === "GET" && req.method !== "GET") return sendJson(res, 405, { ok: false, error: "方法不对" });
          if (method === "POST") {
            if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "方法不对" });
            requireWrite(req);
          }
          const url = new URL(req.url ?? path, `http://${req.headers?.host ?? "localhost"}`);
          const value = await handler(req, url);
          if (!res.writableEnded) sendJson(res, 200, value);
        } catch (error) {
          const status = Number(error?.statusCode ?? 500);
          if (status >= 500) ctx.logger?.warn?.(`dsh-weave-link: ${path} 处理失败`, error);
          if (!res.writableEnded) {
            sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    });
    if (typeof dispose === "function") disposers.push(dispose);
    else if (dispose && typeof dispose.dispose === "function") disposers.push(() => dispose.dispose());
  }

  route("GET", `${ROUTE_PREFIX}/state`, (_req, url) => state(url));

  route("POST", `${ROUTE_PREFIX}/task`, async (req) => {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) throw Object.assign(new Error("缺少 sessionId"), { statusCode: 400 });
    const instruction = String(body.instruction ?? "").trim();
    if (!instruction) throw Object.assign(new Error("任务内容是空的"), { statusCode: 400 });
    const targets = Array.isArray(body.targets) ? body.targets.map(String) : [];
    if (targets.length === 0) throw Object.assign(new Error("没有选择设备"), { statusCode: 400 });
    const workspacePath = String(body.workspacePath ?? "").trim() || workspaceOf(sessionId);
    const result = await service.createTask({ sessionId, workspacePath, targets, instruction });
    if (result.accepted.length === 0) {
      throw Object.assign(
        new Error(result.rejected.map((item) => `${item.target}：${item.reason}`).join("；") || "没有找到可用的设备"),
        { statusCode: 409 }
      );
    }
    return {
      ok: true,
      task: taskDetail(result.task),
      accepted: result.accepted,
      rejected: result.rejected
    };
  });

  route("POST", `${ROUTE_PREFIX}/followup`, async (req) => {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? "").trim();
    const taskId = String(body.taskId ?? "").trim();
    const text = String(body.text ?? "").trim();
    if (!taskId || !text) throw Object.assign(new Error("缺少 taskId 或内容"), { statusCode: 400 });
    const task = service.store.get(taskId);
    if (!task) throw Object.assign(new Error("任务不存在"), { statusCode: 404 });
    if (sessionId && task.sessionId !== sessionId) throw Object.assign(new Error("不是本会话的任务"), { statusCode: 403 });
    const delivered = await service.sendFollowup(task, text);
    return { ok: true, delivered, task: taskDetail(task) };
  });

  route("POST", `${ROUTE_PREFIX}/retry`, async (req) => {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? "").trim();
    const taskId = String(body.taskId ?? "").trim();
    if (!taskId) throw Object.assign(new Error("缺少 taskId"), { statusCode: 400 });
    const task = service.store.get(taskId);
    if (!task) throw Object.assign(new Error("任务不存在"), { statusCode: 404 });
    if (sessionId && task.sessionId !== sessionId) throw Object.assign(new Error("不是本会话的任务"), { statusCode: 403 });
    const delivered = await service.retryTaskById(taskId, { manual: true, reason: String(body.reason ?? "用户点了重试") });
    return { ok: true, delivered, task: taskDetail(task) };
  });

  route("POST", `${ROUTE_PREFIX}/delete`, async (req) => {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? "").trim();
    const taskId = String(body.taskId ?? "").trim();
    if (!taskId) throw Object.assign(new Error("缺少 taskId"), { statusCode: 400 });
    const task = service.store.get(taskId);
    if (!task) throw Object.assign(new Error("任务不存在"), { statusCode: 404 });
    if (sessionId && task.sessionId !== sessionId) throw Object.assign(new Error("不是本会话的任务"), { statusCode: 403 });
    const deleted = await service.deleteTask(taskId);
    return { ok: true, deleted };
  });

  route("POST", `${ROUTE_PREFIX}/settings`, async (req) => {
    const body = await readBody(req);
    const next = await settings.patch(body ?? {});
    try {
      ctx.dshWeave?.setHostName?.(next.localName);
    } catch {
      /* 旧版 dsh-weave 没有这个方法时忽略 */
    }
    return { ok: true, settings: next };
  });

  route("POST", `${ROUTE_PREFIX}/untrust`, async (req) => {
    const body = await readBody(req);
    const peerId = String(body.peerId ?? "").trim();
    if (!peerId) throw Object.assign(new Error("缺少 peerId"), { statusCode: 400 });
    const ok = await ctx.dshWeave.untrust?.(peerId);
    deviceCache = { at: 0, value: [] };
    return { ok: true, untrusted: Boolean(ok) };
  });

  ctx.logger?.info?.(`dsh-weave-link: 面板接口已注册（${ROUTE_PREFIX}）`);
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}
