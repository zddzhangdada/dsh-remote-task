window.__ModuleLoader__.load({
  id: "dsh-weave",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const inject = ["slots", "connection", "locale"];

    const NS = "dsh-weave";
    const dictionaries = {
  "zh": {
    "loading": "读取中…",
    "working": "处理中…",
    "refresh": "刷新",
    "online": "在线",
    "offline": "离线",
    "copy": "复制",
    "copied": "已复制",
    "cancel": "取消",
    "title": "Weave",
    "intro": "连接你信任的 DSH 主机，让聊天和其他插件跨设备协作。",
    "thisHost": "本机",
    "relay": "中继",
    "default": "默认",
    "disabled": "已停用",
    "custom": "自定义",
    "trustedPeers": "台已配对主机",
    "ticket": "本机配对凭据",
    "ticketHint": "仅将配对凭据提供给你信任的设备。",
    "copyUnavailable": "无法使用剪贴板，请手动复制。",
    "pairHost": "配对另一台主机",
    "pairHint": "粘贴受信任主机的凭据。配对后，Chat 可通过 Weave 跨主机投递。",
    "otherTicket": "对方主机的配对凭据",
    "placeholder": "粘贴 Iroh endpoint ticket",
    "pair": "配对",
    "pairedHosts": "已配对主机",
    "host": "主机",
    "connecting": "连接中",
    "unknown": "尚未检查",
    "unpaired": "需要重新配对",
    "remove": "移除",
    "removeHint": "移除后将停止信任此主机。需要再次配对才能恢复跨主机连接。",
    "confirmRemove": "确认移除",
    "empty": "尚未配对其他主机。"
  },
  "en": {
    "loading": "Loading…",
    "working": "Working…",
    "refresh": "Refresh",
    "online": "Online",
    "offline": "Offline",
    "copy": "Copy",
    "copied": "Copied",
    "cancel": "Cancel",
    "title": "Weave",
    "intro": "Connect trusted DSH hosts so Chat and other plugins can work across devices.",
    "thisHost": "This host",
    "relay": "Relay",
    "default": "Default",
    "disabled": "Disabled",
    "custom": "Custom",
    "trustedPeers": "paired hosts",
    "ticket": "This host’s pairing ticket",
    "ticketHint": "Share the pairing ticket only with devices you trust.",
    "copyUnavailable": "Clipboard unavailable. Copy the ticket manually.",
    "pairHost": "Pair another host",
    "pairHint": "Paste a trusted host’s ticket. Chat can then deliver across hosts through Weave.",
    "otherTicket": "Other host’s pairing ticket",
    "placeholder": "Paste an Iroh endpoint ticket",
    "pair": "Pair",
    "pairedHosts": "Paired hosts",
    "host": "Host",
    "connecting": "Connecting",
    "unknown": "Not checked",
    "unpaired": "Pair again",
    "remove": "Remove",
    "removeHint": "This host will no longer be trusted. Pair it again to restore the connection.",
    "confirmRemove": "Remove host",
    "empty": "No paired hosts yet."
  }
};
    const styles = `.dshWeaveSettings { display:flex; flex-direction:column; gap:18px; max-width:720px; min-width:0; padding-bottom:24px; font-size:14px; line-height:22px; color:var(--dsw-alias-label-primary); }
.dshWeaveSettings * { box-sizing:border-box; }
.dshWeaveSettings h2 { margin:0; font-size:20px; line-height:28px; font-weight:600; }
.dshWeaveSettings h3 { margin:0; font-size:14px; line-height:20px; font-weight:600; }
.dshWeaveSettings p { margin:0; color:var(--dsw-alias-label-secondary); }
.dshWeaveSettings header p { margin-top:6px; }
.dshWeaveSettings .panel { padding:18px 20px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-module-platform); display:flex; flex-direction:column; gap:14px; min-width:0; }
.dshWeaveSettings .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.dshWeaveSettings .between { justify-content:space-between; }
.dshWeaveSettings .grow { flex:1; min-width:0; overflow-wrap:anywhere; }
.dshWeaveSettings .muted { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
.dshWeaveSettings .field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--dsw-alias-label-secondary); min-width:0; }
.dshWeaveSettings :is(input,textarea,select) { min-width:0; max-width:100%; min-height:38px; padding:8px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px; }
.dshWeaveSettings textarea { width:100%; resize:vertical; }
.dshWeaveSettings input { width:100%; }
.dshWeaveSettings button { display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:6px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:18px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px; cursor:pointer; }
.dshWeaveSettings button.primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); border-color:var(--dsw-alias-button-primary-fill); }
.dshWeaveSettings button.danger { color:var(--dsw-alias-state-error-primary); }
.dshWeaveSettings button:not(:disabled):not(.primary):hover { background:var(--dsw-alias-interactive-bg-hover); }
.dshWeaveSettings button:disabled { opacity:.45; cursor:default; }
.dshWeaveSettings :is(button,input,textarea,select,a):focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.dshWeaveSettings .alert { padding:10px 12px; border-left:2px solid var(--dsw-alias-state-error-primary); border-radius:4px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-state-error-primary); overflow-wrap:anywhere; font-size:13px; }
.dshWeaveSettings .list { display:flex; flex-direction:column; gap:10px; }
.dshWeaveSettings .list-item { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); min-width:0; }
.dshWeaveSettings .name { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
.dshWeaveSettings .code { font-family:ui-monospace,monospace; font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.dshWeaveSettings .status { display:inline-flex; align-items:center; gap:6px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.dshWeaveSettings .status::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; flex:0 0 auto; }
.dshWeaveSettings .status[data-state="online"],.dshWeaveSettings .status[data-state="running"] { color:var(--dsw-alias-state-success-primary); }
.dshWeaveSettings .status[data-state="connecting"] { color:var(--dsw-alias-state-warn-primary); }
.dshWeaveSettings .status[data-state="unpaired"] { color:var(--dsw-alias-state-error-primary); }
.dshWeaveSettings .empty { padding:10px 0; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dshWeaveSettings .confirm { display:flex; flex-direction:column; gap:8px; padding-top:10px; border-top:1px solid var(--dsw-alias-border-l1); font-size:13px; }
`;
    function installStyles() {
      if (typeof document === "undefined") return;
      const style = document.createElement("style");
      style.dataset.plugin = NS;
      style.textContent = styles;
      document.head.appendChild(style);
      return () => style.remove();
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, dictionaries), `${NS}: dictionaries`);
      ctx.effect(installStyles, `${NS}: styles`);
      // The host route sits under `/api`, the one prefix Connection mounts and
      // fences for this page: a per-plugin RPC channel is not reachable here.
      const call = async (endpoint, args = {}, signal) => {
        const response = await fetch("/api/dsh-weave", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ endpoint, args }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
        });
        if (!response.ok) throw new Error(`Weave request failed (HTTP ${response.status})`);
        const envelope = await response.json();
        if (envelope?.ok !== true) throw new Error(envelope?.error?.message ?? "Weave request failed");
        return envelope.value;
      };
      function WeaveSettings() {
        const [ticket, setTicket] = React.useState("");
        const [draft, setDraft] = React.useState("");
        const [endpoints, setEndpoints] = React.useState([]);
        const [status, setStatus] = React.useState(null);
        const [error, setError] = React.useState("");
        const [working, setWorking] = React.useState(false);
        const [copied, setCopied] = React.useState(false);
        const [removing, setRemoving] = React.useState(null);
        const lifecycle = React.useRef({ controller: new AbortController(), busy: false });
        const refresh = React.useCallback(async (signal = lifecycle.current.controller.signal) => {
          const [ticketResult, endpointResult, statusResult] = await Promise.all([call("ticket", {}, signal), call("endpoints", {}, signal), call("status", {}, signal)]);
          signal.throwIfAborted();
          setTicket(ticketResult.ticket); setEndpoints(endpointResult.endpoints); setStatus(statusResult); setError("");
        }, []);
        React.useEffect(() => {
          const controller = new AbortController(); lifecycle.current.controller = controller;
          void refresh(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)); });
          return () => controller.abort();
        }, [refresh]);
        const run = async (action) => {
          if (lifecycle.current.busy) return;
          const signal = lifecycle.current.controller.signal;
          lifecycle.current.busy = true; setWorking(true); setError("");
          try { await action(signal); await refresh(signal); }
          catch (cause) { if (!signal.aborted) setError(String(cause.message ?? cause)); }
          finally { lifecycle.current.busy = false; if (!signal.aborted) setWorking(false); }
        };
        const trust = (event) => { event.preventDefault(); if (!draft.trim()) return; void run(async (signal) => { await call("trust", { ticket: draft.trim() }, signal); setDraft(""); }); };
        const copyTicket = async () => {
          try { if (!navigator.clipboard?.writeText) throw new Error(t("copyUnavailable")); await navigator.clipboard.writeText(ticket); setCopied(true); }
          catch (cause) { setError(String(cause.message ?? cause)); }
        };
        return h("section", { className: "dshWeaveSettings", "aria-label": t("title") },
          h("header", null, h("h2", null, t("title")), h("p", null, t("intro"))),
          error ? h("p", { role: "alert", className: "alert" }, error) : null,
          h("section", { className: "panel" },
            h("div", { className: "row between" }, h("h3", null, t("thisHost")), h("button", { type: "button", disabled: working, onClick: () => run(async () => {}) }, working ? t("working") : t("refresh"))),
            h("p", { className: "muted" }, status ? `${t("relay")}: ${t(status.relayMode)} · ${status.peerCount} ${t("trustedPeers")}` : t("loading")),
            h("label", { className: "field" }, t("ticket"), h("textarea", { readOnly: true, value: ticket, rows: 3, className: "code", "aria-label": t("ticket") })),
            h("div", { className: "row between" }, h("p", { className: "muted grow" }, t("ticketHint")), h("button", { type: "button", onClick: copyTicket, disabled: !ticket }, copied ? t("copied") : t("copy")))),
          h("section", { className: "panel" },
            h("h3", null, t("pairHost")), h("p", { className: "muted" }, t("pairHint")),
            h("form", { onSubmit: trust, className: "row" }, h("label", { className: "field grow" }, t("otherTicket"), h("input", { value: draft, onChange: (event) => setDraft(event.target.value), placeholder: t("placeholder"), disabled: working })), h("button", { type: "submit", disabled: working || !draft.trim(), className: "primary", style: { alignSelf: "flex-end" } }, t("pair")))),
          h("section", { className: "panel" },
            h("div", { className: "row between" }, h("h3", null, t("pairedHosts")), status ? h("span", { className: "muted" }, endpoints.length) : null),
            h("div", { className: "list" }, endpoints.map((endpoint) => h("div", { key: endpoint.hostId, className: "list-item" },
              h("div", { className: "row between" }, h("div", { className: "grow" },
                h("div", { className: "row" }, h("strong", { className: "name" }, `${t("host")} ${endpoint.hostId.slice(0, 12)}`), h("span", { className: "status", "data-state": endpoint.state }, t(["online","connecting","offline","unknown","unpaired"].includes(endpoint.state) ? endpoint.state : "unknown"))),
                h("p", { className: "code muted" }, endpoint.hostId)), h("button", { type: "button", disabled: working, className: "danger", onClick: () => setRemoving(endpoint.hostId) }, t("remove"))),
              removing === endpoint.hostId ? h("div", { className: "confirm", role: "group", "aria-label": t("remove") }, h("p", null, t("removeHint")), h("div", { className: "row" },
                h("button", { type: "button", className: "danger", disabled: working, onClick: () => run(async (signal) => { await call("untrust", { peerId: endpoint.hostId }, signal); setRemoving(null); }) }, t("confirmRemove")),
                h("button", { type: "button", disabled: working, onClick: () => setRemoving(null) }, t("cancel")))) : null))),
            endpoints.length === 0 ? h("p", { className: "empty", role: "status" }, status ? t("empty") : t("loading")) : null));
      }
      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "weave", order: 35, label: () => t("title") }, WeaveSettings)), `${NS}: settings`);
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
