/**
 * dsh-weave — 两台 DSH 之间双向传话、传文件（远程任务层）。
 *
 * 依赖 dsh-weave（提供加密直连通道）。入站消息由本插件自己投进目标会话，
 * 不经过 dsh-bridge —— dsh-bridge 0.1.0-rc.17 用的 source.kind="plugin"
 * 在 session format v4 下会被拒绝（"requires a producer-owned source kind"）。
 * 对端也要装同一个插件，才能从对端主动回话、主动发文件。
 */
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
import { SettingsStore } from "./settings.js";
import { createTaskService } from "./task-service.js";
import { registerHttpApi } from "./http-api.js";

export const name = "dsh-weave";

/** dshWeave: 通道；agents/typert: 把入站消息投进会话；tools: 注册工具；sessions: 取会话工作区。 */
export const inject = ["tools", "dshWeave", "agents", "typert", "sessions"];

const FROM_PREFIX = "weave-link:";
const SYSTEM_TARGET = "dsh-weave/system/1";
/** 手机发“开个新对话”用的目标；收到后在本机默认工作区新建会话。 */
const NEW_SESSION_TARGET = "weave-link:new";
/** 文件分片消息统一发到这个目标，由本插件认领，不会进任何会话。 */
const FILE_TARGET = "dsh-weave/file/1";
const MAX_INBOX = 200;
const MAX_OUTBOX = 100;
/** 每片原始字节数。base64 后约 43.7KB，加信封仍在 64KB 帧内。 */
const CHUNK_BYTES = 32 * 1024;

export const Config = Schema.object({
  timeoutMs: Schema.number()
    .default(15_000)
    .description("发送一条消息最多等多久（毫秒）。手机息屏时首次连接可能要几秒，别设太小。"),
  replyHint: Schema.boolean()
    .default(true)
    .description("发送时在末尾附一句“回复请用 link_reply”，方便对端的 AI 找到回话工具。")
});

function shortId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}…` : String(id ?? "");
}

function safeName(name) {
  const base = path.basename(String(name || "file"));
  return base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "file";
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function uniquePath(dir, name) {
  const base = safeName(name);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = path.join(dir, base);
  for (let i = 1; i < 1000; i += 1) {
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${stem}_${i}${ext}`);
  }
  return path.join(dir, `${stem}_${Date.now()}${ext}`);
}

