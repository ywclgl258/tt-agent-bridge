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
  send: (event: 'message_added' | 'worldinfo_activation' | 'log_error', payload: unknown) => void,
): void {
  const unsubs: HostUnsubscribe[] = [];

  if (stReady()) {
    const eventSource = getStContext().eventSource;
    if (eventSource) {
      const onMessage = (message: unknown) => {
        const chat = getStContext().chat;
        const index = Array.isArray(chat) ? chat.length - 1 : null;
        const name =
          message && typeof message === 'object' && 'name' in message
            ? String((message as { name?: unknown }).name ?? '')
            : '';
        const mes =
          message && typeof message === 'object' && 'mes' in message
            ? snippet((message as { mes?: unknown }).mes)
            : '';
        send('message_added', { index, name, snippet: mes });
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
        if (entry.level === 'error') send('log_error', entry);
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
  const operate = createOperateHandlers();
  const debug = createDebugHandlers({ hostApi });
  for (const [name, handler] of Object.entries({ ...inspect, ...operate, ...debug })) {
    dispatcher.register(name as never, handler as never);
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
      host: { capabilities: dispatcher.registeredTools() },
    }),
    dispatcher,
    onStateChange: (state: ConnState, detail?: string) => {
      ui.setState(state, detail);
      if (state === 'connected') ui.log('bridge connected');
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
