// TT Agent Bridge server 入口：WS hub (127.0.0.1) + MCP stdio。
// bind-or-attach：端口上已有同 token 的存活 hub（如 daemon）时作为 agent 挂上去，
// 否则自己 bind。stdout 是 MCP 通道，一切日志走 stderr。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExtensionHub, type HubLike } from './hub.js';
import { tryAttach } from './attach.js';
import { buildMcpServer } from './mcp.js';
import { parseBridgeArgs, stderrLog } from './args.js';

async function main(): Promise<void> {
  const { port, token } = parseBridgeArgs();

  // 先探测是否已有 hub（daemon 或另一个 MCP 实例）
  const attach = await tryAttach(port, token, { agentName: 'mcp-stdio', log: stderrLog });

  let hub: HubLike;

  if (attach.ok) {
    hub = attach.client;
    stderrLog(`running in attached mode (hub shared, token file untouched)`);
  } else if (attach.reason === 'token-rejected') {
    throw new Error(
      `port ${port} is occupied by a bridge hub with a DIFFERENT token. ` +
        `Stop it or pass its token via TTAB_TOKEN/--token.`,
    );
  } else if (attach.reason === 'protocol-mismatch') {
    throw new Error(
      `port ${port} is occupied by a bridge hub with an incompatible protocol version. ` +
        `Stop the old hub first.`,
    );
  } else {
    // 无监听 / 超时：自己 bind
    const owned = new ExtensionHub(port, token, stderrLog);
    await owned.listen();

    // token 落盘，方便脚本/agent 读取后填入扩展设置
    const tokenFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../.bridge-token');
    try {
      mkdirSync(dirname(tokenFile), { recursive: true });
      writeFileSync(tokenFile, token, { encoding: 'utf-8' });
    } catch (err) {
      stderrLog(`warn: cannot persist token file: ${String(err)}`);
    }

    stderrLog(`WS hub listening on ws://127.0.0.1:${port}/bridge`);
    stderrLog(`token: ${token}`);
    hub = owned;
  }

  const server = buildMcpServer(hub);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  stderrLog('MCP server ready on stdio');

  const shutdown = () => {
    stderrLog('shutting down');
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
