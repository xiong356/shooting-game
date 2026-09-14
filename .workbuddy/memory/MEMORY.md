# 项目记忆 - 王者峡谷 PvE 野怪追逐

## 项目概述
Web-based 第一人称射击游戏，王者峡谷 PvE 野怪追逐模式（前身为 Valorant 训练靶场），Three.js 3D 渲染。

## 技术栈
- Three.js 0.160 (CDN importmap)
- 纯 HTML/CSS/JS (ES Module)，零构建依赖
- Web Audio API 合成音效
- Pointer Lock API 鼠标控制
- GLTFLoader 加载外部枪模 (assets/ak47.glb, 47KB 低模)

## 文件结构
```
shoot/
├── index.html       - 主文件，UI overlay 结构
├── css/styles.css   - 王者峡谷风格样式，响应式布局
├── js/game.js       - 完整游戏逻辑 (~2000行)
├── server.js        - Node 静态服务器（含自动打开浏览器）
├── start.bat        - 双击启动器（纯 ASCII）
└── assets/ak47.glb  - AK-47 枪模（低模，47KB）
```

## 核心功能
- 第一人称视角，WASD 移动 + 空格跳跃
- 左键射击（射线检测），按住连发，R 换弹
- AK-47 GLB 枪模挂载相机（注意 scene.add(camera) 必须）
- 红/蓝双阵营野怪（猩红石像/蔚蓝石像），追逐 AI + 警戒区
- 野怪视觉：主色红/蓝 + 胸口魔纹 + 背部尖刺 + 发光眼睛 + 头顶宝石
- 击中白色闪烁 + userData.originalColor 恢复
- 后坐力系统：相机上抬回正 + 随机水平偏移 + 武器枪口上翘 + 准星扩散
- 合成音效 (开枪/命中/换弹)
- 粒子特效 + 枪口闪光 + 弹道轨迹
- 移动端触控 (虚拟摇杆+射击按钮+滑动视角)
- 击杀野怪减计数，无时间限制

## 启动方式
双击 start.bat → node server.js → 自动打开浏览器 http://127.0.0.1:3000

## ⚠️ 重要约定（踩坑记录）
- **start.bat 必须用纯 ASCII 英文**：Windows cmd 用 GBK 代码页解析 .bat，中文内容（即使 UTF-8 无 BOM）会被解析成乱码命令，导致 `node server.js` 不执行、游戏打不开。中文提示放 server.js 的 node 输出里。
- 服务器必须通过 HTTP 访问（ES Module + fetch 被 file:// 协议拦截），用 start.bat 或 node server.js 启动。
- 野怪击中闪烁恢复：各 mesh 原始颜色存在 `userData.originalColor`，恢复时统一从该字段读回（不要按 name 匹配，部件命名不全会漏）。
- 后坐力必须是独立偏移量叠加到相机旋转（`cameraAngleV + recoilPitch`），不能累加到玩家视角变量，否则回正不了。
- EADDRINUSE 是 EventEmitter 的 error 事件，必须用 `server.on('error')` 处理，不能用 `process.on('uncaughtException')`。
- **指针锁定必须同步请求**：`startGame()` 由 click 事件直接调用，`canvas.requestPointerLock()` 要在同一调用栈内执行。用 `setTimeout(...,100)` 会丢失 transient activation，抛 `NotAllowedError: A user gesture is required to request Pointer Lock`，表现为「进了游戏但鼠标转不了视角」。统一走 `requestPointerLock()` 帮助函数（内含 try/catch + Promise catch）。
- **启动守卫**：`index.html` 内置探测脚本，`game.js` 模块顶部设 `window.__GAME_BOOTED__ = true`。若约 6 秒未置位（典型场景：file:// 打开导致 ES Module 被 CORS 拦截），显示 `#boot-guard` 提示改走 start.bat。**改动 index.html 的脚本顺序时不要破坏这个标志位。**
- **枪模**：`loadFirstAvailableModel(['assets/ak47.glb'])`，2000 行附近的 `loadFirstAvailableModel` 保留为**通用兜底机制**（多路径时依次降级），不要因为它只有单元素就删掉。`ak47.glb`（47684 bytes，29 meshes）完整，是当前唯一枪模，视觉偏方块。
  **`ak47_2.glb` 已于 2026-09-14 删除** —— 它是下载中断的残档（头声明 5068520 bytes，实际 2056192 bytes，缺 2.9MB），二进制数据缺失不可修复，且每次加载会白下 2MB 再抛 `Invalid typed array length`。如需高模须**重新下载一份完整 GLB**，放回 `assets/` 并在该数组里加回路径。
