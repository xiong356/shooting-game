# 贡献指南

本文档面向所有改动这个项目的人（包括 AI 助手）。项目的详细踩坑记录在
[`.workbuddy/memory/MEMORY.md`](.workbuddy/memory/MEMORY.md)，**动手前建议先读一遍**——
里面很多结论是实测出来的，不看容易重蹈覆辙。

---

## 环境要求

- **Node.js**：仅用于起静态服务器，项目本身**没有任何 npm 依赖**，不需要 `npm install`。
- **浏览器**：Chrome / Edge 等支持 ES Module、Pointer Lock、importmap 的现代浏览器。

## 启动项目

```bash
start.bat          # Windows 双击，自动开浏览器
node server.js     # 或命令行
```

访问 <http://127.0.0.1:3000>。

> **⚠️ 不能直接双击 `index.html`。** `game.js` 是 ES Module，`file://` 协议下会被 CORS 拦截，
> 脚本一行都不执行，表现为「按钮点了没反应」且页面无提示。必须走 HTTP。

---

## 代码约定

- **零构建**。不要引入 webpack / vite / npm 依赖。Three.js 通过 `index.html` 的 importmap
  从 CDN 加载，用浏览器原生 ES Module。
- **中文注释**。项目现有注释和文档都是中文，保持一致。
- **不要为了小改动重构大块代码**。`js/game.js` 约 2600 行、按功能分区（文件内有
  `// ====` 分隔的区块标题），跟随现有分区结构加代码，不要另起炉灶。
- **魔数要提成具名常量**并写注释说明含义，例如 `RELOAD_MAG_IN_AT`、`DEATH_DURATION`。

## 文件结构

```
index.html          主页面 + UI overlay 结构
css/styles.css      样式与响应式布局
js/game.js          全部游戏逻辑
server.js           Node 静态服务器
assets/             模型与音效
.workbuddy/memory/  开发日志与项目约定
.learnings/         复盘条目
```

---

## 验证要求

**这是本项目最重要的部分。** 下面的规则都是踩过坑之后定下来的，不是形式主义。

### 1. JS 静态检查必须走 `.mjs` 副本

```bash
cp js/game.js /tmp/game.mjs && node --check /tmp/game.mjs
```

**不要用 `node --check js/game.js`** ——它对 `.js` 按 CommonJS 解析，会**漏掉 ESM 语法错误**。
实测：同一份含多余右括号的文件，`--check x.mjs` 退出码 1（能抓到），`--check x.js` 退出码 0（漏检）。
这个洞曾让一段「整个游戏打不开」的代码被判成通过。

### 2. 工具返回成功 ≠ 验证通过

任何门禁工具都要先用一个**已知会失败的样本**试一次，确认它真的能失败（negative control）。
否则你拿到的是虚假的安全感。

### 3. 验证要驱动真实输入，不能只断言 DOM

前端游戏「点击没反应」这类问题靠读代码猜根因很低效。用**零依赖的裸 CDP** 驱动无头 Chrome
（Node 22 内置 `WebSocket`，不需要装 Playwright / Puppeteer）可以真实点击并捕获异常。

无头环境有两个必备配置：
- `--disable-features=OverscrollHistoryNavigation` —— 否则触摸横向拖拽被当成返回手势，
  页面被导航走，表现为白屏 + DOM 查询全 null，极易误判成"代码崩了"。
- `Emulation.setTouchEmulationEnabled` + **`Page.reload`** —— 无头下指针锁定必然抛
  `NotAllowedError`，只能走触摸路径驱动视角/移动；用 `reload` 而非 `navigate` 才能让 `init()`
  读到触摸能力。

### 4. 数值验证要从源码抽取，不要复制实现

把被测函数复制一份到测试脚本里 → 改了实现测试仍会通过 → **假验证**。
正确做法是从真实源码正则抽取函数体再 `new Function` 求值。

### 5. 改动画曲线要验证「边界速度连续性」

只检查 `f(0)` 和 `f(1)` 不够——那只能证明起止位置对。真正的观感缺陷藏在关键帧边界的
一阶导数突变：曲线值连续但速度不连续，肉眼就是抽动。用中心差分求边界左右两侧导数并断言差值。

---

## 已知的坑（改相关代码前必看）

