// SillyTavern 兼容层 —— 通过公开边界获取 getContext()。
// 优先 window.SillyTavern.getContext()，兜底动态 import('/scripts/extensions.js')。

export interface SlashCommandResult {
  isError?: boolean;
  errorMessage?: string;
  pipe?: unknown;
}

export interface StEventSource {
  on: (type: string, cb: (data: unknown) => void) => void;
  off?: (type: string, cb: (data: unknown) => void) => void;
}

export interface StChatMessage {
  name: string;
  is_user: boolean;
  is_system: boolean;
  mes: string;
  swipe_id?: number;
  swipes?: string[];
  variables?: unknown;
  extra?: Record<string, unknown>;
  send_date?: string;
  [key: string]: unknown;
}

export interface StContext {
  chat: StChatMessage[];
  characters?: Record<string, unknown>[];
  characterId?: number | null;
  groupId?: number | null;
  name1?: string;
  name2?: string;
  chatMetadata?: Record<string, unknown>;
  chatId?: string | null;
  eventSource?: StEventSource;
  executeSlashCommandsWithOptions?: (
    command: string,
    ...rest: unknown[]
  ) => Promise<SlashCommandResult>;
  saveChat?: (...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

let getContextFn: (() => StContext) | null = null;
let execFallback: ((command: string) => Promise<SlashCommandResult>) | null = null;

export function stReady(): boolean {
  return getContextFn !== null;
}

export function getStContext(): StContext {
  if (!getContextFn) {
    throw new Error('st-context unavailable: getContext() not resolved');
  }
  return getContextFn();
}

export async function initStLayer(): Promise<boolean> {
  const w = window as unknown as {
    SillyTavern?: { getContext?: () => unknown };
  };

  if (typeof w.SillyTavern?.getContext === 'function') {
    getContextFn = w.SillyTavern.getContext as () => StContext;
  } else {
    try {
      const url = '/scripts/extensions.js';
      const mod = (await import(/* @vite-ignore */ url)) as {
        getContext?: () => unknown;
      };
      if (typeof mod.getContext === 'function') {
        getContextFn = mod.getContext as () => StContext;
      }
    } catch {
      // extensions.js 不可用，保持未就绪
    }
  }

  if (getContextFn) {
    const probe = getContextFn();
    if (typeof probe.executeSlashCommandsWithOptions !== 'function') {
      try {
        const url = '/scripts/slash-commands.js';
        const mod = (await import(/* @vite-ignore */ url)) as {
          SlashCommandParser?: {
            commands?: {
              parse?: (command: string, ...rest: unknown[]) => Promise<SlashCommandResult>;
            };
          };
        };
        const parse = mod.SlashCommandParser?.commands?.parse;
        if (typeof parse === 'function') {
          execFallback = (command) => parse(command);
        }
      } catch {
        // 无兜底
      }
    }
  }

  return getContextFn !== null;
}

export async function execSlash(command: string): Promise<SlashCommandResult> {
  if (execFallback) {
    return execFallback(command);
  }
  const ctx = getStContext();
  if (typeof ctx.executeSlashCommandsWithOptions !== 'function') {
    throw new Error('no slash command executor available');
  }
  return ctx.executeSlashCommandsWithOptions(command);
}

/** 上游事件名常量（字符串值长期稳定） */
export const ST_EVENTS = {
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',
} as const;