- **Google Fonts 国内不可达**（实测 `fonts.googleapis.com` 15s 超时），`index.html` 中已改为 `media="print" onload="this.media='all'"` 非阻塞加载；CSS 字体变量末尾保留系统中文字体兜底，不要删。
- **调试手段（可复用）**：无头 Chrome + CDP 探针脚本可真实点击按钮并捕获异常，无需安装任何依赖（Node 22 内置 WebSocket）。脚本在 `C:\Users\32346\AppData\Local\Temp\probe.js`，用法 `node probe.js <url>`，`SHOT=路径` 可截图。
- **换弹系统约定**：`RELOAD_MAG_IN_AT = 0.55` 是弹药补满的进度点（在 `updateReload` 里判定），**不是换弹计时结束才补**。改 `reloadDuration` 时该比例自动跟随，无需改常量。动画用 `RELOAD_KEYFRAMES`（6 帧 × 6 通道）+ **Catmull-Rom 插值** —— 不要退回逐段 easeOutCubic，那会让关键帧边界出现速度突变（约 9°/帧的可见抽动）。
- **手势类 API 必须同步调用**：`requestPointerLock()` 这类要求用户激活的 API 不能在 `setTimeout` 里调用。
- **改动画/曲线类逻辑时**：用「从源码正则抽取函数 + `new Function` 求值」的方式做数值验证，比复制粘贴一份到测试里可靠（不会与实现漂移）。测试脚本见 `C:\Users\32346\AppData\Local\Temp\reload-pose-test.js`。
- **⚠️ `node --check` 对 `.js` 文件不可靠**：实测同一份含多余右括号的文件，`--check x.mjs` 退出码 1（能抓到），`--check x.js` 退出码 0（**漏检**，因为按 CommonJS 解析）。本项目 JS 静态检查一律走 **`.mjs` 副本**，用 `C:\Users\32346\AppData\Local\Temp\esm-lint.js`（含 ESM 语法 + HTML/JS 元素 id 交叉校验）。**曾因此漏掉一个 `});` 未改的错误，导致整个 game.js 不执行。**
- **血量/伤害/死亡规格**：红 `maxHealth: 150`、蓝 `100`；`BASE_DAMAGE = 34`、`HEADSHOT_MULTIPLIER = 2`（命中 `name='head'` 的 mesh）。死亡动画常量 `DEATH_DURATION=0.9s` / `DEATH_DISTANCE=3m`（位移向量长度）/ `DEATH_ELEVATION_DEG=22` / `DEATH_SCALE_TO=2`。死亡立即判定：`userData.dying=true` 后**必须**从 raycast 与 HUD 计数里排除，动画播完才 `removeMonster` 并释放 geometry/material。
- **血条是 3D `THREE.Sprite` + `CanvasTexture`**，位于野怪 `y=3.05`（宝石在 2.45）。`drawHealthBar` 仅在血量变化时重绘（不进每帧循环）。**坑：canvas 元素的尺寸属性是 `width`/`height`，不是 `w`/`h`** —— 写成 `const { w: W } = canvas` 会得到 `undefined`，`fillRect` 静默什么都不画。
- **音效系统**：`SFX_FILES`（key→路径）+ `WEAPON_SFX`（武器 ID→槽位映射）+ `playWeaponSfx(slot)`，采样缺失自动回退合成音。新增枪械只需登记两条配置。采样来源与许可见 `assets/sfx/CREDITS.md`（换弹三段为 OGA 真 CC0，枪声为程序化合成）。
- **无头浏览器测游戏的两个必备配置**：① `--disable-features=OverscrollHistoryNavigation`（否则触摸横向拖拽被当成返回手势，页面被导航走、表现为白屏）；② `Emulation.setTouchEmulationEnabled` + `Page.reload` 让 `state.isMobile=true`（无头环境指针锁定必然失败，只能走触摸路径驱动视角/移动）。
