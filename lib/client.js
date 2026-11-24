window.__ModuleLoader__.load({
  id: 'dsh-weave',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const NS = 'dsh-weave'
    const TAB_ID = 'weave-link'
    const TAB_KIND = 'weave-link'
    const ROUTE = '/__dsh/weave-link'

    const zh = {
      tabTitle: '远程任务',
      panelTitle: '本会话',
      addTask: '派任务',
      settingsTitle: '远程任务',
      summary: '连接远程设备、派任务、看进度；配对和任务设置都在这一页。'
    }

    const CSS = `
      .wl-pane {
        background: var(--dsw-alias-bg-base, #fff);
        --wl-ok: var(--dsw-alias-state-success-primary, #166534);
        --wl-idle: var(--dsw-alias-state-idle-primary, #6b7280);
        --wl-muted: var(--dsw-alias-label-secondary, #5b5f66);
        --wl-line: var(--dsw-alias-border-l1, rgba(0,0,0,.10));
        --wl-card: var(--dsw-alias-bg-layer-1, #fff);
        --wl-hover: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04));
        --wl-link: var(--dsw-alias-link, #1D4ED8);
        --wl-err: var(--dsw-alias-state-error-primary, #b91c1c);
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: var(--dsw-alias-label-primary, #17191c);
        font: 400 13px/1.5 var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
      }
      .wl-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 14px 10px; }
      .wl-head-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .wl-title { font-size: 13px; font-weight: 600; line-height: 1.3; }
      .wl-sub { font-size: 11.5px; line-height: 1.4; color: var(--wl-muted); }
      .wl-add { flex: none; border: 1px solid var(--wl-line); background: transparent; color: var(--wl-link); font: 500 12px/1 inherit; cursor: pointer; padding: 6px 9px; border-radius: 8px; }
      .wl-add:hover { background: var(--wl-hover); }
      .wl-compose { flex: none; margin: 0 12px 10px; border: 1px solid var(--wl-line); border-radius: 10px; background: var(--wl-card); padding: 10px; }
      .wl-compose textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; border: 0; outline: none; background: transparent; color: inherit; font: inherit; }
      .wl-devices { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
      .wl-chip { border: 1px solid var(--wl-line); background: transparent; color: inherit; border-radius: 999px; padding: 4px 9px; font: 400 12px/1 inherit; cursor: pointer; }
      .wl-chip.on { background: var(--dsw-alias-button-primary-fill, #17191c); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
      .wl-compose-actions { display: flex; justify-content: flex-end; gap: 8px; }
      .wl-btn { height: 28px; padding: 0 11px; border: 1px solid var(--wl-line); border-radius: 8px; background: transparent; color: inherit; font: 500 12px/1 inherit; cursor: pointer; }
      .wl-btn.primary { background: var(--dsw-alias-button-primary-fill, #17191c); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; }
      .wl-btn:disabled { opacity: .45; cursor: default; }

      .wl-list { flex: none; max-height: 30%; overflow-y: auto; padding: 0 8px 8px; }
      .wl-row { display: flex; align-items: flex-start; gap: 9px; padding: 9px 8px; border-radius: 10px; cursor: pointer; }
      .wl-row:hover { background: var(--wl-hover); }
      .wl-row.on { background: var(--wl-hover); box-shadow: inset 2px 0 0 var(--wl-link); }
      .wl-row-body { flex: 1 1 auto; min-width: 0; }
      .wl-row-name { font-weight: 600; font-size: 12.5px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-row-sub { margin-top: 2px; font-size: 11.5px; line-height: 1.4; color: var(--wl-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-row-end { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; padding-top: 1px; }
      .wl-row-state { font-size: 10.5px; font-weight: 600; line-height: 15px; padding: 0 5px; border-radius: 4px; color: var(--wl-muted); background: var(--wl-hover); white-space: nowrap; }
      .wl-row-state.on { color: var(--wl-ok); background: color-mix(in srgb, var(--wl-ok) 10%, transparent); }
      .wl-row-state.done { color: var(--wl-ok); background: color-mix(in srgb, var(--wl-ok) 10%, transparent); }
      .wl-row-state.err { color: var(--wl-err); background: color-mix(in srgb, var(--wl-err) 9%, transparent); }
      .wl-row-at { font-size: 10.5px; line-height: 1.3; color: var(--wl-muted); font-variant-numeric: tabular-nums; }

      .wl-av { width: 22px; height: 22px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; font: 600 10.5px/1 inherit; font-style: normal; color: var(--wl-ok); background: color-mix(in srgb, var(--wl-ok) 12%, transparent); }
      .wl-av.lg { width: 30px; height: 30px; font-size: 13px; }
      .wl-av.idle { color: var(--wl-idle); background: color-mix(in srgb, var(--wl-idle) 12%, transparent); }
      .wl-av.err { color: var(--wl-err); background: color-mix(in srgb, var(--wl-err) 10%, transparent); }

      .wl-sep { flex: none; height: 1px; background: var(--wl-line); margin: 0 14px; }
      .wl-ctx { flex: none; padding: 12px 14px 10px; border-bottom: 1px solid var(--wl-line); background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02)); }
      .wl-ctx-kicker { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--wl-link); }
      .wl-ctx-title { margin-top: 3px; font-weight: 600; font-size: 14.5px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-ctx-meta { margin-top: 4px; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 11.5px; line-height: 1.4; color: var(--wl-muted); }
      .wl-instr { margin-top: 8px; font-size: 12.5px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
      .wl-meta { margin-top: 4px; font-size: 11px; line-height: 1.4; color: var(--wl-muted); }
      .wl-state { flex: none; height: 22px; padding: 0 8px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--wl-line); color: var(--wl-muted); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
      .wl-state.on { color: var(--wl-ok); border-color: color-mix(in srgb, var(--wl-ok) 30%, transparent); background: color-mix(in srgb, var(--wl-ok) 9%, transparent); }
      .wl-state.done { color: var(--wl-ok); border-color: color-mix(in srgb, var(--wl-ok) 28%, transparent); background: color-mix(in srgb, var(--wl-ok) 8%, transparent); }
      .wl-state.err { color: var(--wl-err); border-color: color-mix(in srgb, var(--wl-err) 25%, transparent); background: color-mix(in srgb, var(--wl-err) 6%, transparent); }

      .wl-thread { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 9px 14px 10px; display: flex; flex-direction: column; gap: 10px; }
      .wl-empty { padding: 28px 16px; text-align: center; color: var(--wl-muted); font-size: 12.5px; line-height: 1.7; white-space: pre-line; }
      .wl-day { align-self: center; font-size: 10.5px; line-height: 18px; color: var(--wl-muted); background: var(--wl-hover); padding: 0 8px; border-radius: 999px; }
      .wl-me { align-self: flex-end; max-width: 86%; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
      .wl-me-head { font-size: 10.5px; line-height: 1.3; color: var(--wl-muted); font-variant-numeric: tabular-nums; }
      .wl-me .wl-bubble { background: var(--dsw-alias-button-primary-fill, #17191c); color: var(--dsw-alias-label-primary-foreground, #fff); border-radius: 12px 12px 4px 12px; padding: 9px 11px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
      .wl-msg { max-width: 92%; display: flex; flex-direction: column; gap: 3px; }
      .wl-who { display: flex; align-items: center; gap: 5px; font-size: 10.5px; line-height: 1.3; color: var(--wl-muted); font-variant-numeric: tabular-nums; }
      .wl-who b { font-weight: 600; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-at { color: var(--wl-muted); }
      .wl-bubble { display: inline-block; padding: 9px 11px; border: 1px solid var(--wl-line); border-radius: 4px 12px 12px 12px; background: var(--wl-card); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
      .wl-event { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; line-height: 1.5; color: var(--wl-muted); padding-left: 4px; }
      .wl-event-at { flex: none; color: var(--wl-muted); opacity: .8; font-variant-numeric: tabular-nums; }
      .wl-spin { width: 9px; height: 9px; margin-top: 3px; border-radius: 50%; border: 1.5px solid var(--wl-line); border-top-color: var(--wl-link); flex: none; }
      .wl-result { align-self: stretch; border: 1px solid color-mix(in srgb, var(--wl-ok) 24%, transparent); background: color-mix(in srgb, var(--wl-ok) 5%, transparent); border-radius: 10px; padding: 9px 11px; }
      .wl-result.err { border-color: color-mix(in srgb, var(--wl-err) 24%, transparent); background: color-mix(in srgb, var(--wl-err) 5%, transparent); }
      .wl-result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10.5px; font-weight: 600; color: var(--wl-ok); letter-spacing: .03em; }
      .wl-result.err .wl-result-head { color: var(--wl-err); }
      .wl-result-body { margin-top: 5px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

      .wl-foot { flex: none; padding: 8px 14px 14px; border-top: 1px solid var(--wl-line); }
      .wl-input { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 6px 4px 12px; border: 1px solid var(--wl-line); border-radius: var(--dsw-radius-md, 10px); background: var(--wl-card); }
      .wl-input input { flex: 1 1 auto; min-width: 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; }
      .wl-send { flex: none; width: 28px; height: 28px; border: 0; border-radius: 8px; background: var(--dsw-alias-button-primary-fill, #17191c); color: var(--dsw-alias-label-primary-foreground, #fff); cursor: pointer; font-size: 14px; }
      .wl-send:disabled { opacity: .4; cursor: default; }
      .wl-err { color: var(--wl-err); font-size: 12px; margin-top: 6px; }

      .wl-card { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1, #fff); padding: 10px 12px; margin: 6px 0; max-width: 560px; font: 400 13px/1.5 var(--dsw-font-family, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif); color: var(--dsw-alias-label-primary, #17191c); }
      .wl-card-head { display: flex; align-items: center; gap: 7px; }
      .wl-card-tag { font-size: 11px; font-weight: 600; letter-spacing: .03em; padding: 2px 6px; border-radius: 5px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-card-dev { font-size: 12px; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-card-state { margin-left: auto; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-state-success-primary, #166534); }
      .wl-card-state.err { color: var(--dsw-alias-state-error-primary, #b91c1c); }
      .wl-card-title { margin-top: 7px; font-weight: 500; }
      .wl-card-foot { margin-top: 7px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-card-open { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-link, #1D4ED8); font: 500 12px/1 inherit; cursor: pointer; padding: 2px; }

      .wl-set { padding: 4px 20px 26px; box-sizing: border-box; font: 400 13px/1.5 var(--dsw-font-family, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif); color: var(--dsw-alias-label-primary, #17191c); }
      .wl-set-title { font-size: 18px; font-weight: 600; line-height: 1.3; }
      .wl-set-lead { margin-top: 4px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-set-sec { margin-top: 22px; }
      .wl-set-sec-t { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #5b5f66); letter-spacing: .04em; margin-bottom: 8px; }
      .wl-set-box { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
      .wl-set-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); min-width: 0; }
      .wl-set-row:first-child { border-top: 0; }
      .wl-set-lab { flex: 1 1 180px; min-width: 0; }
      .wl-set-lab b { display: block; font-size: 13px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
      .wl-set-lab span { display: block; margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #5b5f66); overflow-wrap: anywhere; }
      .wl-set-ctl { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; flex: 0 1 auto; min-width: 0; max-width: 100%; }
      .wl-in, .wl-sel { height: 32px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: 8px; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #17191c); font: 400 12.5px/1 inherit; padding: 0 10px; box-sizing: border-box; max-width: 100%; }
      .wl-in-name { width: 210px; }
      .wl-in-subdir { width: 130px; }
      .wl-in-devname { width: 140px; }
      .wl-in-ticket { width: 300px; }
      .wl-sel-project { width: 260px; }
      .wl-sel-small { width: auto; max-width: 140px; }
      .wl-in.num { width: 62px; flex: none; text-align: right; padding-right: 8px; }
      .wl-unit { flex: none; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #5b5f66); margin-left: -6px; }
      .wl-sel { width: 230px; }
      .wl-dev-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: 0 1 auto; min-width: 0; }
      .wl-sw { width: 34px; height: 20px; border-radius: 999px; background: #D5D8DE; position: relative; flex: none; border: 0; cursor: pointer; padding: 0; }
      .wl-sw.on { background: #17191C; }
      .wl-sw i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: left .12s; }
      .wl-sw.on i { left: 16px; }
      .wl-set-tip { margin-top: 7px; padding: 9px 11px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover, #F5F6F8); font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-dev { display: flex; align-items: center; gap: 9px; }
      .wl-dev .wl-dot { margin: 0; }
      .wl-dev-name { font-weight: 500; }
      .wl-dev-state { font-size: 12px; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-note { font-size: 12px; color: var(--dsw-alias-state-success-primary, #166534); margin-left: 10px; }
      .wl-weave-ticket { width: 100%; min-height: 66px; resize: vertical; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: 8px; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #17191c); font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; padding: 8px 10px; box-sizing: border-box; word-break: break-all; }
      .wl-weave-line { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); }
      .wl-weave-line:first-child { border-top: 0; }
      .wl-weave-grow { flex: 1 1 auto; min-width: 0; }
      .wl-weave-grow b { display: block; font-size: 13px; font-weight: 500; line-height: 1.4; }
      .wl-weave-grow span { display: block; margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #5b5f66); overflow-wrap: anywhere; }
      .wl-weave-peer { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); font-size: 12px; }
      .wl-weave-peer:first-child { border-top: 0; }
      .wl-weave-peer code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary, #5b5f66); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-weave-peer .wl-btn { margin-left: auto; }
      .wl-weave-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .wl-summary { padding: 2px 0; color: var(--dsw-alias-label-secondary, #5b5f66); font-size: 13px; }

      /* 手机端（设置页宽度有限）：标签与控件纵向排开，控件占满整行，避免文字被挤成一条竖线。 */
      @media (max-width: 600px) {
        .wl-set { padding: 2px 12px 22px; }
        .wl-set-title { font-size: 17px; }
        .wl-set-lead { font-size: 12px; }
        .wl-set-sec { margin-top: 18px; }
        .wl-set-row { flex-wrap: wrap; align-items: stretch; gap: 8px; padding: 12px; }
        .wl-set-row .wl-set-lab { flex: 1 1 100%; }
        .wl-set-row .wl-set-ctl { flex: 1 1 100%; justify-content: flex-start; }
        .wl-set-row .wl-set-ctl > .wl-in,
        .wl-set-row .wl-set-ctl > .wl-sel,
        .wl-set-row .wl-set-ctl > div,
        .wl-set-row > .wl-in,
        .wl-set-row > .wl-sel { flex: 1 1 auto; width: 100% !important; min-width: 0; }
        .wl-set-row .wl-in-name,
        .wl-set-row .wl-in-subdir,
        .wl-set-row .wl-in-devname,
        .wl-set-row .wl-in-ticket,
        .wl-set-row .wl-sel-project { width: 100% !important; }
        .wl-set-row .wl-in.num { flex: 0 0 88px; width: 88px !important; }
        .wl-set-row .wl-unit { margin-left: 0; }
        .wl-inbox-ctl { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
        .wl-set-row .wl-inbox-ctl > .wl-in { flex: 1 1 auto; width: auto !important; min-width: 0; }
        .wl-dev-actions { flex: 1 1 100%; margin-left: 0 !important; flex-wrap: wrap; }
        .wl-dev-actions .wl-sel { flex: 1 1 120px; width: auto; max-width: 100%; }
        .wl-weave-line { flex-wrap: wrap; align-items: flex-start; gap: 8px; }
        .wl-weave-line .wl-weave-grow { flex: 1 1 100%; }
        .wl-weave-line > .wl-btn { align-self: flex-start; }
        .wl-weave-actions { flex: 1 1 100%; }
        .wl-weave-actions .wl-in { flex: 1 1 160px; width: auto !important; min-width: 0; }
        .wl-weave-peer { flex-wrap: wrap; }
        .wl-weave-peer .wl-btn { margin-left: 0; }
      }
      .wl-chip { border: .5px solid var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-secondary, #4b5563); border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
      .wl-chip:hover { background: var(--dsw-alias-interactive-bg-hover, #f3f4f6); color: var(--dsw-alias-label-primary, #111827); }
      .wl-chip.on { background: color-mix(in srgb, var(--dsw-alias-link, #3f6fe0) 18%, transparent); border-color: var(--dsw-alias-link, #3f6fe0); color: var(--dsw-alias-link, #3f6fe0); font-weight: 600; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-link, #3f6fe0) 28%, transparent); }
      .wl-chip.on .dot { background: var(--dsw-alias-link, #3f6fe0) !important; }
      .wl-chip .check { font-size: 11px; line-height: 1; }
      .wl-sheet-all { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-link, #3f6fe0); font: inherit; font-size: 11.5px; cursor: pointer; padding: 0; }

      /* 聊天窗口式右侧面板 */
      .wl-chat-pane { position: relative; background: var(--dsw-alias-bg-base, #fff); height: 100%; display: flex; flex-direction: column; overflow: hidden; color: var(--dsw-alias-label-primary, #17191c); font: 400 13px/1.5 var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif); }
      .wl-chat-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); }
      .wl-chat-head-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .wl-chat-head-title { font-size: 17px; font-weight: 700; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-chat-head-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-back { flex: none; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, #5b5f66); font-size: 18px; line-height: 1; cursor: pointer; }
      .wl-back:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
      .wl-icon-btn { flex: none; width: 32px; height: 32px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); border-radius: 10px; background: transparent; color: var(--dsw-alias-link, #1D4ED8); font: 500 19px/1 inherit; cursor: pointer; }
      .wl-icon-btn.primary { border: 0; background: var(--dsw-alias-link, #2563EB); color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.18); }
      .wl-icon-btn.primary:hover { filter: brightness(1.06); }
      .wl-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
      .wl-filters { flex: none; display: flex; gap: 8px; padding: 12px 16px 6px; }
      .wl-filter { border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #5b5f66); font: 500 12.5px/28px inherit; padding: 0 10px; border-radius: 999px; cursor: pointer; }
      .wl-filter .num { margin-left: 4px; opacity: .55; font-variant-numeric: tabular-nums; }
      .wl-filter.on { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); color: var(--dsw-alias-label-primary, #17191c); font-weight: 600; }
      .wl-inbox-entry { flex: none; display: flex; align-items: center; gap: 10px; margin: 10px 12px 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.015)); color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .wl-inbox-entry:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04)); }
      .wl-inbox-ic { flex: none; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; background: color-mix(in srgb, var(--dsw-alias-link, #2563EB) 10%, transparent); }
      .wl-inbox-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .wl-inbox-main b { font-size: 13px; font-weight: 600; }
      .wl-inbox-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5b5f66); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-inbox-arrow { flex: none; color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 18px; line-height: 1; }
      .wl-task-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 10px 18px; }
      .wl-task-row { display: flex; align-items: center; gap: 11px; padding: 12px; margin-bottom: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.015)); cursor: pointer; }
      .wl-task-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04)); }
      .wl-task-row.on { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); box-shadow: inset 2px 0 0 var(--dsw-alias-link, #2563EB); }
      .wl-task-av { position: relative; width: 36px; height: 36px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; font: 600 13px/1 inherit; color: var(--dsw-alias-state-success-primary, #166534); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #166534) 12%, transparent); }
      .wl-task-av.amber { color: var(--dsw-alias-state-warn-primary, #b45309); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b45309) 13%, transparent); }
      .wl-task-av .wl-dot { position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border: 2px solid var(--dsw-alias-bg-layer-1, #1b1b1f); border-radius: 50%; background: var(--dsw-alias-state-success-primary, #166534); }
      .wl-task-av .wl-dot.off { background: var(--dsw-alias-label-tertiary, #8a8f98); }
      .wl-task-av.err { color: var(--dsw-alias-state-error-primary, #b91c1c); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #b91c1c) 10%, transparent); }
      .wl-task-main { flex: 1 1 auto; min-width: 0; }
      .wl-task-top { display: flex; align-items: baseline; gap: 7px; }
      .wl-task-name { font-weight: 600; font-size: 13px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-task-time { margin-left: auto; flex: none; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #5b5f66); font-variant-numeric: tabular-nums; }
      .wl-task-title { margin-top: 2px; font-size: 13px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-task-preview { margin-top: 3px; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #5b5f66); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-task-state { flex: none; margin-top: 0; font-size: 11px; font-weight: 600; line-height: 18px; padding: 0 8px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #5b5f66); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); white-space: nowrap; }
      .wl-task-state.on { color: var(--dsw-alias-state-success-primary, #166534); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #166534) 10%, transparent); }
      .wl-task-state.done { color: var(--dsw-alias-state-success-primary, #166534); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #166534) 10%, transparent); }
      .wl-task-state.err { color: var(--dsw-alias-state-error-primary, #b91c1c); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #b91c1c) 9%, transparent); }
      .wl-chat-context { flex: none; margin: 10px 12px 0; padding: 11px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); border-radius: 11px; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.02)); }
      .wl-chat-banner { display: flex; align-items: center; gap: 8px; }
      .wl-chat-banner .wl-chat-task { flex: 1 1 auto; min-width: 0; margin: 0; }
      .wl-chat-av { position: relative; width: 30px; height: 30px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; font: 600 12px/1 inherit; color: var(--dsw-alias-state-success-primary, #166534); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #166534) 12%, transparent); }
      .wl-chat-av .wl-dot { position: absolute; right: -1px; bottom: -1px; width: 8px; height: 8px; border: 2px solid var(--dsw-alias-bg-base, #fff); border-radius: 50%; background: var(--dsw-alias-state-success-primary, #166534); }
      .wl-chat-av .wl-dot.off { background: var(--dsw-alias-label-tertiary, #8a8f98); }
      .wl-chat-kicker { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--dsw-alias-link, #1D4ED8); }
      .wl-chat-task { margin-top: 3px; font-size: 13.5px; font-weight: 600; line-height: 1.4; }
      .wl-chat-meta { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 5px 8px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary, #5b5f66); }
      .wl-chat-instruction { margin-top: 6px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #5b5f66); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .wl-chat-thread { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 10px; }
      .wl-chat-day { align-self: center; font-size: 10.5px; line-height: 18px; color: var(--dsw-alias-label-secondary, #5b5f66); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); padding: 0 8px; border-radius: 999px; }
      .wl-chat-me { align-self: flex-end; max-width: 86%; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
      .wl-chat-me-head { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #5b5f66); font-variant-numeric: tabular-nums; }
      .wl-chat-me .wl-chat-bubble { background: var(--dsw-alias-button-primary-fill, #17191c); color: var(--dsw-alias-label-primary-foreground, #fff); border-radius: 12px 12px 4px 12px; padding: 9px 11px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
      .wl-chat-msg { max-width: 92%; display: flex; flex-direction: column; gap: 3px; }
      .wl-chat-who { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #5b5f66); font-variant-numeric: tabular-nums; }
      .wl-chat-who b { color: var(--dsw-alias-label-primary, #17191c); font-weight: 600; }
      .wl-chat-bubble { display: inline-block; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); border-radius: 4px 12px 12px 12px; background: var(--dsw-alias-bg-layer-1, #fff); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
      .wl-chat-event { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #5b5f66); padding-left: 4px; }
      .wl-chat-event-at { flex: none; opacity: .8; font-variant-numeric: tabular-nums; }
      .wl-chat-result { align-self: stretch; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #166534) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #166534) 5%, transparent); border-radius: 10px; padding: 9px 11px; }
      .wl-chat-result.err { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #b91c1c) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #b91c1c) 5%, transparent); }
      .wl-chat-result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10.5px; font-weight: 600; color: var(--dsw-alias-state-success-primary, #166534); letter-spacing: .03em; }
      .wl-chat-result.err .wl-chat-result-head { color: var(--dsw-alias-state-error-primary, #b91c1c); }
      .wl-chat-result-body { margin-top: 5px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
      .wl-chat-foot { flex: none; padding: 8px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); }
      .wl-chat-input { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 6px 4px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); }
      .wl-chat-input input { flex: 1 1 auto; min-width: 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; }
      .wl-chat-send { flex: none; width: 28px; height: 28px; border: 0; border-radius: 8px; background: var(--dsw-alias-button-primary-fill, #17191c); color: var(--dsw-alias-label-primary-foreground, #fff); cursor: pointer; font-size: 14px; }
      .wl-chat-send:disabled { opacity: .4; cursor: default; }
      .wl-chat-empty { padding: 36px 18px; text-align: center; color: var(--dsw-alias-label-secondary, #5b5f66); font-size: 12.5px; line-height: 1.7; white-space: pre-line; }
      .wl-chat-form { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }
      .wl-chat-form textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 110px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); color: inherit; font: inherit; padding: 10px 12px; outline: none; }
      .wl-chat-form textarea:focus { border-color: var(--dsw-alias-link, #1D4ED8); }
      .wl-chat-devices { display: flex; flex-wrap: wrap; gap: 6px; }
      .wl-chat-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; padding-top: 10px; }
      .wl-chat-pane { position: relative; }
      .wl-online { font-style: normal; font-size: 11px; font-weight: 500; color: var(--dsw-alias-state-success-primary, #166534); margin-left: 6px; }
      .wl-overlay { position: absolute; inset: 0; z-index: 20; display: flex; align-items: flex-end; background: rgba(0,0,0,.46); }
      .wl-sheet { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-layer-1, #18181b); border-radius: 18px 18px 0 0; padding: 10px 16px calc(16px + env(safe-area-inset-bottom)); box-shadow: 0 -8px 30px rgba(0,0,0,.35); display: flex; flex-direction: column; gap: 10px; max-height: 92%; overflow-y: auto; }
      .wl-sheet-grabber { width: 38px; height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l2, rgba(255,255,255,.18)); margin: 0 auto 4px; }
      .wl-sheet-title { margin: 0; font-size: 17px; font-weight: 700; }
      .wl-sheet-lead { margin: -4px 0 2px; font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9aa2); }
      .wl-sheet-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #9a9aa2); display: flex; gap: 6px; align-items: baseline; }
      .wl-sheet-label .hint { font-weight: 400; color: var(--dsw-alias-label-tertiary, #7d7d86); }
      .wl-sheet-devices { display: flex; flex-wrap: wrap; gap: 6px; }
      .wl-sheet-devices .wl-chip { display: inline-flex; align-items: center; gap: 6px; }
      .wl-sheet-devices .wl-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary, #166534); }
      .wl-sheet-devices .wl-chip.off .dot { background: var(--dsw-alias-label-tertiary, #8a8f98); }
      .wl-sheet textarea { width: 100%; box-sizing: border-box; resize: none; min-height: 96px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12)); border-radius: 10px; background: var(--dsw-alias-bg-base, #0f0f10); color: inherit; font: inherit; padding: 10px 12px; outline: none; }
      .wl-sheet textarea:focus { border-color: var(--dsw-alias-link, #3f6fe0); }
      .wl-sheet-tip { font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, #7d7d86); }
      .wl-sheet-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
      .wl-menu { position: absolute; right: 12px; top: 58px; z-index: 15; min-width: 180px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #18181b); box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0,0,0,.28)); font-size: 12px; }
      .wl-menu-row { padding: 5px 8px; color: var(--dsw-alias-label-secondary, #9a9aa2); display: flex; justify-content: space-between; gap: 12px; }
      .wl-menu-row b { color: var(--dsw-alias-label-primary, #ededf0); font-weight: 500; }
      .wl-menu button { width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
      .wl-menu button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.07)); }
      .wl-icon-btn.danger { color: var(--dsw-alias-label-tertiary, #8a8f98); }
      .wl-icon-btn.danger:hover { color: var(--dsw-alias-state-error-primary, #f87171); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #f87171) 12%, transparent); }

      .wl-chat-retry { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #b91c1c) 28%, transparent); background: transparent; color: var(--dsw-alias-state-error-primary, #b91c1c); border-radius: 8px; height: 28px; padding: 0 11px; font: 500 12px/1 inherit; cursor: pointer; }
      .wl-chat-retry:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #b91c1c) 6%, transparent); }
      .wl-chat-err { color: var(--dsw-alias-state-error-primary, #b91c1c); font-size: 12px; margin-top: 6px; }
    `

    function ensureStyle() {
      let el = document.getElementById('dsh-weave-style')
      if (!el) {
        el = document.createElement('style')
        el.id = 'dsh-weave-style'
        document.head.appendChild(el)
      }
      if (el.textContent !== CSS) el.textContent = CSS
      return () => {
        if (el.textContent === CSS) el.remove()
      }
    }

    function token() {
      try {
        return String(globalThis.__DSH_WEAVE_LINK_TOKEN__ || '')
      } catch {
        return ''
      }
    }

    function makeApi() {
      return async function api(path, options = {}) {
        const headers = Object.assign({}, options.headers || {})
        if (options.body) headers['content-type'] = 'application/json'
        const tk = token()
        if (tk) headers['x-dsh-weave-link-token'] = tk
        const res = await fetch(ROUTE + path, Object.assign({ credentials: 'same-origin' }, options, { headers }))
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`)
        return data
      }
    }

    const STATUS_TEXT = {
      queued: '等待开始',
      dispatched: '已派出',
      running: '运行中',
      done: '已完成',
      failed: '失败',
      unreachable: '失败'
    }

    function pad2(n) {
      return String(n).padStart(2, '0')
    }

    function dur(ms) {
      const total = Math.max(0, Math.round(Number(ms || 0) / 1000))
      return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
    }

    function elapsed(task) {
      const events = Array.isArray(task.events) ? task.events : []
      const end = [...events].reverse().find((event) => event.kind === 'result' || event.kind === 'failed' || event.kind === 'stopped')?.at || task.updatedAt
      return dur(Number(end) - Number(task.createdAt))
    }

    function ago(at) {
      if (!at) return '还没有心跳'
      const seconds = Math.max(0, Math.round((Date.now() - Number(at)) / 1000))
      if (seconds < 5) return '刚刚'
      if (seconds < 60) return `${seconds} 秒前`
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
      return `${Math.floor(seconds / 3600)} 小时前`
    }

    function statusOf(task) {
      const text = STATUS_TEXT[task.status] || task.status
      if (task.status === 'running' || task.status === 'dispatched') {
        if (task.stuck) return { text: `可能卡住 · 已追问 ${task.asks || 1} 次`, cls: 'err' }
        return { text: `${text} ${dur(Date.now() - Number(task.lastProgressAt || task.createdAt))}`, cls: 'on' }
      }
      if (task.status === 'done') return { text: `已完成 · ${elapsed(task)}`, cls: 'done' }
      if (task.status === 'failed' || task.status === 'unreachable') return { text, cls: 'err' }
      return { text, cls: '' }
    }

    function taskDevices(task) {
      const names = (task.targets || []).map((item) => item.alias || item.hostName || item.peerId)
      return names.length > 0 ? names.join('、') : '未指定设备'
    }

    function taskRowName(task) {
      return `${taskDevices(task)} · ${task.title}`
    }

    function clock(at) {
      const date = new Date(Number(at) || Date.now())
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function dayKey(at) {
      const date = new Date(Number(at) || Date.now())
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    }

    function dayLabel(at) {
      const key = dayKey(at)
      if (key === dayKey(Date.now())) return '今天'
      if (key === dayKey(Date.now() - 86400000)) return '昨天'
      const date = new Date(Number(at) || Date.now())
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
    }

    function initialOf(name) {
      return String(name || '?').trim().slice(0, 1).toUpperCase() || '?'
    }

    function shortStatus(task) {
      if (task.status === 'running') return task.stuck ? '卡住' : '运行中'
      if (task.status === 'dispatched') return '已派出'
      if (task.status === 'done') return '完成'
      if (task.status === 'failed') return '失败'
      if (task.status === 'unreachable') return '失败'
      return '等待'
    }

    function rowState(task) {
      if (task.status === 'running' || task.status === 'dispatched') return { text: shortStatus(task), cls: 'on' }
      if (task.status === 'done') return { text: shortStatus(task), cls: 'done' }
      if (task.status === 'failed' || task.status === 'unreachable' || task.stuck) return { text: shortStatus(task), cls: 'err' }
      return { text: shortStatus(task), cls: '' }
    }

    function syntheticAck(message, task) {
      if (String(message.text || '').trim() !== '收到，开始执行') return false
      const at = Number(message.at) || 0
      return (task.targets || []).some((target) => Math.abs(Number(target.deliveredAt || 0) - at) < 2000)
    }

    function Pane({ sessionId, api }) {
      const [tasks, setTasks] = useState([])
      const [timeline, setTimeline] = useState([])
      const [devices, setDevices] = useState([])
      const [inbox, setInbox] = useState([])
      const [selectedId, setSelectedId] = useState('')
      const [view, setView] = useState('list')
      const [filter, setFilter] = useState('all')
      const [task, setTask] = useState(null)
      const [draft, setDraft] = useState('')
      const [picked, setPicked] = useState([])
      const [error, setError] = useState('')
      const [followup, setFollowup] = useState('')
      const [sending, setSending] = useState(false)
      const [menu, setMenu] = useState(false)
      const threadRef = useRef(null)

      const load = useCallback(
        async (loud) => {
          if (!sessionId) return
          try {
            const query = `?sessionId=${encodeURIComponent(sessionId)}${selectedId ? `&taskId=${encodeURIComponent(selectedId)}` : ''}`
            const data = await api('/state' + query)
            setTasks(data.tasks || [])
            setTimeline(data.timeline || [])
            setDevices(data.devices || [])
            setInbox(data.inbox || [])
            setTask(data.task || null)
            if (loud) setError('')
          } catch (e) {
            if (loud) setError(e.message)
          }
        },
        [api, sessionId, selectedId]
      )

      useEffect(() => {
        load(true)
        const timer = setInterval(() => {
          if (view !== 'new') load(false)
        }, 3000)
        return () => clearInterval(timer)
      }, [load, view])

      useEffect(() => {
        const node = threadRef.current
        if (node) node.scrollTop = node.scrollHeight
      }, [selectedId, timeline.length, task && task.status])

      const selected = (task && task.id === selectedId ? task : null) || tasks.find((item) => item.id === selectedId) || null
      const names = selected ? taskDevices(selected) : ''
      const device = selected
        ? devices.find((item) => (selected.targets || []).some((target) => target.peerId === item.peerId))
        : null
      const counts = {
        all: tasks.length,
        active: tasks.filter((item) => item.status === 'queued' || item.status === 'dispatched' || item.status === 'running').length,
        done: tasks.filter((item) => item.status === 'done').length,
        failed: tasks.filter((item) => item.status === 'failed').length
      }
      const filtered = tasks.filter((item) => {
        if (filter === 'active') return item.status === 'queued' || item.status === 'dispatched' || item.status === 'running'
        if (filter === 'done') return item.status === 'done'
        if (filter === 'failed') return item.status === 'failed'
        return true
      })

      function peerLabel(peerId, fallback) {
        const found = devices.find((item) => String(item.peerId) === String(peerId))
        const name = (found && (found.alias || found.hostName)) || fallback || String(peerId || '')
        return name.length > 24 ? `${name.slice(0, 10)}…` : name
      }

      let entries = timeline.filter((entry) => !selectedId || entry.taskId === selectedId)
      if (selected && entries.length === 0) {
        for (const message of selected.messages || []) {
          const messageText = String(message.text || '')
          const role = message.role === 'local' ? 'me' : 'peer'
          if (role === 'peer' && (/^\s*\[?任务(完成|失败)\s*#/.test(messageText) || syntheticAck(message, selected))) continue
          entries.push({ kind: role, at: Number(message.at) || 0, text: messageText, from: message.from || '' })
        }
        for (const event of selected.events || []) {
          if (event.kind === 'result' || event.kind === 'created') continue
          entries.push({ kind: 'event', at: Number(event.at) || 0, text: String(event.text || '') })
        }
        if ((selected.status === 'done' || selected.status === 'failed') && selected.result?.text) {
          entries.push({ kind: 'result', at: Number(selected.updatedAt) || Date.now(), text: selected.result.text, err: selected.status === 'failed' })
        }
        entries = entries.sort((a, b) => a.at - b.at)
      }

      const timelineRows = []
      let lastDay = ''
      for (const entry of entries) {
        const key = dayKey(entry.at)
        if (key !== lastDay) {
          timelineRows.push({ kind: 'day', at: entry.at, key })
          lastDay = key
        }
        timelineRows.push(entry)
      }

      async function submitTask() {
        if (!draft.trim() || picked.length === 0) return
        setSending(true)
        setError('')
        try {
          const data = await api('/task', {
            method: 'POST',
            body: JSON.stringify({ sessionId, targets: picked, instruction: draft })
          })
          setDraft('')
          setPicked([])
          setSelectedId(data.task.id)
          setTask(data.task)
          setView('chat')
          await load(false)
        } catch (e) {
          setError(e.message)
        } finally {
          setSending(false)
        }
      }

      async function submitFollowup() {
        if (!selected || !followup.trim()) return
        setSending(true)
        setError('')
        try {
          await api('/followup', {
            method: 'POST',
            body: JSON.stringify({ sessionId, taskId: selected.id, text: followup })
          })
          setFollowup('')
          await load(false)
        } catch (e) {
          setError(e.message)
        } finally {
          setSending(false)
        }
      }

      async function deleteTask() {
        if (!selected) return
        const ok = window.confirm(`删除「${selected.title || '远程任务'}」这条任务对话？\n只删任务记录，不影响主会话里已经产生的聊天记录。`)
        if (!ok) return
        setSending(true)
        setError('')
        try {
          await api('/delete', {
            method: 'POST',
            body: JSON.stringify({ sessionId, taskId: selected.id })
          })
          setSelectedId('')
          setTask(null)
          setMenu(false)
          setView('list')
          await load(false)
        } catch (e) {
          setError(e.message)
        } finally {
          setSending(false)
        }
      }

      async function retryTask() {
        if (!selected) return
        setSending(true)
        setError('')
        try {
          await api('/retry', {
            method: 'POST',
            body: JSON.stringify({ sessionId, taskId: selected.id })
          })
          await load(false)
        } catch (e) {
          setError(e.message)
        } finally {
          setSending(false)
        }
      }

      function openTask(id) {
        setSelectedId(id)
        setView('chat')
        setFollowup('')
        setError('')
        setMenu(false)
      }

      function openNew() {
        setDraft('')
        setPicked(devices.filter((item) => item.paired).map((item) => item.alias || item.peerId))
        setView('new')
        setError('')
      }

      const header = (title, sub, back, avatar, right) =>
        h(
          'div',
          { className: 'wl-chat-head' },
          back
            ? h(
                'button',
                { className: 'wl-back', onClick: () => { setView('list'); setSelectedId(''); setTask(null); setError(''); setMenu(false) }, title: '返回' },
                '←'
              )
            : null,
          avatar || null,
          h('div', { className: 'wl-chat-head-main' }, h('div', { className: 'wl-chat-head-title' }, title), sub ? h('div', { className: 'wl-chat-head-sub' }, sub) : null),
          right || (view === 'list'
            ? h('button', { className: 'wl-icon-btn primary', onClick: openNew, title: '派任务' }, '+')
            : null)
        )

      if (view === 'chat' && selected) {
        const current = rowState(selected)
        const sessionLine = selected.targets && selected.targets[0]
          ? `${selected.targets[0].sessionTitle || '对端会话'}${selected.targets.length > 1 ? ` · ${selected.targets.length} 台设备` : ''}`
          : '未指定设备'
        return h(
          'div',
          { className: 'wl-chat-pane' },
          header(
            h('span', null, names || '远程设备', device ? h('em', { className: 'wl-online' }, device.online ? '在线' : '离线') : null),
            h('span', null, '任务 · ', h('b', null, selected.title || '远程任务')),
            true,
            h('div', { className: 'wl-chat-av' }, initialOf(names), h('span', { className: 'wl-dot' + (device && device.online ? '' : ' off') })),
            h(
              React.Fragment,
              null,
              h('button', { className: 'wl-icon-btn danger', onClick: deleteTask, title: '删除对话', 'aria-label': '删除对话', disabled: sending }, '🗑'),
              h('button', { className: 'wl-icon-btn', onClick: () => setMenu((value) => !value), title: '任务详情', 'aria-label': '任务详情' }, '⋯')
            )
          ),
          menu
            ? h(
                'div',
                { className: 'wl-menu' },
                h('div', { className: 'wl-menu-row' }, '任务 ID', h('b', null, selected.id)),
                h('div', { className: 'wl-menu-row' }, '对端会话', h('b', null, sessionLine)),
                h('div', { className: 'wl-menu-row' }, '开始', h('b', null, clock(selected.createdAt))),
                h('div', { className: 'wl-menu-row' }, '用时', h('b', null, elapsed(selected))),
                h('div', { className: 'wl-menu-row' }, '重试', h('b', null, `${selected.retries || 0} / ${selected.maxRetries ?? 2}`)),
                selected.failure?.reason ? h('div', { className: 'wl-menu-row' }, '失败原因', h('b', null, selected.failure.reason)) : null,
                h('button', { onClick: () => { try { navigator.clipboard?.writeText(selected.id) } catch { /* ignore */ } setMenu(false) } }, '复制任务 ID'),
                selected.status === 'failed' ? h('button', { onClick: () => { setMenu(false); retryTask() } }, '再试一次') : null,
                h('button', { onClick: () => { setMenu(false); setView('list'); setSelectedId(''); setTask(null) } }, '回到任务列表')
              )
            : null,
          h(
            'div',
            { className: 'wl-chat-context' },
            h(
              'div',
              { className: 'wl-chat-banner' },
              h('span', { className: 'wl-chat-kicker' }, '当前任务'),
              h('span', { className: 'wl-chat-task' }, selected.title || '远程任务'),
              h('span', { className: 'wl-task-state ' + current.cls }, current.text)
            ),
            selected.status === 'failed'
              ? h('button', { className: 'wl-chat-retry', onClick: retryTask, disabled: sending }, sending ? '重试中…' : '再试一次')
              : null
          ),
          h(
            'div',
            { className: 'wl-chat-thread', ref: threadRef },
            timelineRows.length === 0
              ? h('div', { className: 'wl-chat-empty' }, '任务已派出，等对方回话…')
              : timelineRows.map((entry, index) =>
                  entry.kind === 'day'
                    ? h('div', { key: 'day-' + index, className: 'wl-chat-day' }, dayLabel(entry.at))
                    : entry.kind === 'me'
                      ? h(
                          'div',
                          { key: index, className: 'wl-chat-me' },
                          h('div', { className: 'wl-chat-me-head' }, `我 · ${clock(entry.at)}`),
                          h('div', { className: 'wl-chat-bubble' }, entry.text)
                        )
                      : entry.kind === 'peer'
                        ? h(
                            'div',
                            { key: index, className: 'wl-chat-msg' },
                            h(
                              'div',
                              { className: 'wl-chat-who' },
                              h('i', { className: 'wl-task-av' }, initialOf(entry.from || names)),
                              h('b', null, entry.from || names),
                              h('span', null, clock(entry.at))
                            ),
                            h('div', { className: 'wl-chat-bubble' }, entry.text)
                          )
                        : entry.kind === 'result'
                          ? h(
                              'div',
                              { key: index, className: 'wl-chat-result' + (entry.err ? ' err' : '') },
                              h(
                                'div',
                                { className: 'wl-chat-result-head' },
                                h('span', null, entry.err ? '任务失败' : '任务结果'),
                                h('span', null, clock(entry.at))
                              ),
                              h('div', { className: 'wl-chat-result-body' }, entry.text)
                            )
                          : h(
                              'div',
                              { key: index, className: 'wl-chat-event' },
                              h('span', { className: 'wl-chat-event-at' }, clock(entry.at)),
                              h('span', null, entry.text)
                            )
                )
          ),
          h(
                'div',
                { className: 'wl-chat-foot' },
                h(
                  'div',
                  { className: 'wl-chat-input' },
                  h('input', {
                    value: followup,
                    placeholder: `追问 ${names}…`,
                    onChange: (event) => setFollowup(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') submitFollowup()
                    }
                  }),
                  h('button', { className: 'wl-chat-send', disabled: sending || !followup.trim(), onClick: submitFollowup, title: '发送' }, '↑')
                )
              ),
          error ? h('div', { className: 'wl-chat-err', style: { padding: '0 14px 10px' } }, error) : null
        )
      }

      if (view === 'inbox') {
        const rows = inbox.slice().reverse()
        return h(
          'div',
          { className: 'wl-chat-pane' },
          header('收到的消息', `对方发来 · ${inbox.length} 条`, true),
          h(
            'div',
            { className: 'wl-chat-thread' },
            rows.length === 0
              ? h('div', { className: 'wl-chat-empty' }, '还没有收到消息。\n对方用 link_reply / link_send 发来的话都会出现在这里。')
              : rows.map((item, index) => {
                  const name = peerLabel(item.peerId, item.from)
                  return h(
                    'div',
                    { key: index, className: 'wl-chat-msg' },
                    h(
                      'div',
                      { className: 'wl-chat-who' },
                      h('i', { className: 'wl-task-av' }, initialOf(name)),
                      h('b', null, name),
                      h('span', null, `${dayLabel(item.at)} ${clock(item.at)}`)
                    ),
                    h('div', { className: 'wl-chat-bubble' }, item.text)
                  )
                })
          )
        )
      }

      const list = h(
        'div',
        { className: 'wl-chat-pane' },
        header('远程任务', `本会话 · ${tasks.length} 个任务`),
        h(
          'button',
          { className: 'wl-inbox-entry', onClick: () => setView('inbox') },
          h('span', { className: 'wl-inbox-ic' }, '📥'),
          h(
            'span',
            { className: 'wl-inbox-main' },
            h('b', null, '收到的消息'),
            h(
              'span',
              { className: 'wl-inbox-sub' },
              inbox.length === 0
                ? '对方发来的话都会记在这里'
                : `最近 ${inbox.length} 条 · ${String(inbox[inbox.length - 1].text || '').replace(/\s+/g, ' ').slice(0, 28)}`
            )
          ),
          h('span', { className: 'wl-inbox-arrow' }, '›')
        ),
        h(
          'div',
          { className: 'wl-filters' },
          [['all', '全部'], ['active', '进行中'], ['done', '已完成']].map(([key, label]) =>
            h('button', { key, className: 'wl-filter' + (filter === key ? ' on' : ''), onClick: () => setFilter(key) }, label, h('span', { className: 'num' }, String(counts[key])))
          )
        ),
        h(
          'div',
          { className: 'wl-task-list' },
          filtered.length === 0
            ? h('div', { className: 'wl-chat-empty' }, '本会话还没有远程任务。\n点右上角「+」给设备派一件。')
            : filtered.map((item) => {
                const state = rowState(item)
                const itemNames = taskDevices(item)
                const preview = item.lastEvent?.text || item.result?.text || item.instruction || item.id
                return h(
                  'div',
                  { key: item.id, className: 'wl-task-row' + (item.id === selectedId ? ' on' : ''), onClick: () => openTask(item.id) },
                  (() => {
                    const itemDevice = devices.find((device) => (item.targets || []).some((target) => target.peerId === device.peerId))
                    const online = itemDevice ? itemDevice.online : false
                    return h(
                      'div',
                      { className: 'wl-task-av' + (state.cls === 'err' ? ' err' : (itemDevice && !online ? ' amber' : '')) },
                      initialOf(itemNames),
                      h('span', { className: 'wl-dot' + (online ? '' : ' off') })
                    )
                  })(),
                  h(
                    'div',
                    { className: 'wl-task-main' },
                    h(
                      'div',
                      { className: 'wl-task-top' },
                      h('span', { className: 'wl-task-name' }, itemNames),
                      h('span', { className: 'wl-task-time' }, clock(item.updatedAt || item.createdAt))
                    ),
                    h('div', { className: 'wl-task-title' }, item.title || '远程任务'),
                    h('div', { className: 'wl-task-preview' }, String(preview).replace(/\s+/g, ' ').slice(0, 80))
                  ),
                  h('span', { className: 'wl-task-state ' + state.cls }, state.text)
                )
              })
        ),
        error ? h('div', { className: 'wl-chat-err', style: { padding: '0 14px 10px' } }, error) : null
      )

      const sheet = view === 'new'
        ? h(
            'div',
            { className: 'wl-overlay', onClick: () => setView('list') },
            h(
              'div',
              { className: 'wl-sheet', onClick: (event) => event.stopPropagation() },
              h('div', { className: 'wl-sheet-grabber' }),
              h('h2', { className: 'wl-sheet-title' }, '派个远程任务'),
              h('p', { className: 'wl-sheet-lead' }, '选设备，写一句话。任务会在右侧栏留一条对话。'),
              h(
                'div',
                { className: 'wl-sheet-label' },
                '派给 ',
                h('span', { className: 'hint' }, `已选 ${picked.length} 台`),
                h('button', {
                  className: 'wl-sheet-all',
                  type: 'button',
                  onClick: () => setPicked(devices.filter((item) => item.paired).map((item) => item.alias || item.peerId))
                }, '全选')
              ),
              h(
                'div',
                { className: 'wl-sheet-devices' },
                devices.length === 0
                  ? h('span', { className: 'wl-chat-empty' }, '还没有配对设备')
                  : devices.filter((item) => item.paired).map((item) => {
                      const name = item.alias || item.peerId
                      const on = picked.includes(name)
                      return h(
                        'button',
                        {
                          key: item.peerId,
                          className: 'wl-chip' + (on ? ' on' : '') + (item.online ? '' : ' off'),
                          onClick: () => setPicked((values) => (values.includes(name) ? values.filter((value) => value !== name) : [...values, name]))
                        },
                        h('span', { className: 'dot' }),
                        h('span', { className: 'check' }, on ? '✓' : ''),
                        name
                      )
                    })
              ),
              h('div', { className: 'wl-sheet-label' }, '做什么'),
              h('textarea', {
                value: draft,
                placeholder: '比如：把桌面上的截图按日期整理到「收到文件」里。',
                onChange: (event) => setDraft(event.target.value)
              }),
              h('div', { className: 'wl-sheet-tip' }, '任务会出现在会话里，也会出现在右侧栏。对方完成后，结果会自动回到这条对话。'),
              error ? h('div', { className: 'wl-chat-err' }, error) : null,
              h(
                'div',
                { className: 'wl-sheet-actions' },
                h('button', { className: 'wl-btn', onClick: () => setView('list') }, '取消'),
                h('button', { className: 'wl-btn primary', disabled: sending || !draft.trim() || picked.length === 0, onClick: submitTask }, sending ? '派出中…' : '派任务')
              )
            )
          )
        : null

      return h(React.Fragment, null, list, sheet)
    }


    function TaskCard({ node, sessionId, api, openPanel }) {
      const data = node?.data || {}
      const [task, setTask] = useState(null)
      const [enabled, setEnabled] = useState(true)
      useEffect(() => {
        if (!data.taskId) return
        let alive = true
        const load = async () => {
          try {
            const result = await api(`/state?devices=0&taskId=${encodeURIComponent(data.taskId)}`)
            if (alive) {
              setTask(result.task)
              if (result.settings) setEnabled(result.settings.showTaskCard !== false)
            }
          } catch {
            /* ignore */
          }
        }
        load()
        const timer = setInterval(load, 2500)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [api, data.taskId])
      if (!data.taskId || !enabled) return null
      const view = task || { status: 'dispatched', title: data.instruction || '远程任务', targets: [] }
      const state = statusOf(view)
      const names = task ? taskDevices(task) : data.targets?.join('、') || '远程设备'
      return h(
        'section',
        { className: 'wl-card', 'data-weave-link-task': data.taskId },
        h(
          'header',
          { className: 'wl-card-head' },
          h('span', { className: 'wl-card-tag' }, '远程任务'),
          h('span', { className: 'wl-card-dev' }, names),
          h('span', { className: 'wl-card-state' + (state.cls === 'err' ? ' err' : '') }, state.text)
        ),
        h('div', { className: 'wl-card-title' }, view.title || data.instruction || '远程任务'),
        h(
          'div',
          { className: 'wl-card-foot' },
          `心跳 ${ago(view.lastHeartbeatAt)} · 来自本会话`,
          h(
            'button',
            {
              className: 'wl-card-open',
              onClick: () => openPanel?.(data.sessionId || sessionId)
            },
            '打开面板 →'
          )
        )
      )
    }

    function Field(props) {
      const { label, hint, children } = props
      return h(
        'div',
        { className: 'wl-set-row' },
        h('div', { className: 'wl-set-lab' }, h('b', null, label), hint ? h('span', null, hint) : null),
        h('div', { className: 'wl-set-ctl' }, children)
      )
    }

    function NameField({ value, onCommit }) {
      const [text, setText] = useState(value || '')
      useEffect(() => {
        setText(value || '')
      }, [value])
      function commit() {
        const next = text.trim()
        if (next && next !== value) onCommit(next)
        else if (!next) setText(value || '')
      }
      return h('input', {
        className: 'wl-in wl-in-name',
        value: text,
        onChange: (event) => setText(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setText(value || '')
            event.currentTarget.blur()
          }
        }
      })
    }

    function Toggle({ on, onChange, label }) {
      return h(
        'button',
        { className: 'wl-sw' + (on ? ' on' : ''), onClick: () => onChange(!on), 'aria-label': label, type: 'button' },
        h('i', null)
      )
    }

    function DeviceRow({ device, settings, save, removeDevice }) {
      const [editing, setEditing] = useState(false)
      const [name, setName] = useState(device.alias || '')
      useEffect(() => {
        if (!editing) setName(device.alias || '')
      }, [device.alias, editing])

      function commit() {
        const aliases = { ...(settings.aliases || {}) }
        const value = name.trim()
        if (value) aliases[device.peerId] = value
        else delete aliases[device.peerId]
        save({ aliases })
        setEditing(false)
      }

      function setWorkspace(workspace) {
        const defaults = settings.deviceDefaults || {}
        save({
          deviceDefaults: {
            ...defaults,
            [device.peerId]: { ...(defaults[device.peerId] || {}), workspace }
          }
        })
      }

      const workspaces = Array.isArray(device.workspaces) ? device.workspaces : []
      const currentWorkspace = settings.deviceDefaults?.[device.peerId]?.workspace || ''
      return h(
        'div',
        { className: 'wl-set-row' },
        h(
          'div',
          { className: 'wl-dev', style: { flex: '1 1 auto', minWidth: 0 } },
          h('i', { className: 'wl-dot' + (device.online ? '' : ' idle') }),
          editing
            ? h('input', {
                className: 'wl-in wl-in-devname',
                value: name,
                autoFocus: true,
                placeholder: device.alias || device.peerId,
                onChange: (event) => setName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') commit()
                  if (event.key === 'Escape') {
                    setName(device.alias || '')
                    setEditing(false)
                  }
                },
                onBlur: commit
              })
            : h('span', { className: 'wl-dev-name', title: device.peerId }, device.alias || device.peerId),
          h('span', { className: 'wl-dev-state' }, device.online ? '在线' : '离线')
        ),
        h(
          'div',
          { className: 'wl-dev-actions' },
          workspaces.length || currentWorkspace
            ? h(
                'select',
                {
                  className: 'wl-sel wl-sel-small',
                  title: '派任务优先落到这台设备的哪个工作区',
                  value: workspaces.some((item) => item.id === currentWorkspace) || !currentWorkspace ? currentWorkspace : '',
                  onChange: (event) => setWorkspace(event.target.value)
                },
                h('option', { value: '' }, '自动（空闲会话）'),
                workspaces.map((item) => h('option', { key: item.id, value: item.id }, item.title || item.id)),
                currentWorkspace && !workspaces.some((item) => item.id === currentWorkspace)
                  ? h('option', { value: currentWorkspace }, '已保存的工作区（当前不在线）')
                  : null
              )
            : null,
          h('button', { className: 'wl-btn', onMouseDown: (event) => event.preventDefault(), onClick: () => (editing ? commit() : setEditing(true)) }, editing ? '完成' : '改名'),
          h('button', { className: 'wl-btn', onClick: () => removeDevice(device) }, '移除')
        )
      )
    }

    function WeaveSection() {
      const [ticket, setTicket] = useState('')
      const [endpoints, setEndpoints] = useState([])
      const [status, setStatus] = useState(null)
      const [draft, setDraft] = useState('')
      const [error, setError] = useState('')
      const [working, setWorking] = useState(false)
      const [copied, setCopied] = useState(false)

      const call = useCallback(async (endpoint, args = {}) => {
        const res = await fetch('/api/dsh-weave', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ endpoint, args })
        })
        const envelope = await res.json()
        if (envelope?.ok !== true) throw new Error(envelope?.error?.message || 'Weave 请求失败')
        return envelope.value
      }, [])

      const refresh = useCallback(async () => {
        const [ticketResult, endpointResult, statusResult] = await Promise.all([
          call('ticket'),
          call('endpoints'),
          call('status')
        ])
        setTicket(ticketResult.ticket || '')
        setEndpoints(endpointResult.endpoints || [])
        setStatus(statusResult)
        setError('')
      }, [call])

      useEffect(() => {
        let alive = true
        refresh().catch((e) => { if (alive) setError(e.message) })
        return () => { alive = false }
      }, [refresh])

      async function run(action) {
        if (working) return
        setWorking(true)
        setError('')
        try {
          await action()
          await refresh()
        } catch (e) {
          setError(e.message)
        } finally {
          setWorking(false)
        }
      }

      function trust(event) {
        event.preventDefault()
        const value = draft.trim()
        if (!value) return
        void run(async () => {
          await call('trust', { ticket: value })
          setDraft('')
        })
      }

      async function copyTicket() {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('无法使用剪贴板，请手动复制')
          await navigator.clipboard.writeText(ticket)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch (e) {
          setError(e.message)
        }
      }

      function remove(hostId) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('移除后将停止信任这台主机，要重新配对才能再连。确定移除？')) return
        void run(async () => { await call('untrust', { peerId: hostId }) })
      }

      const stateText = (state) => (state === 'online' ? '在线' : state === 'offline' ? '离线' : state === 'unpaired' ? '需要重新配对' : '尚未检查')

      return h('div', { className: 'wl-set-sec' },
        h('div', { className: 'wl-set-sec-t' }, '配对与连接'),
        h('div', { className: 'wl-set-box' },
          h('div', { className: 'wl-weave-line' },
            h('div', { className: 'wl-weave-grow' },
              h('b', null, '本机配对凭据'),
              h('span', null, status ? `中继：${status.relayMode === 'disabled' ? '已停用' : '默认'} · ${status.peerCount} 台已配对主机` : '读取中…')
            ),
            h('button', { className: 'wl-btn', onClick: copyTicket, disabled: !ticket }, copied ? '已复制' : '复制')
          ),
          h('div', { className: 'wl-weave-line' },
            h('div', { className: 'wl-weave-grow' },
              h('b', null, '本机凭据'),
              h('textarea', { className: 'wl-weave-ticket', readOnly: true, rows: 3, value: ticket, placeholder: '读取中…' })
            )
          ),
          h('div', { className: 'wl-weave-line' },
            h('div', { className: 'wl-weave-grow' },
              h('b', null, '配对另一台主机'),
              h('span', null, '把对方的配对凭据粘到这里；配对后就能互相派任务。')
            ),
            h('div', { className: 'wl-weave-actions' },
              h('input', { className: 'wl-in wl-in-ticket', placeholder: '粘贴 Iroh endpoint ticket', value: draft, onChange: (event) => setDraft(event.target.value), disabled: working }),
              h('button', { className: 'wl-btn primary', onClick: trust, disabled: working || !draft.trim() }, '配对')
            )
          ),
          endpoints.length === 0
            ? h('div', { className: 'wl-weave-peer' }, h('span', { className: 'wl-set-tip', style: { margin: 0 } }, '还没有配对主机。'))
            : endpoints.map((endpoint) => h('div', { key: endpoint.hostId, className: 'wl-weave-peer' },
                h('div', { className: 'wl-weave-grow' },
                  h('b', null, `主机 ${endpoint.hostId.slice(0, 12)}`),
                  h('code', null, endpoint.hostId),
                  h('span', null, stateText(endpoint.state))
                ),
                h('button', { className: 'wl-btn', onClick: () => remove(endpoint.hostId), disabled: working }, '移除')
              ))
        ),
        error ? h('div', { className: 'wl-err' }, error) : null
      )
    }

    function SettingsPage({ view, api }) {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const timer = useRef(null)
      const pending = useRef({})
      const saveSeq = useRef(0)
      const inFlight = useRef(0)

      useEffect(() => {
        let alive = true
        const refresh = () => {
          // 有没写完或正在写盘的改动时不要刷新，否则输入框会被旧值冲回去。
          if (timer.current || inFlight.current > 0 || Object.keys(pending.current).length > 0) return
          api('/state?devices=1&tasks=0')
            .then((data) => {
              if (alive) setSnap(data)
            })
            .catch((e) => {
              if (alive) setError(e.message)
            })
        }
        refresh()
        const id = setInterval(refresh, 5000)
        return () => {
          alive = false
          clearInterval(id)
          if (timer.current) clearTimeout(timer.current)
        }
      }, [api])

      function save(patch) {
        const seq = ++saveSeq.current
        setSnap((current) => (current ? { ...current, settings: { ...current.settings, ...patch } } : current))
        Object.assign(pending.current, patch)
        setNote('')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(async () => {
          const body = pending.current
          pending.current = {}
          inFlight.current += 1
          try {
            const data = await api('/settings', { method: 'POST', body: JSON.stringify(body) })
            // 只认最后一次输入的结果；中途还有新输入时不要把旧响应写回界面。
            if (seq === saveSeq.current && Object.keys(pending.current).length === 0) {
              setSnap((current) => (current ? { ...current, settings: data.settings } : current))
              setNote('已保存')
              setTimeout(() => setNote(''), 1600)
            }
          } catch (e) {
            if (seq === saveSeq.current) setError(e.message)
          } finally {
            inFlight.current -= 1
            if (seq === saveSeq.current) timer.current = null
          }
        }, 250)
      }

      async function removeDevice(device) {
        const label = device?.alias || device?.peerId || ''
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(`确定移除「${label}」？移除后要重新配对才能再连。`)) return
        try {
          await api('/untrust', { method: 'POST', body: JSON.stringify({ peerId: device?.peerId }) })
          const data = await api('/state?devices=1&tasks=0')
          setSnap(data)
        } catch (e) {
          setError(e.message)
        }
      }

      if (view === 'summary') {
        return h('div', { className: 'wl-summary' }, '多设备派任务、心跳管理和会话任务面板。')
      }
      if (!snap) {
        return h('div', { className: 'wl-set' }, h('div', { className: 'wl-set-title' }, '远程设备'), error ? h('div', { className: 'wl-err' }, error) : h('div', { className: 'wl-set-lead' }, '读取设置中…'))
      }
      const s = snap.settings || {}
      const devices = snap.devices || []
      const projects = Array.isArray(snap.projects) ? snap.projects : []
      const defaultProject = snap.defaultWorkspace && typeof snap.defaultWorkspace === 'object' ? snap.defaultWorkspace : {}
      const currentProject = String(s.defaultWorkspace || "")
      return h(
        'div',
        { className: 'wl-set' },
        h('div', { className: 'wl-set-title' }, '远程任务'),
        h('div', { className: 'wl-set-lead' }, '配对设备、派任务、看进度；所有跟远程设备有关的东西都在这一页。', note ? h('span', { className: 'wl-note' }, note) : null),
        error ? h('div', { className: 'wl-err' }, error) : null,
        h(WeaveSection),
        h(
          'div',
          { className: 'wl-set-sec' },
          h('div', { className: 'wl-set-sec-t' }, '设备'),
          h(
            'div',
            { className: 'wl-set-box' },
            h(
              Field,
              { label: '本机名称', hint: '别的设备看到的就是这个名字' },
              h(NameField, {
                value: s.localName || '',
                onCommit: (value) => save({ localName: value })
              })
            ),
            h(
              Field,
              { label: '收到文件保存到', hint: '默认放进当前对话的项目文件夹，没有会自动建' },
              h(
                'div',
                { className: 'wl-inbox-ctl' },
                h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: 12, flex: 'none' } }, '项目文件夹 /'),
                h('input', {
                  className: 'wl-in wl-in-subdir',
                  value: s.inboxSubdir || '收到文件',
                  onChange: (event) => save({ inboxSubdir: event.target.value })
                })
              )
            ),
            h(
              Field,
              { label: '新对话默认工作区', hint: '手机开新对话发过来时，在这个工作区里新建会话；不选就用 DSH 默认工作区' },
              h(
                'select',
                {
                  className: 'wl-sel wl-sel-project',
                  value: currentProject,
                  onChange: (event) => save({ defaultWorkspace: event.target.value })
                },
                h('option', { value: '' }, defaultProject.path
                  ? `默认工作区（${defaultProject.title || defaultProject.path}）`
                  : '默认工作区'),
                projects.map((project) => h('option', { key: project.id || project.path, value: project.path }, project.title || project.path)),
                currentProject && !projects.some((project) => project.path === currentProject)
                  ? h('option', { value: currentProject }, `当前：${currentProject}`)
                  : null
              )
            )
          ),
          h('div', { className: 'wl-set-tip' }, defaultProject.path
            ? `默认工作区：${defaultProject.path}。这个设置管「手机主动开新对话」；手机端要下次装新版才会发新对话请求，现在它只能回复已有会话。`
            : '这个设置管「手机主动开新对话」；手机端要下次装新版才会发新对话请求，现在它只能回复已有会话。')
        ),
        h(
          'div',
          { className: 'wl-set-sec' },
          h('div', { className: 'wl-set-sec-t' }, '任务与心跳'),
          h(
            'div',
            { className: 'wl-set-box' },
            h(
              Field,
              { label: '心跳间隔', hint: '对方干活时，每隔多久自动报一次「还在跑」' },
              h('input', { className: 'wl-in num', type: 'number', min: 5, value: s.heartbeatSec ?? 30, onChange: (event) => save({ heartbeatSec: Number(event.target.value) || 30 }) }),
              h('span', { className: 'wl-unit' }, '秒')
            ),
            h(
              Field,
              { label: '多久没动静算卡住', hint: '超过这个时间没有心跳，主控就追问一次' },
              h('input', { className: 'wl-in num', type: 'number', min: 1, value: Math.round((s.stuckSec ?? 120) / 60), onChange: (event) => save({ stuckSec: (Number(event.target.value) || 2) * 60 }) }),
              h('span', { className: 'wl-unit' }, '分钟')
            ),
            h(
              Field,
              { label: '最多追问几次', hint: '问满次数仍没回应，就把任务标为失败' },
              h('input', { className: 'wl-in num', type: 'number', min: 1, value: s.maxAsks ?? 3, onChange: (event) => save({ maxAsks: Number(event.target.value) || 1 }) }),
              h('span', { className: 'wl-unit' }, '次')
            )
          ),
          h('div', { className: 'wl-set-tip' }, '标为失败也不会取消对方正在跑的任务；你可以点「再试一次」，或者先问清楚情况。')
        ),
        h(
          'div',
          { className: 'wl-set-sec' },
          h('div', { className: 'wl-set-sec-t' }, '会话里怎么用'),
          h(
            'div',
            { className: 'wl-set-box' },
            h(
              Field,
              { label: '在会话里显示任务卡', hint: '派出去的任务会在对话里留一张卡，进度自己更新' },
              h(Toggle, { on: s.showTaskCard !== false, onChange: (value) => save({ showTaskCard: value }), label: '在会话里显示任务卡' })
            ),
            h(
              Field,
              { label: '没指定设备时先反问', hint: '匹配到多台设备时，先问一句派给哪台，不猜' },
              h(Toggle, { on: s.askWhenAmbiguous !== false, onChange: (value) => save({ askWhenAmbiguous: value }), label: '没指定设备时先反问' })
            ),
            h(
              Field,
              { label: '默认开新会话', hint: '派任务没说派到哪个对话时，让对方新开一个，别塞进它正在用的对话里' },
              h(Toggle, { on: s.newSessionByDefault !== false, onChange: (value) => save({ newSessionByDefault: value }), label: '默认开新会话' })
            )
          )
        ),
        h(
          'div',
          { className: 'wl-set-sec' },
          h('div', { className: 'wl-set-sec-t' }, '已配对设备'),
          h('div', { className: 'wl-set-tip' }, '配对在上面的「配对与连接」里完成；这里只改名字、选默认工作区。'),
          h(
            'div',
            { className: 'wl-set-box' },
            devices.length === 0
              ? h('div', { className: 'wl-set-row' }, h('div', { className: 'wl-set-lab' }, h('span', null, '还没有配对设备。')))
              : devices.map((device) =>
                  h(DeviceRow, {
                    key: device.peerId,
                    device: { ...device, alias: (s.aliases || {})[device.peerId] || device.alias },
                    settings: s,
                    save,
                    removeDevice
                  })
                )
          )
        )
      )
    }

    return {
      inject: ['slots', 'locale', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => ensureStyle(), 'dsh-weave: styles')
        ctx.effect(() => ctx.locale.register(NS, { zh, en: zh }), 'dsh-weave: dictionaries')
        const api = makeApi()
        let sidebar = null
        const openPanel = (sessionId) => {
          try {
            if (sessionId && typeof sidebar?.openTabIn === 'function') sidebar.openTabIn(sessionId, TAB_KIND)
            else sidebar?.openTab?.(TAB_KIND)
          } catch {
            /* ignore */
          }
        }

        ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {
          sidebar = native.sidebarRight
          native.effect(
            () =>
              native.sidebarRightTabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                title: () => '远程任务',
                guide: [
                  {
                    id: TAB_ID,
                    order: 70,
                    title: () => '远程任务',
                    description: () => '查看本会话派给远程设备的任务'
                  }
                ]
              }),
            'dsh-weave: right tab'
          )
          native.slots.inject('sidebar.right.pane.tab', () =>
            native.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: TAB_ID,
                inject: (sessionId) => ({ api, sessionId })
              },
              Pane
            )
          )
        })

        ctx.inject(['inputTriggers'], (input) => {
          const triggers = typeof input.get === 'function' ? input.get('inputTriggers') : input.inputTriggers
          if (!triggers) return
          input.effect(
            () =>
              triggers.registerSource({
                trigger: '@',
                name: 'weave-link-devices',
                order: 40,
                showGroupTitle: true,
                async candidates() {
                  const state = await api('/state?devices=1')
                  return (state.devices || [])
                    .filter((device) => device.paired)
                    .map((device) => ({
                      name: device.alias,
                      label: device.alias,
                      description: device.online ? '在线' : '离线',
                      hint: device.online ? '在线' : '离线',
                      value: device.peerId
                    }))
                },
                onPick(pick) {
                  return { text: '@' + pick.candidate.name + ' ' }
                }
              }),
            'dsh-weave: @ device source'
          )
        })

        ctx.slots.inject('conversation.chat.node', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.node',
              key: 'weave-link-task',
              inject: (sessionId) => ({ api, openPanel, sessionId })
            },
            TaskCard
          )
        )

        ctx.uiConversation.events.register({
          kind: 'weave-link-task',
          target: 'chat',
          match(event) {
            if (event.type === 'tool/call' && event.data?.name === 'link_task') {
              return { id: String(event.data.callId), role: 'start' }
            }
            if (event.type === 'tool/result' && event.data?.message?.source?.kind === 'tool' && event.data?.message?.source?.callId) {
              return { id: String(event.data.message.source.callId), role: 'update' }
            }
            return null
          },
          start(_context, match) {
            let args = {}
            try {
              args = JSON.parse(match.event.data.arguments || '{}')
            } catch {
              args = {}
            }
            return {
              instruction: String(args.instruction || ''),
              targets: Array.isArray(args.targets) ? args.targets.map(String) : [],
              taskId: '',
              sessionId: ''
            }
          },
          update(context, match) {
            if (match.event.type !== 'tool/result') return context.state
            let taskId = ''
            let sessionId = ''
            const meta = match.event.data.meta
            if (meta && typeof meta === 'object') {
              taskId = String(meta.taskId || '')
              sessionId = String(meta.sessionId || '')
            }
            if (!taskId) {
              const text = (match.event.data.message?.content || [])
                .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
                .map((block) => block.text)
                .join('\n')
              const found = /已派任务\s+(task-[A-Za-z0-9-]+)/.exec(text)
              if (found) taskId = found[1]
            }
            return Object.assign({}, context.state, { taskId, sessionId: sessionId || context.state.sessionId })
          },
          buildViewNode(context) {
            if (context.start === undefined || !context.state.taskId) return null
            return {
              key: context.key,
              kind: 'weave-link-task',
              id: context.id,
              target: 'chat',
              anchorSeq: context.start.event.seq,
              location: context.start.location,
              visibility: 'visible',
              data: {
                taskId: context.state.taskId,
                sessionId: context.state.sessionId,
                instruction: context.state.instruction,
                targets: context.state.targets
              }
            }
          }
        })

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'weave',
              order: 35,
              label: () => '远程任务',
              inject: () => ({ api })
            },
            SettingsPage
          )
        )
      }
    }
  }
})
