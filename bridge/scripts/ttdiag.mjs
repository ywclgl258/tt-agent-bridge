// 交互式 TT 诊断：node ttdiag.mjs <步骤名>（内置诊断序列）。
// 优先 attach 存活 daemon（瞬时）；无 daemon 时 spawn MCP server 兜底。
import { connectAgent } from './lib/agent.mjs';

const agent = await connectAgent();
console.error(`[ttdiag] hub mode: ${agent.mode}`);
if (!(await agent.waitExtension())) {
  console.error('[ttdiag] extension never connected');
  await agent.close();
  process.exit(1);
}

async function call(name, args = {}) {
  try {
    return await agent.call(name, args);
  } catch (err) {
    return { __error: err.message };
  }
}

const step = process.argv[2] || 'inspect';

if (step === 'switch') {
  const r = await call('tt_switch_character', { name: '教主模拟器' });
  console.log(JSON.stringify(r));
  await new Promise((r) => setTimeout(r, 4000));
  const st = await call('tt_status');
  console.log(JSON.stringify(st, null, 1));
} else if (step === 'inspect') {
  const st = await call('tt_status');
  console.log('--- status ---');
  console.log(JSON.stringify(st, null, 1));

  const frames = await call('tt_iframes');
  console.log('--- iframes ---');
  console.log(JSON.stringify(frames, null, 1));

  // 状态栏 iframe 运行时检查（新工具直接拿 frame 列表）
  const msgFrames = (frames.iframes ?? []).filter((f) => f.kind === 'message' && f.sameOrigin);
  for (const f of msgFrames.slice(0, 3)) {
    const probe = await call('tt_eval', {
      frame: f.name,
      code: `
        return {
          name: ${JSON.stringify(f.name)},
          hasGetAllVariables: typeof getAllVariables === 'function',
          hasMvuOnParent: !!(window.parent && window.parent.Mvu),
          statKeys: (() => {
            try {
              const v = getAllVariables && getAllVariables();
              return v && v.stat_data ? Object.keys(v.stat_data).slice(0, 12) : null;
            } catch (e) { return 'err:' + String(e).slice(0, 60); }
          })(),
        };
      `,
    });
    console.log('--- iframe runtime probe ---');
    console.log(JSON.stringify(probe, null, 1));
  }

  const logs = await call('tt_logs', { kind: 'frontend', limit: 15 });
  console.log('--- frontend logs (last 15) ---');
  for (const e of logs.entries ?? []) {
    console.log(`[${e.level}] ${e.message?.slice(0, 140)}`);
  }
}

await agent.close();
process.exit(0);
