// MCP 端到端冒烟：以 stdio client 身份调 bridge 的工具，验证全链路。
// （bind-or-attach：端口上已有 daemon 时自动 attach，不再 EADDRINUSE。）
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(bridgeRoot, 'node_modules/tsx/dist/cli.mjs'), resolve(bridgeRoot, 'src/index.ts')],
  cwd: bridgeRoot,
  env: { ...process.env, TTAB_PORT: '18789', TTAB_TOKEN: 'ttab-local-dev-001' },
});

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

// 等扩展重连上来（backoff 最长 15s）
for (let i = 0; i < 20; i++) {
  const r = await client.callTool({ name: 'tt_bridge_status', arguments: {} });
  const status = JSON.parse((r.content || []).map((c) => c.text).join('\n'));
  if (status.extConnected) break;
  await new Promise((r) => setTimeout(r, 1500));
}

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content || []).map((c) => c.text).join('\n');
  console.log(`\n===== ${name} =====`);
  console.log(text.slice(0, 1500));
}

await call('tt_bridge_status');
await call('tt_status');
await call('tt_read_messages', { from: 0, to: 3 });
await call('tt_get_variables', { floor: 'latest' });
await call('tt_iframes');
await call('tt_eval', { code: 'return { hasMvu: !!(window.parent), iframes: document.querySelectorAll(\'iframe\').length, title: document.title };' });

await client.close();
process.exit(0);
