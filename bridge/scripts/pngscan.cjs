// 用法：
//   node pngscan.cjs <card.png>                      → 关键片段存在性检查
//   node pngscan.cjs <card.png> unpack <outDir>      → 全量解包：卡 JSON + regex/scripts/worldbook 摘要
const fs = require('fs');
const path = require('path');

function extractCardJson(pngPath) {
  const buf = fs.readFileSync(pngPath);
  let off = 8;
  const texts = {};
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tEXt') {
      const data = buf.slice(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      texts[data.toString('ascii', 0, nul)] = data.slice(nul + 1).toString('latin1');
    }
    off += 12 + len;
    if (type === 'IEND') break;
  }
  for (const key of ['ccv3', 'chara']) {
    if (!texts[key]) continue;
    let json = Buffer.from(texts[key], 'base64').toString('utf8');
    if (json.startsWith('%')) json = decodeURIComponent(json);
    return { key, json };
  }
  return null;
}

function scanSnippet(obj, needle) {
  // 在整棵字符串值里找 needle，返回命中键路径
  const hits = [];
  (function walk(v, p) {
    if (hits.length > 5) return;
    if (typeof v === 'string') { if (v.includes(needle)) hits.push(p); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], p + '.' + k); }
  })(obj, '$');
  return hits;
}

const file = process.argv[2];
const mode = process.argv[3] || 'scan';
const found = extractCardJson(file);
if (!found) { console.log(file + ': no chara/ccv3 chunk'); process.exit(1); }
const card = JSON.parse(found.json);
const name = card.data ? card.data.name : card.name;

if (mode === 'unpack') {
  const outDir = process.argv[4] || (file.replace(/\.png$/i, '') + '-unpacked');
  fs.mkdirSync(outDir, { recursive: true });
  const safe = String(name || 'card').replace(/[\\/:*?"<>|]/g, '_');
  fs.writeFileSync(path.join(outDir, safe + '.json'), JSON.stringify(card, null, 2));

  const data = card.data || card;
  const summary = { file, chunkKey: found.key, name, sections: {} };

  // 角色内嵌正则 → 每条一个文件
  const regexes = data?.extensions?.regex_scripts ?? card.extension?.regex_scripts ?? [];
  summary.sections.regexes = Array.isArray(regexes) ? regexes.length : 0;
  if (Array.isArray(regexes)) {
    const dir = path.join(outDir, 'regexes');
    fs.mkdirSync(dir, { recursive: true });
    regexes.forEach((r, i) => {
      const fn = `${String(i).padStart(2, '0')}_${(r.scriptName || r.name || i).toString().replace(/[\\/:*?"<>|]/g, '_')}.json`;
      fs.writeFileSync(path.join(dir, fn), JSON.stringify(r, null, 2));
    });
  }

  // 酒馆助手脚本 → 每个一个文件（内容为 js/txt）
  const th = data?.extensions?.tavern_helper;
  const scriptsRaw = th?.scripts ?? th?.script_list;
  let scripts = [];
  if (Array.isArray(scriptsRaw)) {
    scripts = scriptsRaw.map((s, i) => [s.name || s.id || `#${i}`, s]);
  } else if (scriptsRaw && typeof scriptsRaw === 'object') {
    scripts = Object.entries(scriptsRaw);
  }
  summary.sections.scripts = scripts.length;
  if (scripts.length > 0) {
    const dir = path.join(outDir, 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    for (const [key, s] of scripts) {
      const fn = String(key).replace(/[\\/:*?"<>|]/g, '_');
      fs.writeFileSync(path.join(dir, `${fn}.json`), JSON.stringify(s, null, 2));
      if (typeof s.content === 'string' && s.content.length > 0) {
        fs.writeFileSync(path.join(dir, `${fn}.content.txt`), s.content);
      }
    }
  }

  // 内嵌世界书
  const book = data?.character_book ?? card.character_book;
  const entries = book?.entries;
  const bookList = Array.isArray(entries)
    ? entries.map((e, i) => [i, e])
    : entries && typeof entries === 'object' ? Object.entries(entries) : [];
  summary.sections.character_book = bookList.length;
  if (bookList.length > 0) {
    fs.writeFileSync(
      path.join(outDir, 'character_book.json'),
      JSON.stringify(book, null, 2),
    );
  }

  fs.writeFileSync(path.join(outDir, 'unpack-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ unpacked: outDir, ...summary }, null, 1));
  process.exit(0);
}

const blobs = [];
(function walk(v) {
  if (typeof v === 'string' && v.length > 200) blobs.push(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
})(card);
const joined = blobs.join('\n');
console.log(JSON.stringify({
  file,
  chunkKey: found.key,
  name,
  hasDvrootTemplate: joined.includes('class=\\"d-vroot\\"') || joined.includes("'\\u003cdiv class=\\\"d-vroot"),
  boundClick: joined.includes('@click="rootClick"') || joined.includes('d-vroot\\" @click'),
  unbound: /'<div class="d-vroot">'/.test(joined.replace(/\\"/g, '"')),
  dRootCount: (joined.match(/id="d-root"/g) || []).length,
}, null, 1));
