// 检测类工具：状态 / 消息 / 变量 / 角色卡 / 世界书激活。

import { getStContext, stReady, type StChatMessage } from '../../host/st';
import type { TauriTavernHostApi } from '../../host/api';
import { argBool, argNumber, argString, snippet, ToolError } from './util';

export interface HandlerEnv {
  hostApi: TauriTavernHostApi | null;
  extVersion: string;
}

const CHARACTER_SUMMARY_FIELDS = [
  'name',
  'avatar',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'tags',
  'creator',
  'character_version',
  'talkativeness',
  'favorites',
];

function mapMessage(msg: StChatMessage, index: number, maxLen: number, includeVariables: boolean) {
  const out: Record<string, unknown> = {
    index,
    name: msg.name,
    is_user: msg.is_user,
    is_system: msg.is_system,
    mes: snippet(String(msg.mes ?? ''), maxLen),
    swipe_id: msg.swipe_id,
    swipe_count: Array.isArray(msg.swipes) ? msg.swipes.length : undefined,
    send_date: msg.send_date,
  };
  if (includeVariables && msg.variables !== undefined) {
    out.variables = msg.variables;
  }
  if (msg.extra && Object.keys(msg.extra).length > 0) {
    out.extra_keys = Object.keys(msg.extra);
  }
  return out;
}

export function createInspectHandlers(env: HandlerEnv) {
  return {
    async tt_status(): Promise<unknown> {
      const base: Record<string, unknown> = {
        extension: { version: env.extVersion, stContext: stReady() },
        capabilities: env.hostApi
          ? [
              'st-context',
              ...(env.hostApi.dev?.frontendLogs ? ['dev.frontendLogs'] : []),
              ...(env.hostApi.dev?.backendLogs ? ['dev.backendLogs'] : []),
              ...(env.hostApi.dev?.llmApiLogs ? ['dev.llmApiLogs'] : []),
              ...(env.hostApi.worldInfo ? ['worldInfo'] : []),
              ...(env.hostApi.chat ? ['chat'] : []),
            ]
          : ['st-context'],
      };
      if (stReady()) {
        const ctx = getStContext();
        base.chat = {
          length: Array.isArray(ctx.chat) ? ctx.chat.length : null,
          chatId: ctx.chatId ?? null,
          chatMetadataKeys: ctx.chatMetadata ? Object.keys(ctx.chatMetadata) : [],
        };
        base.character = {
          name: ctx.name2 ?? null,
          userName: ctx.name1 ?? null,
          characterId: ctx.characterId ?? null,
          groupId: ctx.groupId ?? null,
        };
      }
      return base;
    },

    async tt_read_messages(args: Record<string, unknown>): Promise<unknown> {
      const ctx = getStContext();
      const chat = ctx.chat;
      if (!Array.isArray(chat)) throw new ToolError('context.chat is not an array');
      const from = argNumber(args, 'from', { min: 0 }) ?? 0;
      const to = argNumber(args, 'to', { min: from, max: chat.length }) ?? chat.length;
      const maxLen = argNumber(args, 'maxMessageLength', { def: 2000, min: 100, max: 200_000 })!;
      const includeVariables = argBool(args, 'includeVariables', false);
      const slice = chat.slice(from, to);
      return {
        total: chat.length,
        from,
        to,
        messages: slice.map((m, i) => mapMessage(m, from + i, maxLen, includeVariables)),
      };
    },

    async tt_get_variables(args: Record<string, unknown>): Promise<unknown> {
      const ctx = getStContext();
      const floor = argString(args, 'floor', { def: '' });
      if (floor !== '') {
        const chat = ctx.chat;
        if (!Array.isArray(chat)) throw new ToolError('context.chat is not an array');
        let msg: StChatMessage | undefined;
        let index: number;
        if (floor === 'latest') {
          msg = chat[chat.length - 1];
          index = chat.length - 1;
        } else {
          const idx = Number(floor);
          if (!Number.isInteger(idx) || idx < 0 || idx >= chat.length) {
            throw new ToolError(`floor index out of range: ${floor} (chat length ${chat.length})`);
          }
          msg = chat[idx];
          index = idx;
        }
        if (!msg) throw new ToolError('chat is empty');
        return {
          index,
          swipe_id: msg.swipe_id,
          variables: msg.variables ?? null,
        };
      }
      return {
        chatMetadata: ctx.chatMetadata?.variables ?? null,
      };
    },

    async tt_get_character(args: Record<string, unknown>): Promise<unknown> {
      const ctx = getStContext();
      const characters = ctx.characters;
      if (!Array.isArray(characters)) throw new ToolError('context.characters is not available');
      const name = argString(args, 'name', { def: '' });
      const full = argBool(args, 'full', false);

      let card: Record<string, unknown> | undefined;
      if (name) {
        card = characters.find(
          (c) => String(c.name ?? '') === name || String(c.avatar ?? '') === name,
        );
        if (!card) {
          const names = characters.map((c) => String(c.name ?? c.avatar ?? '?'));
          throw new ToolError(`character not found: ${name}. available: ${names.join(', ')}`);
        }
      } else {
        const id = ctx.characterId;
        if (typeof id !== 'number' || !characters[id]) {
          throw new ToolError('no active character (characterId is null or invalid)');
        }
        card = characters[id];
      }

      if (full) return card;

      const summary: Record<string, unknown> = {};
      for (const key of CHARACTER_SUMMARY_FIELDS) {
        const v = card[key];
        if (typeof v === 'string') {
          summary[key] = snippet(v, 400);
        } else if (v !== undefined) {
          summary[key] = v;
        }
      }
      summary.all_keys = Object.keys(card);
      const data = card.data as Record<string, unknown> | undefined;
      if (data && typeof data === 'object') {
        summary.data_keys = Object.keys(data);
        const extensions = data.extensions as Record<string, unknown> | undefined;
        if (extensions && typeof extensions === 'object') {
          summary.extension_keys = Object.keys(extensions);
        }
      }
      return summary;
    },

    async tt_worldinfo_last(): Promise<unknown> {
      const worldInfo = env.hostApi?.worldInfo;
      if (!worldInfo) throw new ToolError('worldInfo API unavailable on this host');
      return worldInfo.getLastActivation();
    },
  };
}
