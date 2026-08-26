// WebSocket hub：仅监听 127.0.0.1，token 握手，单扩展连接，
// MCP 工具调用转发（带超时），事件环形缓冲。

import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type WebSocket as WsType } from 'ws';
import {
  PROTOCOL_VERSION,
  type ExtToServer,
  type ServerToExt,
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

interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class ExtensionHub {
  private wss: WebSocketServer | null = null;
  private ext: WsType | null = null;
  private extTools: string[] | null = null;
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
    this.ext?.close();
    this.wss?.close();
  }

  /** 转发工具调用到扩展；未连接时立即失败 */
  callExtension(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const ext = this.ext;
    if (!this.extConnected || !ext) {
      throw new Error('extension not connected (is TT running with the bridge extension enabled?)');
    }
    const id = randomUUID();
    const msg: ServerToExt = { type: 'call', id, tool, args };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`extension call timed out after ${CALL_TIMEOUT_MS}ms: ${tool}`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ext.send(JSON.stringify(msg));
    });
  }

  eventsSince(sinceSeq: number): QueuedEvent[] {
    return this.eventBuffer.filter((e) => e.seq > sinceSeq);
  }

  lastEventSeq(): number {
    return this.eventSeq;
  }

  private onConnection(ws: WsType): void {
    let authenticated = false;
    // 鉴权超时：10 秒内必须完成 hello
    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'auth timeout');
    }, 10_000);

    ws.on('message', (raw) => {
      let msg: ExtToServer;
      try {
        msg = JSON.parse(String(raw)) as ExtToServer;
      } catch {
        this.log('dropped malformed message from extension socket');
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
          this.log(`auth failed: protocol mismatch (ext ${msg.protocolVersion}, server ${PROTOCOL_VERSION})`);
          ws.close(4003, 'protocol version mismatch');
          return;
        }
        authenticated = true;
        clearTimeout(authTimer);

        // 单连接：踢掉旧扩展
        if (this.ext && this.ext !== ws) {
          this.log('replacing previous extension connection');
          this.ext.close(4000, 'replaced');
        }
        this.ext = ws;
        this.extTools = msg.host.capabilities ?? null;
        this.missedBeats = 0;
        this.startHeartbeat();
        this.log(`extension connected (tools: ${(msg.host.capabilities ?? []).join(', ')})`);
        return;
      }

      this.handleMessage(ws, msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (this.ext === ws) {
        this.ext = null;
        this.extTools = null;
        this.stopHeartbeat();
        this.log('extension disconnected');
      }
    });
  }

  private handleMessage(ws: WsType, msg: ExtToServer): void {
    if (ws !== this.ext) return;

    switch (msg.type) {
      case 'result': {
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok) call.resolve(msg.data);
        else call.reject(new Error(msg.error));
        return;
      }
      case 'event': {
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
        return;
      }
      case 'pong': {
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
      this.ext.send(JSON.stringify({ type: 'ping', t: Date.now() } satisfies ServerToExt));
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
