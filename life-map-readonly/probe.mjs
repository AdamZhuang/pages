/**
 * 人生地图 UI 稿探针：用真 Chrome（headless + CDP）打开稿子，逐屏量结构与文案。
 * 纯探针：只读结果、不改稿子。
 *   node probe.mjs           # 只跑判定
 *   node probe.mjs --shot    # 同时出截图到 evidence/
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const FILE = 'file://' + path.resolve(__dirname, 'index.html');
const wantShot = process.argv.includes('--shot');

const profile = fs.mkdtempSync('/tmp/chrome-probe-lifemap-');
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1180,1200', FILE
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

/* 在页面里跑的探针：逐屏取数 */
const HARNESS = String.raw`
(async () => {
  const out = {};
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, ' ') : null);
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const screen = async (k) => {
    document.querySelector('.switcher button[data-screen="' + k + '"]').click();
    await tick();
  };

  // ── ① 改前 ──
  await screen('before');
  out.before_gone = all('.mark-gone').length;
  out.before_text = text(document.querySelector('.phone-inner'));
  out.before_has_coverage = out.before_text.includes('覆盖度');
  out.before_has_changes = out.before_text.includes('变化');

  // ── ② 总览 ──
  await screen('overview');
  out.ov_text = text(document.querySelector('.phone-inner'));
  out.ov_now_cards = all('.now-card').length;
  out.ov_chg_cards = all('.chg-card').length;
  out.ov_cov_rows = all('.cov-row').length;
  out.ov_cov_names = all('.cov-name').map(text);
  out.ov_cov_gaps = all('.cov-gap').map(text);
  out.ov_cov_empty_count = all('.cov-gap.empty').length;
  out.ov_has_writes = ['记录此刻', '收件箱', '找 Avatar 聊聊', '随手记'].filter((w) => out.ov_text.includes(w));

  // ── ③ 变化 ──
  await screen('changes');
  out.chg_steps = all('.chg-step').length;
  out.chg_chips = all('.chg-chip').length;
  out.chg_text = text(document.querySelector('.phone-inner'));
  out.chg_has_middle = out.chg_text.includes('中间发生了什么');

  // ── ④ 轨迹 ──
  await screen('timeline');
  out.tl_items = all('.tl-item').length;
  out.tl_gaps = all('.tl-gap').length;
  out.tl_text = text(document.querySelector('.phone-inner'));

  // ── ⑤ 主题 ──
  await screen('themes');
  out.th_cards = all('.th-card').length;
  out.th_more = all('.th-ev-more').length;
  out.th_rows = all('.th-ev-row').length;
  out.th_text = text(document.querySelector('.phone-inner'));

  // ── ⑥ 原文 ──
  await screen('source');
  out.src_text = text(document.querySelector('.phone-inner'));
  out.src_hl = all('.src-raw .hl').length;
  out.src_raw = text(document.querySelector('.src-raw'));

  // ── ⑦ 空领域 ──
  await screen('empty');
  out.empty_text = text(document.querySelector('.phone-inner'));

  // ── ⑧ 窄屏 ──
  await screen('narrow');
  const phone = document.getElementById('phone');
  out.narrow_phone_width = Math.round(phone.getBoundingClientRect().width);
  const scroller = document.querySelector('.scroll');
  out.narrow_overflow = { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
  out.narrow_beyond = (() => {
    const box = phone.getBoundingClientRect();
    return all('.phone-inner *').filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > box.right + 1;
    }).length;
  })();

  // ── 通用 ──
  // 隐私扫描：稿子发在公开仓库，任何真实人名 / 公司 / 地点 / 身体数据都不许出现。
  // 词表**不进仓库**（黑名单本身就是隐私），由探针在本地读 .private-words.txt（已 gitignore）。
  const html = document.documentElement.outerHTML;
  out.private_hits = (window.__PRIVATE_WORDS__ || []).filter((w) => w && html.includes(w));
  out.private_word_count = (window.__PRIVATE_WORDS__ || []).length;
  out.private_kg = (html.match(/\d+\s*kg/g) || []);
  // 故事必须是编的：主角是虚构人物，且不许残留真实事件日期（2026-06 ~ 2026-09 那批记录）。
  out.fiction_marks = ['周叙', '阿岚', '命令行工具'].filter((w) => html.includes(w));
  out.real_dates = (html.match(/2026-(0[6-9]|1[0-2])-\d{2}/g) || [])
    .filter((d) => d !== '2026-10-18');

  out.external = all('link[href], script[src], img[src]')
    .map((el) => el.getAttribute('href') || el.getAttribute('src'))
    .filter((u) => u && /^https?:/i.test(u)).length;

  // 8 屏都能渲染且不抛错
  out.render_errors = [];
  for (const k of ['before', 'overview', 'changes', 'timeline', 'themes', 'source', 'empty', 'narrow']) {
    try { await screen(k); } catch (e) { out.render_errors.push(k + ': ' + e.message); }
  }

  // 所有屏都没有写入入口（除改前那一屏的标注）。
  // 判据是**写入控件本身**，不是「确认」这种在来源标注里正常出现的词：
  // 「已确认 · 在职」是数据来源，不是按钮；「不包含未经确认的 AI 推测」是免责声明。
  out.write_words_after = {};
  for (const k of ['overview', 'changes', 'timeline', 'themes', 'source', 'empty', 'narrow']) {
    await screen(k);
    const hit = [];
    if (document.querySelector('.mark-gone')) hit.push('.mark-gone');
    if (document.querySelector('.old-capture, .old-inbox, .old-chat')) hit.push('.old-capture/.old-inbox/.old-chat');
    // 写入型按钮：文案是动作而不是数据
    for (const el of all('.phone-inner button, .phone-inner textarea, .phone-inner input')) {
      const label = (el.getAttribute('aria-label') || text(el) || '').trim();
      if (/^(记录此刻|随手记|收件箱|找 Avatar 聊聊|保存到待确认|保存修改|确认|忽略|更新)$/.test(label)) hit.push(label);
    }
    if (hit.length) out.write_words_after[k] = hit;
  }

  return out;
})()
`;

