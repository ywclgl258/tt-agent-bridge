// v0.3.0 回归套件：node regress.mjs
// 覆盖：daemon bind → agent attach → 双 agent 并存 → MCP server attach（不撞端口）→
//       MCP 工具清单（21 个全注册）→ 本地工具 → （扩展在线时）全部转发工具形状断言。
// 扩展不在线的项标记 SKIP，最后汇总 PASS/FAIL/SKIP。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectAgent, killTree } from './lib/agent.mjs';

const BRIDGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TTAB_PORT ?? 18789);
const TOKEN = process.env.TTAB_TOKEN ?? 'ttab-local-dev-001';

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, mode = 'assert', detail = '') => {
  if (mode === 'skip') { skip++; console.log(`SKIP - ${name}${detail ? ' (' + detail + ')' : ''}`); return; }
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ' (' + detail + ')' : ''}`);
  ok ? pass++ : fail++;
};

// ---- 1. daemon 生命周期 ----
const daemon = spawn(
  process.execPath,
  [resolve(BRIDGE_ROOT, 'node_modules/tsx/dist/cli.mjs'), resolve(BRIDGE_ROOT, 'src/daemon.ts')],
  { cwd: BRIDGE_ROOT, env: { ...process.env, TTAB_PORT: String(PORT), TTAB_TOKEN: TOKEN }, stdio: ['ignore', 'inherit', 'inherit'] },
);
await new Promise((r) => setTimeout(r, 3500));
check('daemon alive after 3.5s', daemon.exitCode === null, 'assert', `exitCode=${daemon.exitCode}`);

// ---- 2. agent attach（直连） ----
const a1 = await connectAgent({ spawn: false }).catch((e) => ({ err: e.message }));
check('agent #1 attach to daemon', !a1.err, 'assert', a1.err ?? '');
if (a1.err) { daemon.kill(); process.exit(1); }

// ---- 3. 双 agent 并存 ----
const a2 = await connectAgent({ spawn: false }).catch((e) => ({ err: e.message }));
check('agent #2 attach alongside #1', !a2.err, 'assert', a2.err ?? '');

// ---- 4. 扩展在线检测（决定转发类工具是测还是跳过） ----
const extOnline = await a1.waitExtension();
console.log(`# extension online: ${extOnline}`);

// ---- 5. MCP server attach 到 daemon（旧版这里会 EADDRINUSE 即死） ----
const mcp = new Client({ name: 'regress', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(BRIDGE_ROOT, 'node_modules/tsx/dist/cli.mjs'), resolve(BRIDGE_ROOT, 'src/index.ts')],
  cwd: BRIDGE_ROOT,
  env: { ...process.env, TTAB_PORT: String(PORT), TTAB_TOKEN: TOKEN },
});
let mcpOk = true;
try {
  await mcp.connect(transport);
} catch (err) {
  mcpOk = false;
}
check('MCP stdio server attach mode (no EADDRINUSE)', mcpOk);

async function mcall(name, args = {}) {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content || []).map((c) => c.text).join('\n');
  try { return JSON.parse(text); } catch { return text; }
}

