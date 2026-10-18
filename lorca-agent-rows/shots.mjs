/**
 * 用真 Chrome（headless + CDP）给 UI 稿每个屏拍一张图，作为交付证据。
 *   node shots.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9337;
const OUT = path.join(__dirname, 'evidence');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync('/tmp/chrome-shots-agent-');

function launch(width, height) {
  return spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    'file://' + path.resolve(__dirname, 'index.html')
  ], { stdio: 'ignore' });
}

async function targetUrl() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('Chrome 没起来');
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const ready = new Promise((resolve) => ws.addEventListener('open', resolve));
  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const myId = ++id;
        pending.set(myId, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    },
    close: () => ws.close()
  };
}

async function shot(ws, screen, name, clip) {
  await ws.send('Runtime.evaluate', {
    expression: `document.querySelector('.switcher button[data-screen="${screen}"]').click()`,
    returnByValue: true
  });
  await sleep(450);
  const params = { format: 'png', captureBeyondViewport: true };
  if (clip) params.clip = clip;
  const res = await ws.send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(res.data, 'base64'));
  console.log('写入 evidence/' + name);
}

(async () => {
  // 桌面宽度：拍整幅页（含结论区）
  let chrome = launch(1240, 2400);
  let ws = cdp(await targetUrl());
  await ws.ready;
  await ws.send('Page.enable');
  await ws.send('Runtime.enable');
  await sleep(800);

  // 只拍手机壳那一块，图才干净
  const phoneBox = await ws.send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('.phone').getBoundingClientRect();
      return JSON.stringify({ x: b.x - 12, y: b.y + window.scrollY - 12, width: b.width + 24, height: b.height + 24 }); })()`,
    returnByValue: true
  });
  const clip = JSON.parse(phoneBox.result.value);
  clip.scale = 2;

  for (const [screen, name] of [
    ['before', 'shot-01-before.png'],
    ['after', 'shot-02-after.png'],
    ['working', 'shot-03-working.png'],
    ['done', 'shot-04-done.png'],
    ['failed', 'shot-05-failed.png'],
    ['failed-start', 'shot-06-failed-start.png']
  ]) {
    await shot(ws, screen, name, clip);
  }

  // 窄屏：先把窗口改窄，再拍 360pt 的壳
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(300);
  await ws.send('Runtime.evaluate', {
    expression: `document.querySelector('.switcher button[data-screen="narrow"]').click()`,
    returnByValue: true
  });
  await sleep(450);
  const narrowBox = await ws.send('Runtime.evaluate', {
    expression: `(() => { const b = document.getElementById('narrow-phone').getBoundingClientRect();
      return JSON.stringify({ x: b.x - 8, y: b.y + window.scrollY - 8, width: b.width + 16, height: b.height + 16, scale: 2 }); })()`,
    returnByValue: true
  });
  const narrowClip = JSON.parse(narrowBox.result.value);
  const narrowShot = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: narrowClip });
  fs.writeFileSync(path.join(OUT, 'shot-07-narrow.png'), Buffer.from(narrowShot.data, 'base64'));
  console.log('写入 evidence/shot-07-narrow.png');

  // 整幅页（含结论区）单独一张
  await ws.send('Emulation.clearDeviceMetricsOverride');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 2400, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  await ws.send('Runtime.evaluate', { expression: `document.querySelector('.switcher button[data-screen="after"]').click()` });
  await sleep(400);
  const full = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, 'shot-00-page.png'), Buffer.from(full.data, 'base64'));
  console.log('写入 evidence/shot-00-page.png');

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
