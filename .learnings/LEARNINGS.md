# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260807-001] bat_file_must_be_ascii

**Logged**: 2026-08-07T23:40:30+08:00
**Priority**: high
**Status**: promoted
**Area**: config

### Summary
Windows .bat 文件必须用纯 ASCII 英文编写，中文内容即使 UTF-8 无 BOM 也会被 cmd 用 GBK 代码页错误解析，导致命令块损坏、脚本静默失败。

### Details
- cmd.exe 解析 .bat 时使用系统活动代码页（中文系统默认 cp936/GBK），不是文件自身编码
- `chcp 65001` 只能切换后续输出代码页，对 bat 文件行的解析不可靠
- 中文行会被拆解成乱码"命令"执行 → `'娴忚...' 不是内部或外部命令`，且 `if (...)` 括号块被破坏，后续命令全部跳过
- 之前还踩过 UTF-8 BOM 的坑（BOM 字符在 `@echo off` 前会破坏第一行）

### Suggested Action
所有 .bat 文件内容保持纯 ASCII 英文。需要中文提示时放 server.js 等 node/python 输出（UTF-8 文件 + 运行时输出无碍），或单独用 `chcp 65001` + 独立处理。

### Metadata
- Source: user_feedback
- Related Files: start.bat
- Tags: windows, bat, encoding, cmd
- Pattern-Key: windows.bat.ascii_only

### Resolution
- **Status**: promoted → 项目 MEMORY.md
- **Notes**: 重写 start.bat 为纯 ASCII，验证通过。

---

## [LRN-20260913-001] 无头 Chrome + CDP 探针：零依赖复现「点击无反应」类前端 Bug

### Category
best_practice

### Insight
前端游戏「点击按钮没反应」这类问题，靠读代码猜根因很低效（代码语法完全正常、逻辑也自洽）。
真正有效的是**在真实浏览器里点击一次并抓取异常**。不必安装 Playwright/Puppeteer：
Node 22 内置了全局 `WebSocket`，可以直接裸连 Chrome DevTools Protocol。

关键点：
1. `Runtime.evaluate` 可以执行 `document.getElementById('btn').click()` 做真实点击
2. 对比**点击前 / 点击后**的 DOM 状态，能一刀切区分「事件没绑上」和「绑上了但逻辑走错」
3. 监听 `Runtime.exceptionThrown`、`Log.entryAdded`、`Runtime.consoleAPICalled` 三类事件即可覆盖全部报错

探针脚本：`C:\Users\32346\AppData\Local\Temp\probe.js`，用法 `node probe.js <url>`，`SHOT=路径` 顺带截图。

### 本次实战价值
一次探针运行就锁定了两个真实缺陷，且排除了若干错误猜测（我先怀疑过 CSS 遮挡、`updateUI()` 空引用、
Google Fonts 阻塞脚本执行——探针证实这三者都不是元凶）。

### Common Pitfalls
- 必须给 Chrome 独立的 `--user-data-dir`，否则与用户正在用的 Chrome 实例冲突、CDP 端口起不来
- 程序化 `.click()` **不构成用户手势**，`requestPointerLock()` 必然抛 `NotAllowedError`。
  在无头环境里看到这个异常属**测试假象**，不要在没验证的情况下当成真实 Bug 去改
- 轮询 `/json/list` 找 target 时要等 `webSocketDebuggerUrl` 出现，Chrome 冷启动需数秒

### Metadata
- Source: error_investigation
- Related Files: index.html, js/game.js
- Tags: debugging, cdp, chrome-devtools-protocol, headless, no-dependency
- Pattern-Key: debugging.browser.cdp_probe

### Resolution
- **Status**: promoted → 项目 MEMORY.md（调试手段条目）
- **Notes**: 已在 ERR-20260913-001 / 002 两次调查中复用

---

## [LRN-20260913-002] 动画曲线要验证「边界速度连续性」，而不只是首尾值

### Category
best_practice

### Insight
写关键帧动画时，只检查 `f(0)` 和 `f(1)` 是不够的——那只能证明"起止位置对"。
真正的观感缺陷藏在**关键帧边界处的一阶导数突变**：曲线值连续但速度不连续，肉眼就是一顿一顿的抽动。

本次实测数据（换弹 1.5s、60fps、每帧进度增量 0.0111）：

| 插值方式 | 边界速度突变 | 折算可见效果 |
|---|---|---|
| 逐段独立 easeOutCubic | 0.164 rad/帧 | **约 9.4°/帧**，明显抽动 |
| Catmull-Rom 样条 | 0.0038 rad/帧 | 0.22°/帧，无感 |

根因：逐段缓动让每段**两端斜率都为 0**，跨到下一段时斜率从 0 突变为大值。

### 正确的验证方法
1. 用中心差分求每个关键帧边界左右两侧的导数：`speed(p±h)`
2. 断言 `|左速度 - 右速度|` 小于阈值（本项目取 0.02 rad/帧）
3. 同时记录**最大单帧速度**（`导数 × 每帧进度增量`），它才是有观感意义的量；单纯看"每单位进度的导数"会误判

