# Bot 页「额度」Tab · UI 稿（issue #3）

静态稿：`index.html`（单文件，无外链资源）。探针：`node probe.mjs`（真 Chrome，51 项断言）。
证据：`evidence/probe-log.txt` + 十三张截图。

口径来源：issue #3 正文 + 2026-10-18 群里与研发锁定的方案（原因码 / 两块独立降级 / not_configured 不画卡）。

版本：
- v1：四档 Tab、五条原因码分层、设置/清除 key 弹层。
- v2：配额卡置顶、5 小时 / 7 天两档进度条、余额沉底、30 天不显示、key 输入框改普通文本格子。
- v3：改用官方 `GET /api/v1/users/me/plan/usage-limits` 一次拿三档（5 小时 / 7 天 / 本月），
  每档带重置时间；分档加载作废，改整卡加载；删掉「与官方口径可能有差异」小字；本月放开显示。

key 一律由 Adam 自己在 App 里填；稿子里没有任何真实凭据，百分比是上游返回的样例值。
