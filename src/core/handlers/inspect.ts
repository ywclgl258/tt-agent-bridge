// 检测类工具：状态 / 消息 / 变量 / 角色卡 / 世界书激活 / MVU / 聊天搜索。

import { getStContext, stReady, type StChatMessage } from '../../host/st';
import type { TauriTavernHostApi } from '../../host/api';
import { probeCapabilities } from '../../host/api';
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

/** 楼层 -> iframe name 映射（TH-message--{floor}--{block}，同楼多代码块会有多个） */
function mapMessageIframes(): Record<number, string[]> {
  const byFloor: Record<number, string[]> = {};
  for (const f of document.querySelectorAll('iframe')) {
    const m = /^TH-message--(\d+)--\d+$/.exec(f.name || '');
    if (m) {
      const floor = Number(m[1]);
      (byFloor[floor] ??= []).push(f.name);
    }
  }
  return byFloor;
}

/** 取某层按 swipe_id 解析后的 variables（MVU 把 stat_data 放在 variables[swipe_id]） */
function resolveSwipeVariables(msg: StChatMessage): unknown {
  const vars = msg.variables;
  if (Array.isArray(vars)) {
    const swipe = typeof msg.swipe_id === 'number' ? msg.swipe_id : 0;
    return vars[swipe] ?? vars[vars.length - 1] ?? null;
  }
  return vars ?? null;
}

function mapMessage(
  msg: StChatMessage,
  index: number,
  maxLen: number,
  includeVariables: boolean,
  iframeMap?: Record<number, string[]>,
) {
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
  const frames = iframeMap?.[index];
  if (frames && frames.length > 0) {
    out.iframes = frames;
  }
  return out;
}

/** string[] 参数：接受数组或逗号分隔字符串 */
function argStringList(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  throw new ToolError(`arg ${key} must be a string array or comma-separated string`);
}

