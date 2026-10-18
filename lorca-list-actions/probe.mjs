/**
 * 在真 Chrome 里驱动 UI 稿 v2 的滑动演示，核 AC-1/2/3/4/5/6/8/14 的数值口径。
 * 纯探针：只读结果、不改稿子。
 *   node probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const FILE = 'file://' + path.resolve(__dirname, 'index.html') + '#swipe';

const profile = fs.mkdtempSync('/tmp/chrome-probe-');
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1180,1160', FILE
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 50; i += 1) {
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
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
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

const HARNESS = String.raw`
(async () => {
  const out = {};
  const readout = document.getElementById('readout');
  const note = () => readout.textContent;
  const tracks = Array.from(document.querySelectorAll('#demo-list .lrow-track[data-row]'));
  const trackA = tracks[0];
  const trackB = tracks[1];
  const list = document.getElementById('demo-list');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const px = (el) => {
    const m = (el.style.transform || '').match(/-?[\d.]+/);
    return m ? Math.abs(parseFloat(m[0])) : 0;
  };
  const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y
  }));
  const reset = () => { document.getElementById('demo-reset').click(); };
  const begin = (el, x0 = 200, y0 = 300) => fire(el, 'pointerdown', x0, y0);
  const moveTo = (el, dx, dy, x0 = 200, y0 = 300) => fire(el, 'pointermove', x0 + dx, y0 + dy);
  const endDrag = (el, dx, dy, x0 = 200, y0 = 300) => fire(el, 'pointerup', x0 + dx, y0 + dy);
  // 向左滑 = dx 为负（行左移、格子从右侧出）
  const drag = (el, dx, dy) => { begin(el); moveTo(el, dx, dy); endDrag(el, dx, dy); };

  // 槽位与顺序（AC-1）
  out.slot_widths = Array.from(trackA.closest('.lrow').querySelectorAll('.lrow-acts .slot'))
    .map((s) => Math.round(s.getBoundingClientRect().width));
  out.slot_order = Array.from(trackA.closest('.lrow').querySelectorAll('.lrow-acts .slot'))
    .map((s) => s.textContent.trim());
  out.row_width = Math.round(trackA.getBoundingClientRect().width);
  const acts = trackA.closest('.lrow').querySelector('.lrow-acts');
  const rowBox = trackA.closest('.lrow').getBoundingClientRect();
  const actsBox = acts.getBoundingClientRect();
  out.acts_anchor = {
    right_gap: Math.round(rowBox.right - actsBox.right),
    left_gap: Math.round(actsBox.left - rowBox.left),
    width: Math.round(actsBox.width)
  };
  // 视觉顺序 = 自左向右（Adam 2026-10-18 定：置顶 · 隐藏 · ⋯）
  const slotBoxes = Array.from(acts.querySelectorAll('.slot')).map((el) => {
    const b = el.getBoundingClientRect();
    return { text: el.textContent.trim(), left: Math.round(b.left), right: Math.round(b.right) };
  }).sort((a, b) => a.left - b.left);
  out.visual_order = slotBoxes.map((x) => x.text);

  // AC-2 四个吸附点
  // 只有两态：125 → 0、126 → 全开 252
  reset(); drag(trackA, -41, 0);   out.snap_41 = px(trackA);
  reset(); drag(trackA, -100, 0);  out.snap_100 = px(trackA);
  reset(); drag(trackA, -125, 0);  out.snap_125 = px(trackA);
  reset(); drag(trackA, -126, 0);  out.snap_126 = px(trackA);
  reset(); drag(trackA, -150, 0);  out.snap_150 = px(trackA);
  reset(); drag(trackA, -220, 0);  out.snap_220 = px(trackA);
  // 上限封顶
  reset(); drag(trackA, -400, 0);  out.snap_over = px(trackA);
  // 向右滑不开格
  reset(); drag(trackA, 120, 0);   out.rightward = px(trackA);

  // Hidden 行（两格）封顶 168 —— 那两行在 ③ 屏，先切过去
  document.querySelector('.switcher button[data-screen="hidden"]').click();
  await tick();
  const trackH = document.querySelector('.screen[data-screen="hidden"] .lrow-track[data-slots="2"]');
  const hiddenMax = Number(trackH.dataset.slots) * 84;
  fire(trackH, 'pointerdown', 360, 300);
  fire(trackH, 'pointermove', 276, 300);  // dx = −84，正好两格行阈值
  fire(trackH, 'pointerup', 276, 300);
  out.hidden_row = {
    slots: Number(trackH.dataset.slots),
    max: hiddenMax,
    open: px(trackH),
    slots_in_dom: Array.from(trackH.closest('.lrow').querySelectorAll('.lrow-acts .slot')).map((x) => x.textContent.trim())
  };
  document.querySelector('.switcher button[data-screen="swipe"]').click();
  await tick();

  // AC-3 方向判定（向右滑）
  reset(); begin(trackA); moveTo(trackA, -20, 8);
  out.diag_horizontal = { x: px(trackA), note: note() };
  endDrag(trackA, -20, 8);

  reset(); begin(trackA); moveTo(trackA, -20, 25);
  out.diag_vertical = { x: px(trackA), note: note() };
  endDrag(trackA, -20, 25);

  reset(); begin(trackA); moveTo(trackA, -20, 16);
  out.diag_dead = { x: px(trackA), note: note() };
  endDrag(trackA, -20, 16);

  reset(); begin(trackA); moveTo(trackA, -5, 0);
  out.before_lock = { x: px(trackA), note: note() };
  endDrag(trackA, -5, 0);

  // 左缘起手（v4 不再有排除区）：向左滑照常开格
  reset();
  begin(trackA, 8, 300); moveTo(trackA, -126, 0, 8, 300); endDrag(trackA, -126, 0, 8, 300);
  out.left_edge_drag = px(trackA);

  // AC-4 一次只开一行
  reset(); drag(trackA, -126, 0); const aOpen = px(trackA);
  drag(trackB, -126, 0);
  out.one_at_a_time = { a: aOpen, aAfter: px(trackA), b: px(trackB) };

  // AC-6 行开着时点正文：只关行，点击被吃掉
  reset(); drag(trackA, -126, 0);
  await tick();
  const before = px(trackA);
  const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
  trackA.querySelector('.row-main').dispatchEvent(clickEvent);
  out.ac6_open = { before, after: px(trackA), defaultPrevented: clickEvent.defaultPrevented, note: note() };

  // 行关着时点正文：正常透传
  reset();
  const plainClick = new MouseEvent('click', { bubbles: true, cancelable: true });
  trackA.querySelector('.row-main').dispatchEvent(plainClick);
  out.ac6_closed = { defaultPrevented: plainClick.defaultPrevented };

  // AC-8 第三格 ⋯ 开菜单
  reset(); drag(trackA, -252, 0);
  await tick();
  const row = trackA.closest('.lrow');
  const menu = row.querySelector('.row-menu');
  const items = Array.from(menu.querySelectorAll('button')).map((b) => b.textContent.trim());
  const disabled = Array.from(menu.querySelectorAll('button')).map((b) => b.disabled);
  row.querySelector('.slot[data-more]').click();
  await tick();
  out.ac8_menu = { items, disabled, open: !menu.hasAttribute('hidden'), note: note() };
  // 再点一次关
  row.querySelector('.slot[data-more]').click();
  await tick();
  out.ac8_toggle_close = menu.hasAttribute('hidden');

  // AC-5 列表真实滚动量 > 6px 关行
  reset(); drag(trackA, -126, 0);
  await tick();
  const openBefore = px(trackA);
  list.scrollTop = 8;
  list.dispatchEvent(new Event('scroll'));
  out.scroll_close = { before: openBefore, after: px(trackA), note: note() };

  // scrollTop 不变 → 不关
  reset(); drag(trackA, -126, 0);
  await tick();
  list.dispatchEvent(new Event('scroll'));
  out.scroll_noop_keeps_open = px(trackA);

  // 已开态反方向滑：每 42px 收一档 252 → 168 → 84 → 0
  reset(); drag(trackA, -252, 0);
  await tick();
  const full = px(trackA);
  drag(trackA, 41, 0); await tick(); const shortBack = px(trackA);   // 不足 42 → 回全开
  drag(trackA, 42, 0); await tick(); const closed = px(trackA);     // ≥ 42 → 关
  out.reverse = { full, shortBack, closed };

  // AC-7 常态行尾没有 ⋯（稿里没有 .more-btn）
  out.no_row_end_more = document.querySelectorAll('.more-btn').length === 0;

  reset();
  return JSON.stringify(out);
})()
`;

const checks = (out) => [
  ['AC-1 三格各 84px', out.slot_widths.length === 3 && out.slot_widths.every((w) => w === 84)],
  ['AC-1 三格贴行尾（右对齐，右侧无缝隙）', out.acts_anchor.right_gap === 0 && out.acts_anchor.left_gap > 0 && out.acts_anchor.width === 252],
  ['AC-1 槽序（左→右）= 置顶 · 完成 · ⋯', out.visual_order.length === 3 && out.visual_order[0].includes('置顶') && out.visual_order[1].includes('完成') && out.visual_order[2].includes('更多')],
  ['AC-2 松手 41px → 0', out.snap_41 === 0],
  ['AC-2 松手 100px → 0（无中间档）', out.snap_100 === 0],
  ['AC-2 松手 125px → 0（阈值下）', out.snap_125 === 0],
  ['AC-2 松手 126px → 全开 252（阈值上）', out.snap_126 === 252],
  ['AC-2 松手 150px → 全开 252', out.snap_150 === 252],
  ['AC-2 松手 220px → 全开 252', out.snap_220 === 252],
  ['上限封顶 252px', out.snap_over === 252],
  ['已完成行两格阈值 84 → 全开 168（槽 = 取消完成 / 更多）', out.hidden_row.slots === 2 && out.hidden_row.open === 168 && out.hidden_row.slots_in_dom.join('/').includes('取消完成') && out.hidden_row.slots_in_dom.join('/').includes('更多')],
  ['AC-3 dx−20/dy8 → 横向、行跟手', out.diag_horizontal.x === 20 && out.diag_horizontal.note.includes('横向')],
  ['AC-3 dx−20/dy25 → 纵向、交回滚动', out.diag_vertical.x === 0 && out.diag_vertical.note.includes('纵向')],
  ['AC-3 dx−20/dy16 → 未起判区、行不跟手', out.diag_dead.x === 0 && out.diag_dead.note.includes('斜滑未定')],
  ['起判前不跟手（5px 位移 0）', out.before_lock.x === 0 && out.before_lock.note.includes('未起判')],
  ['向右滑不开格', out.rightward === 0],
  ['左缘起手向左滑照常开格（无排除区）', out.left_edge_drag === 252],
  ['AC-4 A 开着滑 B → A 回 0、只 B 开', out.one_at_a_time.a === 252 && out.one_at_a_time.aAfter === 0 && out.one_at_a_time.b === 252],
  ['AC-6 行开着点正文只关行、点击被吃', out.ac6_open.before === 252 && out.ac6_open.after === 0 && out.ac6_open.defaultPrevented === true],
  ['AC-6 行关着点正文正常透传', out.ac6_closed.defaultPrevented === false],
  ['AC-8 第三格 ⋯ 开菜单，三项齐全且不重复置顶/隐藏', out.ac8_menu.open === true && out.ac8_menu.items.length === 3 && !out.ac8_menu.items.join('/').includes('置顶') && !out.ac8_menu.items.join('/').includes('隐藏')],
  ['AC-8 未读为 0 时「标记为已读」置灰', out.ac8_menu.disabled.some((d) => d === true)],
  ['AC-8 再点一次关菜单', out.ac8_toggle_close === true],
  ['AC-5 滚动 8px 关行', out.scroll_close.before === 252 && out.scroll_close.after === 0],
  ['scrollTop 不变不关行', out.scroll_noop_keeps_open === 252],
  ['AC-2b 向右滑 41px → 回全开 252', out.reverse.full === 252 && out.reverse.shortBack === 252],
  ['AC-2b 向右滑 42px → 关回 0', out.reverse.closed === 0],
  ['AC-7 常态行尾没有 ⋯', out.no_row_end_more === true]
];

(async () => {
  const ws = cdp(await targetUrl());
  await ws.ready;
  await ws.send('Runtime.enable');
  await sleep(700);
  const res = await ws.send('Runtime.evaluate', { expression: HARNESS, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    console.error('页面内异常：', JSON.stringify(res.exceptionDetails, null, 2));
    ws.close(); chrome.kill(); process.exit(3);
  }
  const out = JSON.parse(res.result.value);
  console.log(JSON.stringify(out, null, 2));

  console.log('\n--- 判定 ---');
  const list = checks(out);
  let failed = 0;
  for (const [name, ok] of list) {
    if (!ok) failed += 1;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  }
  console.log('\n' + (list.length - failed) + '/' + list.length + ' 通过');
  ws.close();
  chrome.kill();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(2);
});
