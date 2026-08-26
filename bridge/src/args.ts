// 共享启动参数：TTAB_PORT / TTAB_TOKEN 环境变量 + --port/--token 命令行覆盖。

import { randomBytes } from 'node:crypto';

export interface BridgeArgs {
  port: number;
  token: string;
}

export function parseBridgeArgs(): BridgeArgs {
  const argv = process.argv.slice(2);
  let port = Number(process.env.TTAB_PORT ?? 18789);
  let token = process.env.TTAB_TOKEN ?? '';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = Number(argv[i + 1]);
      i++;
    } else if (argv[i] === '--token' && argv[i + 1]) {
      token = argv[i + 1];
      i++;
    }
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
  if (!token) {
    token = randomBytes(24).toString('hex');
  }
  return { port, token };
}

export const stderrLog = (line: string): void => {
  process.stderr.write(`[tt-bridge] ${new Date().toISOString()} ${line}\n`);
};
