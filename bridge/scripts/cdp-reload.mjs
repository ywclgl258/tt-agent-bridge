// 经 WebView2 CDP 重载 TT 页面（等效 F5）。用法: node cdp-reload.mjs
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page' && /tauri\.localhost|TauriTavern/i.test(t.url + t.title));
if (!page) {
  console.error('no TauriTavern page target');
  process.exit(1);
}
console.log('target:', page.title, page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
ws.send(JSON.stringify({
  id: 1,
  method: 'Runtime.evaluate',
  params: { expression: 'location.reload(); "reloading"', returnByValue: true },
}));
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id === 1) {
    console.log('eval result:', JSON.stringify(msg.result?.result?.value ?? msg.result));
    ws.close();
    process.exit(0);
  }
});
setTimeout(() => { console.error('cdp timeout'); process.exit(1); }, 5000);
