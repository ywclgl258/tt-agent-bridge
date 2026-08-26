// 调试类工具：宿主日志 / LLM 请求日志 / 主文档 eval。

import type { TauriTavernHostApi } from '../../host/api';
import { argBool, argNumber, argString, safeStringify, ToolError } from './util';

export interface DebugHandlerEnv {
  hostApi: TauriTavernHostApi | null;
}

export function createDebugHandlers(env: DebugHandlerEnv) {
  return {
    async tt_logs(args: Record<string, unknown>): Promise<unknown> {
      const kind = argString(args, 'kind', { def: 'frontend' });
      const limit = argNumber(args, 'limit', { def: 50, min: 1, max: 500 })!;
      const dev = env.hostApi?.dev;
      if (!dev) throw new ToolError('dev API unavailable on this host');

      if (kind === 'frontend') {
        if (!dev.frontendLogs) throw new ToolError('dev.frontendLogs unavailable');
        const entries = await dev.frontendLogs.list({ limit });
        return { kind, entries };
      }
      if (kind === 'backend') {
        if (!dev.backendLogs) throw new ToolError('dev.backendLogs unavailable');
        const entries = await dev.backendLogs.tail({ limit });
        return { kind, entries };
      }
      throw new ToolError(`unknown kind: ${kind} (use 'frontend' or 'backend')`);
    },

    async tt_llm_logs(args: Record<string, unknown>): Promise<unknown> {
      const dev = env.hostApi?.dev;
      if (!dev?.llmApiLogs) throw new ToolError('dev.llmApiLogs unavailable on this host');

      const id = argNumber(args, 'id');
      if (id !== undefined) {
        const raw = argBool(args, 'raw', false);
        if (raw) {
          return dev.llmApiLogs.getRaw(id);
        }
        return dev.llmApiLogs.getPreview(id);
      }

      const limit = argNumber(args, 'limit', { def: 20, min: 1, max: 200 })!;
      return dev.llmApiLogs.index({ limit });
    },

    async tt_eval(args: Record<string, unknown>): Promise<unknown> {
      const code = argString(args, 'code', { required: true });
      const fn = new Function(
        '"use strict";return (async () => {\n' + code + '\n})()',
      ) as () => Promise<unknown>;
      const value = await fn();
      if (value === undefined) return null;
      if (typeof value === 'string') return value;
      return JSON.parse(safeStringify(value));
    },
  };
}
