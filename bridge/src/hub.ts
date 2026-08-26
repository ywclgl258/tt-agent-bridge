// WebSocket hub：仅监听 127.0.0.1，token 握手，两类客户端：
//   extension（单连接，事件生产者，被 call 的对象）
//   agent（多连接，可发起 call、接收事件直推；daemon/MCP attach/dev 脚本用它）
// MCP 工具调用转发（带超时），事件环形缓冲。

import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type WebSocket as WsType } from 'ws';
import {
  EXTENSION_TOOLS,
  PROTOCOL_VERSION,
  type ClientToServer,
  type ExtensionHelloMsg,
  type ServerToClient,
} from '../../src/core/protocol.js';

const EVENT_BUFFER_SIZE = 300;
const CALL_TIMEOUT_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const HEARTBEAT_TOLERANCE = 2;

export interface QueuedEvent {
  seq: number;
  t: number;
  event: string;
  payload: unknown;
}

/** mcp.ts 依赖的 hub 能力面（ExtensionHub 与 AttachClient 都实现它） */
export interface HubLike {
  readonly attached: boolean;
  readonly extConnected: boolean;
  readonly extToolList: string[] | null;
  readonly startedAt: number;
  callExtension(tool: string, args: Record<string, unknown>): Promise<unknown>;
  eventsSince(sinceSeq: number): QueuedEvent[];
  lastEventSeq(): number;
  dispose(): void;
}

interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class ExtensionHub implements HubLike {
  readonly attached = false;
  private wss: WebSocketServer | null = null;
  private ext: WsType | null = null;
  private extTools: string[] | null = null;
  private extVersion: string | null = null;
  private agents = new Map<WsType, string>();
  private pending = new Map<string, PendingCall>();
  private eventBuffer: QueuedEvent[] = [];
  private eventSeq = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private missedBeats = 0;
  readonly startedAt = Date.now();

  constructor(
    private readonly port: number,
    private readonly token: string,
    private readonly log: (line: string) => void,
  ) {}

  get extConnected(): boolean {
    return this.ext?.readyState === WebSocket.OPEN;
  }

  get extToolList(): string[] | null {
    return this.extTools;
  }

  get agentCount(): number {
    return this.agents.size;
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
      wss.on('error', reject);
      wss.on('connection', (ws) => this.onConnection(ws));
      wss.on('listening', () => {
        this.wss = wss;
        resolve();
      });
    });
  }

  dispose(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new Error('bridge shutting down'));
    }
    this.pending.clear();
    for (const ws of this.agents.keys()) ws.close(1001, 'bridge shutting down');
    this.agents.clear();
    this.ext?.close();
    this.wss?.close();
  }

  /** 转发工具调用到扩展；未连接时立即失败（以 rejected promise 形式，agent 侧可 catch） */
  callExtension(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const ext = this.ext;
    if (!this.extConnected || !ext) {
      return Promise.reject(
        new Error('extension not connected (is TT running with the bridge extension enabled?)'),
      );
    }
    return this.forwardCall(ext, tool, args);
  }

  eventsSince(sinceSeq: number): QueuedEvent[] {
    return this.eventBuffer.filter((e) => e.seq > sinceSeq);
  }

  lastEventSeq(): number {
    return this.eventSeq;
  }

  private forwardCall(ext: WsType, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    const msg: ServerToClient = { type: 'call', id, tool, args };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`extension call timed out after ${CALL_TIMEOUT_MS}ms: ${tool}`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ext.send(JSON.stringify(msg));
    });
  }

  private welcomePayload(): ServerToClient {
    return {
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      hub: {
        extConnected: this.extConnected,
        extTools: this.extToolList,
        extVersion: this.extVersion,
        lastEventSeq: this.eventSeq,
        serverStartedAtMs: this.startedAt,
      },
    };
  }

  private onConnection(ws: WsType): void {
    let authenticated = false;
    let role: 'extension' | 'agent' = 'extension';
    // 鉴权超时：10 秒内必须完成 hello
    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'auth timeout');
    }, 10_000);

    ws.on('message', (raw) => {
      let msg: ClientToServer;
      try {
        msg = JSON.parse(String(raw)) as ClientToServer;
      } catch {
        this.log('dropped malformed message from client socket');
        return;
      }

      if (!authenticated) {
        if (msg.type !== 'hello') {
          ws.close(4001, 'expected hello');
          return;
        }
        if (msg.token !== this.token) {
          this.log('auth failed: token mismatch');
          ws.close(4001, 'token rejected');
          return;
        }
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.log(`auth failed: protocol mismatch (client ${msg.protocolVersion}, server ${PROTOCOL_VERSION})`);
          ws.close(4003, 'protocol version mismatch');
          return;
        }
        authenticated = true;
        role = msg.role ?? 'extension';
        clearTimeout(authTimer);

        if (role === 'agent') {
          const name = (msg as Extract<ClientToServer, { role: 'agent' }>).agent?.name ?? 'unnamed';
          this.agents.set(ws, name);
          ws.send(JSON.stringify(this.welcomePayload()));
          this.log(`agent connected: ${name}`);
          return;
        }

        const hello = msg as ExtensionHelloMsg;
        // 单连接：踢掉旧扩展
        if (this.ext && this.ext !== ws) {
          this.log('replacing previous extension connection');
          this.ext.close(4000, 'replaced');
        }
        this.ext = ws;
        this.extTools = hello.host?.tools ?? null;
        this.extVersion = hello.ext?.version ?? null;
        this.missedBeats = 0;
        this.startHeartbeat();
        ws.send(JSON.stringify(this.welcomePayload()));
        this.log(
          `extension connected v${this.extVersion ?? '?'} (tools: ${(this.extTools ?? []).join(', ')})`,
        );
        const unknown = (this.extTools ?? []).filter((t) => !EXTENSION_TOOLS.includes(t as never));
        if (unknown.length > 0) {
          this.log(`warn: extension reported tools outside protocol contract: ${unknown.join(', ')}`);
        }
        return;
      }

      this.handleMessage(ws, role, msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (role === 'agent') {
        this.agents.delete(ws);
        return;
      }
      if (this.ext === ws) {
        this.ext = null;
        this.extTools = null;
        this.extVersion = null;
        this.stopHeartbeat();
        // 扩展掉线：挂起中的调用立即失败，而不是等 60s 超时
        for (const [, call] of this.pending) {
          clearTimeout(call.timer);
          call.reject(new Error('extension disconnected before answering'));
        }
        this.pending.clear();
        this.log('extension disconnected');
      }
    });
  }

  private handleMessage(ws: WsType, role: 'extension' | 'agent', msg: ClientToServer): void {
    switch (msg.type) {
      case 'call': {
        // 只有 agent 会发起 call（MCP server attach 模式 / dev 脚本）
        if (role !== 'agent' || !this.agents.has(ws)) return;
        this.callExtension(msg.tool, msg.args ?? {})
          .then((data) => {
            ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, data }));
          })
          .catch((err: unknown) => {
            ws.send(
              JSON.stringify({
                type: 'result',
                id: msg.id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          });
        return;
      }
      case 'result': {
        if (ws !== this.ext) return;
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok) call.resolve(msg.data);
        else call.reject(new Error(msg.error));
        return;
      }
      case 'event': {
        if (ws !== this.ext) return;
        this.eventSeq++;
        this.eventBuffer.push({
          seq: this.eventSeq,
          t: Date.now(),
          event: msg.event,
          payload: msg.payload,
        });
        if (this.eventBuffer.length > EVENT_BUFFER_SIZE) {
          this.eventBuffer.splice(0, this.eventBuffer.length - EVENT_BUFFER_SIZE);
        }
        // 直推给 agent（带 seq，attach 端据此维护本地 ring）
        const push = JSON.stringify({
          type: 'event',
          seq: this.eventSeq,
          t: Date.now(),
          event: msg.event,
          payload: msg.payload,
        });
        for (const agent of this.agents.keys()) {
          if (agent.readyState === WebSocket.OPEN) agent.send(push);
        }
        return;
      }
      case 'pong': {
        if (ws !== this.ext) return;
        this.missedBeats = 0;
        return;
      }
      case 'hello': {
        // 重复 hello 忽略
        return;
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.extConnected || !this.ext) return;
      this.missedBeats++;
      if (this.missedBeats > HEARTBEAT_TOLERANCE) {
        this.log('extension missed heartbeats, dropping connection');
        this.ext.terminate();
        return;
      }
      this.ext.send(JSON.stringify({ type: 'ping', t: Date.now() } satisfies ServerToClient));
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
