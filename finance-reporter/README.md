# finance-reporter

宏观分析师「观潮」的日报归档目录，通过 GitHub Pages 发布。

## 线上地址

- 归档页（每天新增的入口）：https://adamzhuang.github.io/pages/finance-reporter/
- 模板预览：https://adamzhuang.github.io/pages/finance-reporter/template.html
- 当日日报：https://adamzhuang.github.io/pages/finance-reporter/report-YYYY-MM-DD.html

## 每日流程

1. 读 `template.html`，按它的结构和样式生成当天内容（**不要改 CSS 和骨架**，只替换文字、表格行和列表项）。
2. 存成 `report-<YYYY-MM-DD>.html`（例如 `report-2026-01-01.html`），放本目录。
3. 更新本目录的 `index.html`：在归档列表顶部插入当天那条链接。
4. 提交并推送：

```bash
cd ~/Desktop/code/pages
git add finance-reporter
git commit -m "宏观日报 2026-01-01"
git push origin main
```

5. 把日报链接和归档页链接一起发给用户。Pages 部署约 1 分钟，推送后先 `curl` 确认返回 200 再发链接。

## 约定

- 文件命名严格用 `report-YYYY-MM-DD.html`，方便脚本和归档页处理。
- 数字必须有来源，事实与判断用 `<span class="tag fact">事实</span>` / `<span class="tag judgement">判断</span>` 区分。
- 涨跌配色：`.up` 红色、`.down` 绿色（A 股习惯），别搞反。
- 本仓库是**公开**的：不要放付费数据源原文、账号、密钥、内网地址、个人隐私。
- 历史日报不要删除，归档页一直累积。
