// 命令路由：bridge 下发的 call -> 本地 handler。

import { EXTENSION_TOOLS, type ExtensionToolName } from './protocol';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export class Dispatcher {
  private handlers = new Map<string, ToolHandler>();

  register(name: ExtensionToolName, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  registeredTools(): string[] {
    return [...this.handlers.keys()];
  }

  async handle(tool: string, args: Record<string, unknown>): Promise<DispatchResult> {
    const handler = this.handlers.get(tool);
    if (!handler) {
      const known = (this.handlers.size > 0 ? this.registeredTools() : [...EXTENSION_TOOLS]).join(', ');
      return { ok: false, error: `unknown tool: ${tool}. known: ${known}` };
    }
    try {
      const data = await handler(args ?? {});
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
