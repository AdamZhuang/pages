# avatar 会话列表动作 · UI 稿（issue #1）

- 线上地址：https://adamzhuang.github.io/pages/lorca-list-actions/
- 内容：会话列表的滑动三格（置顶/取消置顶 · 隐藏 · ⋯ 更多）、Hidden 分组、删除二次确认；
  含「现状 · 改前」基线屏、数值尺子表、15 条验收口径（AC）。
- 交互：① 屏的行可直接拖动，读数打在页面右侧；切屏用顶部按钮，或 `#swipe` / `#menu` / `#hidden` / `#confirm` / `#before` 直链。
- `probe.mjs`：在真 Chrome（headless + CDP）里驱动 ① 屏，核吸附、方向判定、一次只开一行、
  滚动关闭、第三格菜单等 25 项判定。跑法：`node probe.mjs`（需要 `/Applications/Google Chrome.app`）。
- 口径来源：`apps/mobile/src/styles/{tokens,lorca}.css` 与上游 lorca `docs/architecture/{sidebar,phone-app}.md`。
