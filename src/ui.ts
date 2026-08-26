// 极简 UI：右下角状态徽章 + 设置面板。Shadow DOM 隔离，不污染宿主样式。

import type { ConnState } from './core/connection';
import type { SettingsStore } from './settings';

export interface UiController {
  setState(state: ConnState, detail?: string): void;
  log(line: string): void;
  dispose(): void;
}

const STYLE = `
  :host {
    all: initial;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 99999;
  }
  .wrap { position: relative; }
  .badge {
    display: flex; align-items: center; gap: 6px;
    background: rgba(20, 20, 24, 0.88);
    color: #eee;
    border-radius: 999px;
    padding: 5px 12px 5px 8px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .dot.connected { background: #3ecf6e; }
  .dot.connecting, .dot.disconnected { background: #e6b450; }
  .dot.auth-failed { background: #e6544e; }
  .dot.disabled { background: #888; }
  .panel {
    position: absolute; right: 0; bottom: 36px;
    width: 300px;
    background: rgba(24, 24, 28, 0.96);
    color: #ddd;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 12px;
    font-size: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  }
  .panel.hidden { display: none; }
  h3 { margin: 0 0 8px; font-size: 13px; color: #fff; }
  .row { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .row label { flex: none; width: 46px; color: #aaa; }
  .row input[type=number], .row input[type=password] {
    flex: 1; min-width: 0;
    background: #111; color: #eee;
    border: 1px solid #333; border-radius: 6px;
    padding: 4px 6px; font-size: 12px;
  }
  .status { color: #9c9; margin: 6px 0; word-break: break-all; }
  .status.err { color: #e6544e; }
  button {
    background: #2c5f8a; color: #fff; border: none;
    border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;
  }
  button:hover { background: #3775a8; }
  .logs {
    margin-top: 8px;
    max-height: 140px; overflow-y: auto;
    background: #111; border-radius: 6px; padding: 6px;
    font-family: ui-monospace, Consolas, monospace; font-size: 11px;
    color: #9a9; white-space: pre-wrap; word-break: break-all;
  }
`;

export function createUi(opts: {
  settings: SettingsStore;
  onManualRestart: () => void;
}): UiController {
  const host = document.createElement('div');
  host.id = 'tt-agent-bridge-ui';
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>${STYLE}</style>
    <div class="wrap">
      <div class="badge"><span class="dot disabled"></span><span class="label">Bridge</span></div>
      <div class="panel hidden">
        <h3>TT Agent Bridge</h3>
        <div class="status">initializing…</div>
        <div class="row"><label>启用</label><input type="checkbox" class="enabled"></div>
        <div class="row"><label>端口</label><input type="number" class="port" min="1" max="65535"></div>
        <div class="row"><label>Token</label><input type="password" class="token" placeholder="粘贴 bridge token"></div>
        <div class="row">
          <button class="reconnect">重连</button>
          <button class="close">收起</button>
        </div>
        <div class="logs"></div>
      </div>
    </div>
  `;

  const badge = root.querySelector('.badge') as HTMLDivElement;
  const dot = root.querySelector('.dot') as HTMLSpanElement;
  const label = root.querySelector('.label') as HTMLSpanElement;
  const panel = root.querySelector('.panel') as HTMLDivElement;
  const statusEl = root.querySelector('.status') as HTMLDivElement;
  const enabledInput = root.querySelector('.enabled') as HTMLInputElement;
  const portInput = root.querySelector('.port') as HTMLInputElement;
  const tokenInput = root.querySelector('.token') as HTMLInputElement;
  const reconnectBtn = root.querySelector('.reconnect') as HTMLButtonElement;
  const closeBtn = root.querySelector('.close') as HTMLButtonElement;
  const logsEl = root.querySelector('.logs') as HTMLDivElement;

  const logLines: string[] = [];

  badge.addEventListener('click', () => panel.classList.toggle('hidden'));
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  const { settings } = opts;
  enabledInput.checked = settings.state.enabled;
  portInput.value = String(settings.state.port);
  tokenInput.value = settings.state.token;

  enabledInput.addEventListener('change', () => settings.update({ enabled: enabledInput.checked }));
  portInput.addEventListener('change', () => {
    const port = Number(portInput.value);
    if (Number.isInteger(port) && port > 0 && port < 65536) settings.update({ port });
  });
  tokenInput.addEventListener('change', () => settings.update({ token: tokenInput.value.trim() }));
  reconnectBtn.addEventListener('click', () => opts.onManualRestart());

  function render(state: ConnState, detail?: string) {
    dot.className = `dot ${state}`;
    const labels: Record<ConnState, string> = {
      connected: 'Bridge ✓',
      connecting: 'Bridge …',
      'auth-failed': 'Bridge ✗',
      disconnected: 'Bridge ×',
      disabled: 'Bridge off',
    };
    label.textContent = labels[state];
    statusEl.textContent = detail ? `${state}: ${detail}` : state;
    statusEl.className = state === 'auth-failed' ? 'status err' : 'status';
  }

  document.body.appendChild(host);

  return {
    setState: render,
    log(line) {
      const stamped = `${new Date().toLocaleTimeString()} ${line}`;
      logLines.push(stamped);
      if (logLines.length > 30) logLines.shift();
      logsEl.textContent = logLines.join('\n');
      logsEl.scrollTop = logsEl.scrollHeight;
    },
    dispose() {
      host.remove();
    },
  };
}