if (mcpOk) {
  // ---- 6. MCP 工具清单穷尽 ----
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = [
    'tt_bridge_status', 'tt_console_capture', 'tt_eval', 'tt_exec_stscript', 'tt_find_message',
    'tt_get_character', 'tt_get_variables', 'tt_iframes', 'tt_llm_keep', 'tt_llm_logs',
    'tt_logs', 'tt_mvu_stat', 'tt_poll_events', 'tt_read_messages', 'tt_search_chat',
    'tt_send_message', 'tt_set_variables', 'tt_status', 'tt_switch_character',
    'tt_worldinfo_last', 'tt_worldinfo_open',
  ].sort();
  check('MCP 注册工具 = 21 且与协议清单一致', JSON.stringify(names) === JSON.stringify(expected),
    'assert', `got ${names.length}: ${names.join(',')}`);

  // ---- 7. 本地工具（不依赖扩展） ----
  const st = await mcall('tt_bridge_status');
  check('tt_bridge_status mode=attached', st.mode === 'attached', 'assert', JSON.stringify(st).slice(0, 120));
  const ev = await mcall('tt_poll_events');
  check('tt_poll_events 形状', typeof ev.lastSeq === 'number' && Array.isArray(ev.events));

  // ---- 8. 转发类工具（依赖扩展在线） ----
  if (extOnline) {
    const status = await mcall('tt_status');
    check('tt_status 扩展版本 0.3.0', status?.extension?.version === '0.3.0',
      'assert', `got ${status?.extension?.version}`);
    check('tt_status 能力含 dev.frontendLogs', (status?.capabilities ?? []).includes('dev.frontendLogs'));

    const frames = await mcall('tt_iframes');
    const msgFrames = (frames?.iframes ?? []).filter((f) => f.kind === 'message');
    check('tt_iframes 列出消息 iframe 且带楼层映射',
      Array.isArray(frames?.iframes) && frames.iframes.length > 0 && !!frames.messageIframesByFloor,
      'assert', `count=${frames?.count}, message=${msgFrames.length}`);
    const sameOriginMsg = msgFrames.find((f) => f.sameOrigin);

    if (sameOriginMsg) {
      const probe = await mcall('tt_eval', {
        frame: sameOriginMsg.name,
        code: 'return { hasGetAllVariables: typeof getAllVariables === "function" };',
      });
      check('tt_eval frame= 在 iframe realm 内执行', probe?.hasGetAllVariables === true,
        'assert', JSON.stringify(probe).slice(0, 100));
    } else {
      check('tt_eval frame= 在 iframe realm 内执行', false, 'skip', '无同源消息 iframe');
    }

    const vars = await mcall('tt_get_variables', { floor: 'latest' });
    check('tt_get_variables 返回 swipe_id 字段', vars && typeof vars === 'object' && 'swipe_id' in vars,
      'assert', JSON.stringify(vars).slice(0, 100));

    const mvu = await mcall('tt_mvu_stat');
    check('tt_mvu_stat 形状', typeof mvu?.totalFloors === 'number' && Array.isArray(mvu?.floorsWithVariables),
      'assert', JSON.stringify(mvu).slice(0, 100));

    const card = await mcall('tt_get_character', { section: 'summary' });
    check('tt_get_character section=summary 带键名清单', Array.isArray(card?.all_keys));

    const cap = await mcall('tt_console_capture');
    check('tt_console_capture 只读形状', typeof cap?.enabled === 'boolean' && typeof cap?.before === 'boolean',
      'assert', JSON.stringify(cap).slice(0, 80));

    const keep = await mcall('tt_llm_keep');
    check('tt_llm_keep 只读形状', typeof keep?.keep === 'number', 'assert', JSON.stringify(keep).slice(0, 80));

    for (const t of ['tt_search_chat', 'tt_find_message']) {
      try {
        if (t === 'tt_search_chat') {
          const r = await mcp.callTool({ name: t, arguments: { query: '的' } });
          check('tt_search_chat 可调用', !r.isError, 'assert', '');
        } else {
          const r = await mcp.callTool({ name: t, arguments: {} });
          check('tt_find_message 可调用', !r.isError, 'assert', '');
        }
      } catch (err) {
        check(`${t} 可调用`, false, 'assert', err.message.slice(0, 100));
      }
    }
  } else {
    for (const t of ['tt_status 扩展版本 0.3.0', 'tt_iframes', 'tt_eval frame=', 'tt_get_variables swipe 字段',
      'tt_mvu_stat', 'tt_get_character section', 'tt_console_capture', 'tt_llm_keep', 'tt_search_chat', 'tt_find_message']) {
      check(t, false, 'skip', '扩展未连接（TT 内仍是旧版扩展？）');
    }
  }

  await mcp.close();
} else {
  for (const t of ['MCP 工具清单', 'tt_bridge_status attached', 'tt_poll_events']) check(t, false, 'skip', 'MCP attach 失败');
}

// ---- 9. 双 agent 并发调用 ----
if (!a2.err) {
  const [r1, r2] = await Promise.allSettled([
    a1.call('tt_status'),
    a2.call('tt_status'),
  ]);
  const bothOk = extOnline ? r1.status === 'fulfilled' && r2.status === 'fulfilled' : true;
  check('双 agent 并发调用', bothOk, extOnline ? 'assert' : 'skip',
    extOnline ? `${r1.status}/${r2.status}` : '扩展未连接');
  await a2.close();
}

// ---- 收尾 ----
await a1.close();
killTree(daemon);
await new Promise((r) => setTimeout(r, 1500));
console.log(`\n=== regress: PASS=${pass} FAIL=${fail} SKIP=${skip} ===`);
process.exit(fail > 0 ? 1 : 0);
