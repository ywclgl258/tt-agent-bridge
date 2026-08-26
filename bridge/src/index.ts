// TT Agent Bridge server 入口：WS hub (127.0.0.1) + MCP stdio。
// stdout 是 MCP 通道，一切日志走 stderr。

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExtensionHub } from './hub.js';
import { buildMcpServer } from './mcp.js';

const log = (line: string) => {
  process.stderr.write(`[tt-bridge] ${new Date().toISOString()} ${line}\n`);
};

function parseArgs(): { port: number; token: string } {
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

async function main(): Promise<void> {
  const { port, token } = parseArgs();

  // token 落盘，方便脚本/agent 读取后填入扩展设置
  const tokenFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../.bridge-token');
  try {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, token, { encoding: 'utf-8' });
  } catch (err) {
    log(`warn: cannot persist token file: ${String(err)}`);
  }

  const hub = new ExtensionHub(port, token, log);
  await hub.listen();
  log(`WS hub listening on ws://127.0.0.1:${port}/bridge`);
  log(`token: ${token}`);

  const server = buildMcpServer(hub);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server ready on stdio');

  const shutdown = () => {
    log('shutting down');
    hub.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
