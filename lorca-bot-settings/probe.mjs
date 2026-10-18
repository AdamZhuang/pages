/**
 * 在真 Chrome 里驱动「队友设置」UI 稿 v1，逐屏核 AC-4/5/6/7/8/9 的口径。
 * 纯探针：只读结果、不改稿子。
 *   node probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9337;
const FILE = 'file://' + path.resolve(__dirname, 'index.html');

const profile = fs.mkdtempSync('/tmp/chrome-probe-botsettings-');
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
  const value = (key) => text(document.querySelector('[data-value="' + key + '"]'));

  // ── 目录本身（AC-4 / AC-7 / AC-6） ─────────────────────────────
  out.catalog_total = M.catalog().length;
  out.catalog_decides = M.catalog().filter((m) => m.decides).map((m) => m.provider + '/' + m.id);
  out.models_magpie = M.modelsFor('custom:127-0-0-1').map((m) => m.id);
  out.models_magpie_has_decides = M.modelsFor('custom:127-0-0-1').some((m) => m.decides);
  out.levels_magpie_longest = M.levelsFor('custom:127-0-0-1', 'clinepass/cline-pass/deepseek-v4.1-flash');
  out.levels_empty_model = M.levelsFor('custom:127-0-0-1', 'clinepass/cline-free/mimo-v2.6-flash');
  out.levels_cli_minimax = M.levelsFor('custom:cli-proxy', 'minimax-m3');
  out.levels_unknown_model_falls_back = M.levelsFor('custom:127-0-0-1', 'no-such-model');
  out.provider_label_magpie = M.providerLabel('custom:127-0-0-1');
  out.provider_label_cli = M.providerLabel('custom:cli-proxy');
  out.provider_label_opencode = M.providerLabel('opencode');
  out.provider_label_gone_custom = M.providerLabel('custom:gone');

  // 服务商列表顺序与接入状态（AC-8）
  const choices = M.providerChoices();
  out.provider_order = choices.map((c) => c.label + (c.connected ? '' : '(未接入)'));
  out.provider_groups = choices.map((c) => c.group);
  out.provider_first_is_connected = choices[0].connected;

  // 联动（AC-5）
  const start = { provider: 'custom:127-0-0-1', model: 'clinepass/cline-pass/deepseek-v4.1-flash', thinking: 'high' };
  out.switch_provider_clears = M.nextRuntime(start, { provider: 'grok' });
  out.switch_same_provider_keeps = M.nextRuntime(start, { provider: 'custom:127-0-0-1' });
  // magpie 的 mimo-v2.6-flash levels 为空 → 当前档 high 不被支持，应清回默认
  out.switch_model_unsupported_clears = M.nextRuntime(start, { model: 'clinepass/cline-free/mimo-v2.6-flash' });
  // 反例：grok/grok-4.7 支持 high，不清
  out.switch_model_keeps_high = M.nextRuntime(start, { model: 'grok/grok-4.7' });
  out.switch_model_supported_keeps = M.nextRuntime(
    { provider: 'custom:cli-proxy', model: 'deepseek-v4.1-flash', thinking: 'high' },
    { model: 'gpt-5.6-terra' }
  );
  out.switch_thinking_sets = M.nextRuntime(start, { thinking: 'max' });

  // ── 屏 ①：改前 ⋯ 菜单（没有「队友设置」） ─────────────────────
  M.setScreen('before'); await tick();
  const menuBefore = Array.from(document.querySelectorAll('.more-menu > button')).map(text);
  out.menu_before = menuBefore;
  out.menu_before_has_entry = menuBefore.includes('队友设置');

  // ── 屏 ②：改后 ⋯ 菜单（有，且位置正确） ───────────────────────
  M.setScreen('after'); await tick();
  const menuAfter = Array.from(document.querySelectorAll('.more-menu > button')).map(text);
  out.menu_after = menuAfter;
  out.menu_after_has_entry = menuAfter.includes('队友设置');
  out.menu_after_index = menuAfter.indexOf('队友设置');

  // ── 屏 ③：三段与当前值（AC-4） ────────────────────────────────
  M.setScreen('settings'); await tick();
  out.settings_labels = Array.from(document.querySelectorAll('.optrow .optrow-label')).map(text);
  out.settings_provider_value = value('provider');
  out.settings_model_value = value('model');
  out.settings_thinking_value = value('thinking');
  out.settings_hint = text(document.querySelector('.sheet-hint'));

  // ── 屏 ④：选服务商 ────────────────────────────────────────────
  M.setScreen('provider'); await tick();
  const provRows = Array.from(document.querySelectorAll('.pick-row'));
  out.provider_rows = provRows.map((r) => ({
    label: text(r.querySelector('.pick-label')),
    selected: r.classList.contains('is-selected'),
    disabled: r.classList.contains('is-disabled'),
    reason: text(r.querySelector('.pick-reason'))
  }));
  out.provider_divider_count = document.querySelectorAll('.pick-divider').length;

  // ── 屏 ⑤：选模型（搜索框 + 长 id） ────────────────────────────
  M.setScreen('model'); await tick();
  out.model_search_shown = !!document.getElementById('model-search');
  out.model_rows_count = document.querySelectorAll('.pick-row').length;
  out.model_first_label = text(document.querySelector('.pick-row .pick-label'));
  out.model_has_jev = Array.from(document.querySelectorAll('.pick-sub')).some((e) => text(e).includes('jev-1.13'));
  const longest = Array.from(document.querySelectorAll('.pick-sub')).map((e) => text(e)).sort((a, b) => b.length - a.length)[0];
  out.model_longest_sub = longest;
  // 长 id 在 360px 抽屉里是否溢出：量它自己的 scrollWidth / clientWidth
  const phone = document.getElementById('phone');
  phone.classList.add('is-narrow');
  await tick();
  const sub = Array.from(document.querySelectorAll('.pick-sub')).find((e) => text(e) === longest);
  out.model_longest_overflow = sub ? { scrollWidth: sub.scrollWidth, clientWidth: sub.clientWidth } : null;
  const doc = document.documentElement;
  out.narrow_doc_overflow = { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  const sheet = document.querySelector('.sheet');
  out.narrow_sheet_overflow = sheet ? { scrollWidth: sheet.scrollWidth, clientWidth: sheet.clientWidth } : null;
  phone.classList.remove('is-narrow');

  // 搜索过滤
  M.setScreen('model'); await tick();
  const input = document.getElementById('model-search');
  if (input) {
    input.value = 'grok';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    out.search_grok_rows = Array.from(document.querySelectorAll('.pick-label')).map(text);
  }

  // ── 屏 ⑥：选思考（只列该模型支持的档） ────────────────────────
  M.setScreen('thinking'); await tick();
  out.thinking_rows = Array.from(document.querySelectorAll('.pick-row .pick-label')).map(text);
  out.thinking_selected = Array.from(document.querySelectorAll('.pick-row.is-selected .pick-label')).map(text);

  // ── 屏 ⑦：换服务商后（模型与思考都回默认） ────────────────────
  M.setScreen('switched'); await tick();
  out.switched_provider = value('provider');
  out.switched_model = value('model');
  out.switched_thinking = value('thinking');
  out.switched_rows = Array.from(document.querySelectorAll('.optrow .optrow-label')).map(text);

  // ── 屏 ⑧：无思考档的模型 → 思考整段消失 ──────────────────────
  M.setScreen('nolevels'); await tick();
  out.nolevels_rows = Array.from(document.querySelectorAll('.optrow .optrow-label')).map(text);
  out.nolevels_model = value('model');

  // ── 屏 ⑨：360px 窄屏三段 ─────────────────────────────────────
  M.setScreen('narrow'); await tick();
  const phoneN = document.getElementById('phone');
  out.narrow_phone_width = Math.round(phoneN.getBoundingClientRect().width);
  out.narrow_settings_overflow = {
    doc: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    sheet: (() => { const s = document.querySelector('.sheet'); return s ? { scrollWidth: s.scrollWidth, clientWidth: s.clientWidth } : null; })(),
    value: (() => { const v = document.querySelector('[data-value="model"]'); return v ? { scrollWidth: v.scrollWidth, clientWidth: v.clientWidth, ellipsis: getComputedStyle(v).textOverflow } : null; })()
  };

  // 点选一条模型 → 联动回三段
  M.setScreen('settings'); await tick();
  document.querySelector('[data-action="open-model"]').click();
  await tick();
  const target = Array.from(document.querySelectorAll('.pick-row')).find((r) => (r.dataset.model || '') === 'grok/grok-4.7');
  if (target) target.click();
  await tick();
  out.click_model_result = {
    screen_has_settings: !!document.querySelector('.optgroup'),
    model: value('model'),
    thinking: value('thinking'),
    rows: Array.from(document.querySelectorAll('.optrow .optrow-label')).map(text)
  };

  // 点未接入的服务商 → 不生效
  M.setScreen('provider'); await tick();
  const disabled = document.querySelector('.pick-row.is-disabled');
  if (disabled) disabled.click();
  await tick();
  out.click_disabled_stays = !!document.querySelector('.pick-list');

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

  const errors = [];
  client.send('Log.enable').catch(() => {});
  const evalRes = await client.send('Runtime.evaluate', {
    expression: HARNESS, awaitPromise: true, returnByValue: true
  });
  if (evalRes.exceptionDetails) {
    console.error('探针脚本抛错：', JSON.stringify(evalRes.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    Object.assign(results, evalRes.result.value || {});
  }

  // 截图：逐屏
  const shots = [
    ['before', 'shot-1-before-menu.png'],
    ['after', 'shot-2-after-menu.png'],
    ['settings', 'shot-3-settings.png'],
    ['provider', 'shot-4-provider.png'],
    ['model', 'shot-5-model.png'],
    ['thinking', 'shot-6-thinking.png'],
    ['switched', 'shot-7-switched.png'],
    ['nolevels', 'shot-8-nolevels.png'],
    ['narrow', 'shot-9-narrow.png']
  ];
  fs.mkdirSync(path.resolve(__dirname, 'evidence'), { recursive: true });
  for (const [screen, file] of shots) {
    await client.send('Runtime.evaluate', { expression: `window.__mock.setScreen(${JSON.stringify(screen)})` });
    await sleep(120);
    const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(__dirname, 'evidence', file), Buffer.from(shot.data, 'base64'));
  }

  client.close();
  chrome.kill();

  // ── 断言 ─────────────────────────────────────────────────────
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  check('AC-4 当前值：服务商显示 magpie', results.settings_provider_value === 'magpie', results.settings_provider_value);
  check('AC-4 当前值：模型显示 name', results.settings_model_value === 'cline-pass/deepseek-v4.1-flash', results.settings_model_value);
  check('AC-4 当前值：思考显示「高」', results.settings_thinking_value === '高', results.settings_thinking_value);
  check('AC-4 三段齐（服务商/模型/思考）', JSON.stringify(results.settings_labels) === JSON.stringify(['服务商', '模型', '思考']), results.settings_labels);
  check('入口：改前菜单没有「队友设置」', results.menu_before_has_entry === false, results.menu_before);
  check('入口：改后菜单有「队友设置」', results.menu_after_has_entry === true, results.menu_after);
  check('入口：位置在「移到分组」之后', results.menu_after_index === 2, results.menu_after_index);
  check('AC-8 未接入 provider 标灰且不可点', results.provider_rows.some((r) => r.disabled && r.reason === '未接入'), results.provider_rows.filter((r) => r.disabled).length);
  check('AC-8 已接入 provider 可点', results.provider_rows.filter((r) => !r.disabled).every((r) => r.reason === null), results.provider_rows.filter((r) => !r.disabled).map((r) => r.label));
  check('AC-8 服务商顺序：已接入的内置在前、其余内置按原序、自定义最后', JSON.stringify(results.provider_order) === JSON.stringify([
    'Grok', 'DeepSeek(未接入)', 'Anthropic(未接入)', 'OpenCode Zen(未接入)', 'OpenCode Go(未接入)', 'ChatGPT(未接入)', 'CLI Proxy', 'magpie'
  ]), results.provider_order);
  check('AC-8 内置与自定义之间一条分隔线', results.provider_divider_count === 1, results.provider_divider_count);
  check('AC-7 decides 模型不进候选（目录里 2 条）', results.catalog_decides.length === 2 && results.models_magpie_has_decides === false, results.catalog_decides);
  check('AC-7 magpie 10 条全在，jev 不在模型列表', results.model_rows_count === 11 && results.model_has_jev === false, { rows: results.model_rows_count, has_jev: results.model_has_jev });
  check('AC-6 思考只列该模型支持的档（low/high/max）', JSON.stringify(results.thinking_rows) === JSON.stringify(['默认', '低', '高', '最高']), results.thinking_rows);
  check('AC-6 当前档选中「高」', JSON.stringify(results.thinking_selected) === JSON.stringify(['高']), results.thinking_selected);
  check('AC-5 换服务商：模型与思考都回默认', results.switched_provider === 'Grok' && results.switched_model === '默认（Grok 4.7）' && results.switched_thinking === '默认', results.switched_rows);
  check('AC-5 换模型不支持当前档：思考回默认', results.switch_model_unsupported_clears.thinking === null, results.switch_model_unsupported_clears);
  check('AC-5 换模型支持当前档：思考保留', results.switch_model_supported_keeps.thinking === 'high', results.switch_model_supported_keeps);
  check('AC-6 无档模型：思考整段不出现', JSON.stringify(results.nolevels_rows) === JSON.stringify(['服务商', '模型']), results.nolevels_rows);
  check('AC-9 360px 抽屉不横向溢出', results.narrow_settings_overflow.sheet.scrollWidth <= results.narrow_settings_overflow.sheet.clientWidth, results.narrow_settings_overflow.sheet);
  check('AC-9 360px 当前值单行省略', results.narrow_settings_overflow.value.ellipsis === 'ellipsis', results.narrow_settings_overflow.value);
  check('AC-9 长 id 在选择列表里换行不截断', results.model_longest_overflow.scrollWidth <= results.model_longest_overflow.clientWidth, results.model_longest_overflow);
  check('搜索框：magpie 10 条时出现', results.model_search_shown === true, results.model_search_shown);
  check('搜索「grok」只剩 grok 两条 + 默认行', JSON.stringify(results.search_grok_rows) === JSON.stringify(['默认（cline-pass/deepseek-v4.1-flash）', 'Grok 4.7', 'Grok 4.6']), results.search_grok_rows);
  check('点未接入的服务商不生效', results.click_disabled_stays === true, results.click_disabled_stays);
  check('点模型后回到三段且值更新', results.click_model_result.screen_has_settings === true && results.click_model_result.model === 'Grok 4.7', results.click_model_result);

  const passed = checks.filter((c) => c.ok).length;
  const lines = [];
  lines.push(`# 队友设置 UI 稿 v1 探针 — ${passed}/${checks.length}`);
  lines.push('');
  for (const c of checks) {
    lines.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  → 实际：' + JSON.stringify(c.detail)}`);
  }
  lines.push('');
  lines.push('## 原始读数');
  lines.push(JSON.stringify(results, null, 2));

  const report = lines.join('\n');
  fs.writeFileSync(path.resolve(__dirname, 'evidence', 'probe-log.txt'), report);
  console.log(report);
  if (passed !== checks.length) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exitCode = 1;
});
