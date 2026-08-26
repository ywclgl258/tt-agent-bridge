// dev 脚本共享的 agent 直连客户端：
// 优先 attach 已存活的 hub（daemon / MCP server），瞬时连接；
// 失败时可选 spawn 一个 MCP server 子进程（老路径）。
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.TTAB_PORT ?? 18789);
const TOKEN = process.env.TTAB_TOKEN ?? 'ttab-local-dev-001';
const PROTOCOL_VERSION = 2;

/**
 * 直连 agent：返回 { call, close }。
 * @param opts.spawn 无存活 hub 时是否 spawn MCP server（tsx src/index.ts）兜底
 */
export async function connectAgent(opts = {}) {
  const { spawn = true, waitExtensionMs = 20_000 } = opts;

  let child = null;
  const tryDirect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/bridge`);
    const opened = await new Promise((res) => {
      ws.once('open', () => res(true));
      ws.once('error', () => res(false));
      setTimeout(() => res(ws.readyState === WebSocket.OPEN), 2500);
    });
    if (!opened) {
      try { ws.terminate(); } catch {}
      return null;
    }
    const welcome = await new Promise((res) => {
      const t = setTimeout(() => res(null), 2500);
      ws.once('message', (raw) => {
        clearTimeout(t);
        try { res(JSON.parse(String(raw))); } catch { res(null); }
      });
      ws.send(JSON.stringify({
        type: 'hello', token: TOKEN, protocolVersion: PROTOCOL_VERSION,
        role: 'agent', agent: { name: 'dev-script' },
      }));
    });
    if (!welcome || welcome.type !== 'welcome') {
      try { ws.terminate(); } catch {}
      return null;
    }
    return ws;
  };

  let ws = await tryDirect();
  if (!ws && spawn) {
    const { spawn: cpSpawn } = await import('node:child_process');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { dirname } = await import('node:path');
    const bridgeRoot = resolve(dirname(fileURLToPath(new URL('.', import.meta.url))), '..');
    child = cpSpawn(
      process.execPath,
      [resolve(bridgeRoot, 'node_modules/tsx/dist/cli.mjs'), resolve(bridgeRoot, 'src/index.ts')],
      {
        cwd: bridgeRoot,
        env: { ...process.env, TTAB_PORT: String(PORT), TTAB_TOKEN: TOKEN },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    // 等 MCP server bind 完成后再 attach
    for (let i = 0; i < 10 && !ws; i++) {
      await new Promise((r) => setTimeout(r, 600));
      ws = await tryDirect();
    }
  }
  if (!ws) throw new Error('cannot reach bridge hub (no daemon and spawn failed)');

  const pending = new Map();
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'result' && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.ok ? resolve(msg.data) : reject(new Error(msg.error));
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
    }
  });

  let seq = 0;
  async function call(tool, args = {}) {
    const id = `dev-${Date.now()}-${seq++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout calling ${tool}`));
      }, 65_000);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      ws.send(JSON.stringify({ type: 'call', id, tool, args }));
    });
  }

  /** 等扩展连上（hub 存活但扩展未连时 call 会失败） */
  async function waitExtension() {
    const deadline = Date.now() + waitExtensionMs;
    while (Date.now() < deadline) {
      try {
        await call('tt_status');
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return false;
  }

  async function close() {
    try { ws.close(); } catch {}
    if (child) {
      const c = child;
      await new Promise((r) => {
        c.on('exit', r);
        killTree(c);
        setTimeout(r, 1500);
      });
    }
  }

  return { call, waitExtension, close, mode: child ? 'spawned' : 'attached' };
}

/** Windows 上 tsx/npm 会 fork 子进程，必须整树终止否则端口泄漏 */
export function killTree(child) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  } else {
    try { child.kill('SIGKILL'); } catch {}
  }
}
