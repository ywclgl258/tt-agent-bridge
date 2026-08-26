// TT Agent Bridge 扩展入口。
// 生命周期：DOM ready -> host ready -> ST 兼容层 -> dispatcher + WS 连接 + UI -> 事件订阅。

import './style.css';
import {
  getHostApi,
  waitForHostReady,
  type HostUnsubscribe,
  type TauriTavernHostApi,
} from './host/api';
import { getStContext, initStLayer, ST_EVENTS, stReady } from './host/st';
import { EXTENSION_VERSION } from './version';
import { BridgeConnection, type ConnState } from './core/connection';
import { Dispatcher } from './core/dispatcher';
import { EXTENSION_TOOLS } from './core/protocol';
import { createInspectHandlers } from './core/handlers/inspect';
import { createOperateHandlers } from './core/handlers/operate';
import { createDebugHandlers } from './core/handlers/debug';
import { createSettingsStore } from './settings';
import { createUi, type UiController } from './ui';

type DisposeFn = () => void;
const disposers: DisposeFn[] = [];

function waitForDocumentReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function snippet(text: unknown, maxLen = 200): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

/** 宿主事件 -> bridge 事件流 */
function subscribeEvents(
  hostApi: TauriTavernHostApi | null,
  send: (event: 'message_added' | 'worldinfo_activation' | 'log_error' | 'llm_request' | 'extension_log', payload: unknown) => void,
): void {
  const unsubs: HostUnsubscribe[] = [];

  if (stReady()) {
    const eventSource = getStContext().eventSource;
    if (eventSource) {
      const onMessage = (message: unknown) => {
        const chat = getStContext().chat;
        const localIndex = Array.isArray(chat) ? chat.length - 1 : null;
        const name =
          message && typeof message === 'object' && 'name' in message
            ? String((message as { name?: unknown }).name ?? '')
            : '';
        const mes =
          message && typeof message === 'object' && 'mes' in message
            ? snippet((message as { mes?: unknown }).mes)
            : '';
        const emit = (index: number | null) =>
          send('message_added', { index, name, snippet: mes });
        // 窗口化加载下 chat 只含窗口内容：用宿主 windowInfo 换算绝对楼层
        const windowInfo = hostApi?.chat?.current?.windowInfo;
        if (windowInfo) {
          windowInfo()
            .then((w) => {
              if (w && w.mode === 'windowed' && localIndex !== null) {
                emit(w.windowStartIndex + localIndex);
              } else {
                emit(localIndex);
              }
            })
            .catch(() => emit(localIndex));
        } else {
          emit(localIndex);
        }
      };
      eventSource.on(ST_EVENTS.MESSAGE_RECEIVED, onMessage);
      eventSource.on(ST_EVENTS.MESSAGE_SENT, onMessage);
      unsubs.push(() => {
        eventSource.off?.(ST_EVENTS.MESSAGE_RECEIVED, onMessage);
        eventSource.off?.(ST_EVENTS.MESSAGE_SENT, onMessage);
      });
    }
  }

  if (hostApi?.worldInfo?.subscribeActivations) {
    void hostApi.worldInfo
      .subscribeActivations((batch) => send('worldinfo_activation', batch))
      .then((unsub) => unsubs.push(unsub))
      .catch(() => undefined);
  }

  if (hostApi?.dev?.frontendLogs?.subscribe) {
    void hostApi.dev.frontendLogs
      .subscribe((entry) => {
        if (entry.level === 'error') send('log_error', { kind: 'frontend', ...entry });
      })
      .then((unsub) => unsubs.push(unsub))
      .catch(() => undefined);
  }

  if (hostApi?.dev?.backendLogs?.subscribe) {
    void hostApi.dev.backendLogs
      .subscribe((entry) => {
        if (entry.level === 'ERROR') send('log_error', { kind: 'backend', ...entry });
      })
      .then((unsub) => unsubs.push(unsub))
      .catch(() => undefined);
  }

  if (hostApi?.dev?.llmApiLogs?.subscribeIndex) {
    void hostApi.dev.llmApiLogs
      .subscribeIndex((entry) => {
        send('llm_request', {
          id: entry.id,
          ok: entry.ok,
          level: entry.level,
          model: entry.model ?? null,
          endpoint: entry.endpoint,
          durationMs: entry.durationMs,
        });
      })
      .then((unsub) => unsubs.push(unsub))
      .catch(() => undefined);
  }

  disposers.push(() => {
    for (const unsub of unsubs) {
      try {
        void unsub();
      } catch {
        // best-effort
      }
    }
  });
}

async function bootstrap(): Promise<void> {
  await waitForDocumentReady();
  await waitForHostReady();

  const hostApi = getHostApi();
  const stOk = await initStLayer();

  // dispatcher：注册全部工具（依赖缺失时调用即报错，而不是整个工具消失）
  const dispatcher = new Dispatcher();
  const inspect = createInspectHandlers({ hostApi, extVersion: EXTENSION_VERSION });
  const operate = createOperateHandlers({ hostApi });
  const debug = createDebugHandlers({ hostApi });
  const handlerMap = { ...inspect, ...operate, ...debug } as Record<string, unknown>;
  // 注册完整性：与协议契约比对，缺一个直接在控制台暴露
  for (const name of EXTENSION_TOOLS) {
    const handler = handlerMap[name];
    if (typeof handler !== 'function') {
      console.error(`[TT Agent Bridge] handler missing for protocol tool: ${name}`);
    }
    dispatcher.register(name, handler as never);
  }

  // settings + UI
  const settings = createSettingsStore();
  let connection: BridgeConnection | null = null;
  const ui: UiController = createUi({
    settings,
    onManualRestart: () => connection?.restart(),
  });
  disposers.push(() => ui.dispose());

  connection = new BridgeConnection({
    getPort: () => settings.state.port,
    getToken: () => settings.state.token,
    buildHello: () => ({
      ext: { version: EXTENSION_VERSION },
      host: { tools: dispatcher.registeredTools() },
    }),
    dispatcher,
    onStateChange: (state: ConnState, detail?: string) => {
      ui.setState(state, detail);
      if (state === 'connected') ui.log('bridge connected');
      connection?.sendEvent('extension_log', {
        level: 'info',
        message: `connection ${state}${detail ? `: ${detail}` : ''}`,
      });
    },
    onLog: (line) => ui.log(line),
  });

  // settings 变更 -> 连接生命周期
  const applySettings = () => {
    if (settings.state.enabled) {
      connection?.restart();
    } else {
      connection?.stop();
      ui.setState('disabled');
    }
  };
  settings.subscribe(applySettings);

  // 首次应用（enabled 默认 true；token 未配置时连上会被 bridge 拒绝，UI 显示 auth-failed 提示）
  applySettings();

  subscribeEvents(hostApi, (event, payload) => connection?.sendEvent(event, payload));

  ui.log(`extension v${EXTENSION_VERSION} loaded (st-context: ${stOk ? 'ok' : 'unavailable'})`);

  window.addEventListener('pagehide', dispose, { once: true });
}

function dispose(): void {
  for (const fn of disposers.splice(0)) {
    try {
      fn();
    } catch {
      // best-effort
    }
  }
}

void bootstrap().catch((err) => {
  console.error('[TT Agent Bridge] bootstrap failed:', err);
});