export function createInspectHandlers(env: HandlerEnv) {
  return {
    async tt_status(): Promise<unknown> {
      const base: Record<string, unknown> = {
        extension: { version: env.extVersion, stContext: stReady() },
        capabilities: env.hostApi
          ? probeCapabilities(env.hostApi)
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
      const iframeMap = mapMessageIframes();
      const slice = chat.slice(from, to);
      return {
        total: chat.length,
        from,
        to,
        messages: slice.map((m, i) =>
          mapMessage(m, from + i, maxLen, includeVariables, iframeMap),
        ),
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
          swipe_id: msg.swipe_id ?? 0,
          variables: resolveSwipeVariables(msg),
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
      const section = argString(args, 'section', { def: full ? 'full' : 'summary' });

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
        // 注意：上游 ST 的 characterId 是 number，TauriTavern 实测为数字字符串
        const id = Number(ctx.characterId);
        if (!Number.isInteger(id) || id < 0 || id >= characters.length || !characters[id]) {
          throw new ToolError('no active character (characterId is null or invalid)');
        }
        card = characters[id];
      }

      if (section === 'full') return card;

      if (section === 'regexes') {
        const data = card.data as { extensions?: { regex_scripts?: unknown } } | undefined;
        const legacy = card as { extension?: { regex_scripts?: unknown } };
        const regexes =
          data?.extensions?.regex_scripts ?? legacy.extension?.regex_scripts ?? null;
        if (!Array.isArray(regexes)) {
          return { section, count: 0, regexes: [], note: 'no embedded regex_scripts found' };
        }
        return {
          section,
          count: regexes.length,
          regexes: regexes.map((r) => {
            const re = r as Record<string, unknown>;
            const out = { ...re };
            if (typeof out.replaceString === 'string') {
              out.replaceString = snippet(out.replaceString, 4000);
            }
            return out;
          }),
        };
      }

      if (section === 'scripts') {
        const includeContent = argBool(args, 'includeContent', false);
        const th = (card.data as { extensions?: { tavern_helper?: { scripts?: unknown } } } | undefined)
          ?.extensions?.tavern_helper;
        const raw = th?.scripts ?? (th as { script_list?: unknown } | undefined)?.script_list;
        let scripts: [string, Record<string, unknown>][] = [];
        if (Array.isArray(raw)) {
          scripts = raw.map((s, i) => {
            const rec = s as Record<string, unknown>;
            return [String(rec.name ?? rec.id ?? `#${i}`), rec];
          });
        } else if (raw && typeof raw === 'object') {
          scripts = Object.entries(raw as Record<string, Record<string, unknown>>);
        }
        return {
          section,
          count: scripts.length,
          scripts: scripts.map(([key, s]) => {
            const out: Record<string, unknown> = {
              key,
              name: s.name ?? key,
              id: s.id ?? undefined,
              type: s.type ?? undefined,
              enabled: s.enabled ?? undefined,
            };
            if (typeof s.content === 'string') {
              out.contentLength = s.content.length;
              out.content = includeContent ? s.content : snippet(s.content, 400);
            }
            return out;
          }),
        };
      }

      if (section === 'character_book') {
        const book = (card.data as { character_book?: { entries?: unknown } } | undefined)
          ?.character_book ?? (card as { character_book?: { entries?: unknown } }).character_book;
        const rawEntries = book?.entries;
        if (!Array.isArray(rawEntries) && !(rawEntries && typeof rawEntries === 'object')) {
          return { section, count: 0, entries: [], note: 'no character_book found' };
        }
        const list: Array<[string | number, Record<string, unknown>]> = Array.isArray(rawEntries)
          ? rawEntries.map((e, i) => [i, (e ?? {}) as Record<string, unknown>])
          : Object.entries(rawEntries as Record<string, Record<string, unknown>>);
        return {
          section,
          count: list.length,
          entries: list.map(([i, e]) => ({
            index: i,
            comment: e.comment ?? e.name ?? null,
            keys: e.key ?? e.keys ?? [],
            secondaryKeys: e.secondary_keys ?? e.keysecondary ?? undefined,
            constant: e.constant ?? undefined,
            enabled: e.enabled ?? e.disable === false,
            position: e.position ?? undefined,
            order: e.order ?? e.insertion_order ?? undefined,
            contentPreview: typeof e.content === 'string' ? snippet(e.content, 200) : undefined,
          })),
        };
      }

      if (section !== 'summary') {
        throw new ToolError(
          `unknown section: ${section} (use summary | full | regexes | scripts | character_book)`,
        );
      }

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

    async tt_mvu_stat(args: Record<string, unknown>): Promise<unknown> {
      const ctx = getStContext();
      const chat = ctx.chat;
      if (!Array.isArray(chat)) throw new ToolError('context.chat is not an array');

      const floorsWithVariables: Array<{ index: number; swipe_id: number; statKeys: string[] }> =
        [];
      let latest: { index: number; swipe_id: number; stat_data: unknown } | null = null;
      let initvarFloor: number | null = null;

      for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || msg.variables === undefined) continue;
        const resolved = resolveSwipeVariables(msg) as
          | { stat_data?: unknown }
          | null;
        const stat = resolved && typeof resolved === 'object' ? resolved.stat_data : undefined;
        const statKeys =
          stat && typeof stat === 'object' && !Array.isArray(stat) ? Object.keys(stat) : [];
        floorsWithVariables.push({
          index: i,
          swipe_id: msg.swipe_id ?? 0,
          statKeys,
        });
        if (initvarFloor === null && statKeys.length > 0) initvarFloor = i;
        latest = { index: i, swipe_id: msg.swipe_id ?? 0, stat_data: stat ?? null };
      }

      // 最近一条 <UpdateVariable> 原文（从末尾向前扫，最多 scanFloors 层）
      const scanFloors = argNumber(args, 'scanFloors', { def: 30, min: 1, max: 500 })!;
      let lastUpdateVariable: { index: number; text: string } | null = null;
      const re = /<UpdateVariable\b[^>]*>([\s\S]*?)<\/UpdateVariable>/i;
      for (let i = chat.length - 1; i >= Math.max(0, chat.length - scanFloors); i--) {
        const mes = chat[i]?.mes;
        if (typeof mes !== 'string') continue;
        const m = re.exec(mes);
        if (m) {
          lastUpdateVariable = { index: i, text: snippet(m[0], 4000) };
          break;
        }
      }

      const latestStat = latest?.stat_data as Record<string, unknown> | null;
      const latestEmpty =
        latestStat && typeof latestStat === 'object' && Object.keys(latestStat).length === 0;

      return {
        totalFloors: chat.length,
        latest,
        latestStatEmpty: latestEmpty === true,
        initvarFloor,
        floorsWithVariables,
        lastUpdateVariable,
        hint:
          latestEmpty === true
            ? '最新楼层 stat_data 为空对象 {} —— truthy 但无数据；读合并表请在消息 iframe 内用 getAllVariables()'
            : undefined,
      };
    },

    async tt_search_chat(args: Record<string, unknown>): Promise<unknown> {
      const chat = env.hostApi?.chat?.current;
      if (!chat?.handle) throw new ToolError('chat handle API unavailable on this host');
      const query = argString(args, 'query', { required: true });
      const limit = argNumber(args, 'limit', { def: 20, min: 1, max: 200 });
      const role = argString(args, 'role', { def: '' });
      const handle = await chat.handle();
      const opts: Record<string, unknown> = { query };
      if (limit !== undefined) opts.limit = limit;
      if (role) opts.role = role;
      const hits = await handle.searchMessages(opts as never);
      return { query, hits };
    },

    async tt_find_message(args: Record<string, unknown>): Promise<unknown> {
      const chat = env.hostApi?.chat?.current;
      if (!chat?.handle) throw new ToolError('chat handle API unavailable on this host');
      const role = argString(args, 'role', { def: '' });
      const hasTopLevelKeys = argStringList(args, 'hasTopLevelKeys');
      const hasExtraKeys = argStringList(args, 'hasExtraKeys');
      const scanLimit = argNumber(args, 'scanLimit', { min: 1, max: 100_000 });
      const query: Record<string, unknown> = {};
      if (role) query.role = role;
      if (hasTopLevelKeys) query.hasTopLevelKeys = hasTopLevelKeys;
      if (hasExtraKeys) query.hasExtraKeys = hasExtraKeys;
      if (scanLimit !== undefined) query.scanLimit = scanLimit;
      const handle = await chat.handle();
      const found = await handle.locate.findLastMessage(query as never);
      return { found };
    },

    async tt_worldinfo_last(): Promise<unknown> {
      const worldInfo = env.hostApi?.worldInfo;
      if (!worldInfo) throw new ToolError('worldInfo API unavailable on this host');
      return worldInfo.getLastActivation();
    },
  };
}
