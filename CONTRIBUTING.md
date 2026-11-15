# 贡献指南

感谢你愿意改进 ToDoLocal。为保持项目定位，请先了解以下约束。

## 设计边界

1. **严格离线**：不得引入任何运行时网络请求、遥测、自动更新或 CDN 资源。
2. **零运行时依赖**：渲染层保持原生 HTML / CSS / JavaScript，不引入前端框架或 UI 库。
3. **数据格式兼容**：修改 `data.json` 结构时必须提供旧数据迁移或向后兼容读取。
4. **单平台优先**：当前仅保证 Windows x64 行为，跨平台改动需自行验证。

## 开发环境

```bash
npm install
npm start
```

提交前请运行自动化验收，确认 29 项全部通过：

```bash
npx electron tools/verify.js
```

若宿主注入了 `ELECTRON_RUN_AS_NODE=1`，使用 `env -u ELECTRON_RUN_AS_NODE npx electron tools/verify.js`。

## 提交规范

- 提交信息采用简洁的祈使句，例如 `fix: 修复跨零点后我的一天未刷新`。
- 前缀建议：`feat` / `fix` / `refactor` / `docs` / `test` / `chore`。
- 一个提交聚焦一件事，不涉及无关格式化改动。
- 不要提交 `dist/`、`release/`、`node_modules/`、`verify-out/`、`data.json` 或任何个人数据。

## Pull Request

- 说明改动动机、实现方式与验证结果（附验收脚本输出或截图）。
- 涉及 UI 的改动请附前后对比截图。
- 涉及主进程 IPC 或数据文件路径的改动，请说明对绿色版与开发态两种运行形态的影响。

## 报告问题

请使用 Issue 模板，并尽量提供：Windows 版本、应用版本、复现步骤、实际与预期行为、`verify-out/report.json`（如有）。**请勿在 Issue 中粘贴 `data.json` 内容**，其中可能包含你的真实任务信息。