| 领域 | 约定 |
|---|---|
| `start.bat` | **必须纯 ASCII 英文**。cmd.exe 用系统代码页（中文系统为 GBK）解析 .bat，中文内容会变成乱码命令、破坏 `if (...)` 块、后续命令静默跳过。中文提示放 `server.js` 的 node 输出里。 |
| 指针锁定 | `requestPointerLock()` 必须在用户手势的**同步调用栈**内执行。放 `setTimeout` 里会丢失 transient activation，抛 `NotAllowedError`，表现为「进了游戏但鼠标转不了视角」。 |
| 启动守卫 | `game.js` 模块顶部设 `window.__GAME_BOOTED__`，`index.html` 靠它判断脚本是否加载成功。**改脚本顺序时不要破坏这个标志位。** |
| 后坐力 | 必须是独立偏移量叠加到相机旋转（`cameraAngleV + recoilPitch`），不能累加进玩家视角变量，否则回正不了。 |
| 端口占用 | `EADDRINUSE` 是 EventEmitter 的 `error` **事件**，必须用 `server.on('error')`，不能用 `process.on('uncaughtException')`。 |
| 野怪闪烁 | 各 mesh 原始颜色存在 `userData.originalColor`，恢复时统一从该字段读回。**不要按 name 匹配**，部件命名不全会漏。 |
| 血条绘制 | canvas 元素的尺寸属性是 `width`/`height`，**不是 `w`/`h`**。写成 `const { w: W } = canvas` 会得到 `undefined`，`fillRect` 静默什么都不画。 |
| 换弹时序 | `RELOAD_MAG_IN_AT = 0.55` 是**弹药补满的进度点**，不是换弹结束才补。改 `reloadDuration` 时该比例自动跟随。 |
| 换弹插值 | 用 `RELOAD_KEYFRAMES` + **Catmull-Rom**。不要退回逐段 `easeOutCubic`——关键帧边界会出现约 9°/帧 的速度突变，肉眼可见抽动。 |
| 字体 | Google Fonts 国内不可达（实测 15s 超时）。`index.html` 用 `media="print" onload="this.media='all'"` 非阻塞加载，CSS 字体变量末尾保留系统中文字体兜底，**不要删**。 |
| 枪模 | `loadFirstAvailableModel([...])` 是通用的多路径兜底机制，即使当前只有单个路径也**不要删掉这个函数**。 |

---

## 素材与许可

**新增任何第三方素材（音效、模型、贴图、字体）前必须先核实许可，并把来源与许可记录到
[`assets/sfx/CREDITS.md`](assets/sfx/CREDITS.md)（或同级 CREDITS 文件）。**

本项目的教训：有个音效包页面元数据标 CC0，但包内 `creativecommons.txt` 写明 CC-BY 3.0，
**许可自相矛盾**——这类素材一律不用。只接受许可明确、可直链核实、允许商用的素材。

枪声是程序化合成的（自有权利）。若后续取得许可干净的真实 AK-47 录音，
覆盖 `ak47-shot.wav` 同名文件即可，代码无需改动。

---

## 提交与推送

远程仓库：<https://github.com/xiong356/shoot>（分支 `main`）

```bash
git add -A
git status --short          # ← 先核对文件数与排除项，再提交
git commit
git push
```

**顺序约束（踩过坑）：**

1. **`.gitignore` 必须在任何 `git add` 之前落盘。** 否则文件先进索引，
   `gitignore` 对**已跟踪**文件无效，看起来像"没生效"——实际是顺序错了，不是语法错。
   补救要 `git reset && git add -A`，且别把这条接在可能失败的 `&&` 链后面（会整条被截断）。
2. **提交前用 `git status --short` 核对文件数**。`.workbuddy/backup/`、`.workbuddy/verify/`
   体积大且是过程产物，已被 `.gitignore` 排除，确认它们没混进暂存区。
3. `*.bat` / `*.ps1` 由 `.gitattributes` 强制保持 CRLF，**不要删这个文件**——
   `start.bat` 用 LF 行尾在 cmd.exe 下可能解析异常。

---

## AI 助手协作注意

本项目大量借助 AI 助手迭代。以下是与工具链相关、人类贡献者可以忽略的一节。

- **文件写入工具在本仓库偶发静默丢文件**（报成功但实际不落盘，已实测于
  `README.md` / `.gitattributes` / `.gitignore` / `docs/CONTRIBUTING-draft.md`，
  规律未明，与路径层级无关）。绕行方案：改用 shell 创建（已验证稳定），
  或写到 `docs/` 子目录再 `mv`。**写完文件后务必 `ls -la` 验证一次**，不要相信工具的返回。
- **这个环境里 `cd` 后工作目录会被重置**，脚本里一律用绝对路径，
  否则 `sed` / `grep` 会找不到文件白跑一轮。
