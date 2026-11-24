/**
 * 远程任务存储。
 *
 * 任务记录跟着对话走：每个会话一个 weave-tasks.json，放在该会话自己的目录里
 * （和会话 JSONL 同级）。删掉会话目录，任务记录一起消失；不再往全局
 * ~/.dsh/weave-link/tasks 里散落文件。
 *
 * 旧版本的任务文件在 ~/.dsh/weave-link/tasks/，load() 时读出来迁移到各自的
 * 会话目录，旧文件保留不删，方便回退和排查。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export function weaveRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "weave-link");
}

/** 旧版任务目录，仅用于迁移。 */
export function tasksDir() {
  return path.join(weaveRoot(), "tasks");
}

export function defaultInboxDir() {
  return path.join(weaveRoot(), "inbox");
}

/** 文件名安全、按时间可排序的任务 id。 */
export function newTaskId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `task-${stamp}-${rand}`;
}

/** 从指令里取一行当任务名，面板和卡片都显示它。 */
export function taskTitle(instruction) {
  const line = String(instruction ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  const title = (line || "远程任务").replace(/^#+\s*/, "").replace(/\s+/g, " ");
  return title.length > 42 ? `${title.slice(0, 42)}…` : title;
}

async function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

const ACTIVE_STATUS = new Set(["queued", "dispatched", "running"]);
const STATUSES = new Set(["queued", "dispatched", "running", "done", "failed"]);

function safeSessionId(id) {
  return String(id ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function readTasksFile(raw) {
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(value) ? value : Array.isArray(value?.tasks) ? value.tasks : [];
  return list.filter((task) => task && typeof task.id === "string").map(normalizeTask);
}

export class TaskStore {
  constructor(logger, ctx) {
    this.logger = logger;
    this.ctx = ctx;
    this.tasks = new Map();
    this.loaded = false;
    this.dirCache = new Map();
  }

  /** 会话目录：会话 JSONL 所在目录；拿不到时退回全局目录。 */
  async dirFor(sessionId) {
    const key = String(sessionId ?? "");
    if (this.dirCache.has(key)) return this.dirCache.get(key);
    let dir = "";
    if (key && this.ctx?.sessionPersistence?.stat) {
      try {
        const stat = await this.ctx.sessionPersistence.stat(key);
        const file = String(stat?.location?.path ?? "");
        if (file) dir = path.dirname(file);
      } catch (error) {
        this.logger?.debug?.(`dsh-weave: 读取会话 ${key} 的目录失败`, error);
      }
    }
    if (!dir) dir = path.join(weaveRoot(), "sessions", safeSessionId(key));
    this.dirCache.set(key, dir);
    return dir;
  }

  sessionFile(sessionId, dir) {
    return path.join(dir || path.join(weaveRoot(), "sessions", safeSessionId(sessionId)), "weave-tasks.json");
  }

  async load() {
    if (this.loaded) return;
    // 1) 新版：每个会话目录下的 weave-tasks.json
    let sessions = [];
    try {
      sessions = this.ctx?.sessions?.list?.() ?? [];
    } catch (error) {
      this.logger?.debug?.("dsh-weave: 列会话失败", error);
    }
    for (const session of sessions) {
      const sessionId = String(session?.id ?? "");
      if (!sessionId) continue;
      try {
        const dir = await this.dirFor(sessionId);
        const file = this.sessionFile(sessionId, dir);
        const raw = await fs.readFile(file, "utf8");
        for (const task of readTasksFile(raw)) this.tasks.set(task.id, task);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          this.logger?.warn?.(`dsh-weave: 读取会话任务失败（${sessionId}）`, error);
        }
      }
    }

    // 1b) 兜底：扫描 ~/.dsh/weave-link/sessions/*/weave-tasks.json
    //     （测试环境或 sessionPersistence 不可用时，任务仍能按会话文件读回来）
    try {
      const entries = await fs.readdir(path.join(weaveRoot(), "sessions"), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const file = path.join(weaveRoot(), "sessions", entry.name, "weave-tasks.json");
        try {
          const raw = await fs.readFile(file, "utf8");
          for (const task of readTasksFile(raw)) this.tasks.set(task.id, task);
        } catch (error) {
          if (error?.code !== "ENOENT") {
            this.logger?.warn?.(`dsh-weave: 读取兜底任务文件失败（${entry.name}）`, error);
          }
        }
      }
    } catch {
      /* 没有兜底目录就跳过 */
    }

    // 2) 旧版：~/.dsh/weave-link/tasks/*.json，逐个迁移到会话目录；旧文件保留。
    let names = [];
    try {
      names = await fs.readdir(tasksDir());
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      try {
        const raw = await fs.readFile(path.join(tasksDir(), name), "utf8");
        const task = JSON.parse(raw);
        if (!task || typeof task.id !== "string" || this.tasks.has(task.id)) continue;
        const normalized = normalizeTask(task);
        this.tasks.set(normalized.id, normalized);
        if (normalized.sessionId) await this.save(normalized);
      } catch (error) {
        this.logger?.warn?.(`dsh-weave: 旧任务文件 ${name} 读不出来，跳过`, error);
      }
    }

    // 重启前还在跑的任务，继续按“已派发/运行中”盯着；不会重复发指令。
    for (const task of this.tasks.values()) {
      if (task.status === "queued") task.status = "dispatched";
    }
    this.loaded = true;
  }

  get(id) {
    return this.tasks.get(String(id ?? "")) ?? null;
  }

  list(sessionId) {
    const rows = [...this.tasks.values()];
    const filtered = sessionId ? rows.filter((task) => task.sessionId === sessionId) : rows;
    return filtered.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  active(sessionId) {
    return this.list(sessionId).filter((task) => ACTIVE_STATUS.has(task.status));
  }

  create(fields) {
    const now = Date.now();
    const task = normalizeTask({
      id: fields.id || newTaskId(),
      sessionId: String(fields.sessionId ?? ""),
      workspacePath: String(fields.workspacePath ?? ""),
      targets: Array.isArray(fields.targets) ? fields.targets : [],
      instruction: String(fields.instruction ?? ""),
      title: taskTitle(fields.instruction),
      status: fields.status || "queued",
      createdAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
      lastProgressAt: now,
      lastProbeAt: 0,
      lastAskAt: 0,
      asks: 0,
      retries: 0,
      maxRetries: 2,
      failure: null,
      result: { text: "", files: [] },
      events: [],
      messages: [],
      ...fields
    });
    this.tasks.set(task.id, task);
    return task;
  }

  /** 把一个会话的全部任务写进同一个 weave-tasks.json。 */
  async save(task) {
    task.updatedAt = Date.now();
    const sessionId = String(task.sessionId ?? "");
    const dir = await this.dirFor(sessionId);
    await fs.mkdir(dir, { recursive: true });
    const rows = [...this.tasks.values()]
      .filter((item) => String(item.sessionId ?? "") === sessionId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    await atomicWrite(this.sessionFile(sessionId, dir), {
      version: 1,
      updatedAt: Date.now(),
      tasks: rows
    });
  }

  /** 删除一条任务记录，只删任务文件里的这一条，不动会话本身。 */
  async remove(taskId) {
    const task = this.get(taskId);
    if (!task) return false;
    this.tasks.delete(task.id);
    const sessionId = String(task.sessionId ?? "");
    const dir = await this.dirFor(sessionId);
    const file = this.sessionFile(sessionId, dir);
    const rows = [...this.tasks.values()]
      .filter((item) => String(item.sessionId ?? "") === sessionId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    if (rows.length === 0) {
      try {
        await fs.unlink(file);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } else {
      await atomicWrite(file, { version: 1, updatedAt: Date.now(), tasks: rows });
    }
    return true;
  }

  /** 兼容旧调用；任务索引不再需要单独维护。 */
  async saveIndex() {}

  async patch(task, patch) {
    Object.assign(task, patch);
    await this.save(task);
    return task;
  }

  async event(task, kind, text, extra = {}) {
    const event = { at: Date.now(), kind, text: String(text ?? ""), ...extra };
    task.events.push(event);
    if (task.events.length > 500) task.events.splice(0, task.events.length - 500);
    task.updatedAt = event.at;
    return event;
  }

  async message(task, role, text, extra = {}) {
    const message = { at: Date.now(), role, text: String(text ?? ""), ...extra };
    task.messages.push(message);
    if (task.messages.length > 500) task.messages.splice(0, task.messages.length - 500);
    if (role === "peer") {
      task.lastHeartbeatAt = message.at;
      task.lastProgressAt = message.at;
    }
    task.updatedAt = message.at;
    return message;
  }
}

function normalizeTask(task) {
  task.targets = Array.isArray(task.targets) ? task.targets : [];
  task.events = Array.isArray(task.events) ? task.events : [];
  task.messages = Array.isArray(task.messages) ? task.messages : [];
  // 统一只有一个失败状态：旧版的 unreachable 也归到 failed。
  if (task.status === "unreachable") {
    task.status = "failed";
    task.failure = task.failure || { reason: "联系不上", at: task.updatedAt || Date.now(), source: "legacy" };
  }
  if (!STATUSES.has(task.status)) task.status = "queued";
  task.retries = Number(task.retries ?? 0) || 0;
  task.maxRetries = Number(task.maxRetries ?? 2) || 2;
  task.failure = task.failure && typeof task.failure === "object" ? task.failure : null;
  // 旧版本留下的假回执和原始完成标记：界面上已经用结果卡代替，读盘时顺手清掉。
  const deliveredAt = Number(task.targets?.[0]?.deliveredAt ?? 0);
  task.messages = task.messages.filter((message) => {
    if (!message || message.role !== "peer") return true;
    const text = String(message.text ?? "");
    if (/^\s*\[?任务(完成|失败)\s*#/.test(text)) return false;
    if (text === "收到，开始执行" && deliveredAt && Math.abs(Number(message.at ?? 0) - deliveredAt) < 3000) return false;
    return true;
  });
  task.result = task.result && typeof task.result === "object" ? task.result : { text: "", files: [] };
  task.asks = Number(task.asks ?? 0) || 0;
  task.lastHeartbeatAt = Number(task.lastHeartbeatAt ?? task.createdAt ?? Date.now()) || Date.now();
  task.lastProgressAt = Number(task.lastProgressAt ?? task.lastHeartbeatAt) || task.lastHeartbeatAt;
  task.title = task.title || taskTitle(task.instruction);
  return task;
}
