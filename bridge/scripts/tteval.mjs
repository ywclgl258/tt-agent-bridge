// 通用 tt_eval 运行器：node tteval.mjs <code-file.js> [第二步文件 ...]
// 每个文件的内容作为主文档（或 frame= 指定的 iframe）async 函数体执行，打印 JSON 结果。
// 优先 attach 存活 daemon（瞬时）；无 daemon 时 spawn MCP server 兜底。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectAgent } from './lib/agent.mjs';

const agent = await connectAgent();
console.error(`[tteval] hub mode: ${agent.mode}`);
if (!(await agent.waitExtension())) {
  console.error('[tteval] extension never connected — is TauriTavern running with the bridge extension enabled?');
  await agent.close();
  process.exit(1);
}

for (const file of process.argv.slice(2)) {
  const code = readFileSync(resolve(process.cwd(), file), 'utf8');
  console.log(`===== ${file} =====`);
  try {
    const r = await agent.call('tt_eval', { code });
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}

await agent.close();
process.exit(0);
