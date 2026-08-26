// agent 角色的 WS 客户端：作为 HubLike 挂到已存在的 hub（daemon）上。
// 用于 MCP stdio server 的 bind-or-attach 模式与 dev 脚本的即时连接。

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  type ServerToClient,
  type WelcomeMsg,
} from '../../src/core/protocol.js';
import type { HubLike, QueuedEvent } from './hub.js';

const CALL_TIMEOUT_MS = 60_000;
const LOCAL_EVENT_BUFFER = 300;

export class AttachClient implements HubLike {
  readonly attached = true;
  private pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private events: QueuedEvent[] = [];
  private eventSeq = 0;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly hubSnapshot: NonNullable<WelcomeMsg['hub']>,
  ) {
    ws.on('message', (raw) => {
      if (this.closed) return;
      let msg: ServerToClient;
      try {
        msg = JSON.parse(String(raw)) as ServerToClient;
      } catch {
        return;
      }
      if (msg.type === 'result') {
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok) call.resolve(msg.data);
        else call.reject(new Error(msg.error));
        return;
      }
      if (msg.type === 'event') {
        this.eventSeq = Math.max(this.eventSeq, msg.seq);
        this.events.push({ seq: msg.seq, t: msg.t, event: msg.event, payload: msg.payload });
        if (this.events.length > LOCAL_EVENT_BUFFER) {
          this.events.splice(0, this.events.length - LOCAL_EVENT_BUFFER);
        }
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      }
    });
    ws.on('close', () => {
      const err = new Error('connection to bridge hub lost (daemon exited?)');
      for (const [, call] of this.pending) {
        clearTimeout(call.timer);
        call.reject(err);
      }
      this.pending.clear();
    });
  }

  get extConnected(): boolean {
    // attach 时刻的快照；之后以最近一次调用结果为准（失败会带明确错误）
    return this.hubSnapshot.extConnected;
  }

  get extToolList(): string[] | null {
    return this.hubSnapshot.extTools;
  }

  get startedAt(): number {
    return this.hubSnapshot.serverStartedAtMs;
  }

  callExtension(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('attach connection closed'));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`extension call timed out after ${CALL_TIMEOUT_MS}ms: ${tool}`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'call', id, tool, args }));
    });
  }

  eventsSince(sinceSeq: number): QueuedEvent[] {
    return this.events.filter((e) => e.seq > sinceSeq);
  }

  lastEventSeq(): number {
    return this.eventSeq;
  }

  dispose(): void {
    this.closed = true;
    this.ws.close();
  }
}

export type AttachResult =
  | { ok: true; client: AttachClient }
  | { ok: false; reason: 'no-listener' | 'token-rejected' | 'protocol-mismatch' | 'timeout' };

/** 探测 ws://127.0.0.1:{port} 是否有同 token 的存活 hub；有则作为 agent 挂上 */
export async function tryAttach(
  port: number,
  token: string,
  opts: { timeoutMs?: number; agentName?: string; log?: (line: string) => void } = {},
): Promise<AttachResult> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const log = opts.log ?? (() => undefined);
  const url = `ws://127.0.0.1:${port}/bridge`;

  return new Promise<AttachResult>((resolve) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      resolve({ ok: false, reason: 'no-listener' });
      return;
    }

    const finish = (r: AttachResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!r.ok) {
        try {
          ws.removeAllListeners();
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
          }
        } catch {
          // best-effort
        }
      }
      resolve(r);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          token,
          protocolVersion: PROTOCOL_VERSION,
          role: 'agent',
          agent: { name: opts.agentName ?? 'mcp-attach' },
        }),
      );
    });

    ws.on('message', (raw) => {
      let msg: ServerToClient;
      try {
        msg = JSON.parse(String(raw)) as ServerToClient;
      } catch {
        return;
      }
      if (msg.type === 'welcome' && msg.hub) {
        log(`attached to existing hub at ${url} (ext connected: ${msg.hub.extConnected})`);
        const client = new AttachClient(ws, msg.hub);
        // AttachClient 自己的 close 清理已接管
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, client });
      }
    });

    ws.on('close', (code) => {
      if (code === 4001) {
        log('attach rejected: token mismatch with existing hub');
        finish({ ok: false, reason: 'token-rejected' });
      } else if (code === 4003) {
        finish({ ok: false, reason: 'protocol-mismatch' });
      } else {
        finish({ ok: false, reason: 'no-listener' });
      }
    });

    ws.on('error', () => {
      // 连接被拒/端口无监听等，交给 close 或 timeout 收尾
    });
  });
}
