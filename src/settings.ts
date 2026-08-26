// 扩展设置：localStorage 持久化（同源、随 TT 数据目录走）。

export interface BridgeSettings {
  enabled: boolean;
  port: number;
  token: string;
}

const STORAGE_KEY = 'tt-agent-bridge.settings';

export const DEFAULT_SETTINGS: BridgeSettings = {
  enabled: true,
  port: 18789,
  token: '',
};

export interface SettingsStore {
  readonly state: BridgeSettings;
  update(patch: Partial<BridgeSettings>): void;
  subscribe(cb: (state: BridgeSettings) => void): () => void;
}

export function createSettingsStore(): SettingsStore {
  let state: BridgeSettings = load();

  function load(): BridgeSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<BridgeSettings>;
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
        port:
          typeof parsed.port === 'number' && parsed.port > 0 && parsed.port < 65536
            ? parsed.port
            : DEFAULT_SETTINGS.port,
        token: typeof parsed.token === 'string' ? parsed.token : '',
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  const listeners = new Set<(state: BridgeSettings) => void>();

  return {
    get state() {
      return state;
    },
    update(patch) {
      state = { ...state, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // 存储失败不阻断运行
      }
      for (const cb of listeners) cb(state);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
