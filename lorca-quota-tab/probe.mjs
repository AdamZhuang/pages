/**
 * 在真 Chrome 里驱动「额度 Tab」UI 稿 v1，逐屏核 issue #3 的产品口径。
 * 纯探针：只读结果、不改稿子。
 *   node probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9338;
const FILE = 'file://' + path.resolve(__dirname, 'index.html');

const profile = fs.mkdtempSync('/tmp/chrome-probe-quota-');
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
  const M = window.__mock;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, ' ') : null);
  const texts = (sel) => Array.from(document.querySelectorAll(sel)).map(text);

  // ── 文案表本身：五条码齐、层级正确、未知码不编 ────────────────
  out.codes = Object.keys(M.COPY).sort();
  out.level_global = ['not_configured','key_invalid','network_unreachable'].map((c) => M.levelOf(c));
  out.level_block = ['upstream_no_data','quota_unavailable'].map((c) => M.levelOf(c));
  out.unknown_code_copy = M.copyFor('definitely_not_a_code');
  out.cards_not_configured = M.cardsRendered('not_configured');
  out.cards_key_invalid = M.cardsRendered('key_invalid');
  // 每条码都必须有可见的下一步（主文案之外的 action 或 desc）
  out.code_actions = Object.fromEntries(Object.entries(M.COPY).map(([k, v]) => [k, v.action || v.desc || null]));
  out.codes_without_next_step = Object.entries(M.COPY).filter(([, v]) => !v.action && !v.desc).map(([k]) => k);

  // 中文校验：主文案里不许出现码名、上游英文错误原文、HTTP 状态码
  // （Cline / key / API 这类产品名与必要名词不算 —— 用户本来就要看到它们）
  const BANNED = /(Unauthorized|success|error|forbidden|not_configured|key_invalid|network_unreachable|upstream_no_data|quota_unavailable|\b[45]\d\d\b)/i;
  out.copy_has_banned = Object.fromEntries(
    Object.entries(M.COPY).map(([k, v]) => [k, BANNED.test(v.title + ' ' + (v.desc || ''))])
  );

  // ── 屏 ①：改前（三档，没有额度） ─────────────────────────────
  M.setScreen('before'); await tick();
  out.tabs_before = texts('.tabs .tab').map((t) => t.replace(/\d+$/, '').trim());
  out.tabs_before_has_quota = out.tabs_before.includes('额度');

  // ── 屏 ②：没配 key（AC-2） ───────────────────────────────────
  M.setScreen('nokey'); await tick();
  out.tabs_after = texts('.tabs .tab').map((t) => t.replace(/\d+$/, '').trim());
  out.quota_tab_last = out.tabs_after[out.tabs_after.length - 1];
  out.nokey_status = text(document.querySelector('[data-status]'));
  out.nokey_status_code = document.querySelector('[data-status]')?.dataset.status;
  out.nokey_cards = document.querySelectorAll('[data-card]').length;
  out.nokey_action = text(document.querySelector('.status-actions .btn'));
  out.nokey_has_spinner = !!document.querySelector('.spinner, [aria-busy="true"]');

  // ── 屏 ③：三档配额（v3：官方 usage-limits 一次拿全） ─────────
  M.setScreen('ok'); await tick();
  out.ok_status_bar = document.querySelectorAll('[data-status]').length;
  out.ok_card_order = texts('[data-card] .card-hd h3');
  out.ok_quota_first = (out.ok_card_order[0] || '').includes('配额');
  out.ok_balance_last = (out.ok_card_order[out.ok_card_order.length - 1] || '').includes('余额');
  out.ok_win_names = texts('[data-card="quota"] .win-name');
  out.ok_win_used = texts('[data-card="quota"] .win-used');
  out.ok_win_sub = texts('[data-card="quota"] .win-sub');
  out.ok_win_bars = Array.from(document.querySelectorAll('[data-card="quota"] .bar')).map((b) => ({
    role: b.getAttribute('role'), now: b.getAttribute('aria-valuenow'), width: b.querySelector('i')?.style.width
  }));
  out.ok_quota_note_gone = !/与官方口径可能有差异|每笔调用费用/.test(document.querySelector('[data-card="quota"]')?.innerText || '');
  out.ok_balance = text(document.querySelector('[data-balance]'));
  out.ok_balance_note = text(document.querySelector('[data-card="balance"] .card-note'));
  out.ok_balance_has_currency = /[$€£¥]/.test(out.ok_balance || '');
  out.ok_reset_row = document.querySelectorAll('[data-card="balance"] .card-row').length;

  // ── 屏 ④：整卡读取中（v3：不再分档加载） ─────────────────────
  M.setScreen('loading'); await tick();
  const loadingCard = document.querySelector('[data-card="quota"]');
  out.loading_card_loading = loadingCard?.dataset.loading === "1";
  out.loading_text = text(loadingCard?.querySelector('.win-name'));
  out.loading_has_skeleton = !!loadingCard?.querySelector('.skeleton');
  out.loading_has_bar = !!loadingCard?.querySelector('.bar');
  out.loading_balance_still_there = !!document.querySelector('[data-balance]');

  // ── 屏 ⑤：7 天到 84%（警示色） ──────────────────────────────
  M.setScreen('high'); await tick();
  const win7h = document.querySelector('[data-win="7d"]');
  out.high_7d_used = text(win7h?.querySelector('.win-used'));
  out.high_7d_is_warn = !!win7h?.querySelector('.win-used.is-high');
  out.high_7d_bar_warn = !!win7h?.querySelector('.bar > i.is-high');
  out.high_5h_stays_normal = !document.querySelector('[data-win="5h"] .win-used.is-high');

  // ── 屏 ⑥：5 小时用满（危险色） ──────────────────────────────
  M.setScreen('full'); await tick();
  const win5f = document.querySelector('[data-win="5h"]');
  out.full_5h_used = text(win5f?.querySelector('.win-used'));
  out.full_5h_is_danger = !!win5f?.querySelector('.win-used.is-full');
  out.full_5h_bar_danger = !!win5f?.querySelector('.bar > i.is-full');
  out.full_5h_bar_width = win5f?.querySelector('.bar > i')?.style.width;

  // ── 屏 ⑥：空数据（块级原因，不顶到全局条） ────────────────────
  M.setScreen('nodata'); await tick();
  out.nodata_global_bar = document.querySelectorAll('[data-status]').length;
  out.nodata_balance_reason = document.querySelector('[data-card="balance"]')?.dataset.reason;
  out.nodata_quota_reason = document.querySelector('[data-card="quota"]')?.dataset.reason;
  out.nodata_card_order = texts('[data-card] .card-hd h3');
  out.nodata_balance_action = text(document.querySelector('[data-card="balance"] .inline-action'));

  // ── 屏 ⑤：key 无效（全局条 + 两块骨架保留） ─────────────────
  M.setScreen('invalid'); await tick();
  out.invalid_status_code = document.querySelector('[data-status]')?.dataset.status;
  out.invalid_status_text = text(document.querySelector('[data-status] .status-title'));
  out.invalid_cards = document.querySelectorAll('[data-card]').length;
  out.invalid_placeholders = texts('[data-card] .placeholder');
  out.invalid_has_upstream_english = /Unauthorized|401|success/i.test(document.body.innerText);

  // ── 屏 ⑥：连不上 Cline ──────────────────────────────────────
  M.setScreen('offline'); await tick();
  out.offline_status_code = document.querySelector('[data-status]')?.dataset.status;
  out.offline_status_text = text(document.querySelector('[data-status] .status-title'));
  out.offline_action = text(document.querySelector('.status-actions .btn'));
  out.offline_cards = document.querySelectorAll('[data-card]').length;

  // ── 屏 ⑨：设置 key 弹层（普通文本格子，v2 改口） ─────────────
  M.setScreen('sheet'); await tick();
  const input = document.getElementById('key-input');
  out.sheet_title = text(document.querySelector('.sheet h3'));
  out.sheet_input_type = input?.type;
  out.sheet_input_empty = input?.value === '';
  out.sheet_has_eye_button = !!document.querySelector('.eye-btn, [data-action="toggle-plain"]');
  out.sheet_autocomplete = input?.getAttribute('autocomplete');
  out.sheet_autocapitalize = input?.getAttribute('autocapitalize');
  out.sheet_autocorrect = input?.getAttribute('autocorrect');
  out.sheet_spellcheck = input?.getAttribute('spellcheck');
  out.sheet_save_disabled = document.querySelector('[data-action="save-key"]')?.disabled;

  // 保存失败态：留在弹层 + 错误行 + 输入不丢
  M.setScreen('sheet-error'); await tick();
  out.sheet_error_shown = text(document.querySelector('[data-sheet-error]'));
  out.sheet_error_keeps_value = (document.getElementById('key-input')?.value || '').length > 0;

  // ── 屏 ⑩：清除二次确认 ─────────────────────────────────────
  M.setScreen('clearing'); await tick();
  out.clear_title = text(document.querySelector('.sheet h3'));
  out.clear_desc = text(document.querySelector('.sheet-desc'));
  out.clear_confirm = text(document.querySelector('[data-action="confirm-clear"]'));

  // 保存成功只回 toast「已设置」
  M.setScreen('saved'); await tick();
  out.saved_toast = text(document.querySelector('[data-toast]'));
  out.saved_no_key_on_screen = !/sk-/.test(document.body.innerText);

  // ── 屏 ⑪：360px 窄屏溢出 ──────────────────────────────────
  M.setScreen('narrow'); await tick();
  const phone = document.getElementById('phone');
  out.narrow_phone_width = Math.round(phone.getBoundingClientRect().width);
  out.narrow_doc_overflow = { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  out.narrow_body_overflow = (() => { const b = document.querySelector('.body'); return { scrollWidth: b.scrollWidth, clientWidth: b.clientWidth }; })();
  out.narrow_balance = text(document.querySelector('[data-balance]'));

  // 交互：没配 key 时点「设置 API key」→ 弹层
  M.setScreen('nokey'); await tick();
  document.querySelector('[data-action="open-sheet"]').click(); await tick();
  out.click_open_sheet = { screen: M.screenOf(), has_input: !!document.getElementById('key-input') };
  // 取消 → 回到有数据屏
  document.querySelector('[data-action="close-sheet"]').click(); await tick();
  out.click_close_sheet = { screen: M.screenOf(), has_sheet: !!document.querySelector('.sheet-scrim') };

  return out;
})()
`;

const results = {};

async function run() {
  const wsUrl = await targetUrl();
  const client = cdp(wsUrl);
  await client.ready;
  await client.send('Runtime.enable');
  await sleep(400);

  const evalRes = await client.send('Runtime.evaluate', {
    expression: HARNESS, awaitPromise: true, returnByValue: true
  });
  if (evalRes.exceptionDetails) {
    console.error('探针脚本抛错：', JSON.stringify(evalRes.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    Object.assign(results, evalRes.result.value || {});
  }

  const shots = [
    ['before', 'shot-1-before-tabs.png'],
    ['nokey', 'shot-2-no-key.png'],
    ['ok', 'shot-3-quota-three-windows.png'],
    ['loading', 'shot-4-loading.png'],
    ['high', 'shot-5-warn-84.png'],
    ['full', 'shot-6-full-100.png'],
    ['nodata', 'shot-7-no-data.png'],
    ['invalid', 'shot-8-key-invalid.png'],
    ['offline', 'shot-9-offline.png'],
    ['sheet', 'shot-10-sheet.png'],
    ['sheet-filled', 'shot-11-sheet-filled.png'],
    ['clearing', 'shot-12-clear-confirm.png'],
    ['narrow', 'shot-13-narrow.png']
  ];
  fs.mkdirSync(path.resolve(__dirname, 'evidence'), { recursive: true });
  for (const [screen, file] of shots) {
    await client.send('Runtime.evaluate', { expression: `window.__mock.setScreen(${JSON.stringify(screen)})` });
    await sleep(150);
    const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(__dirname, 'evidence', file), Buffer.from(shot.data, 'base64'));
  }

  client.close();
  chrome.kill();

  // ── 断言 ────────────────────────────────────────────────────
  const checks = [];
  const ok = (name, cond, detail) => checks.push({ name, pass: !!cond, detail });

  ok('五条原因码齐备', results.codes?.length === 5, results.codes);
  ok('前三条是全局级', results.level_global?.every((l) => l === 'global'), results.level_global);
  ok('后两条是块级', results.level_block?.every((l) => l === 'block'), results.level_block);
  ok('未知码不编文案', results.unknown_code_copy === null, results.unknown_code_copy);
  ok('每条码都有下一步', results.codes_without_next_step?.length === 0, results.codes_without_next_step);
  ok('主文案无码名/上游原文/状态码', Object.values(results.copy_has_banned || {}).every((v) => v === false), results.copy_has_banned);

  ok('改前没有额度 Tab', results.tabs_before_has_quota === false, results.tabs_before);
  ok('额度排最后', results.quota_tab_last === '额度', results.tabs_after);
  ok('四档顺序正确', JSON.stringify(results.tabs_after) === JSON.stringify(['会话', '已完成', '自动化', '额度']), results.tabs_after);

  ok('没配 key 不画两块卡', results.nokey_cards === 0, results.nokey_cards);
  ok('没配 key 有设置入口', results.nokey_action === '设置 API key', results.nokey_action);
  ok('没配 key 不转圈', results.nokey_has_spinner === false, results.nokey_has_spinner);

  ok('有余额时无全局条', results.ok_status_bar === 0, results.ok_status_bar);
  ok('配额卡在最上', results.ok_quota_first === true, results.ok_card_order);
  ok('余额卡沉底', results.ok_balance_last === true, results.ok_card_order);
  ok('三档是 5 小时 / 7 天 / 本月', JSON.stringify(results.ok_win_names) === JSON.stringify(['最近 5 小时', '最近 7 天', '本月']), results.ok_win_names);
  ok('主数字写「已用 x%」且是上游整数', JSON.stringify(results.ok_win_used) === JSON.stringify(['已用 5%', '已用 34%', '已用 17%']), results.ok_win_used);
  ok('副行写「剩 y% + 重置时间」', results.ok_win_sub?.every((t) => /^剩 \d+% · .+重置$/.test(t)), results.ok_win_sub);
  ok('进度条是真 progressbar 且宽度对应百分比', results.ok_win_bars?.length === 3 && results.ok_win_bars.every((b) => b.role === 'progressbar' && b.width === b.now + '%'), results.ok_win_bars);
  ok('配额卡不再有「口径可能有差异」小字', results.ok_quota_note_gone === true, results.ok_quota_note_gone);
  ok('余额数值不加货币符号', results.ok_balance_has_currency === false, results.ok_balance);
  ok('余额带「不是配额」小字', /不是 ClinePass 订阅配额/.test(results.ok_balance_note || ''), results.ok_balance_note);
  ok('无 resetAt 不渲染重置行', results.ok_reset_row === 0, results.ok_reset_row);

  ok('读取中是整卡加载', results.loading_card_loading === true, results.loading_card_loading);
  ok('加载文案「正在读取…」', results.loading_text === '正在读取…', results.loading_text);
  ok('加载是骨架不是空进度条', results.loading_has_skeleton === true && results.loading_has_bar === false, [results.loading_has_skeleton, results.loading_has_bar]);
  ok('加载时余额块不受影响', results.loading_balance_still_there === true, results.loading_balance_still_there);
  ok('84% 转警示色', results.high_7d_is_warn === true && results.high_7d_bar_warn === true, [results.high_7d_used, results.high_7d_is_warn, results.high_7d_bar_warn]);
  ok('没到 80% 的档不转警示色', results.high_5h_stays_normal === true, results.high_5h_stays_normal);
  ok('用满 100% 转危险色', results.full_5h_is_danger === true && results.full_5h_bar_danger === true && results.full_5h_bar_width === '100%', [results.full_5h_used, results.full_5h_is_danger, results.full_5h_bar_width]);

  ok('块级原因不顶到全局条', results.nodata_global_bar === 0, results.nodata_global_bar);
  ok('两块各自降级（配额在上、余额在下）', results.nodata_quota_reason === 'upstream_no_data' && results.nodata_balance_reason === 'upstream_no_data' && (results.nodata_card_order[0] || '').includes('配额'), [results.nodata_quota_reason, results.nodata_balance_reason, results.nodata_card_order]);
  ok('块级降级带重试', results.nodata_balance_action === '重试', results.nodata_balance_action);

  ok('key 无效走全局条', results.invalid_status_code === 'key_invalid', results.invalid_status_code);
  ok('key 无效保留两块骨架', results.invalid_cards === 2, results.invalid_cards);
  ok('key 无效不出现上游英文/状态码', results.invalid_has_upstream_english === false, results.invalid_has_upstream_english);

  ok('连不上走全局条', results.offline_status_code === 'network_unreachable', results.offline_status_code);
  ok('连不上带重试', results.offline_action === '重试', results.offline_action);

  ok('弹层标题正确', results.sheet_title === '设置 Cline API key', results.sheet_title);
  ok('输入框是普通文本框', results.sheet_input_type === 'text', results.sheet_input_type);
  ok('没有密文眼睛按钮', results.sheet_has_eye_button === false, results.sheet_has_eye_button);
  ok('关掉自动纠正/首字母大写', results.sheet_autocomplete === 'off' && results.sheet_autocapitalize === 'off' && results.sheet_autocorrect === 'off' && results.sheet_spellcheck === 'false', [results.sheet_autocomplete, results.sheet_autocapitalize, results.sheet_autocorrect, results.sheet_spellcheck]);
  ok('重开弹层输入为空（不回显）', results.sheet_input_empty === true, results.sheet_input_empty);
  ok('空输入不能保存', results.sheet_save_disabled === true, results.sheet_save_disabled);
  ok('保存失败留在弹层且不丢输入', !!results.sheet_error_shown && results.sheet_error_keeps_value, [results.sheet_error_shown, results.sheet_error_keeps_value]);
  ok('保存成功只回「已设置」', results.saved_toast === '已设置', results.saved_toast);
  ok('屏幕上不出现 key 明文', results.saved_no_key_on_screen === true, results.saved_no_key_on_screen);
  ok('清除二次确认文案', results.clear_desc === '清除后将看不到额度。', results.clear_desc);
  ok('窄屏不横向溢出', results.narrow_doc_overflow?.scrollWidth <= results.narrow_doc_overflow?.clientWidth, results.narrow_doc_overflow);
  ok('点设置入口开弹层', results.click_open_sheet?.has_input === true, results.click_open_sheet);
  ok('取消关闭弹层', results.click_close_sheet?.has_sheet === false, results.click_close_sheet);

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass);

  const lines = [];
  lines.push(`探针结果 ${passed}/${checks.length}`);
  for (const c of checks) {
    lines.push(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  → ${JSON.stringify(c.detail)}`}`);
  }
  lines.push('');
  lines.push('原始读回：');
  lines.push(JSON.stringify(results, null, 2));
  const report = lines.join('\n');
  fs.writeFileSync(path.resolve(__dirname, 'evidence', 'probe-log.txt'), report);
  console.log(report);
  if (failed.length) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exitCode = 1;
});
