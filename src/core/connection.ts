// WebSocket 连接：主动连出 -> bridge，token 握手，指数退避重连。

import {
  PROTOCOL_VERSION,
  type EventMsg,
  type ExtToServer,
  type ExtensionHelloMsg,
  type ServerToExt,
} from './protocol';
import type { Dispatcher } from './dispatcher';

export type ConnState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'auth-failed'
  | 'disconnected';

export interface BridgeConnectionOpts {
  getPort: () => number;
  getToken: () => string;
  buildHello: () => Omit<ExtensionHelloMsg, 'type' | 'token' | 'protocolVersion' | 'role'>;
  dispatcher: Dispatcher;
  onStateChange: (state: ConnState, detail?: string) => void;
  onLog: (line: string) => void;
}

const MAX_BACKOFF_MS = 15_000;

export class BridgeConnection {
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private backoffMs = 1000;
  private stopped = true;
  private generation = 0;

  constructor(private readonly opts: BridgeConnectionOpts) {}

  get state(): ConnState {
    if (this.stopped) return 'disabled';
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    if (this.retryTimer !== null || this.ws?.readyState === WebSocket.CONNECTING) {
      return 'connecting';
    }
    return 'disconnected';
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.backoffMs = 1000;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.clearRetry();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.opts.onStateChange('disabled');
  }

  restart(): void {
    this.stop();
    this.start();
  }

  sendEvent(event: EventMsg['event'], payload: unknown): void {
    this.rawSend({ type: 'event', event, payload });
  }

  private rawSend(msg: ExtToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private open(): void {
    if (this.stopped) return;
    this.clearRetry();
    this.generation++;
    const gen = this.generation;

    const port = this.opts.getPort();
    const token = this.opts.getToken();
    const url = `ws://127.0.0.1:${port}/bridge`;

    this.opts.onStateChange('connecting', url);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.opts.onLog(`connect failed: ${String(err)}`);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (gen !== this.generation) return;
      const hello: ExtensionHelloMsg = {
        type: 'hello',
        token,
        protocolVersion: PROTOCOL_VERSION,
        role: 'extension',
        ...this.opts.buildHello(),
      };
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (gen !== this.generation) return;
      let msg: ServerToExt;
      try {
        msg = JSON.parse(String(ev.data)) as ServerToExt;
      } catch {
        this.opts.onLog(`bad message from bridge: ${String(ev.data).slice(0, 120)}`);
        return;
      }
      void this.handleMessage(msg);
    };

    ws.onclose = (ev: CloseEvent) => {
      if (gen !== this.generation) return;
      this.ws = null;
      if (ev.code === 4001) {
        this.opts.onStateChange('auth-failed', 'token rejected by bridge');
        this.opts.onLog('auth failed: token rejected (check token in settings)');
        // 保留慢速重试（30s 起步）：bridge 可能换了 token 重启，
        // 用户修好设置或 bridge 恢复后应能自愈，而不是永久躺平
        this.backoffMs = Math.max(this.backoffMs, 30_000);
        this.scheduleRetry('auth');
        return;
      }
      this.scheduleRetry();
    };

    ws.onerror = () => {
      if (gen !== this.generation) return;
      this.opts.onLog('websocket error');
    };
  }

  private async handleMessage(msg: ServerToExt): Promise<void> {
    if (msg.type === 'ping') {
      this.rawSend({ type: 'pong', t: msg.t });
      return;
    }
    if (msg.type === 'welcome') {
      // bridge 接受了 hello：正式置为 connected（点亮徽章、重置退避）
      this.noteAuthenticated();
      return;
    }
    if (msg.type !== 'call') return;

    const result = await this.opts.dispatcher.handle(msg.tool, msg.args);
    if (result.ok) {
      this.rawSend({ type: 'result', id: msg.id, ok: true, data: result.data });
    } else {
      this.rawSend({ type: 'result', id: msg.id, ok: false, error: result.error });
    }
  }

  private scheduleRetry(reason?: string): void {
    if (this.stopped || this.retryTimer !== null) return;
    this.opts.onStateChange(
      reason === 'auth' ? 'auth-failed' : 'disconnected',
      `retry in ${Math.round(this.backoffMs / 1000)}s`,
    );
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** bridge 接受 hello 后状态置绿（由外部在 hello 成功路径调用） */
  noteAuthenticated(): void {
    this.backoffMs = 1000;
    this.opts.onStateChange('connected');
  }
}
