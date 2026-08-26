// 常驻 daemon：只跑 WS hub（无 MCP stdio）。
// 用途：扩展保持长连接，dev 脚本 / MCP server 以 agent 身份即时挂载，
// 消灭每次脚本运行时的扩展重连等待与端口冲突。
//   npm run daemon [-- --port 18789 --token <token>]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtensionHub } from './hub.js';
import { parseBridgeArgs, stderrLog } from './args.js';

async function main(): Promise<void> {
  const { port, token } = parseBridgeArgs();

  const hub = new ExtensionHub(port, token, stderrLog);
  await hub.listen();

  const tokenFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../.bridge-token');
  try {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, token, { encoding: 'utf-8' });
  } catch (err) {
    stderrLog(`warn: cannot persist token file: ${String(err)}`);
  }

  stderrLog(`daemon hub listening on ws://127.0.0.1:${port}/bridge`);
  stderrLog(`token: ${token}`);
  stderrLog('waiting for extension + agents (Ctrl+C to stop)');

  const shutdown = () => {
    stderrLog('daemon shutting down');
    hub.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  stderrLog(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
