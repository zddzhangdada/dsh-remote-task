<div align="center">

<img src="docs/assets/hero.svg" alt="DSH Weave" width="100%" />

# DSH Weave

[English](README.md) · [简体中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-374151?style=flat-square)](LICENSE) [![DSH plugin](https://img.shields.io/badge/DSH-plugin-374151?style=flat-square)](https://github.com/topics/dsh-plugin)

</div>

Connect explicitly trusted DeepSeek Harness hosts through Iroh. Keep pairing, peer identity, reachability, and the remote session directory in one transport layer.

## What you get

| Capability | Behavior |
| --- | --- |
| **Persistent identity** | The same host identity survives restarts. |
| **Explicit pairing** | Exchange endpoint tickets and trust each peer locally. |
| **Encrypted transport** | Iroh provides QUIC connections, direct paths, and relay fallback. |
| **Remote directory** | Discover workspaces and sessions on paired hosts. |
| **Remote tasks** | Send a task to a paired device from the current session; follow heartbeat, progress, and results in the right-side panel. |
| **Visible state** | Host reachability is separate from agent idle/running/offline state. |
| **Native settings** | Grouped identity and pairing controls, copy feedback, and removal confirmation. |

## Remote tasks

Remote tasks are built into this package, so there is no separate `dsh-weave-link` install. From a DSH session you can:

- ask `link_devices` which paired devices are online and what sessions they have;
- call `link_task` with one or more device names and an instruction;
- call `link_tasks` to inspect a task, its messages, heartbeat, and result.

The right-side **远程任务** panel is a chat window: a task list, a conversation view with author and time on every message, and a bottom sheet for sending a task. It shows only the current session. Settings → **远程任务** is the single place for pairing, device renaming, per-device default workspace, heartbeat rules, and the incoming-new-session project. Incoming files are saved to the current conversation's project folder under `收到文件` (created automatically).

Task records live in the session directory as `weave-tasks.json`, so deleting a conversation deletes its task records with it. Failures have one status; the plugin inspects the failure text and retries in the same task at most twice when the problem looks temporary, otherwise it stops and reports.

## Quick start

On each host:

```bash
dsh plugin --profile web add dsh-weave@latest
dsh web
```

1. Open **Settings → 远程任务** (or **Settings → Remote Tasks**) on both hosts.
2. Exchange their tickets through a channel you trust.
3. Add and explicitly trust the other host's ticket on each side.
4. Use a higher-level plugin such as [DSH Chat](https://github.com/baixianger/dsh-chat) to select remote sessions.

Add [DSH Bridge](https://github.com/baixianger/dsh-bridge) when messages should reach local agents on a receiving host. Bridge is optional for transport startup.

## One transport, separate responsibilities

```mermaid
flowchart LR
  A[Host A · Bridge] --> WA[Weave]
  WA <-->|Iroh · QUIC| WB[Weave]
  WB --> B[Host B · Bridge]
```

Iroh owns encrypted connectivity. Weave owns host trust, endpoint refresh, reachability, and authenticated requests. Chat owns rooms, membership, and room capabilities. Knowing a ticket alone does not grant trust or agent access.

## Configuration

| Field | Default | Purpose |
| --- | --- | --- |
| `hostName` | System hostname | Display label for the host. |
| `relayMode` | `default` | Iroh default relay selection, or `disabled`. |
| `persistIdentity` / `persistPeers` | `true` | Keep identity and trusted peers across restarts. |
| `acknowledgementTimeoutMs` | `10000` | Default acknowledgement deadline. |
| `maxConcurrentInbound` | `64` | Bound concurrent incoming requests. |
| `shutdownTimeoutMs` | `1000` | Bound transport shutdown. |

Identity and trusted peers are stored under `$DSH_HOME/dsh-weave` (`~/.dsh` by default), with owner-only permissions. `identityPath` and `peersPath` can override their locations.

## Cancellation & delivery

Outbound requests accept a cancellation signal. Cancellation closes their connection; the receiving listener is also notified when the peer disconnects. Cancelling a request does not mark an otherwise reachable host offline. Chat's longer polling requests use matching acknowledgement deadlines.

The current release includes both the transport MVP and the remote-task layer. Pairing, directory access, authenticated delivery, task dispatch, heartbeat inspection, and session-scoped task cards are implemented. Durable transport outbox/reconnect replay is still not implemented; task completion relies on the receiving agent replying with the documented `[任务完成 #id]` marker.

## Protocol & architecture

[Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Security](docs/SECURITY.md) · [Room authority](docs/ADR-001-authoritative-chat-rooms.md)

The design documents include planned capabilities; use this README and the release notes for current behavior.

## Development & feedback

```bash
npm ci
npm run check
```

[Report an issue](https://github.com/zddzhangdada/dsh-weave/issues) · [Release notes](RELEASES.md) · [MIT license](LICENSE)

---

**Maintenance:** this repository hosts dsh-weave 0.3.6 and later. The original 0.1.x line was created by [Xiang Bai](https://github.com/baixianger); this repository continues from `0.1.0-rc.16` and includes the 0.2.0–0.3.6 changes. The [older repository](https://github.com/baixianger/dsh-weave) remains available for reference.
