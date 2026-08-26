// TauriTavern 宿主 ABI —— 唯一允许接触 window.__TAURITAVERN__ 的地方。
// 类型裁剪自 TauriTavern-Creator-Extension 的公开 ABI，只保留本扩展用到的分区。

export type HostUnsubscribe = () => void | Promise<void>;

export interface FrontendLogEntry {
  id: number;
  timestampMs: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  target?: string;
}

export interface BackendLogEntry {
  id: number;
  timestampMs: number;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  target: string;
  message: string;
}

export interface LlmApiLogIndexEntry {
  id: number;
  timestampMs: number;
  level: 'INFO' | 'ERROR';
  ok: boolean;
  source: string;
  model?: string | null;
  endpoint: string;
  durationMs: number;
  stream: boolean;
}

export interface LlmApiLogPreview extends LlmApiLogIndexEntry {
  errorMessage: string | null;
  requestReadable: string;
  responseReadable: string;
  responseRawKind: 'json' | 'sse' | null;
}

export interface LlmApiLogRaw {
  id: number;
  requestRaw: string;
  responseRaw: string;
  responseRawKind: 'json' | 'sse' | null;
}

export interface WorldInfoActivationBatch {
  timestampMs: number;
  trigger: string;
  entries: WorldInfoActivationEntry[];
}

export interface WorldInfoActivationEntry {
  world: string;
  uid: string | number;
  displayName: string;
  constant: boolean;
  position?: string;
}

export interface TauriTavernHostApi {
  dev?: {
    frontendLogs?: {
      list: (options?: { limit?: number }) => Promise<FrontendLogEntry[]>;
      subscribe: (handler: (entry: FrontendLogEntry) => void) => Promise<HostUnsubscribe>;
    };
    backendLogs?: {
      tail: (options?: { limit?: number }) => Promise<BackendLogEntry[]>;
      subscribe: (handler: (entry: BackendLogEntry) => void) => Promise<HostUnsubscribe>;
    };
    llmApiLogs?: {
      index: (options?: { limit?: number }) => Promise<LlmApiLogIndexEntry[]>;
      getPreview: (id: number) => Promise<LlmApiLogPreview>;
      getRaw: (id: number) => Promise<LlmApiLogRaw>;
    };
  };
  worldInfo?: {
    getLastActivation: () => Promise<WorldInfoActivationBatch | null>;
    subscribeActivations: (
      handler: (batch: WorldInfoActivationBatch) => void,
    ) => Promise<HostUnsubscribe>;
    openEntry: (ref: { world: string; uid: string | number }) => Promise<{ opened: boolean }>;
  };
  chat?: {
    current: {
      ref: () => unknown;
    };
  };
}

declare global {
  interface Window {
    __TAURITAVERN__?: {
      ready?: Promise<void> | null;
      api?: TauriTavernHostApi;
    };
    __TAURITAVERN_MAIN_READY__?: Promise<void>;
  }
}

export function getHostApi(): TauriTavernHostApi | null {
  return window.__TAURITAVERN__?.api ?? null;
}

export async function waitForHostReady(): Promise<void> {
  const readyPromise = window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__;
  if (readyPromise) {
    await readyPromise;
  }
}

export function probeCapabilities(api: TauriTavernHostApi): string[] {
  const caps: string[] = ['st-context'];
  if (api.dev?.frontendLogs) caps.push('dev.frontendLogs');
  if (api.dev?.backendLogs) caps.push('dev.backendLogs');
  if (api.dev?.llmApiLogs) caps.push('dev.llmApiLogs');
  if (api.worldInfo) caps.push('worldInfo');
  if (api.chat) caps.push('chat');
  return caps;
}
