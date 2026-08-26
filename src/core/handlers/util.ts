// 工具 handler 公共工具：参数读取、安全序列化、截断。

export class ToolError extends Error {}

export function argString(
  args: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean; def?: string },
): string {
  const v = args[key];
  if (v === undefined || v === null) {
    if (opts?.required) throw new ToolError(`missing required arg: ${key}`);
    return opts?.def ?? '';
  }
  if (typeof v !== 'string') throw new ToolError(`arg ${key} must be a string`);
  return v;
}

export function argNumber(
  args: Record<string, unknown>,
  key: string,
  opts?: { def?: number; min?: number; max?: number },
): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return opts?.def;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ToolError(`arg ${key} must be a number`);
  let clamped = n;
  if (opts?.min !== undefined) clamped = Math.max(opts.min, clamped);
  if (opts?.max !== undefined) clamped = Math.min(opts.max, clamped);
  return clamped;
}

export function argBool(
  args: Record<string, unknown>,
  key: string,
  def = false,
): boolean {
  const v = args[key];
  if (v === undefined || v === null) return def;
  return v === true || v === 'true';
}

/** 循环引用/BigInt/深嵌套安全的序列化，供 eval 结果等不可信结构使用 */
export function safeStringify(value: unknown, maxDepth = 6): string {
  const seen = new WeakSet<object>();
  let depth = 0;
  const walk = (v: unknown): unknown => {
    if (v === undefined) return undefined;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (typeof v === 'string') return v.length > 200_000 ? v.slice(0, 200_000) + '…[truncated]' : v;
    if (typeof v === 'function') return `[fn ${(v as { name?: string }).name || 'anonymous'}]`;
    if (typeof v === 'symbol') return v.toString();
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === 'object') {
      if (seen.has(v as object)) return '[Circular]';
      if (depth >= maxDepth) return '[MaxDepth]';
      seen.add(v as object);
      depth++;
      try {
        if (Array.isArray(v)) return v.slice(0, 1000).map(walk);
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[k] = walk(val);
        }
        return out;
      } finally {
        depth--;
      }
    }
    return String(v);
  };
  return JSON.stringify(walk(value), null, 2);
}

export function snippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `…[+${text.length - maxLen} chars]`;
}
