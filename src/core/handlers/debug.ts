// 调试类工具：宿主日志 / LLM 请求日志 / 主文档与 iframe 内 eval / iframe 清单 / console 捕获。

import type { TauriTavernHostApi } from '../../host/api';
import { argBool, argNumber, argString, safeStringify, ToolError } from './util';

export interface DebugHandlerEnv {
  hostApi: TauriTavernHostApi | null;
}

export interface IframeInfo {
  name: string;
  kind: 'message' | 'script' | 'other';
  sameOrigin: boolean;
  scripts: number | null;
  bodyHtmlLength: number | null;
  domNodes: number | null;
  hasVue: boolean | null;
  visible: boolean;
  width: number;
  height: number;
}

function classifyFrame(name: string): IframeInfo['kind'] {
  if (name.startsWith('TH-message--')) return 'message';
  if (name.startsWith('TH-script--')) return 'script';
  return 'other';
}

function probeFrame(frame: HTMLIFrameElement): IframeInfo {
  const name = frame.name || '';
  const info: IframeInfo = {
    name,
    kind: classifyFrame(name),
    sameOrigin: false,
    scripts: null,
    bodyHtmlLength: null,
    domNodes: null,
    hasVue: null,
    visible: frame.offsetParent !== null || frame.offsetWidth > 0 || frame.offsetHeight > 0,
    width: frame.offsetWidth,
    height: frame.offsetHeight,
  };
  try {
    const doc = frame.contentDocument;
    if (!doc) return info; // 跨域或未加载
    info.sameOrigin = true;
    info.scripts = doc.querySelectorAll('script').length;
    info.bodyHtmlLength = doc.body ? doc.body.innerHTML.length : 0;
    info.domNodes = doc.querySelectorAll('*').length;
    const win = frame.contentWindow as (Window & { Vue?: unknown }) | null;
    info.hasVue = win ? typeof win.Vue !== 'undefined' : false;
  } catch {
    // contentDocument 访问抛异常 = 跨域
  }
  return info;
}

/** 按精确 name 找 iframe；找不到时把可用清单放进错误信息，便于 agent 自助纠正 */
function resolveFrame(name: string): HTMLIFrameElement {
  const frames = [...document.querySelectorAll('iframe')];
  const hit = frames.find((f) => f.name === name);
  if (hit) return hit;
  const available = frames
    .map((f) => f.name || '(anonymous)')
    .slice(0, 30)
    .join(', ');
  throw new ToolError(`iframe not found: ${name}. available: ${available || '(none)'}`);
}

/** 在指定 realm 内构造 async 函数执行代码；frame 为空 = 主文档 */
function evalInRealm(code: string, frameName: string): Promise<unknown> {
  let target: Window & typeof globalThis;
  if (frameName) {
    const frame = resolveFrame(frameName);
    const win = frame.contentWindow as (Window & typeof globalThis) | null;
    if (!win) throw new ToolError(`iframe has no contentWindow: ${frameName}`);
    target = win;
  } else {
    target = window;
  }
  // 跨域 iframe 访问其 Function 构造器会抛 SecurityError
  let make: (body: string) => () => Promise<unknown>;
  try {
    make = (
      target as unknown as { Function: (body: string) => () => Promise<unknown> }
    ).Function.bind(target);
  } catch (err) {
    throw new ToolError(
      `cannot execute in frame ${frameName}: likely cross-origin (${String(err).slice(0, 80)})`,
    );
  }
  const fn = make('"use strict";return (async () => {\n' + code + '\n})()');
  return fn();
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

    async tt_llm_keep(args: Record<string, unknown>): Promise<unknown> {
      const llm = env.hostApi?.dev?.llmApiLogs;
      if (!llm?.getKeep) throw new ToolError('dev.llmApiLogs.getKeep unavailable on this host');
      const before = await llm.getKeep();
      const keep = argNumber(args, 'keep', { min: 1, max: 10_000 });
      if (keep !== undefined) {
        if (!llm.setKeep) throw new ToolError('dev.llmApiLogs.setKeep unavailable on this host');
        await llm.setKeep(keep);
      }
      const after = await llm.getKeep();
      return { before, after, keep: after };
    },

    async tt_console_capture(args: Record<string, unknown>): Promise<unknown> {
      const fl = env.hostApi?.dev?.frontendLogs;
      if (!fl?.getConsoleCaptureEnabled || !fl.setConsoleCaptureEnabled) {
        throw new ToolError('dev.frontendLogs console capture API unavailable on this host');
      }
      const before = await fl.getConsoleCaptureEnabled();
      if (args.enabled !== undefined) {
        await fl.setConsoleCaptureEnabled(argBool(args, 'enabled', before));
      }
      const after = await fl.getConsoleCaptureEnabled();
      return { before, enabled: after };
    },

    async tt_iframes(): Promise<unknown> {
      const frames = [...document.querySelectorAll('iframe')];
      const iframes = frames.map((f) => probeFrame(f));
      // 楼层 -> iframe name 映射（TH-message--{floor}--{block}）
      const byFloor: Record<string, string[]> = {};
      for (const info of iframes) {
        const m = /^TH-message--(\d+)--\d+$/.exec(info.name);
        if (m) {
          (byFloor[m[1]] ??= []).push(info.name);
        }
      }
      return { count: iframes.length, iframes, messageIframesByFloor: byFloor };
    },

    async tt_eval(args: Record<string, unknown>): Promise<unknown> {
      const code = argString(args, 'code', { required: true });
      const frame = argString(args, 'frame', { def: '' });
      const value = await evalInRealm(code, frame);
      if (value === undefined) return null;
      if (typeof value === 'string') return value;
      return JSON.parse(safeStringify(value));
    },
  };
}
