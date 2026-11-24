# 0.3.6 · 2026-11-24

- 派任务没指定会话时**默认给对端开一个新会话**，不再塞进它正在用的对话里。新会话建在对方的「新对话默认项目」。
- 想恢复老行为：设置页「默认开新会话」关掉即可；给某台设备选了默认工作区时，仍按工作区选现有会话（新会话会落到默认目录，违背该设置）。
- 对端是老版本（不认 `weave-link:new`）时自动退回选现有会话，不会把消息发丢。
- 回话按任务号认领（同一台设备同时跑多条任务也不会挂错），并把对方的真实会话 id 记回来，后续补充/追问发到正确会话。
- 设置页新增「默认开新会话」开关。

## 0.3.5 · 2026-11-23

- 修复：新对话默认项目取不到、会话目录读取失败时的兜底。
- 入站消息支持挂到这台设备最近一条任务，任务结束后的回话也能在对话里看到。

# 0.3.2 · 2026-11-23

- 列表/对话视觉按设计台补齐：蓝色 `+`、筛选计数、头像在线绿点、状态胶囊、卡片式任务行、对话头头像与任务名。

## 0.3.1 · 2026-11-23

- 最终聊天窗口面板：任务列表 / 对话 / 派任务三视图；对话页支持失败任务「再试一次」，新增任务页有返回箭头。
- 统一失败文案为「失败」，不再显示「联系不上」；自动重试后保留失败原因供入站播报。
- `README` / `README.zh` 同步聊天面板、每会话 `weave-tasks.json`、单失败状态与最多 2 次自动重试。

## 0.3.0 · 2026-11-23

- 远程任务改为聊天窗口式右侧面板：任务列表 / 对话 / 派任务三视图，消息带作者和时间，结果只显示一次。
- 任务记录跟着对话走：每会话一个 `weave-tasks.json` 存到会话目录，删会话即删记录；旧任务自动迁移。
- 统一只有一个失败状态；失败内容分拣后自动换方式重试（最多 2 次），权限/钱/删除/对外发送等问题直接停下。
- 入站消息按单条时间线进入主会话上下文；普通进度只注入不唤醒，完成/失败/提问才叫主 AI。
- 失败任务支持在面板里手动「再试一次」。

# Releases

## 0.2.2 · 2026-11-23

- 设置页「本机名称」「设备改名」改为失焦提交，修复输入过程被 5 秒轮询覆盖导致卡顿回退。
- 收到文件默认保存到当前对话的项目文件夹下自动创建的「收到文件」子目录，不再落到全局 `~/.dsh/weave-link/inbox`；旧默认路径自动迁移。
- 「新对话默认项目」改为从 DSH 已登记的项目中选择，不再手填路径。

## 0.2.1 · 2026-11-22

Merge the remote-task layer into `dsh-weave` and remove the separate `dsh-weave-link` package: `link_devices` / `link_task` / `link_tasks`, heartbeat and follow-up reminders, session-scoped task cards, right-side task panel, a single Settings → 远程任务 page with pairing and device management, per-device default workspace, and `weave-link:new` support for new incoming sessions. Existing Weave identity and `peers.json` remain unchanged, so no re-pairing is needed.

## 0.1.0-rc.16 · 2026-09-14

Group bilingual pairing and host settings; cancel disconnected or stopped requests; preserve reachable-host state; obtain optional Bridge through the public service lookup.

Source: [`v0.1.0-rc.16`](https://github.com/baixianger/dsh-weave/tree/v0.1.0-rc.16). Distribution: `latest`.

Release tags point at the exact source commit used to build the package. The bookkeeping commit that fills in a source SHA intentionally comes after that tag.

| Version | Tag | Source commit | Summary |
| --- | --- | --- | --- |
| 0.1.0-rc.15 | `v0.1.0-rc.15` | [`aa956ee14f812e67e50a5bbcdd6969241b9a2f91`](https://github.com/baixianger/dsh-weave/commit/aa956ee14f812e67e50a5bbcdd6969241b9a2f91) | DSH 0.1.5-compatible Web RPC registration and handle-based persistence reads with older-host fallback. |
| 0.1.0-rc.14 | `v0.1.0-rc.14` | [`b021499da6f9c1d2f4880ed002deb22a42621685`](https://github.com/baixianger/dsh-weave/commit/b021499da6f9c1d2f4880ed002deb22a42621685) | Bilingual user documentation, clearer pairing and security guidance, and tokenless GitHub OIDC publishing to `latest`. |
| 0.1.0-rc.13 | `v0.1.0-rc.13` | [`332a8677569a107b76765f3d50530eba342c99e0`](https://github.com/baixianger/dsh-weave/commit/332a8677569a107b76765f3d50530eba342c99e0) | Peer-message deduplication, bounded acknowledgements and shutdown, claimed-delivery enforcement, private identity/peer files, lifecycle disposal, configuration schema and public types. |

