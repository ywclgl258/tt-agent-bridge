// 操作类工具：STScript / 发消息 / 写变量 / 切角色 / 打开世界书条目。全部走公开边界。

import type { TauriTavernHostApi } from '../../host/api';
import { execSlash, getStContext } from '../../host/st';
import { argBool, argString, ToolError } from './util';

/** STScript 里管道符是语法字符，用户文本需要转义 */
function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export interface OperateHandlerEnv {
  hostApi: TauriTavernHostApi | null;
}

export function createOperateHandlers(env: OperateHandlerEnv) {
  return {
    async tt_exec_stscript(args: Record<string, unknown>): Promise<unknown> {
      const command = argString(args, 'command', { required: true });
      const result = await execSlash(command);
      if (result.isError) {
        throw new ToolError(`STScript error: ${result.errorMessage ?? 'unknown'}`);
      }
      return { pipe: result.pipe ?? null };
    },

    async tt_send_message(args: Record<string, unknown>): Promise<unknown> {
      const text = argString(args, 'text', { required: true });
      const trigger = argBool(args, 'trigger', true);
      const silent = argBool(args, 'silent', false);

      if (silent || !trigger) {
        await execSlash(`/send ${escapePipe(text)}`);
        return { sent: true, triggered: false };
      }

      const result = await execSlash(`/send ${escapePipe(text)} | /trigger`);
      if (result.isError) {
        throw new ToolError(`send failed: ${result.errorMessage ?? 'unknown'}`);
      }
      return { sent: true, triggered: true };
    },

    async tt_set_variables(args: Record<string, unknown>): Promise<unknown> {
      const scope = argString(args, 'scope', { def: 'chat' });
      const values = args.values;
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new ToolError('arg values must be an object of key->value');
      }
      const entries = Object.entries(values as Record<string, unknown>);
      if (entries.length === 0) throw new ToolError('values is empty');

      if (scope === 'chat') {
        // chat 级：直接写 chatMetadata.variables（公开边界），saveChat 落盘
        const ctx = getStContext();
        const meta = (ctx.chatMetadata ??= {});
        const vars = ((meta.variables as Record<string, unknown>) ??= {});
        Object.assign(vars, values);
        if (typeof ctx.saveChat === 'function') {
          await ctx.saveChat();
        }
        return { scope, written: entries.map(([k]) => k), persisted: true };
      }

      if (scope === 'global') {
        for (const [key, value] of entries) {
          const encoded = typeof value === 'string' ? value : JSON.stringify(value);
          const result = await execSlash(
            `/setvar scope=global key=${JSON.stringify(key)} ${escapePipe(encoded)}`,
          );
          if (result.isError) {
            throw new ToolError(`setvar failed for ${key}: ${result.errorMessage ?? 'unknown'}`);
          }
        }
        return { scope, written: entries.map(([k]) => k) };
      }

      throw new ToolError(`unknown scope: ${scope} (use 'chat' or 'global')`);
    },

    async tt_switch_character(args: Record<string, unknown>): Promise<unknown> {
      const name = argString(args, 'name', { required: true });
      const result = await execSlash(`/go ${escapePipe(name)}`);
      if (result.isError) {
        throw new ToolError(
          `switch failed: ${result.errorMessage ?? 'unknown'} (check exact character name)`,
        );
      }
      return { switched: true };
    },

    async tt_worldinfo_open(args: Record<string, unknown>): Promise<unknown> {
      const worldInfo = env.hostApi?.worldInfo;
      if (!worldInfo?.openEntry) {
        throw new ToolError('worldInfo.openEntry unavailable on this host');
      }
      const world = argString(args, 'world', { required: true });
      const rawUid = args.uid;
      let uid: string | number;
      if (typeof rawUid === 'number') uid = rawUid;
      else if (typeof rawUid === 'string' && rawUid !== '') uid = rawUid;
      else throw new ToolError('missing required arg: uid (number or string)');
      const r = await worldInfo.openEntry({ world, uid });
      return { opened: r.opened === true, world, uid };
    },
  };
}