export function apply(ctx, config) {
  const timeoutMs = config.timeoutMs ?? 15_000;
  const replyHint = config.replyHint !== false;
  const settings = new SettingsStore(ctx.logger, ctx);
  const settingsReady = settings.load().catch((error) => {
    ctx.logger?.warn?.("dsh-weave: 设置读取失败，用默认值", error);
  });
  settingsReady.then(() => {
    try {
      ctx.dshWeave?.setHostName?.(settings.get().localName);
    } catch {
      /* 旧版 dsh-weave 没有这个方法时忽略 */
    }
  });
  const service = createTaskService(ctx, { settings, timeoutMs, fromPrefix: FROM_PREFIX });

  /** 收到的消息（记录 + 由本插件投递进目标会话）。 */
  const inbox = [];
  /** 发出去的消息，方便排查。 */
  const outbox = [];
  /** 最近一次收到消息的对端，link_reply 默认回到这里。 */
  let lastPeer = null;
  /** 正在接收的文件：id -> { name, size, sha256, total, parts: Map } */
  const incoming = new Map();
  /** 已经收好的文件。 */
  const files = [];

  /** 本机 endpoint id：从自己的配对票据里解出来，缓存一次。 */
  let selfIdPromise = null;
  function selfEndpointId() {
    if (!selfIdPromise) {
      selfIdPromise = (async () => {
        try {
          const ticket = await ctx.dshWeave?.ticket?.();
          if (!ticket) return "";
          const weave = ctx.dshWeave;
          if (typeof weave?.identify === "function") return String(weave.identify(ticket) || "");
        } catch (error) {
          ctx.logger?.debug?.("dsh-weave: 读取本机 endpoint id 失败", error);
        }
        return "";
      })();
    }
    return selfIdPromise;
  }

  /** 找到目标会话对应的 agent：活着的直接用，没有就按 id 恢复。 */
  async function resolveAgent(sessionId) {
    const live = ctx.agents.get(sessionId);
    if (live) return live;
    const provider = ctx.typert.lookups.get("agent");
    if (!provider) throw new Error("本机没有 agent 解析器");
    const resolved = await provider.resolve(sessionId);
    if (!resolved) throw new Error(`会话 ${sessionId} 不存在`);
    return resolved;
  }

  /** 找这台对端最近一次任务所在的本地会话；文件默认落到它的项目文件夹。 */
  function sessionForPeer(peerId) {
    try {
      const tasks = service.store
        .list()
        .filter((task) => (task.targets || []).some((target) => String(target.peerId) === String(peerId)))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      return String(tasks[0]?.sessionId ?? "");
    } catch {
      return "";
    }
  }

  /** 处理一片文件信封，返回 true 表示已认领（不再投进会话）。 */
  async function handleFileFrame(message, raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!frame || frame.__wl !== "file") return false;
    const id = String(frame.id ?? "");
    if (!id) return true;

    if (frame.op === "begin") {
      incoming.set(id, {
        name: safeName(frame.name),
        size: Number(frame.size ?? 0),
        sha256: String(frame.sha256 ?? ""),
        total: Number(frame.total ?? 0),
        parts: new Map(),
        peerId: String(message.peerId ?? ""),
        from: String(message.from ?? "")
      });
      return true;
    }

    if (frame.op === "chunk") {
      const job = incoming.get(id);
      if (job) job.parts.set(Number(frame.seq ?? 0), Buffer.from(String(frame.data ?? ""), "base64"));
      return true;
    }

    if (frame.op === "end") {
      const job = incoming.get(id);
      incoming.delete(id);
      if (!job) return true;
      const ordered = [];
      for (let i = 0; i < job.parts.size; i += 1) {
        const part = job.parts.get(i);
        if (!part) throw new Error(`文件 ${job.name} 缺第 ${i} 片`);
        ordered.push(part);
      }
      const buf = Buffer.concat(ordered);
      if (job.size && buf.length !== job.size) throw new Error(`文件 ${job.name} 大小不符：期望 ${job.size}，实收 ${buf.length}`);
      if (job.sha256 && sha256(buf) !== job.sha256) throw new Error(`文件 ${job.name} 校验失败`);
      const sessionId = sessionForPeer(job.peerId);
      const inboxDir = settings.inboxPath(sessionId);
      await fs.mkdir(inboxDir, { recursive: true });
      const target = await uniquePath(inboxDir, job.name);
      await fs.writeFile(target, buf);
      const record = { name: path.basename(target), size: buf.length, path: target, peerId: job.peerId, sessionId, at: Date.now() };
      files.push(record);
      while (files.length > MAX_INBOX) files.shift();
      ctx.logger?.info?.(`dsh-weave: 收到文件 ${target}（${buf.length} 字节）`);
      return true;
    }

    return true;
  }

  ctx.effect(
    () =>
      ctx.dshWeave.subscribe(async (message) => {
        const from = typeof message.from === "string" ? message.from : "";
        const senderSessionId = from.startsWith(FROM_PREFIX) ? from.slice(FROM_PREFIX.length) : from;
        const text = String(message.text ?? "");
        const to = String(message.to ?? "");

        // 文件分片：认领，不记入普通消息箱、也不投进会话。
        if (to === FILE_TARGET) {
          try {
            return await handleFileFrame(message, text);
          } catch (error) {
            ctx.logger?.warn?.("dsh-weave: 接收文件分片失败", error);
            return true;
          }
        }

        const entry = {
          peerId: String(message.peerId ?? ""),
          from,
          sessionId: senderSessionId,
          to,
          text,
          at: typeof message.receivedAt === "number" ? message.receivedAt : Date.now()
        };
        inbox.push(entry);
        while (inbox.length > MAX_INBOX) inbox.shift();
        lastPeer = { peerId: entry.peerId, sessionId: senderSessionId };
        // 系统帧（会话目录查询）不归我们投递。
        if (to === SYSTEM_TARGET) return false;

        // 先让远程任务服务认领（完成标记、进度回报）；无论认不认领，消息都继续投进会话。
        let handled = null;
        try {
          handled = await service.handleInbound(message, entry);
        } catch (error) {
          ctx.logger?.warn?.("dsh-weave: 处理任务回报失败", error);
        }

        // 手机主动开新对话时，先在本机默认工作区建一个新的会话，再投进去。
        let targetSession = to;
        if (to === NEW_SESSION_TARGET) {
          try {
            targetSession = await service.createIncomingSession();
          } catch (error) {
            ctx.logger?.warn?.("dsh-weave: 新对话创建失败", error);
            return false;
          }
        }

        // 普通进度只注入上下文，不主动唤醒主 AI；完成/失败/提问才让它接话。
        const claimed = handled?.task || null;
        const failed = Boolean(claimed) && (handled.outcome === "failed" || Boolean(claimed.justFailed));
        const finished = Boolean(claimed) && (handled.outcome === "done" || failed);
        let body = `[dsh-weave ${senderSessionId || shortId(message.peerId)}]\n${text}`;
        if (finished) {
          if (handled.outcome === "done") {
            body = `[远程任务 #${claimed.id} 已完成]\n${claimed.result?.text || text}`;
          } else {
            const reason = claimed.failure?.reason || claimed.result?.text || text;
            const retried = claimed.status === "dispatched" && Number(claimed.retries ?? 0) > 0;
            body = `[远程任务 #${claimed.id} 失败]\n${reason}` +
              (retried ? `\n插件已自动换方式重试（第 ${claimed.retries} 次）。` : "");
          }
        }
        const wake = Boolean(finished) || /[@?？]|请问|怎么|是否|需要|能不能|可以吗|帮我|你看|怎么办|选哪个/.test(text);

        // 投进本机目标会话。source 必须用 agent-message（v4 不接受 plugin）。
        try {
          const target = await resolveAgent(targetSession);
          const userMessage = {
            id: randomUUID(),
            role: "user",
            content: [
              {
                type: "text",
                text: body
              }
            ],
            source: {
              kind: "agent-message",
              form: "relay",
              senderSessionId: senderSessionId || String(message.peerId ?? "")
            }
          };
          if (wake || typeof target.inject !== "function") {
            target.followup(userMessage);
          } else {
            target.inject(userMessage);
          }
          return true;
        } catch (error) {
          ctx.logger?.warn?.("dsh-weave: 入站消息投递失败", error);
          return false;
        }
      }),
    "dsh-weave: inbox"
  );

  // 设置读完再开始心跳检查；插件卸载时停掉定时器。
  ctx.effect(() => {
    let disposed = false;
    settingsReady.then(() => {
      if (!disposed) service.start();
    });
    return () => {
      disposed = true;
      service.stop();
    };
  }, "dsh-weave: task heartbeat");

  ctx.effect(
    () => registerHttpApi(ctx, { service, settings, timeoutMs, inbox }),
    "dsh-weave: panel api"
  );

  function rememberOutbound(entry) {
    outbox.push(entry);
    while (outbox.length > MAX_OUTBOX) outbox.shift();
  }

  function hostIdOf(host) {
    return String(host?.hostId ?? host?.peerId ?? "");
  }

  function flattenSessions(hosts) {
    const rows = [];
    for (const host of hosts ?? []) {
      const hostId = hostIdOf(host);
      const hostName = String(host?.hostName ?? shortId(hostId));
      const workspaces = Array.isArray(host?.workspaces) ? host.workspaces : [];
      for (const workspace of workspaces) {
        const sessions = Array.isArray(workspace?.sessions) ? workspace.sessions : [];
        for (const session of sessions) {
          rows.push({
            hostId,
            hostName,
            workspace: String(workspace?.title ?? ""),
            sessionId: String(session?.id ?? ""),
            title: String(session?.title ?? ""),
            state: String(session?.state ?? (session?.running ? "running" : "unknown"))
          });
        }
      }
    }
    return rows;
  }

  ctx.tools.register(
    defineTool({
      name: "link_peers",
      description:
        "列出已经和本机配对的 DSH 对端（通过 dsh-weave 配对），以及它们当前是在线还是离线。给对端发消息前先用它拿 hostId。",
      parameters: {},
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              hostId: { type: "string", required: true },
              state: { type: "string", required: true },
              addressKnown: { type: "boolean", required: true }
            }
          }
        },
        render: (_args, value) =>
          value.length === 0
            ? [{ type: "text", text: "没有配对的对端。先在设置 → Weave 里交换票据。" }]
            : [
                {
                  type: "text",
                  text: value.map((item) => `${item.hostId}  ${item.state}`).join("\n")
                }
              ]
      },
      async execute() {
        const hosts = ctx.dshWeave.hosts?.() ?? [];
        return (hosts ?? []).map((host) => ({
          hostId: hostIdOf(host),
          state: String(host?.state ?? "unknown"),
          addressKnown: Boolean(host?.addressKnown)
        }));
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_sessions",
      description:
        "列出对端 DSH 上所有正在运行的工作区和会话（标题、状态）。发消息前用它挑要发给哪个会话；不传 hostId 就查所有对端。",
      parameters: {
        hostId: {
          type: "string",
          description: "对端的 hostId（link_peers 里拿）。不传就查全部。"
        }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              hostId: { type: "string", required: true },
              hostName: { type: "string", required: true },
              workspace: { type: "string", required: true },
              sessionId: { type: "string", required: true },
              title: { type: "string", required: true },
              state: { type: "string", required: true }
            }
          }
        },
        render: (_args, value) =>
          value.length === 0
            ? [{ type: "text", text: "没读到会话。对端可能离线，或者没装 dsh-bridge。" }]
            : [
                {
                  type: "text",
                  text: value
                    .map(
                      (item) =>
                        `${item.hostName} / ${item.workspace || "(无工作区)"} / ${item.title || item.sessionId}  [${item.state}]  ${item.sessionId}`
                    )
                    .join("\n")
                }
              ]
      },
      async execute(args) {
        const wanted = String(args?.hostId ?? "").trim();
        let hosts = ctx.dshWeave.hosts?.() ?? [];
        if (wanted) hosts = hosts.filter((host) => hostIdOf(host) === wanted);
        if (!hosts || hosts.length === 0) return [];
        // remoteSessions 内部对每个 peer 走一次 request/response，超时自己传，别用默认的 3 秒。
        const catalogs = await ctx.dshWeave.remoteSessions(timeoutMs);
        const filtered = wanted ? (catalogs ?? []).filter((host) => hostIdOf(host) === wanted) : catalogs ?? [];
        return flattenSessions(filtered);
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_send",
      description:
        "把一条消息发给对端 DSH 上的某个会话。对方会话里会收到一条用户消息，对方的 AI 会像收到用户指令一样处理它，并可以用 link_reply 回话。",
      parameters: {
        hostId: { type: "string", required: true, description: "对端 hostId。" },
        sessionId: {
          type: "string",
          description: "对端目标会话 id。如果对端只有一个会话，可以不传，会自动选中。"
        },
        text: { type: "string", required: true, description: "要发过去的内容。" }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", required: true },
            peerId: { type: "string", required: true },
            sessionId: { type: "string", required: true },
            delivered: { type: "boolean", required: true }
          }
        },
        render: (_args, value) => [
          { type: "text", text: `已送达 ${shortId(value.peerId)} / ${value.sessionId}（消息 ${value.id}）` }
        ]
      },
      async execute(args, exec) {
        const hostId = String(args?.hostId ?? "").trim();
        if (!hostId) throw new Error("hostId 不能为空，先用 link_peers 查");
        const text = String(args?.text ?? "");
        if (!text.trim()) throw new Error("text 不能为空");

        let sessionId = String(args?.sessionId ?? "").trim();
        if (!sessionId) {
          const catalogs = await ctx.dshWeave.remoteSessions(timeoutMs);
          const rows = flattenSessions((catalogs ?? []).filter((host) => hostIdOf(host) === hostId));
          if (rows.length === 0) throw new Error("对端没有可用的会话（可能离线）");
          if (rows.length > 1) {
            throw new Error(
              `对端有 ${rows.length} 个会话，请指定 sessionId：\n` +
                rows.map((row) => `${row.sessionId}  ${row.title}`).join("\n")
            );
          }
          sessionId = rows[0].sessionId;
        }

        let body = text;
        if (replyHint) {
          // 尾巴写本机自己的 endpoint id：写收件方 hostId 会让对方误以为是自己。
          const selfId = await selfEndpointId();
          body = selfId
            ? `${text}\n\n—— 来自另一台 DSH（${selfId}）。回话请调用 link_reply 工具。`
            : `${text}\n\n—— 来自另一台 DSH。回话请调用 link_reply 工具。`;
        }
        const from = `${FROM_PREFIX}${service.sessionIdOf(exec)}`;
        const sent = await ctx.dshWeave.sendTo({
          hostId,
          from,
          to: sessionId,
          text: body,
          timeoutMs: timeoutMs
        });
        rememberOutbound({ at: Date.now(), hostId, sessionId, text, id: sent?.id });
        return {
          id: String(sent?.id ?? ""),
          peerId: String(sent?.peerId ?? hostId),
          sessionId,
          delivered: sent?.delivered !== false
        };
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_put",
      description:
        "把一个文件发送给对端 DSH。文件按 32KB 分片走加密通道，对端收到后存进它当前对话的项目文件夹（自动建「收到文件」子目录）。适合截图、文档、图片，不适合视频大文件。",
      parameters: {
        hostId: { type: "string", required: true, description: "对端 hostId。" },
        file: { type: "string", required: true, description: "要发送的本地文件路径（绝对路径，或相对当前工作目录）。" },
        name: { type: "string", description: "对端保存时用的文件名。不传就用原文件名。" }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", required: true },
            size: { type: "number", required: true },
            chunks: { type: "number", required: true },
            peerId: { type: "string", required: true }
          }
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `已发送 ${value.name}（${value.size} 字节，${value.chunks} 片）到 ${shortId(value.peerId)}`
          }
        ]
      },
      async execute(args, exec) {
        const hostId = String(args?.hostId ?? "").trim();
        if (!hostId) throw new Error("hostId 不能为空，先用 link_peers 查");
        const filePath = String(args?.file ?? "").trim();
        if (!filePath) throw new Error("file 不能为空");
        const resolved = path.resolve(filePath);
        const buf = await fs.readFile(resolved);
        const id = randomUUID();
        const total = Math.max(1, Math.ceil(buf.length / CHUNK_BYTES));
        const name = safeName(args?.name || path.basename(resolved));
        const from = `${FROM_PREFIX}${"file"}`;

        await ctx.dshWeave.sendTo({
          hostId,
          from,
          to: FILE_TARGET,
          text: JSON.stringify({ __wl: "file", op: "begin", id, name, size: buf.length, total, sha256: sha256(buf) }),
          timeoutMs: timeoutMs
        });

        for (let seq = 0; seq < total; seq += 1) {
          const slice = buf.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
          await ctx.dshWeave.sendTo({
            hostId,
            from,
            to: FILE_TARGET,
            text: JSON.stringify({ __wl: "file", op: "chunk", id, seq, data: slice.toString("base64") }),
            timeoutMs: timeoutMs
          });
        }

        await ctx.dshWeave.sendTo({
          hostId,
          from,
          to: FILE_TARGET,
          text: JSON.stringify({ __wl: "file", op: "end", id }),
          timeoutMs: timeoutMs
        });

        rememberOutbound({ at: Date.now(), hostId, sessionId: FILE_TARGET, text: `file:${name}`, id });
        return { name, size: buf.length, chunks: total, peerId: hostId };
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_files",
      description: "列出通过 link_put 收到的文件（默认在当前对话的项目文件夹「收到文件」子目录下），返回路径和大小。",
      parameters: {
        limit: { type: "number", description: "最多返回多少条，默认 20。" }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", required: true },
              size: { type: "number", required: true },
              path: { type: "string", required: true },
              at: { type: "number", required: true }
            }
          }
        },
        render: (_args, value) =>
          value.length === 0
            ? [{ type: "text", text: "还没有收到过文件。收到的文件会放在当前对话的项目文件夹「收到文件」子目录里。" }]
            : [
                {
                  type: "text",
                  text: value
                    .map((item) => `${new Date(item.at).toLocaleString()}  ${item.name}  ${item.size} 字节\n${item.path}`)
                    .join("\n")
                }
              ]
      },
      async execute(args, exec) {
        const limit = Math.max(1, Math.min(200, Number(args?.limit ?? 20) || 20));
        const currentSession = service.sessionIdOf(exec);
        const scoped = currentSession ? files.filter((item) => item.sessionId === currentSession) : files;
        return scoped.slice(-limit).map((item) => ({
          name: item.name,
          size: item.size,
          path: item.path,
          at: item.at
        }));
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_reply",
      description:
        "回复最近一次给你发消息的对端 DSH。收到另一台 DSH 发来的消息后，用这个工具把结果发回去。",
      parameters: {
        text: { type: "string", required: true, description: "要回给对方的内容。" },
        hostId: { type: "string", description: "对端 hostId。不传就用最近一次来信的来源。" },
        sessionId: { type: "string", description: "对方会话 id。不传就用最近一次来信的来源会话。" }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", required: true },
            peerId: { type: "string", required: true },
            sessionId: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: `已回复 ${shortId(value.peerId)} / ${value.sessionId}` }]
      },
      async execute(args, exec) {
        const text = String(args?.text ?? "");
        if (!text.trim()) throw new Error("text 不能为空");
        const peerId = String(args?.hostId ?? lastPeer?.peerId ?? "").trim();
        const sessionId = String(args?.sessionId ?? lastPeer?.sessionId ?? "").trim();
        if (!peerId) throw new Error("还没有收到过任何对端消息，请直接用 link_send 指定 hostId");
        if (!sessionId) throw new Error("不知道回给哪个会话，请用 link_send 指定 hostId 和 sessionId");
        const from = `${FROM_PREFIX}${service.sessionIdOf(exec)}`;
        const sent = await ctx.dshWeave.sendTo({
          hostId: peerId,
          from,
          to: sessionId,
          text,
          timeoutMs: timeoutMs
        });
        rememberOutbound({ at: Date.now(), hostId: peerId, sessionId, text, id: sent?.id });
        return { id: String(sent?.id ?? ""), peerId, sessionId };
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_inbox",
      description: "查看最近收到的、来自其它 DSH 的消息（最多 200 条）。用来确认对端回了什么。",
      parameters: {
        limit: { type: "number", description: "最多返回多少条，默认 10。" }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              peerId: { type: "string", required: true },
              sessionId: { type: "string", required: true },
              text: { type: "string", required: true },
              at: { type: "number", required: true }
            }
          }
        },
        render: (_args, value) =>
          value.length === 0
            ? [{ type: "text", text: "还没有收到过消息。" }]
            : [
                {
                  type: "text",
                  text: value
                    .map(
                      (item) => `${new Date(item.at).toLocaleString()}  ${shortId(item.peerId)}/${item.sessionId}\n${item.text}`
                    )
                    .join("\n---\n")
                }
              ]
      },
      async execute(args) {
        const limit = Math.max(1, Math.min(200, Number(args?.limit ?? 10) || 10));
        return inbox.slice(-limit).map((item) => ({
          peerId: item.peerId,
          sessionId: item.sessionId,
          text: item.text,
          at: item.at
        }));
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_devices",
      description:
        "列出所有已配对、可派任务的远程设备（手机 / 平板 / 电脑），带在线状态、最近心跳和可用的会话数。派任务前先看这个。",
      parameters: {
        refresh: { type: "boolean", description: "是否强制刷新设备与会话列表，默认 false。" }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              peerId: { type: "string", required: true },
              alias: { type: "string", required: true },
              state: { type: "string", required: true },
              online: { type: "boolean", required: true },
              paired: { type: "boolean", required: true },
              busy: { type: "boolean", required: true },
              activeTaskCount: { type: "number", required: true },
              lastHeartbeatAt: { type: "number" },
              lastSeenSeconds: { type: "number" },
              sessions: { type: "number", required: true }
            }
          }
        },
        render: (_args, value) =>
          value.length === 0
            ? [{ type: "text", text: "还没有配对任何设备。" }]
            : [
                {
                  type: "text",
                  text: value
                    .map((item) => {
                      const state = item.online ? (item.busy ? "忙碌" : "在线") : item.state === "unpaired" ? "未配对" : "离线";
                      const seen =
                        item.lastSeenSeconds == null
                          ? "还没心跳"
                          : item.lastSeenSeconds < 60
                            ? `${item.lastSeenSeconds} 秒前有心跳`
                            : `${Math.round(item.lastSeenSeconds / 60)} 分钟前有心跳`;
                      return `${item.online ? "🟢" : "⚪"} ${item.alias}（${item.peerId}）· ${state} · ${seen} · ${item.sessions} 个会话`;
                    })
                    .join("\n")
                }
              ]
      },
      async execute(args) {
        return (await service.listDevices({ catalog: true, force: Boolean(args?.refresh) })).map((item) => {
          const view = {
            peerId: item.peerId,
            alias: item.alias,
            state: item.state,
            online: item.online,
            paired: item.paired,
            busy: item.busy,
            activeTaskCount: item.activeTaskCount,
            sessions: item.sessions
          };
          if (item.lastHeartbeatAt) view.lastHeartbeatAt = item.lastHeartbeatAt;
          if (item.lastSeenSeconds != null) view.lastSeenSeconds = item.lastSeenSeconds;
          return view;
        });
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_task",
      description:
        "把一句话任务派给一台或多台远程设备，并立刻拿到任务号。任务会出现在本会话的右侧面板和会话卡片里，状态自动更新；对方完成后结果会回到本会话。targets 可以是设备名、别名、peerId 或「所有设备」。",
      parameters: {
        targets: {
          type: "array",
          items: { type: "string" },
          required: true,
          description: "要派给谁。例如 [\"手机A\"]、[\"所有设备\"]。"
        },
        instruction: { type: "string", required: true, description: "让对端做的事，一句话说清。" }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            taskId: { type: "string", required: true },
            sessionId: { type: "string", required: true },
            status: { type: "string", required: true },
            accepted: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  peerId: { type: "string", required: true },
                  sessionId: { type: "string", required: true },
                  alias: { type: "string", required: true }
                }
              }
            },
            rejected: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  target: { type: "string", required: true },
                  reason: { type: "string", required: true }
                }
              }
            }
          }
        },
        presentationMeta: (_args, value) => ({ taskId: value.taskId, sessionId: value.sessionId }),
        render: (_args, value) => {
          const lines = [
            `已派任务 ${value.taskId}（${value.status}）：${value.accepted.map((item) => item.alias).join("、") || "无"}`
          ];
          for (const item of value.rejected) lines.push(`没派出去：${item.target} — ${item.reason}`);
          lines.push("任务卡和右侧面板会自动更新。");
          return [{ type: "text", text: lines.join("\n") }];
        }
      },
      async execute(args, exec) {
        const instruction = String(args?.instruction ?? "").trim();
        if (!instruction) throw new Error("instruction 不能为空");
        const targets = Array.isArray(args?.targets) ? args.targets.map(String) : [];
        if (targets.length === 0) throw new Error("targets 不能为空，先 link_devices 看设备");
        const sessionId = service.sessionIdOf(exec);
        if (!sessionId) throw new Error("拿不到当前会话 id，无法把任务挂到会话上");
        let workspacePath = "";
        try {
          workspacePath = String(ctx.sessions?.get?.(sessionId)?.header?.cwd ?? "");
        } catch {
          workspacePath = "";
        }
        const result = await service.createTask({ sessionId, workspacePath, targets, instruction });
        return {
          taskId: result.task.id,
          sessionId,
          status: result.task.status,
          accepted: result.accepted.map((item) => ({
            peerId: item.peerId,
            sessionId: item.sessionId,
            alias: item.alias
          })),
          rejected: result.rejected.map((item) => ({ target: item.target, reason: item.reason }))
        };
      }
    })
  );

  ctx.tools.register(
    defineTool({
      name: "link_tasks",
      description:
        "查看远程任务：不传 taskId 就列出当前会话的全部任务；传 taskId 看某一条的详细过程和结果。",
      parameters: {
        taskId: { type: "string", description: "只看这一条任务。" },
        sessionId: { type: "string", description: "看指定会话的任务；默认当前会话。" },
        limit: { type: "number", description: "最多返回多少条，默认 20。" }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", required: true },
              title: { type: "string", required: true },
              status: { type: "string", required: true },
              sessionId: { type: "string", required: true },
              workspacePath: { type: "string", required: true },
              instruction: { type: "string", required: true },
              createdAt: { type: "number", required: true },
              updatedAt: { type: "number", required: true },
              lastHeartbeatAt: { type: "number" },
              stuck: { type: "boolean", required: true },
              asks: { type: "number", required: true },
              retries: { type: "number", required: true },
              maxRetries: { type: "number", required: true },
              failure: { type: "object", additionalProperties: true },
              targets: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
              result: { type: "object", additionalProperties: true, required: true },
              events: { type: "array", items: { type: "object", additionalProperties: true } },
              messages: { type: "array", items: { type: "object", additionalProperties: true } }
            }
          }
        },
        render: (_args, value) =>
          value.length === 0
            ? [{ type: "text", text: "当前会话还没有远程任务。" }]
            : [
                {
                  type: "text",
                  text: value
                    .map((task) => {
                      const targets = (task.targets ?? []).map((item) => item.alias ?? item.peerId).join("、");
                      const detail = task.events?.length
                        ? `\n  ${task.events.slice(-3).map((item) => item.text).join(" → ")}`
                        : "";
                      const result = task.result?.text ? `\n  结果：${task.result.text}` : "";
                      return `${task.id} · ${task.status} · ${targets} · ${task.title}${detail}${result}`;
                    })
                    .join("\n\n")
                }
              ]
      },
      async execute(args, exec) {
        const taskId = String(args?.taskId ?? "").trim();
        if (taskId) {
          const task = service.store.get(taskId);
          if (!task) throw new Error(`找不到任务 ${taskId}`);
          return [taskView(task, true)];
        }
        const sessionId = String(args?.sessionId ?? service.sessionIdOf(exec) ?? "");
        const limit = Math.max(1, Math.min(100, Number(args?.limit ?? 20) || 20));
        return service.store
          .list(sessionId || undefined)
          .slice(0, limit)
          .map((task) => taskView(task, false));
      }
    })
  );
}

function taskView(task, detailed) {
  const view = {
    id: task.id,
    title: task.title,
    status: task.status,
    sessionId: task.sessionId,
    workspacePath: task.workspacePath ?? "",
    instruction: task.instruction,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    asks: task.asks ?? 0,
    retries: task.retries ?? 0,
    maxRetries: task.maxRetries ?? 2,
    failure: task.failure ?? null,
    stuck: Boolean(task.stuck),
    targets: (task.targets ?? []).map((item) => ({
      peerId: item.peerId,
      alias: item.alias ?? "",
      sessionId: item.sessionId,
      state: item.state ?? ""
    })),
    result: task.result ?? { text: "", files: [] }
  };
  if (task.lastHeartbeatAt) view.lastHeartbeatAt = task.lastHeartbeatAt;
  if (detailed) {
    view.events = (task.events ?? []).slice(-40);
    view.messages = (task.messages ?? []).slice(-60);
  }
  return view;
}