### 附带教训
数值验证还顺带暴露了**设计问题**：原关键帧让 rz 通道在 0.22s 内摆动 42°，
虽然曲线连续但动作本身不合理。**连续性通过 ≠ 动画合理**，两个维度都要看。

### 元技巧：测试不要复制实现
把被测函数复制一份到测试脚本里，修改实现后测试仍会通过 → 假验证。
本项目的做法是从真实源码**正则抽取**函数体再 `new Function` 求值：
```js
const fnMatch = src.match(/function getReloadPose\(progress\) \{[\s\S]*?\n\}/);
const fn = new Function('progress', kfMatch[0] + axesMatch[0] + fnMatch[0] + 'return getReloadPose(progress);');
```
注意：`new Function` 的形参要单独传，别只拼进 body（会被当自由变量报 `ReferenceError`）。
抽取时若函数引用了同文件的其他顶层常量，要一并抽取，否则求值报未定义。

### Metadata
- Source: error_investigation
- Related Files: js/game.js（RELOAD_KEYFRAMES / getReloadPose）
- Tags: animation, interpolation, catmull-rom, easing, keyframe, test-integrity
- Pattern-Key: animation.curve.derivative_continuity

### Resolution
- **Status**: promoted → 项目 MEMORY.md
- **Notes**: `reload-pose-test.js` 可作为后续动画改动的回归基线

---

## [LRN-20260913-003] `node --check` 对 .js 文件不可靠 —— 静态门禁必须用 .mjs

### Category
correction（高价值：直接影响所有 JS 项目的验证可信度）

### Insight
做完改动后我照例跑 `node --check js/game.js`，它返回 0 并打印"语法通过"。
但同一份文件在浏览器里报 `Uncaught SyntaxError: Unexpected token ')'`，整个模块不执行、游戏打不开。

对照实验（同一份含多余右括号的文件）：

| 命令 | 退出码 | 是否抓到 |
|---|---|---|
| `node --check probe-bad.mjs` | **1** | ✅ 抓到 |
| `node --check probe-bad.js` | **0** | ❌ **漏检** |

原因：`.js` 文件 Node 走 **CommonJS 解析路径**，ESM 的语法错误被跳过。
（该文件含 `import` 与顶层 `await`，本应是 ESM。）

### 正确做法
静态语法门禁一律走 `.mjs` 副本：
```js
fs.copyFileSync('js/game.js', tmp + '/game.mjs');
execFileSync(process.execPath, ['--check', tmp + '/game.mjs']);
```
已固化为 `esm-lint.js`，并附带 HTML/JS 元素 id 交叉校验。

### 更普适的教训
**「工具返回成功」≠「验证通过」**。任何门禁工具都应先用一个**已知会失败的样本**校验它
真的能失败（negative control）。否则你得到的是一份虚假的安全感 —— 这次就因此
把一段打不开游戏的代码判成了"通过"。

### Metadata
- Source: error_investigation
- Related Files: js/game.js, esm-lint.js
- Tags: verification, node, esm, commonjs, lint, negative-control
- Pattern-Key: verification.tool.trust_but_verify

### Resolution
- **Status**: promoted → 项目 MEMORY.md（重要约定第 2 条）

---

## [LRN-20260913-004] 无头浏览器驱动游戏的两个必备配置

### Category
best_practice

### Insight
用 CDP + 无头 Chrome 做游戏端到端验证时，踩了两个必然遇到的坑：

**① 触摸横向拖拽被识别成 overscroll 返回手势**
现象：拖拽后页面变成纯白，DOM 查询全部返回 `null`（`getElementById('crosshair')` 都是 null），
极易误判为"代码崩了"。
根因：Chrome 把触摸拖拽解释为历史导航；启动时先开 `about:blank` 再 `Page.navigate`，
历史里正好有上一页可回退。
解法：加 `--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation`。

**② 无头环境指针锁定必然失败**
`canvas.requestPointerLock()` 在无头下抛 `NotAllowedError`，于是
`state.isPointerLocked` 永远为 false。而本游戏 `updateMovement` 里视角与移动要求
`isPointerLocked || isMobile`，结果**既转不了视角也走不了路**，无法做命中类验证。
解法：CDP `Emulation.setTouchEmulationEnabled({enabled:true, maxTouchPoints:5})`
让 `isTouchDevice()` 为真 → `state.isMobile=true`，改走触摸输入路径（这也是真实的用户路径）。
注意必须用 `Page.reload` 而不是 `Page.navigate`，才能让 `init()` 读到触摸能力，
同时避免历史里留下 about:blank。

### Methodology
验证游戏这类实时交互时，"能驱动真实输入"比"能断言 DOM"更关键。
先做一次**对照组**（本研究里是截图 md5 是否变化）确认输入真的生效，再去看业务结果。

### Metadata
- Source: error_investigation
- Related Files: hp-test3.js, hp-test4.js
- Tags: cdp, headless, chrome, touch-emulation, pointer-lock, overscroll
- Pattern-Key: testing.headless_game.input_driving

### Resolution
- **Status**: promoted → 项目 MEMORY.md

---
