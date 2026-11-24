/**
 * 远程任务的调度、心跳和追问。
 *
 * 设计要点（见 远程设备插件/交接说明.md）：
 * - 任务永远挂在发起它的 sessionId + workspacePath 上，右侧面板只按会话过滤。
 * - 派任务就是给对方会话发一条普通用户消息，所以老版本插件（手机 0.2.1）
 *   也能收到并执行；新版本额外提供更精确的状态，但没有也不影响主流程。
 * - 心跳不是每 30 秒往对方会话里灌“还在跑”这种噪音，而是每 30 秒查一次
 *   对方会话是否还活着；只有超过 2 分钟没有任何进展才发一句人话追问。
 */
import { TaskStore, newTaskId, taskTitle } from "./tasks.js";

const ACTIVE = new Set(["queued", "dispatched", "running"]);
const TERMINAL = new Set(["done", "failed"]);
const ALL_DEVICES = /^(所有设备|全部设备|所有机器|all|all devices)$/i;
/** 派任务时让对端自己开一个新会话的目标地址（和 task-layer 里认领的是同一个）。 */
export const NEW_SESSION_TARGET = "weave-link:new";

function shortId(id) {
  const value = String(id ?? "");
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function hostIdOf(host) {
  return String(host?.hostId ?? host?.peerId ?? "");
}

/**
 * 失败内容分拣。返回 retryable=true 时，插件会在同一个任务里换一种说法重试。
 * 这里是保守规则：只要碰到权限、账号、钱、删除/覆盖、对外发布这类不可逆或
 * 需要用户授权的内容，一律不自动重试，直接停下汇报。
 */
const NON_RETRYABLE = /(权限|无权|permission|密码|验证码|验证|授权|登录|账号|账户|支付|付款|花钱|转账|购买|删除|覆盖|格式化|清空|rm\s|对外发送|发布|上传到|隐私|身份证|银行卡)/i;
const RETRYABLE = /(超时|timeout|网络|连接|ECONN|断开|暂时|临时|忙|稍后|重试|再试|路径|目录|文件名|参数|命令|格式|找不到|不存在|损坏|错误|失败|error|卡住|没反应)/i;

export function classifyFailure(text) {
  const value = String(text ?? "").trim();
  if (NON_RETRYABLE.test(value)) return { retryable: false, reason: "需要用户授权或涉及不可逆操作" };
  if (RETRYABLE.test(value)) return { retryable: true, reason: "看起来是临时问题或可以换一种做法" };
  return { retryable: false, reason: "不确定怎么换方式，先停下来问用户" };
}

function flattenCatalog(hosts) {
  const rows = [];
  for (const host of hosts ?? []) {
    const peerId = hostIdOf(host);
    const workspaces = Array.isArray(host?.workspaces) ? host.workspaces : [];
    for (const workspace of workspaces) {
      const sessions = Array.isArray(workspace?.sessions) ? workspace.sessions : [];
      for (const session of sessions) {
        rows.push({
          peerId,
          hostName: String(host?.hostName ?? ""),
          workspaceId: String(workspace?.id ?? ""),
          workspace: String(workspace?.title ?? ""),
          sessionId: String(session?.id ?? ""),
          title: String(session?.title ?? ""),
          state: String(session?.state ?? (session?.running ? "running" : "unknown")),
          updatedAt: Number(session?.updatedAt ?? 0) || 0
        });
      }
    }
  }
  return rows;
}

function byBestSession(a, b) {
  // 派新任务优先找空闲会话：正在跑的会话会把新指令排在当前这轮后面，看起来就像“卡住”。
  const score = (row) => (row.state === "idle" ? 2 : row.state === "running" ? 1 : 0);
  return score(b) - score(a) || b.updatedAt - a.updatedAt;
}

export function createTaskService(ctx, options) {
  const { settings, timeoutMs = 15_000, fromPrefix = "weave-link:" } = options;
  const store = new TaskStore(ctx.logger, ctx);
  const ready = store.load().catch((error) => {
    ctx.logger?.warn?.("dsh-weave-link: 任务库初始化失败", error);
  });
  /** peerId -> 最近一次收到消息的时间；给「心跳」兜底。 */
  const peerSeen = new Map();
  /** peerId -> 最近一次读到的名字。 */
  const hostNames = new Map();
  /** 会话目录有缓存：面板每 3 秒轮询，不必每次都去打对端。 */
  let catalogCache = { at: 0, value: [] };
  let catalogInFlight = null;
  let lastCatalogProbeAt = 0;
  /**
   * peerId -> 探测健康度。远程会话目录读失败不等于设备掉线（手机可能只是
   * 慢了一拍），连续两次失败、且 90 秒内没有成功过，才真的标离线。
   */
  const health = new Map();
  let timer = null;
  let stopped = false;
  let ticking = false;

  function sessionIdOf(exec) {
    return String(exec?.agent?.id ?? exec?.agent?.session?.id ?? "");
  }

  /**
   * 一次探测之后更新健康度：目录里出现的设备记一次成功，没出现的记一次失败。
   * 失败计数按“探测轮次”走，不跟面板轮询走，否则 3 秒一次会把计数刷爆。
   */
  function bumpHealth(seenPeers) {
    const now = Date.now();
    for (const host of ctx.dshWeave.hosts?.() ?? []) {
      const peerId = hostIdOf(host);
      if (!peerId) continue;
      const entry = health.get(peerId) ?? { fails: 0, lastOkAt: 0 };
      if (seenPeers?.has(peerId)) {
        entry.fails = 0;
        entry.lastOkAt = now;
      } else {
        entry.fails += 1;
      }
      health.set(peerId, entry);
    }
  }

  async function readCatalog(timeout = Math.min(timeoutMs, 8_000), force = false) {
    if (!force && Date.now() - catalogCache.at < 15_000) return catalogCache.value;
    if (catalogInFlight) return catalogInFlight;
    catalogInFlight = (async () => {
      try {
        const catalogs = await ctx.dshWeave.remoteSessions(timeout);
        const seen = new Set();
        for (const host of catalogs ?? []) {
          const peerId = hostIdOf(host);
          const name = String(host?.hostName ?? "");
          if (peerId && name) hostNames.set(peerId, name);
          if (peerId) seen.add(peerId);
        }
        catalogCache = { at: Date.now(), value: catalogs ?? [] };
        bumpHealth(seen);
        return catalogCache.value;
      } catch (error) {
        ctx.logger?.debug?.("dsh-weave-link: 读取对端会话失败", error);
        bumpHealth(null);
        return catalogCache.value;
      } finally {
        catalogInFlight = null;
      }
    })();
    return catalogInFlight;
  }

  async function deviceSnapshot({ catalog = true, force = false } = {}) {
    await ready;
    // 先刷新目录：remoteSessions 会真的连一次对端，hosts() 的状态才会从
    // unknown 变成 online/offline。顺序反了，第一次 link_devices 会把在线设备报成未知。
    const catalogs = catalog ? await readCatalog(undefined, force) : [];
    const hosts = ctx.dshWeave.hosts?.() ?? [];
    const rows = flattenCatalog(catalogs);
    const catalogHosts = new Set(catalogs.map((host) => hostIdOf(host)));
    // 工作区列表要从原始目录取：没有会话的工作区也该能被选成默认落点。
    const catalogWorkspaces = new Map();
    for (const host of catalogs ?? []) {
      const peerId = hostIdOf(host);
      const list = catalogWorkspaces.get(peerId) ?? new Map();
      for (const workspace of Array.isArray(host?.workspaces) ? host.workspaces : []) {
        const id = String(workspace?.id ?? "");
        if (id) list.set(id, String(workspace?.title ?? id));
      }
      catalogWorkspaces.set(peerId, list);
    }
    const now = Date.now();
    const activeTasks = store.list().filter((task) => ACTIVE.has(task.status));
    const devices = hosts.map((host) => {
      const peerId = hostIdOf(host);
      let state = String(host?.state ?? "unknown");
      if (state === "unknown" && catalogHosts.has(peerId)) state = "online";
      // 单次探测失败不算掉线：90 秒内成功过、且失败次数不到两次，就仍按在线显示，
      // 避免手机慢一拍时面板闪成“离线”。
      const entry = health.get(peerId);
      const grace = Boolean(entry) && now - Number(entry.lastOkAt || 0) < 90_000;
      const degraded = state === "offline" && Boolean(entry) && entry.fails < 2 && grace;
      if (degraded) state = "online";
      let lastHeartbeatAt = peerSeen.get(peerId) ?? 0;
      let activeTaskCount = 0;
      for (const task of activeTasks) {
        if (task.targets.some((target) => target.peerId === peerId)) {
          activeTaskCount += 1;
          lastHeartbeatAt = Math.max(lastHeartbeatAt, Number(task.lastHeartbeatAt ?? 0));
        }
      }
      const alias = settings.get().aliases?.[peerId] || hostNames.get(peerId) || shortId(peerId);
      const deviceRows = rows.filter((row) => row.peerId === peerId);
      const workspaces = [];
      const seenWorkspace = new Set();
      for (const [id, title] of catalogWorkspaces.get(peerId) || []) {
        seenWorkspace.add(id);
        workspaces.push({ id, title: title || id });
      }
      for (const row of deviceRows) {
        const id = row.workspaceId || row.workspace;
        if (!id || seenWorkspace.has(id)) continue;
        seenWorkspace.add(id);
        workspaces.push({ id, title: row.workspace || row.workspaceId });
      }
      return {
        peerId,
        alias,
        hostName: hostNames.get(peerId) || "",
        state,
        paired: state !== "unpaired",
        online: state === "online",
        degraded,
        busy: activeTaskCount > 0,
        activeTaskCount,
        addressKnown: Boolean(host?.addressKnown),
        lastHeartbeatAt: lastHeartbeatAt || null,
        lastSeenSeconds: lastHeartbeatAt ? Math.max(0, Math.round((now - lastHeartbeatAt) / 1000)) : null,
        sessions: deviceRows.length,
        workspaces
      };
    });
    return { devices, rows, catalogs };
  }

  async function listDevices(options) {
    return (await deviceSnapshot(options)).devices;
  }

  /**
   * 手机发来“开个新对话”时调用：在本机默认工作区建一个真实会话。
   * cwd 必须是绝对路径；未显式指定时用 DSH 默认工作区（不是用户主目录）。
   */
  async function createIncomingSession() {
    await ready;
    if (!ctx.agents?.create) throw new Error("宿主没有 agents 服务，建不了新会话");
    const cwd = settings.defaultSessionDir();
    const handle = await ctx.agents.create({ meta: { cwd } });
    const id = String(handle?.agent?.id ?? handle?.session?.id ?? handle?.id ?? "");
    if (!id) throw new Error("会话创建失败");
    return id;
  }

  async function resolveTargets(targets) {
    let snapshot = await deviceSnapshot({ catalog: true });
    // 目录缓存可能是上一次超时留下的空结果；设备在线但一个会话都没有时，
    // 强制再连一次对端，避免“明明在线却提示没有可用会话”。
    if (snapshot.rows.length === 0 && snapshot.devices.some((device) => device.online)) {
      snapshot = await deviceSnapshot({ catalog: true, force: true });
    }
    const { devices, rows } = snapshot;
    // peerId -> 对端是否支持「给它开新会话」；老版本对端没有这个能力，发了会丢。
    const catalogsById = new Map((snapshot.catalogs ?? []).map((host) => [hostIdOf(host), host]));
    const accepted = [];
    const rejected = [];
    const seen = new Set();

    const pushDevice = async (device, explicitSessionId = "") => {
      if (!device || seen.has(device.peerId)) return;
      const allSessions = rows.filter((row) => row.peerId === device.peerId).sort(byBestSession);
      const prefs = settings.get().deviceDefaults?.[device.peerId] || {};
      let sessions = allSessions;
      if (prefs.workspace) {
        const scoped = allSessions.filter(
          (row) => row.workspaceId === prefs.workspace || row.workspace === prefs.workspace
        );
        if (scoped.length) sessions = scoped;
      }
      let chosen = null;
      if (explicitSessionId) {
        chosen = allSessions.find((row) => row.sessionId === explicitSessionId) || null;
        if (!chosen) {
          rejected.push({ target: device.alias || device.peerId, reason: "对端没有这个会话" });
          return;
        }
      } else {
        // 优先级：设备指定的会话 > 设备指定的工作区里的会话 > 开新会话 > 全局空闲会话。
        if (prefs.sessionId) chosen = allSessions.find((row) => row.sessionId === prefs.sessionId) || null;
        // 用户点名了工作区，就按工作区来：新会话会落到默认目录，反而违背这个设置。
        const pinnedWorkspace = Boolean(prefs.workspace);
        if (!chosen && !pinnedWorkspace && settings.get().newSessionByDefault !== false) {
          // 默认给每台设备开一个新会话，别把任务塞进用户正在干活的对话里。
          // 对端不认 weave-link:new（老版本）时退回选现有会话，否则消息会丢。
          const peer = catalogsById.get(device.peerId);
          const capable = peer ? peer.acceptsNewSession === true : false;
          if (capable) {
            seen.add(device.peerId);
            accepted.push({
              peerId: device.peerId,
              sessionId: NEW_SESSION_TARGET,
              alias: device.alias,
              hostName: device.hostName || "",
              sessionTitle: "新会话",
              newSession: true
            });
            return;
          }
        }
        if (!chosen) chosen = sessions[0] || allSessions[0] || null;
      }
      if (!chosen) {
        rejected.push({
          target: device.alias || device.peerId,
          reason: "对端没有可用会话（可能没装 dsh-bridge 或没打开会话）"
        });
        return;
      }
      seen.add(device.peerId);
      accepted.push({
        peerId: device.peerId,
        sessionId: chosen.sessionId,
        alias: device.alias,
        hostName: device.hostName || "",
        sessionTitle: chosen.title || ""
      });
    };

    for (const raw of Array.isArray(targets) ? targets : []) {
      const text = String(raw ?? "").trim();
      if (!text) continue;
      if (ALL_DEVICES.test(text)) {
        for (const device of devices.filter((item) => item.online && item.paired)) await pushDevice(device);
        continue;
      }

      // 支持 “手机A#sessionId” 这种精确写法。
      const hash = text.indexOf("#");
      const namePart = hash > 0 ? text.slice(0, hash).trim() : text;
      const sessionPart = hash > 0 ? text.slice(hash + 1).trim() : "";
      const needle = namePart.toLowerCase();

      let matches = devices.filter((device) => {
        const peerId = device.peerId.toLowerCase();
        return (
          peerId === needle ||
          peerId.endsWith(needle) ||
          String(device.alias).toLowerCase() === needle ||
          String(device.hostName).toLowerCase() === needle ||
          (needle.length >= 2 && String(device.alias).toLowerCase().includes(needle)) ||
          (needle.length >= 2 && String(device.hostName).toLowerCase().includes(needle))
        );
      });

      // 也允许直接点名对端的某个会话标题。
      if (matches.length === 0) {
        const sessionHit = rows.find(
          (row) =>
            row.sessionId === namePart ||
            (namePart.length >= 2 && `${row.title} ${row.workspace}`.toLowerCase().includes(needle))
        );
        if (sessionHit) matches = devices.filter((device) => device.peerId === sessionHit.peerId);
      }

      if (matches.length === 0) {
        rejected.push({ target: text, reason: "没有找到这台设备（先用 link_devices 看已配对设备）" });
        continue;
      }
      if (matches.length > 1) {
        if (settings.get().askWhenAmbiguous === false) {
          await pushDevice(matches.find((item) => item.online && item.paired) || matches[0], sessionPart);
          continue;
        }
        rejected.push({
          target: text,
          reason: `匹配到多台设备：${matches.map((item) => `${item.alias}(${item.peerId})`).join("、")}，请用 peerId 指定`
        });
        continue;
      }
      await pushDevice(matches[0], sessionPart);
    }
    return { targets: accepted, rejected, devices };
  }

  function taskMessage(task) {
    const localName = settings.get().localName || "另一台 DSH";
    return [
      `[远程任务 #${task.id}]`,
      task.instruction.trim(),
      "",
      "——",
      `这是「${localName}」通过 DSH 远程派来的任务，请直接执行。`,
      `做完后用 link_reply 回复，正文第一行写：[任务完成 #${task.id}]，下面写结果摘要。`,
      `如果失败，第一行写：[任务失败 #${task.id}]，再写原因。`
    ].join("\n");
  }

  async function sendTaskText(task, target, text) {
    const sent = await ctx.dshWeave.sendTo({
      hostId: target.peerId,
      from: `${fromPrefix}${task.sessionId || "unknown"}`,
      to: target.sessionId,
      text,
      timeoutMs
    });
    return sent;
  }

  function retryMessage(task, reason) {
    return [
      `[远程任务 #${task.id} · 第 ${Math.max(1, Number(task.retries ?? 0))} 次尝试]`,
      `上次失败原因：${String(reason ?? "").trim() || "对方没有说明"}`,
      "请换一种方式继续完成原任务，不要重复上一次的做法。",
      "如果同一种错误再次出现，直接停下，第一行回复：[任务失败 #" + task.id + "]，下面写原因。",
      "",
      "原任务：",
      task.instruction.trim()
    ].join("\n");
  }

  /**
   * 同一个任务内重试，不新建任务。自动重试最多 maxRetries 次；手工重试不设上限。
   * 返回是否至少发到了一台设备。
   */
  async function retryTask(task, reason, { manual = false } = {}) {
    await ready;
    const used = Number(task.retries ?? 0);
    if (!manual && used >= Number(task.maxRetries ?? 2)) return false;
    task.retries = used + 1;
    task.failure = null;
    task.result = { text: "", files: [] };
    task.status = "dispatched";
    task.justFailed = false;
    task.stuck = false;
    task.asks = 0;
    task.lastAskAt = 0;
    await store.event(task, "retry", `第 ${task.retries} 次尝试：${String(reason ?? "").trim() || "换一种方式"}`);
    let delivered = 0;
    for (const target of task.targets) {
      try {
        const sent = await sendTaskText(task, target, retryMessage(task, reason));
        target.deliveredAt = Date.now();
        target.remoteMessageId = String(sent?.id ?? "");
        delivered += 1;
        await store.event(task, "dispatched", `第 ${task.retries} 次已派给 ${target.alias || shortId(target.peerId)}`);
      } catch (error) {
        target.error = error instanceof Error ? error.message : String(error);
        await store.event(task, "warn", `第 ${task.retries} 次派给 ${target.alias || shortId(target.peerId)} 失败：${target.error}`);
      }
    }
    if (delivered === 0) {
      task.status = "failed";
      task.failure = { reason: "重试也没有发出去", at: Date.now(), source: "send" };
      task.result = { text: "重试也没有发出去", files: [] };
    } else {
      task.lastProgressAt = Date.now();
    }
    await store.save(task);
    return delivered > 0;
  }

  /** 唯一失败入口：先把失败写清楚，再按内容决定要不要换方式重试。 */
  async function handleFailure(task, text, source = "marker") {
    const reason = String(text ?? "").trim() || "对方没有写失败原因";
    task.status = "failed";
    task.justFailed = true;
    task.failure = { reason, at: Date.now(), source, retryable: classifyFailure(reason).retryable };
    task.result = { text: reason, files: [] };
    task.stuck = false;
    await store.event(task, "failed", `任务失败：${reason.slice(0, 200)}`);
    const verdict = classifyFailure(reason);
    if (verdict.retryable && Number(task.retries ?? 0) < Number(task.maxRetries ?? 2)) {
      await store.event(task, "retry-plan", `失败可重试（${verdict.reason}），准备换一种方式`);
      await retryTask(task, reason, { manual: false });
      // 让入站层知道这一轮是“失败后自动重试”，下一轮普通消息会把它清掉。
      task.justFailed = true;
      task.failure = { reason, at: Date.now(), source, retryable: true, retried: true };
      await store.save(task);
    } else {
      await store.event(
        task,
        "stopped",
        verdict.retryable
          ? "自动重试次数已用完，停下来等用户决定"
          : `不自动重试：${verdict.reason}`
      );
      await store.save(task);
    }
    return task;
  }

  async function retryTaskById(taskId, { manual = true, reason = "用户点了重试" } = {}) {
    await ready;
    const task = store.get(taskId);
    if (!task) throw new Error("任务不存在");
    if (task.status !== "failed") throw new Error("只有失败的任务可以重试");
    return retryTask(task, task.failure?.reason || reason, { manual });
  }

  async function deleteTask(taskId) {
    await ready;
    return store.remove(taskId);
  }

  async function createTask({ sessionId, workspacePath, targets, instruction }) {
    await ready;
    const resolved = await resolveTargets(targets);
    const task = store.create({
      id: newTaskId(),
      sessionId: String(sessionId ?? ""),
      workspacePath: String(workspacePath ?? ""),
      targets: resolved.targets,
      instruction: String(instruction ?? ""),
      status: "queued"
    });
    await store.event(task, "created", `任务已创建，准备派给 ${resolved.targets.length} 台设备`);
    await store.message(task, "local", String(instruction ?? "").trim());
    // 多台设备并行派：每台各建一条连接，别让第一台离线把后面的全拖住。
    // 发送阶段只读 task；结果统一回到主流程再串行落盘，避免并发写同一个任务文件。
    const sends = await Promise.all(
      task.targets.map(async (target) => {
        try {
          const sent = await sendTaskText(task, target, taskMessage(task));
          return { target, sent };
        } catch (error) {
          return { target, error };
        }
      })
    );
    let delivered = 0;
    for (const item of sends) {
      const { target, sent, error } = item;
      if (sent) {
        target.deliveredAt = Date.now();
        target.remoteMessageId = String(sent?.id ?? "");
        delivered += 1;
        await store.event(task, "dispatched", `已派给 ${target.alias || shortId(target.peerId)}`);
      } else {
        target.error = error instanceof Error ? error.message : String(error);
        await store.event(task, "warn", `派给 ${target.alias || shortId(target.peerId)} 失败：${target.error}`);
      }
    }
    task.status = delivered > 0 ? "dispatched" : "failed";
    if (delivered === 0) {
      task.failure = { reason: "所有目标都发送失败", at: Date.now(), source: "send", retryable: false };
      task.result = { text: "所有目标都发送失败", files: [] };
    }
    await store.save(task);
    await store.saveIndex();
    const failed = task.targets
      .filter((target) => !target.deliveredAt)
      .map((target) => ({ target: target.alias || target.peerId, reason: target.error || "发送失败" }));
    return {
      task,
      accepted: task.targets.filter((target) => target.deliveredAt),
      rejected: [...resolved.rejected, ...failed]
    };
  }

  function marker(text, word) {
    const re = new RegExp(`\\[?\\s*${word}\\s*#?\\s*([A-Za-z0-9_-]{4,})?\\s*\\]?`);
    const match = re.exec(String(text ?? ""));
    if (!match) return null;
    return { id: match[1] || "", text: match[0] };
  }

  /** 认领一条来自对端的消息，返回命中的任务（没有就 null）。 */
  async function handleInbound(message, entry) {
    await ready;
    const peerId = String(message?.peerId ?? "");
    if (peerId) {
      peerSeen.set(peerId, Date.now());
      const entry = health.get(peerId) ?? { fails: 0, lastOkAt: 0 };
      entry.fails = 0;
      entry.lastOkAt = Date.now();
      health.set(peerId, entry);
    }
    const senderSession = String(entry?.sessionId ?? "");
    const text = String(message?.text ?? "");

    // unreachable 的任务也要能接回来：对方一说话就算重新联系上。
    // 优先挂到还在进行中的任务；都结束了，就挂到这台设备最近一条任务上，
    // 这样任务完成/失败之后对方再发来的消息也能在任务对话里看到。
    const peerTasks = store.list().filter((task) =>
      task.targets.some((target) => target.peerId === peerId)
    );
    const candidates = peerTasks.filter((task) => !TERMINAL.has(task.status));
    // 回话正文里通常带着任务号（[任务完成 #xxx] / [远程任务 #xxx]）。先按号认：
    // 同一台设备同时跑好几条任务、又都开了新会话时，只按会话 id 会挂错。
    let task = candidates.find((item) => item.id && text.includes(item.id)) || null;
    if (!task) {
      task =
        candidates.find((item) =>
          item.targets.some((target) => target.peerId === peerId && target.sessionId === senderSession)
        ) || null;
    }
    if (!task) {
      // 派去「新会话」的任务：对端现开的会话 id 我们事先不知道，回话时才知道。
      // 按设备认领，并把真实 id 记下来，后面探活和续聊才有地方发。
      task = candidates.find((item) =>
        item.targets.some(
          (target) => target.peerId === peerId && target.sessionId === NEW_SESSION_TARGET
        )
      ) || null;
    }
    // 不管怎么认到的，只要对端报了真实会话 id，就把它记下来（新会话模式的关键一步）。
    if (task && senderSession && senderSession !== NEW_SESSION_TARGET) {
      const target = task.targets.find((item) => item.peerId === peerId);
      if (target && target.sessionId !== senderSession) {
        const wasNew = target.sessionId === NEW_SESSION_TARGET;
        target.sessionId = senderSession;
        if (wasNew) {
          target.sessionTitle = target.sessionTitle === "新会话" ? "" : target.sessionTitle;
          target.newSession = false;
        }
      }
    }
    if (!task) task = candidates[0] || null;
    let outcome = "message";
    if (!task) {
      const recent = peerTasks.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      task = recent[0] || null;
    }
    if (!task) return null;
    const terminal = TERMINAL.has(task.status);

    const done = marker(text, "任务完成");
    const failed = marker(text, "任务失败");
    const hit = done || failed;
    if (hit) {
      const id = String(hit.id ?? "");
      if (id && !task.id.startsWith(id) && !id.startsWith(task.id)) {
        // 不是这条任务的完成标记，当普通消息处理。
      } else {
        const clean = text.replace(hit.text, "").replace(/^[:：\s]+/, "").trim();
        task.lastHeartbeatAt = Date.now();
        task.lastProgressAt = Date.now();
        task.stuck = false;
        if (done) {
          task.status = "done";
          task.failure = null;
          task.result = { text: clean || "对方没有写结果摘要", files: [] };
          await store.event(task, "result", "任务完成");
          await store.save(task);
          return { task, outcome: "done" };
        }
        const failedTask = await handleFailure(task, clean || "对方没有写失败原因", "marker");
        return { task: failedTask, outcome: "failed" };
      }
    }

    if (!terminal && task.status === "dispatched") {
      task.status = "running";
    }
    task.lastHeartbeatAt = Date.now();
    task.lastProgressAt = Date.now();
    task.stuck = false;
    task.justFailed = false;
    const from = task.targets.find((target) => target.peerId === peerId)?.alias || shortId(peerId);
    await store.message(task, "peer", text, { from });
    await store.save(task);
    await store.saveIndex();
    return { task, outcome };
  }

  async function sendFollowup(task, text) {
    const body = `[远程任务 #${task.id} · 补充]\n${String(text ?? "").trim()}`;
    let delivered = 0;
    for (const target of task.targets) {
      try {
        await sendTaskText(task, target, body);
        delivered += 1;
      } catch (error) {
        await store.event(task, "warn", `补充消息没发到 ${target.alias || shortId(target.peerId)}：${String(error?.message ?? error)}`);
      }
    }
    if (delivered > 0) {
      await store.message(task, "local", String(text ?? ""));
      task.lastProgressAt = Date.now();
      task.stuck = false;
    }
    await store.save(task);
    await store.saveIndex();
    return delivered;
  }

  async function askProgress(task) {
    const body = [
      `[远程任务 #${task.id} 追问]`,
      "进度如何？如果已经做完，请用 link_reply 回复，第一行写：",
      `[任务完成 #${task.id}]`
    ].join("\n");
    for (const target of task.targets) {
      try {
        await sendTaskText(task, target, body);
      } catch (error) {
        ctx.logger?.debug?.("dsh-weave-link: 追问发送失败", error);
      }
    }
  }

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
    await ready;
    const now = Date.now();
    const config = settings.get();
    const probeEveryMs = Math.max(5, Number(config.heartbeatSec) || 30) * 1000;
    const stuckMs = Math.max(30, Number(config.stuckSec) || 120) * 1000;
    const maxAsks = Math.max(1, Number(config.maxAsks) || 3);

    // 后台定期真连一次对端会话目录：hosts() 没有常驻心跳，只有 remoteSessions
    // 成功/失败才会更新状态。不 await，避免一次 20 秒的探测卡住任务检查。
    if (now - lastCatalogProbeAt >= probeEveryMs) {
      lastCatalogProbeAt = now;
      readCatalog(20_000, true).catch((error) =>
        ctx.logger?.debug?.("dsh-weave-link: 后台探测对端失败", error)
      );
    }

    // 失败任务不在 watched 里；还在跑的任务继续探活，对方开始执行时更新状态。
    const watched = store.list().filter((task) => !TERMINAL.has(task.status));
    for (const task of watched) {
      let dirty = false;
      if (now - Number(task.lastProbeAt ?? 0) >= probeEveryMs) {
        task.lastProbeAt = now;
        let running = false;
        for (const target of task.targets) {
          // 还没认领到真实会话（派去「新会话」但对方还没回话）时没有 id 可探。
          if (!target.sessionId || target.sessionId === NEW_SESSION_TARGET) continue;
          try {
            const status = await ctx.dshWeave.sessionStatus?.(target.peerId, target.sessionId);
            if (status?.state === "running") {
              running = true;
              if (task.status === "dispatched") {
                task.status = "running";
                task.lastProgressAt = now;
                task.stuck = false;
                await store.event(
                  task,
                  "status",
                  `${target.alias || shortId(target.peerId)} 已开始执行`
                );
              }
            }
          } catch (error) {
            ctx.logger?.debug?.("dsh-weave: 会话状态查询失败", error);
          }
        }
        if (running) {
          task.lastHeartbeatAt = now;
          dirty = true;
        }
      }

      if (now - Number(task.lastProgressAt ?? task.createdAt) >= stuckMs && now - Number(task.lastAskAt ?? 0) >= stuckMs) {
        if (Number(task.asks ?? 0) < maxAsks) {
          await askProgress(task);
          task.asks = Number(task.asks ?? 0) + 1;
          task.lastAskAt = now;
          task.stuck = true;
          await store.event(task, "ask", `可能卡住了，已第 ${task.asks} 次追问：进度如何？`);
          dirty = true;
        } else if (task.status !== "failed") {
          await handleFailure(task, "连续追问没有回应，联系不上对方", "timeout");
          dirty = false;
        }
      }

      if (dirty) {
        await store.save(task);
        await store.saveIndex();
      }
    }
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch((error) => ctx.logger?.warn?.("dsh-weave-link: 心跳检查失败", error));
    }, 3_000);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    ready,
    store,
    listDevices,
    createIncomingSession,
    resolveTargets,
    createTask,
    handleInbound,
    handleFailure,
    retryTaskById,
    deleteTask,
    sendFollowup,
    tick,
    start,
    stop,
    sessionIdOf,
    taskTitle
  };
}
