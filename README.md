# ToDoLocal

> 类 Microsoft To Do 的**纯本地离线**任务清单桌面应用。无需账号、无需联网，数据只保存在你自己的电脑上。

基于 Electron 45 与原生 HTML / CSS / JavaScript 构建，零前端框架、零外部资源、零云端依赖。主进程通过 IPC 读写本地 JSON 文件，并在网络层拦截所有非本地 URL 请求。

![主界面 · 我的一天](docs/screenshots/main-light.png)

## 更新日志

### v1.2.0 · 2026-11-25

首个功能完整版本。完整绿色包见 [Releases](https://github.com/nsq4926/ToDoLocal/releases)。相对 v1.1.0 的主要变化：

**新增**

- **窗口置顶**：大面板与迷你面板标题栏各新增「置顶」按钮，两个面板共用同一置顶状态并高亮。
- **工作区**（原「设置工作文件夹」升级）：任务可关联多个目录 / 文件，在详情面板内**常驻展开**（独立卡片，排在「备注」之后，标题为空态「设置工作区」、有内容时「工作区 · N 项」），支持多选、拖入、点击条目打开、单条移除与清空；迷你面板二级页面同样可查看 / 添加 / 移除工作区。
- **导出到 Excel**：更多菜单新增「导出到 Excel」，零依赖手写 OOXML。**一行一个任务**，列顺序为 是否星标 / 待办标题 / 步骤 / 添加日期 / 截至日期 / 重复状态 / 所属列表 / 备注，最后一列起为「工作区目录\\文件」（可点击 `file:///` 超链接，一个任务多个条目时向右追加「（2）（3）」列）；带表头样式、列宽、冻结首行、自动筛选、按内容估算行高，默认保存到「文档」。
- **关于页**：显示作者 nsq4926 与 GitHub 链接（外链只放行 http/https）。

**改进与修复**

- **工作区拖入修复**：放置区从文本框扩大到**整个详情面板**；新增 `dropPaths()`，依次尝试 `File.path` / `webUtils.getPathForFile` 并回退解析 `text/uri-list` / `text/plain` 的 `file:///` 路径；管理员权限运行时 Windows UIPI 会拦截来自普通资源管理器的拖放，此时给出提示并引导改用「添加文件…」。
- **Excel 超链接写法**与 Excel 自身一致（`file:///` + 反斜杠、中文不转义，仅转义空格与 `#?%&`），修复此前全量百分号编码导致 Excel 按 ANSI 解码出现「找不到文件」。
- **图标统一**：`build/gen_icon.py` 一次性生成 `build/icon.ico` 与 `src/icon.ico`（16–256 共 7 帧同源），窗口 / 任务栏 / 托盘共用，修复此前的「图标不一致」。
- **托盘与再次启动**：关闭窗口 = 隐藏到托盘；单实例锁不可靠时用 `ToDoLocal-Data/instance.pid` 复核，残留 PID 不再阻塞启动；第二次启动通过 `wake.flag` 唤起已有窗口；托盘不可用时关闭窗口即直接退出以免失联；托盘图标改用 64×64 PNG 并尝试写入 `IsPromoted=1` 使其常驻可见，托盘菜单新增「在任务栏显示托盘图标…」直达系统设置。
- **双击启动**：本机 Electron 45 的 Chromium 沙箱无法初始化，启动时自动追加 `--no-sandbox`，并以用户环境变量 `ELECTRON_DISABLE_SANDBOX=1` 兜底；绿色版内置「启动.bat」（失败自动重试）与桌面快捷方式（参数带 `--no-sandbox`）。修复 `requestSingleInstanceLock()` 在 userData 目录不存在时导致进程直接崩溃（表现为双击无反应）的问题。
- **启动提速与诊断**：`launch.log` 从主进程第一行开始记录（版本 / argv / 页面加载失败 / 渲染进程退出 / 未捕获异常）；启动耗时约 180ms（boot → 界面就绪），冷启动主要耗时在 Windows Defender 扫描约 238MB 的 exe；检测到 `ELECTRON_RUN_AS_NODE` 时以干净环境重启自身。
- **验收**：`tools/verify.js` 由 29 项扩充到 34 项，覆盖工作区编辑区 / 空状态 / 移除、导出 Excel 数据与落盘、图标同源多尺寸断言。

> 已知问题：部分环境的任务栏按钮仍显示为「Electron」并使用 Electron 自带图标（由 Windows 侧为该 exe 记录的应用身份缓存导致，与图标资源无关），仍在排查。

### v1.1.0

首个开源版本。

## 为什么做这个

市面上的任务清单大多要求注册账号、数据上云。ToDoLocal 的目标是把熟悉的 Microsoft To Do 交互体验完整搬到桌面，同时把数据主权交还给用户：

- **严格离线**：`session.webRequest` 拦截一切 `file:` / `data:` / `blob:` 之外的请求，Electron 自身的后台联网（更新探测、组件更新、DNS 预取）也被关闭。
- **数据自主**：单一 `data.json`，原子写入（临时文件 + rename），支持一键导出 / 导入 JSON 备份，可随目录整体搬走。
- **绿色便携**：数据文件固定在软件目录，不写入注册表、不污染系统目录。

## 功能

| 模块 | 说明 |
| --- | --- |
| 智能列表 | 我的一天（跨零点自动重置）、重要、已计划 |
| 自定义列表 | 新建 / 重命名 / 删除 / 排序 / 主题色，任务可在列表间移动、复制 |
| 任务 | 完成、星标、步骤、备注、截止日期、提醒、重复规则、拖拽排序、已完成折叠 |
| 组织 | 全局搜索、多种排序、右键菜单（含「今天 / 明天到期」「根据任务建列表」） |
| 导出 | 更多菜单「导出到 Excel」：星标、标题、步骤、添加日期、截止日期、重复状态、所属列表、备注，最后一列起是工作区路径（可点击超链接，多条向右追加列）；默认保存到「文档」 |
| 详情面板 | 卡片内步骤展开、工作区常驻展开（目录 / 文件可多选、可拖入——整个详情面板都是放置区，点击条目用资源管理器或默认程序打开）；迷你面板同样可查看 / 添加 / 移除工作区 |
| 外观 | 6 套主题（含深色）、侧栏折叠、迷你小面板（清单 ↔ 详情平推，尺寸偏好记忆） |
| Windows 集成 | 系统托盘常驻（关闭窗口 = 隐藏到托盘）、开机自启、本地通知、无边框窗口、单实例锁（含锁误报兜底）、大 / 迷你面板标题栏「窗口置顶」按钮 |

### 截图

| 深色主题 | 迷你小面板 |
| --- | --- |
| ![深色主题](docs/screenshots/main-dark.png) | ![迷你小面板](docs/screenshots/mini-panel.png) |

任务右键菜单提供 12 项操作，详情见 [右键菜单截图](docs/screenshots/context-menu.png)。

## 快速开始

### 环境要求

- Windows 10 / 11（x64）
- Node.js 18+ 与 npm

### 运行源码

```bash
npm install
npm start
```

数据文件在开发态位于 `%APPDATA%/ToDoLocal/data/data.json`。

### 打包

```bash
npm run dist
```

electron-builder 输出到 `release/`。绿色版目录结构为 `release/win-unpacked/`，应用图标取自 `build/icon.ico`；图标可用 `python build/gen_icon.py` 重新生成（纯 Python 标准库，无第三方依赖）。脚本会同时写出 `build/icon.ico` 与 `src/icon.ico`，两者始终一致，窗口、任务栏与托盘图标不会再出现不一致。

完全离线、electron-builder 卡在 winCodeSign 等工具下载时，可以只重打运行时代码，保留已带图标与版本信息的 exe：

```bash
node tools/pack-asar.js                        # 默认更新 electron/dist/ToDoLocal
node tools/pack-asar.js --app release/win-unpacked
```

脚本用当前 `src/` 重新生成 `resources/app.asar`（含 `src/xlsx.js`），把旧包备份为 `app.asar.<旧版本>.bak`，并同步 `resources/icon.ico`。

> 国内网络提示：若 Electron 二进制下载失败，可设置镜像后手动补齐：
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
> ```
> 仓库内的 `.npmrc` 已配置 npmmirror 源。

### 自动化验收

`tools/verify.js` 会启动真实 Electron 窗口，执行 34 项交互与落盘断言，并输出截图到 `verify-out/`：

```bash
npx electron tools/verify.js
```

部分宿主环境会注入 `ELECTRON_RUN_AS_NODE=1`，此时需先清除该变量：

```bash
env -u ELECTRON_RUN_AS_NODE npx electron tools/verify.js
```

### 启动排查

双击后没有窗口时，先看 `<软件目录>/ToDoLocal-Data/launch.log`：它在主进程第一行就开始写，记录每次启动的版本、`argv`、`runAsNode`、页面加载失败、渲染进程退出与未捕获异常。

- **日志为空 = JS 根本没执行**：Chromium 在加载 app 之前就退出了。本机实测为 GPU / 渲染子进程创建被系统拒绝（日志中会出现 `子进程退出 type=GPU reason=launch-failed`）。用带 `--no-sandbox` 的入口启动即可：绿色版目录内的 `启动.bat`、`ToDoLocal 启动.lnk`，或桌面上的 `ToDoLocal` 快捷方式（参数已带 `--no-sandbox`）。
- 应用自身也会在启动时追加 `--no-sandbox`（设置环境变量 `TODOLOCAL_KEEP_SANDBOX=1` 可关闭），因此只要 Chromium 能起来，后续子进程就不会再被拦。
- 日志里出现「已有实例在运行（pid=…）」但任务管理器里没有 `ToDoLocal.exe`：1.2.0 起用 `<软件目录>/ToDoLocal-Data/instance.pid` 复核，只有该 PID 仍存活才会阻止启动，残留的 PID 文件不会阻塞。
- 已有实例常驻托盘时，再次启动不会新开窗口，而是唤起原窗口（日志记录「检测到重复启动」）；点窗口右上角 × 只是隐藏到托盘，要真正退出请用托盘右键菜单「退出」。
- 关闭窗口后托盘图标消失或找不到时：再次启动会通过 `ToDoLocal-Data/wake.flag` 请求已有实例把窗口显示出来（日志记录「收到唤醒请求」）；若托盘创建失败，关闭窗口将直接退出而不是隐藏，避免应用失联。
- 往工作区拖入文件没反应时：先确认软件不是「以管理员身份运行」。Windows 会拦截从普通资源管理器到提权窗口的拖放（UIPI），此时详情面板工作区下方会显示提示，改用「添加文件…」即可；拖放过程会写进 `launch.log`（`[ui] dragover/drop …`），便于排查。
- 双击 `ToDoLocal.exe` 没反应：本机 Electron 45 的 Chromium 沙箱无法初始化（连最小的 Electron 示例都起不来），必须在命令行带 `--no-sandbox`。软件已把用户环境变量 `ELECTRON_DISABLE_SANDBOX=1` 作为兜底（设置后需重启资源管理器或注销一次才生效），`启动.bat` 与桌面快捷方式也会显式带上该参数。取消兜底：`setx ELECTRON_DISABLE_SANDBOX ""`。
- 点 × 后窗口消失但进程还在（常驻托盘）：Windows 11 默认把新的托盘图标收进任务栏右下角的「^」溢出区。托盘右键菜单里有「在任务栏显示托盘图标…」，会直接打开系统设置页；勾选 To Do 后图标常驻可见。
- 从注入了 `ELECTRON_RUN_AS_NODE=1` 的终端 / IDE 启动时，应用会自动以干净环境重启自身。

## 数据与安全

| 项目 | 说明 |
| --- | --- |
| 绿色版数据位置 | `<软件目录>/ToDoLocal-Data/data.json` |
| 开发态数据位置 | `%APPDATA%/ToDoLocal/data/data.json` |
| 写入策略 | 先写 `data.json.tmp` 再 `rename` 原子替换；窗口关闭前 `sendSync` 兜底落盘 |
| 备份 | 设置菜单中导出 / 导入 JSON；更多菜单可导出 Excel 任务清单 |
| 图标 | `build/icon.ico` 与 `src/icon.ico` 由 `build/gen_icon.py` 同源生成，含 16–256 共 7 个尺寸，窗口 / 任务栏 / 托盘共用 |
| 网络 | 应用层无任何出站请求；主进程显式拦截外部 URL |

提醒功能仅在应用运行时生效，不注册后台服务。成品未做代码签名，首次运行可能触发 Windows SmartScreen，需选择「更多信息 → 仍要运行」。

## 项目结构

```
src/
  main.js       Electron 主进程：窗口 / 托盘 / IPC / 数据文件 / 网络拦截
  preload.js    contextBridge 暴露的最小 API（contextIsolation: true）
  index.html    界面结构与内联 SVG 图标
  styles.css    全部样式与 6 套主题
  app.js        渲染层状态管理、渲染、命令与事件
  xlsx.js       零依赖 XLSX 生成器（导出到 Excel）
  icon.ico      开发态窗口 / 托盘图标（与 build/icon.ico 同源）
build/         应用图标资源与生成脚本（gen_icon.py 一次生成两处图标）
tools/verify.js 真实 Electron 环境自动化验收（34 项）
docs/screenshots/  README 截图
```

## 贡献

欢迎提交 Issue 与 Pull Request，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。本项目保持「零运行时依赖、严格离线」的设计边界，任何引入网络请求或第三方前端框架的方案都需要先讨论。

## 许可证

[MIT](LICENSE) © 2026 nsq4926
