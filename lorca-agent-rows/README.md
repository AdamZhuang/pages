# avatar 编程智能体 · 标记行 + 运行详情浮层（issue #4 P1）

- 线上地址：https://adamzhuang.github.io/pages/lorca-agent-rows/
- 内容：会话流里两种智能体消息的**居中标记行**（启动行 / 发消息行 / 报告行 / 失败行）、
  **运行详情浮层三态**（工作中 / 已结束 / 失败）、窄屏 360pt 检查、与 issue #4 十一条 AC 的对应表。
- 交互：顶部六个按钮切屏，或直链 `#before` / `#after` / `#working` / `#done` / `#failed` / `#narrow`。
- `probe.mjs`：在真 Chrome（headless + CDP）里核 48 项版面口径（居中、320/300 宽上限、
  段距 14/6、字号 11.5、浮层 92% 高、步骤行 14/19、提示词 6 行折叠、窄屏无横向溢出等）。
  跑法：`node probe.mjs`（需要 `/Applications/Google Chrome.app`），实跑输出见 `evidence/probe-log.txt`。
- `shots.mjs`：同一套 Chrome 驱动拍六张证据图到 `evidence/`。跑法：`node shots.mjs`。
- 口径来源：avatar `apps/mobile/src/styles/{tokens,lorca}.css`、`apps/mobile/src/lorca/LorcaPanel.tsx`；
  上游 lorca `docs/architecture/coding-agents.md`、`mobile/src/ui/{transcript.tsx,AgentScreen.tsx,codingAgents.ts}`、
  `mobile/src/i18n/zh.ts`、`crates/cli/src/{model.rs,coding/transcript.rs}`（GPL-3.0，只读口径，不抄代码）。

## 待用户确认的两条（偏离上游，理由是不引 logo 资产）

1. 标记行**带状态词**（工作中 / 需要处理 / 待审核 / 已完成 / 运行失败 / 已停止）。
2. 标记行**写智能体名**（Claude Code / Codex / OpenCode / pi / fx）。

确认后写进 issue #4 的验收标准。
