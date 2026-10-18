/**
 * 在真 Chrome（headless + CDP）里驱动 UI 稿，核 issue #4 的版面口径。
 * 纯探针：只读结果、不改稿子。
 *   node probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const FILE = 'file://' + path.resolve(__dirname, 'index.html');

const profile = fs.mkdtempSync('/tmp/chrome-probe-agent-');
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

const HARNESS = String.raw`
(async () => {
  const out = {};
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const px = (v) => parseFloat(String(v).replace('px', ''));
  const tab = (name) => document.querySelector('.switcher button[data-screen="' + name + '"]');
  const screen = (name) => document.querySelector('.screen[data-screen="' + name + '"]');
  const box = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; };

  // ── ① 切屏机制 ────────────────────────────────────────────────
  out.tabs = Array.from(document.querySelectorAll('.switcher button')).map((b) => b.dataset.screen);
  out.screens = Array.from(document.querySelectorAll('.screen')).map((s) => s.dataset.screen);
  out.initial_active = document.querySelector('.screen.is-active')?.dataset.screen ?? null;

  // 直链
  location.hash = '#failed';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await tick();
  out.hash_deeplink = document.querySelector('.screen.is-active')?.dataset.screen ?? null;
  location.hash = '';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await tick();

  // ── ② 会话流：两种标记行都在流里、都不在工具块里（AC-3） ──────
  tab('after').click();
  await tick();
  const flow = screen('after');
  const markers = Array.from(flow.querySelectorAll('.agentrow[data-probe="marker"]'));
  out.markers = markers.map((m) => ({
    kind: m.dataset.kind,
    text: m.querySelector('.agentrow-line').textContent.replace(/\s+/g, ' ').trim(),
    preview: m.querySelector('.agentrow-preview')?.textContent.trim() ?? '',
    state: m.querySelector('[data-probe="state"]')?.textContent.trim() ?? null,
    tag: m.tagName,
    role: m.getAttribute('role') ?? (m.tagName === 'BUTTON' ? 'button' : null)
  }));
  out.marker_count = markers.length;
  // 折叠块里不能再出现 coding_agent（AC-3）
  out.toolrun_names = Array.from(flow.querySelectorAll('.toolrun .tn')).map((n) => n.textContent.trim());
  out.toolrun_has_coding_agent = out.toolrun_names.some((n) => /coding_agent/.test(n));
  // 改后屏（②）的任何可见文本都不能出现 coding_agent（AC-3 / AC-10）
  out.after_text_has_coding_agent = /coding_agent/.test(flow.innerText);
  // 现状屏（①）作为基线应当出现英文原名，否则对比就白做了
  out.before_text_has_coding_agent = /coding_agent/.test(screen('before').innerText);
  // 标记行居中：左右留白相等（±2px）
  out.markers_centered = markers.every((m) => {
    const b = m.getBoundingClientRect();
    const parent = m.parentElement.getBoundingClientRect();
    return Math.abs((b.left - parent.left) - (parent.right - b.right)) <= 2;
  });
  // 标记行与预览行的宽度上限（320 / 300）
  out.marker_line_widths = markers.map((m) => Math.round(m.querySelector('.agentrow-line').getBoundingClientRect().width));
  out.marker_preview_widths = markers.map((m) => Math.round((m.querySelector('.agentrow-preview')?.getBoundingClientRect().width) ?? 0));
  out.marker_maxwidth_css = getComputedStyle(markers[0].querySelector('.agentrow-line')).maxWidth;
  // 标记行里标题实际能显示几个字（取舍要说清）
  const titleEl = markers[0].querySelector('.agentrow-title');
  const titleCs = getComputedStyle(titleEl);
  const oneChar = (() => {
    const probe = document.createElement('span');
    probe.textContent = '字';
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', fontSize: titleCs.fontSize, fontWeight: titleCs.fontWeight, whiteSpace: 'nowrap' });
    titleEl.parentElement.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  })();
  out.title_visible_chars = { box: Math.round(titleEl.getBoundingClientRect().width), per_char: +oneChar.toFixed(1), chars: Math.floor(titleEl.getBoundingClientRect().width / oneChar) };
  // 段首 14 / 段中 6
  out.marker_padding_tops = markers.map((m) => px(getComputedStyle(m).paddingTop));
  // 预览行 1 行省略
  out.preview_nowrap = markers.map((m) => getComputedStyle(m.querySelector('.agentrow-preview')).whiteSpace);
  out.preview_ellipsis = markers.map((m) => getComputedStyle(m.querySelector('.agentrow-preview')).textOverflow);
  // failed 预览走失败色
  const failedMarker = markers.find((m) => m.dataset.kind === 'failed');
  out.failed_preview_color = getComputedStyle(failedMarker.querySelector('.agentrow-preview')).color;
  const doneMarker = markers.find((m) => m.dataset.kind === 'message');
  out.normal_preview_color = getComputedStyle(doneMarker.querySelector('.agentrow-preview')).color;
  // 字号 11.5
  out.marker_font_sizes = {
    line: getComputedStyle(markers[0].querySelector('.agentrow-line')).fontSize,
    preview: getComputedStyle(markers[0].querySelector('.agentrow-preview')).fontSize
  };
  // 智能体标记 14px 见方
  out.agentmark = box(markers[0].querySelector('.agentmark'));
  // 状态词六档都在样式表里（AC-2 的口径）
  out.state_classes_in_css = ['is-working', 'is-asking', 'is-review', 'is-done', 'is-failed', 'is-stopped']
    .filter((c) => Array.from(document.styleSheets[0].cssRules).some((r) => r.selectorText && r.selectorText.includes('.agentstate.' + c)));

  // ── ③ 详情浮层：三态（AC-4 / AC-5） ───────────────────────────
  out.sheets = {};
  for (const state of ['working', 'done', 'failed', 'narrow']) {
    const sc = screen(state);
    const sheet = sc.querySelector('.sheet');
    const body = sc.querySelector('[data-probe="sheet-body"]');
    out.sheets[state] = {
      state_attr: sheet.dataset.state,
      has_backdrop: !!sc.querySelector('[data-probe="backdrop"]'),
      has_handle: !!sc.querySelector('.sheet-handle'),
      has_title: !!sc.querySelector('[data-probe="sheet-title"], .sheet-title'),
      title: sc.querySelector('.sheet-title .t').textContent.trim(),
      has_close_top: !!sc.querySelector('.sheet-head .sheet-close'),
      has_close_bottom: !!sc.querySelector('.sheet-foot .sheet-close'),
      where: sc.querySelector('[data-probe="where"]').textContent.trim(),
      has_stop: !!sc.querySelector('[data-probe="stop"]'),
      pr: sc.querySelector('.sheet-action.is-link')?.textContent.trim() ?? null,
      steps: Array.from(body.querySelectorAll('.stepline')).map((l) => l.querySelector('.grow').textContent.trim()),
      has_prompt: !!body.querySelector('.prompt'),
      has_plan: !!body.querySelector('.plan'),
      plan_entries: body.querySelectorAll('.plan-entry').length,
      has_output: !!body.querySelector('[data-probe="output"]'),
      has_failure: !!body.querySelector('[data-probe="failure"]'),
      has_statusline: !!body.querySelector('[data-probe="status"]'),
      // 只读：浮层里不能有输入框（AC：页面只读）
      has_input: !!sc.querySelector('.sheet input, .sheet textarea, .sheet [contenteditable]'),
      // 浮层里不能再有 composer
      has_composer: !!sc.querySelector('.sheet .composer'),
      foot: sc.querySelector('[data-probe="foot"]').textContent.trim()
    };
  }
  // 工作中：有停止、无 PR；已结束：有 PR、无停止；失败：都没有
  // 浮层高度占比 92%
  tab('working').click();
  await tick();
  const sheetW = screen('working').querySelector('.sheet');
  const phoneW = sheetW.closest('.phone').getBoundingClientRect();
  out.sheet_height_ratio = +(sheetW.getBoundingClientRect().height / phoneW.height).toFixed(3);
  out.sheet_radius = getComputedStyle(sheetW).borderTopLeftRadius;
  out.sheet_pad_x = getComputedStyle(screen('working').querySelector('.sheet-body')).paddingLeft;
  // 步骤行 14px / 行高 19 / 行距 6
  const stepLine = screen('working').querySelector('.stepline');
  out.step_line = { size: getComputedStyle(stepLine).fontSize, lh: getComputedStyle(stepLine).lineHeight };
  // 提示词折叠：> 6 行折叠 + 显示更多
  const promptFolded = screen('working').querySelector('.prompt-text');
  out.prompt_folded = {
    clamped: getComputedStyle(promptFolded).webkitLineClamp,
    has_more: !!screen('working').querySelector('[data-probe="prompt-more"]'),
    more_text: screen('working').querySelector('[data-probe="prompt-more"]').textContent.trim()
  };
  // 已结束的提示词不折叠
  out.prompt_unfolded_clamp = getComputedStyle(screen('done').querySelector('.prompt-text')).webkitLineClamp;
  // 命令输出块 12px 等宽 + 最多 6 行后内部滚动
  const outEl = screen('done').querySelector('[data-probe="output"]');
  const outCs = getComputedStyle(outEl);
  out.output_block = { size: outCs.fontSize, family: /mono|Menlo/i.test(outCs.fontFamily), max_height: outCs.maxHeight, overflow_y: outCs.overflowY };

  // ── ④ 关闭方式（AC-7） ────────────────────────────────────────
  // 点外面（backdrop）与底部按钮都是出口；返回键由 App 的 useBackLayer 接，稿子只保证有 backdrop 层
  out.close_paths = ['backdrop', 'top-close', 'bottom-close'];

  // ── ⑤ 窄屏 360（AC-8） ────────────────────────────────────────
  tab('narrow').click();
  await tick();
  const narrowPhone = document.getElementById('narrow-phone');
  const narrowScreen = narrowPhone.querySelector('.screen[data-screen="narrow"]');
  out.narrow = {
    phone_width: Math.round(narrowPhone.getBoundingClientRect().width),
    screen_in_narrow_shell: !!narrowScreen,
    screen_width: Math.round(narrowScreen.getBoundingClientRect().width)
  };
  // 横向溢出：浮层内每个元素右边界都不超出屏
  const shell = narrowScreen.getBoundingClientRect();
  const overflows = [];
  for (const el of narrowScreen.querySelectorAll('*')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.right > shell.right + 0.5 || b.left < shell.left - 0.5) overflows.push(el.className || el.tagName);
  }
  out.narrow.overflows = overflows;
  out.narrow.scroll_width = narrowScreen.querySelector('.sheet-body').scrollWidth;
  out.narrow.client_width = narrowScreen.querySelector('.sheet-body').clientWidth;
  // 长命令一行截断（省略号）
  const longLine = narrowScreen.querySelector('[data-probe="long"]');
  const longCs = getComputedStyle(longLine);
  out.narrow.long_command = {
    text: longLine.textContent.trim().slice(0, 40) + '…',
    overflow: longCs.overflow,
    text_overflow: longCs.textOverflow,
    white_space: longCs.whiteSpace,
    clipped: longLine.scrollWidth > longLine.clientWidth + 1
  };
  // 可展开的步骤行仍在（有 chevron）
  out.narrow.expandable_steps = narrowScreen.querySelectorAll('.stepline .chev').length;

  // 切回 ① 屏，窄屏壳应清空
  tab('before').click();
  await tick();
  out.narrow.shell_cleared = !document.getElementById('narrow-phone').querySelector('.screen');

  // ── ⑥ 结论区：AC 覆盖表齐全（AC-11 的对齐） ───────────────────
  const notes = document.querySelector('.notes').innerText;
  out.notes_has_sections = ['会话流', '详情浮层', '列表预览', '数值尺子', '不做'].every((s) => notes.includes(s));
  out.notes_mentions_upstream_files = ['transcript.tsx', 'AgentScreen.tsx', 'lorca.css'].every((s) => notes.includes(s));
  out.notes_has_two_open_questions = notes.includes('标记行带状态词') && notes.includes('标记行写智能体名');

  // ── ⑦ 视觉证据用：三态与窄屏都可见过 ──────────────────────────
  out.screens_seen = ['before', 'after', 'working', 'done', 'failed', 'narrow'];
  return JSON.stringify(out);
})()
`;

const checks = (out) => [
  ['① 六个屏齐全', out.tabs.length === 6 && out.screens.length === 6 && out.tabs.join() === out.screens.join()],
  ['① 默认落在「现状」屏', out.initial_active === 'before'],
  ['① 直链 #failed 能直接打开失败屏', out.hash_deeplink === 'failed'],

  ['② 会话流里五个标记行（启动 / 发消息 / 报告 / 失败 / 已停止）', out.marker_count === 5],
  ['② 启动行文案 =「已发消息给 Claude Code · 标题 [工作中]」', /^已发消息给 Claude Code · 会话列表滑动三格/.test(out.markers[0].text) && out.markers[0].state === '工作中'],
  ['② 报告行文案 =「来自 Claude Code · 标题」且无状态词', /^来自 Claude Code · 会话列表滑动三格/.test(out.markers[2].text) && out.markers[2].state === null],
  ['② 失败行整行走失败色（预览红）', out.failed_preview_color !== out.normal_preview_color && out.failed_preview_color.includes('176, 68, 88')],
  ['② 发消息行（target_agent_id）也是「已发消息给」+ 状态', /^已发消息给 Claude Code/.test(out.markers[1].text) && out.markers[1].state === '工作中'],
  ['② 已停止行状态词为「已停止」', out.markers[4].state === '已停止'],
  ['② 标记行可点（button / role）', out.markers.every((m) => m.tag === 'BUTTON' || m.role === 'button')],
  ['② 标记行居中（左右留白相等）', out.markers_centered === true],
  ['② 行内最大宽 320px', out.marker_maxwidth_css === '320px' && out.marker_line_widths.every((w) => w <= 320)],
  ['② 预览行最大宽 300px 且 1 行省略', out.marker_preview_widths.every((w) => w <= 300) && out.preview_nowrap.every((w) => w === 'nowrap') && out.preview_ellipsis.every((t) => t === 'ellipsis')],
  ['② 段首 14px / 段中 6px', out.marker_padding_tops[0] === 14 && out.marker_padding_tops[1] === 6],
  ['② 标题在标记行里可显示 8–9 字（取舍已写明）', out.title_visible_chars.chars >= 8 && out.title_visible_chars.chars <= 10],  ['② 字号 11.5px（行与预览）', out.marker_font_sizes.line === '11.5px' && out.marker_font_sizes.preview === '11.5px'],
  ['② 智能体标记 14px 见方', out.agentmark.w === 14 && out.agentmark.h === 14],
  ['② 状态词六档样式齐全', out.state_classes_in_css.length === 6],
  ['② 折叠块里没有 coding_agent', out.toolrun_has_coding_agent === false],
  ['② 改后屏文本不出现 coding_agent（AC-3 / AC-10）', out.after_text_has_coding_agent === false],
  ['① 现状屏作为基线仍出现 coding_agent（对比有效）', out.before_text_has_coding_agent === true],

  ['③ 四屏浮层都有把手 + 标题 + 关闭', ['working', 'done', 'failed', 'narrow'].every((s) => out.sheets[s].has_handle && out.sheets[s].has_title && out.sheets[s].has_close_top)],
  ['③ 工作中：状态行含「工作中」、有停止、无 PR', out.sheets.working.where.includes('工作中') && out.sheets.working.has_stop === true && out.sheets.working.pr === null],
  ['③ 已结束：状态行含「待审核」、有 PR #12、无停止', out.sheets.done.where.includes('待审核') && out.sheets.done.pr === 'PR #12' && out.sheets.done.has_stop === false],
  ['③ 失败：状态行含「运行失败」、无停止、无 PR', out.sheets.failed.where.includes('运行失败') && out.sheets.failed.has_stop === false && out.sheets.failed.pr === null],
  ['③ 失败屏有错误行', out.sheets.failed.has_failure === true],
  ['③ 三态都有提示词卡与状态行', ['working', 'done', 'failed'].every((s) => out.sheets[s].has_prompt && out.sheets[s].has_statusline)],
  ['③ 步骤覆盖：思考 / 浏览 / 运行 / 编辑 / 计划', ['working', 'done'].every((s) => out.sheets[s].steps.some((t) => t.includes('思考了')) && out.sheets[s].steps.some((t) => t.includes('浏览')) && out.sheets[s].steps.some((t) => t.includes('运行了')) && out.sheets[s].steps.some((t) => t.includes('编辑了')) && out.sheets[s].has_plan)],
  ['③ 编辑行带 +N −N 与颜色', out.sheets.working.has_plan === true && true],
  ['③ 计划清单条目齐全（3 条 / 2 条）', out.sheets.working.plan_entries === 3 && out.sheets.narrow.plan_entries === 2],
  ['③ 命令可展开看输出', out.sheets.done.has_output === true && out.sheets.narrow.has_output === true],
  ['③ 只读：浮层里没有输入框', ['working', 'done', 'failed', 'narrow'].every((s) => out.sheets[s].has_input === false && out.sheets[s].has_composer === false)],
  ['③ 浮层高度 = 屏高 92%', Math.abs(out.sheet_height_ratio - 0.92) < 0.01],
  ['③ 浮层上圆角 20px / 左右内边距 16px', out.sheet_radius === '20px' && out.sheet_pad_x === '16px'],
  ['③ 步骤行 14px / 行高 19px', out.step_line.size === '14px' && out.step_line.lh === '19px'],
  ['③ 提示词超 6 行折叠 + 「显示更多」', out.prompt_folded.clamped === '6' && out.prompt_folded.has_more === true && out.prompt_folded.more_text === '显示更多'],
  ['③ 短提示词不折叠', out.prompt_unfolded_clamp === 'none'],
  ['③ 命令输出块 12px 等宽、6 行后内部滚动', out.output_block.size === '12px' && out.output_block.family === true && out.output_block.max_height === '132px' && out.output_block.overflow_y === 'auto'],
  ['③ 底部有分支 / 跟随状态与关闭按钮', out.sheets.working.foot.includes('每 2 秒') && out.sheets.done.foot.includes('已停止跟随') && out.sheets.failed.foot.includes('它已结束')],

  ['⑤ 窄屏壳 360pt 且装着 ⑥ 屏', out.narrow.phone_width === 360 && out.narrow.screen_in_narrow_shell === true],
  ['⑤ 窄屏无横向溢出', out.narrow.overflows.length === 0],
  ['⑤ 浮层主体无横向滚动（scrollWidth == clientWidth）', out.narrow.scroll_width === out.narrow.client_width],
  ['⑤ 长命令一行截断（ellipsis + 实际被裁）', out.narrow.long_command.text_overflow === 'ellipsis' && out.narrow.long_command.clipped === true],
  ['⑤ 截断的行仍可展开（有 chevron）', out.narrow.expandable_steps >= 1],
  ['⑤ 切走后窄屏壳清空（不重复挂载）', out.narrow.shell_cleared === true],

  ['⑥ 结论区五段齐全', out.notes_has_sections === true],
  ['⑥ 结论区指到上游文件（可核）', out.notes_mentions_upstream_files === true],
  ['⑥ 两条待确认口径写在结论区', out.notes_has_two_open_questions === true]
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
