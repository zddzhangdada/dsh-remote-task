/**
 * 远程设备的设置。存在 ~/.dsh/weave-link/settings.json，和 dsh-weave 自己的
 * 配置分开：dsh-weave 管通道，这里管“怎么派任务、怎么显示、收到文件放哪”。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultInboxDir, weaveRoot } from "./tasks.js";

export const DEFAULT_SETTINGS = {
  localName: os.hostname(),
  /** 空 = 存到当前对话的项目文件夹；非空 = 用户指定的固定目录。 */
  inboxDir: "",
  /** 项目文件夹下自动创建的子目录名。 */
  inboxSubdir: "收到文件",
  heartbeatSec: 30,
  stuckSec: 120,
  maxAsks: 3,
  showTaskCard: true,
  askWhenAmbiguous: true,
  /** 派任务没指定会话时，给对端开一个新会话，而不是塞进它正在用的对话里。 */
  newSessionByDefault: true,
  relayMode: "default",
  aliases: {},
  /** 每台设备派任务时优先落到的对端工作区；空 = 自动选空闲会话。 */
  deviceDefaults: {},
  /** 手机主动开新对话时，本机在哪个目录新建会话；空 = DSH 默认工作区。 */
  defaultWorkspace: ""
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sanitize(input, base) {
  const next = { ...base };
  if (typeof input.localName === "string" && input.localName.trim()) next.localName = input.localName.trim().slice(0, 60);
  if (typeof input.inboxDir === "string") {
    const value = input.inboxDir.trim();
    // 旧版本默认值（全局 inbox）迁移为“当前对话的项目文件夹”。
    const legacy = value === defaultInboxDir() || /(^|\/)\.dsh\/weave-link\/inbox\/?$/.test(value);
    next.inboxDir = value && !legacy ? value : "";
  }
  if (typeof input.inboxSubdir === "string") {
    const value = input.inboxSubdir.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 60);
    next.inboxSubdir = value || "收到文件";
  }
  if (input.heartbeatSec !== undefined) next.heartbeatSec = clampInt(input.heartbeatSec, 5, 600, base.heartbeatSec);
  if (input.stuckSec !== undefined) next.stuckSec = clampInt(input.stuckSec, 30, 3600, base.stuckSec);
  if (input.maxAsks !== undefined) next.maxAsks = clampInt(input.maxAsks, 1, 10, base.maxAsks);
  if (typeof input.showTaskCard === "boolean") next.showTaskCard = input.showTaskCard;
  if (typeof input.askWhenAmbiguous === "boolean") next.askWhenAmbiguous = input.askWhenAmbiguous;
  if (typeof input.newSessionByDefault === "boolean") next.newSessionByDefault = input.newSessionByDefault;
  if (typeof input.relayMode === "string" && ["default", "disabled"].includes(input.relayMode)) next.relayMode = input.relayMode;
  if (input.aliases && typeof input.aliases === "object" && !Array.isArray(input.aliases)) {
    const aliases = {};
    for (const [key, value] of Object.entries(input.aliases)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) aliases[key] = value.trim().slice(0, 40);
    }
    next.aliases = aliases;
  }
  if (input.deviceDefaults && typeof input.deviceDefaults === "object" && !Array.isArray(input.deviceDefaults)) {
    const defaults = {};
    for (const [key, value] of Object.entries(input.deviceDefaults)) {
      if (!key || !value || typeof value !== "object") continue;
      const workspace = typeof value.workspace === "string" ? value.workspace.trim().slice(0, 300) : "";
      const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim().slice(0, 120) : "";
      if (workspace || sessionId) defaults[key] = { workspace, sessionId };
    }
    next.deviceDefaults = defaults;
  }
  if (typeof input.defaultWorkspace === "string") {
    const value = input.defaultWorkspace.trim();
    next.defaultWorkspace = value
      ? (path.isAbsolute(value) ? value : path.join(os.homedir(), value)).slice(0, 300)
      : "";
  }
  return next;
}

export class SettingsStore {
  constructor(logger, ctx) {
    this.logger = logger;
    this.ctx = ctx;
    this.value = { ...DEFAULT_SETTINGS, aliases: {}, deviceDefaults: {} };
    this.file = path.join(weaveRoot(), "settings.json");
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      this.value = sanitize(parsed ?? {}, this.value);
    } catch (error) {
      if (error?.code !== "ENOENT") this.logger?.warn?.("dsh-weave: 设置读不出来，用默认值", error);
    }
    return this.value;
  }

  get() {
    return this.value;
  }

  async patch(partial) {
    this.value = sanitize(partial ?? {}, this.value);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.value, null, 2), "utf8");
    return this.value;
  }

  /**
   * DSH 的默认工作区：优先取登记表里标记为 default 的工作区，其次 DSH 桌面端
   * 的 `default-workspace`、Android 壳的「临时工作区」，再其次取登记顺序里
   * 第一个工作区。都没有时退回宿主的工作目录默认值（最后才退回用户主目录）。
   */
  defaultWorkspaceInfo() {
    try {
      const registry = this.ctx?.workspaceRegistry;
      const list = (registry?.list?.() ?? []).filter((workspace) => workspace && workspace.path);
      const defaultId = registry?.state?.defaultWorkspaceId;
      const isShellDefault = (workspace) => {
        const path = String(workspace.path || "").replace(/\/+$/, "");
        return workspace.title === "临时工作区" || /(^|\/)workspaces\/incoming$/.test(path);
      };
      const entity =
        (defaultId && list.find((workspace) => String(workspace.id) === String(defaultId))) ||
        list.find((workspace) => workspace.title === "default-workspace") ||
        list.find(isShellDefault) ||
        list[0];
      if (entity) return { path: String(entity.path), title: String(entity.title || "") };
    } catch {
      /* registry 不可用时走下面的兜底 */
    }
    let workingDirectory;
    try {
      workingDirectory = this.ctx?.get?.("workingDirectory") ?? this.ctx?.workingDirectory;
    } catch {
      workingDirectory = undefined;
    }
    const fallback = String(workingDirectory?.defaultDirectory || "").trim();
    if (fallback) return { path: fallback, title: "" };
    return { path: os.homedir(), title: "" };
  }

  /** 新会话默认目录：显式设置优先，否则用 DSH 默认工作区，而不是用户主目录。 */
  defaultSessionDir() {
    const explicit = String(this.value.defaultWorkspace || "").trim();
    return explicit || this.defaultWorkspaceInfo().path;
  }

  /** 展开 ~ 和相对路径；空则按当前会话的项目文件夹 + inboxSubdir。 */
  inboxPath(sessionId) {
    const raw = String(this.value.inboxDir || "").trim();
    if (raw) {
      if (raw === "~") return os.homedir();
      if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
      return path.isAbsolute(raw) ? raw : path.join(os.homedir(), raw);
    }
    let cwd = "";
    try {
      cwd = String(this.ctx?.sessions?.get?.(sessionId)?.header?.cwd ?? "").trim();
    } catch {
      cwd = "";
    }
    if (!cwd) cwd = this.defaultSessionDir();
    return path.join(cwd, String(this.value.inboxSubdir || "收到文件").trim() || "收到文件");
  }
}