const results = {};

async function run() {
  const wsUrl = await targetUrl();
  const client = cdp(wsUrl);
  await client.ready;
  await client.send('Runtime.enable');
  await sleep(500);

  // 本地隐私词表（不进仓库）；没有这个文件就跳过词表扫描，只留通用断言。
  const wordsFile = path.resolve(__dirname, '.private-words.txt');
  const words = fs.existsSync(wordsFile)
    ? fs.readFileSync(wordsFile, 'utf8').split('\n').map((w) => w.trim()).filter((w) => w && !w.startsWith('#'))
    : [];
  await client.send('Runtime.evaluate', {
    expression: `window.__PRIVATE_WORDS__ = ${JSON.stringify(words)}`
  });

  const evalRes = await client.send('Runtime.evaluate', {
    expression: HARNESS, awaitPromise: true, returnByValue: true
  });
  if (evalRes.exceptionDetails) {
    console.error('探针脚本抛错：', JSON.stringify(evalRes.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    Object.assign(results, evalRes.result.value || {});
  }

  if (wantShot) {
    const shots = [
      ['before', 'shot-01-before.png'],
      ['overview', 'shot-02-overview.png'],
      ['changes', 'shot-03-changes.png'],
      ['timeline', 'shot-04-timeline.png'],
      ['themes', 'shot-05-themes.png'],
      ['source', 'shot-06-source.png'],
      ['empty', 'shot-07-empty.png'],
      ['narrow', 'shot-08-narrow.png']
    ];
    fs.mkdirSync(path.resolve(__dirname, 'evidence'), { recursive: true });
    for (const [k, file] of shots) {
      await client.send('Runtime.evaluate', {
        expression: `document.querySelector('.switcher button[data-screen="${k}"]').click()`
      });
      await sleep(200);
      const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.resolve(__dirname, 'evidence', file), Buffer.from(shot.data, 'base64'));
    }
    console.log('截图已存到 evidence/');
  }

  client.close();
  chrome.kill();

  // ── 断言 ────────────────────────────────────────────────────
  const checks = [];
  const ok = (name, cond, detail) => checks.push({ name, pass: !!cond, detail });

  ok('① 改前有 3 个写入入口且标了「摘掉」', results.before_gone === 3, results.before_gone);
  ok('① 改前只有三个视图（无覆盖度）', results.before_has_coverage === false, results.before_has_coverage);
  ok('① 改前无变化层', results.before_has_changes === false, results.before_has_changes);

  ok('② 覆盖度列出四个领域', JSON.stringify(results.ov_cov_names) === JSON.stringify(['工作', '关系', '生活', '创造']), results.ov_cov_names);
  ok('② 生活与创造都写「还没建立」', results.ov_cov_empty_count === 2, results.ov_cov_gaps);
  ok('② 现在卡 4 张', results.ov_now_cards === 4, results.ov_now_cards);
  ok('② 变化卡 2 张', results.ov_chg_cards === 2, results.ov_chg_cards);
  ok('② 改后无任何写入入口', (results.ov_has_writes || []).length === 0, results.ov_has_writes);

  ok('③ 变化卡有时间点', results.chg_steps >= 4, results.chg_steps);
  ok('③ 变化卡有「中间发生了什么」', results.chg_has_middle === true, results.chg_has_middle);
  ok('③ 证据 chip 可点', results.chg_chips >= 5, results.chg_chips);

  ok('④ 轨迹条目 7 条', results.tl_items === 7, results.tl_items);
  ok('④ 有空档提示', results.tl_gaps >= 1, results.tl_gaps);
  ok('④ 轨迹文案来自示例数据', results.tl_text.includes('最后一次见面，聊得很客气'), null);

  ok('⑤ 主题 5 张', results.th_cards === 5, results.th_cards);
  ok('⑤ 有「展开其余 N 条证据」', results.th_more >= 1, results.th_more);
  ok('⑤ 证据默认最多露 2 条/卡', results.th_rows <= 10, results.th_rows);
  ok('⑤ 主题来自示例数据', results.th_text.includes('工作里的优先级') && results.th_text.includes('相处起来舒服的方式'), null);

  ok('⑥ 显示文件路径', results.src_text.includes('memory/relationship/contact-a.md'), null);
  ok('⑥ 命中行高亮 1 处', results.src_hl === 1, results.src_hl);
  ok('⑥ 只显示这一节', results.src_raw.includes('2025-10-19') && !results.src_raw.includes('2025-09-14'), null);
  ok('⑥ 写明只读', results.src_text.includes('改内容请找 Bot'), null);

  ok('⑦ 空态说清「还没有记录」', results.empty_text.includes('这个领域还没有记录'), null);
  ok('⑦ 空态给出唯一可做的事', results.empty_text.includes('跟人生地图 Bot 说一句'), null);
  ok('⑦ 变化为空不画空框', results.empty_text.includes('还没有两个时间点可以对比'), null);
  ok('⑦ 不编「暂未填写」', !results.empty_text.includes('暂未填写'), null);

  ok('⑧ 视口真的到 360px', results.narrow_phone_width === 360, results.narrow_phone_width);
  ok('⑧ 无横向溢出', results.narrow_overflow?.scrollWidth <= results.narrow_overflow?.clientWidth + 1, results.narrow_overflow);
  ok('⑧ 没有元素越过右边缘', results.narrow_beyond === 0, results.narrow_beyond);

  ok(`通用：稿里没有真实人名/公司/地点（词表 ${results.private_word_count || 0} 条）`, (results.private_hits || []).length === 0, results.private_hits);
  ok('通用：没有体重数字', (results.private_kg || []).length === 0, results.private_kg);
  ok('通用：故事是虚构的（周叙 / 阿岚 / 虚构物件在场）', (results.fiction_marks || []).length === 3, results.fiction_marks);
  ok('通用：没有残留真实事件日期', (results.real_dates || []).length === 0, results.real_dates);
  ok('通用：不引外部资源', results.external === 0, results.external);
  ok('通用：8 屏渲染无错', (results.render_errors || []).length === 0, results.render_errors);
  ok('通用：改后所有屏都没有写入入口', Object.keys(results.write_words_after || {}).length === 0, results.write_words_after);

  // ── 输出 ────────────────────────────────────────────────────
  console.log('');
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail !== null && c.detail !== undefined ? '  → ' + JSON.stringify(c.detail) : ''}`);
  }
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n--- 判定 ---\n\n${pass}/${checks.length} 通过`);
  process.exitCode = pass === checks.length ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
