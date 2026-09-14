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
- **行走三档速度**：慢走 4.2（默认）/ 疾跑 7.2（按住 Shift）/ 开枪 2.4 / 换弹 3.2；移动端摇杆推满（>0.85）自动渐变到疾跑
- **相机呼吸与行走摆动**：待机 0.25Hz 微起伏；行走时与步伐同频的垂直+横向摆动，疾跑幅度更大、频率 ×1.6；摆动只叠加在 camera.position，不改 rotation（准星与弹道仍一致）
- **脚步音**：程序化合成（零素材），4 个音色变体 + 每步随机音高/音量；踩在摆动周期最低点
- 左键射击（射线检测），按住连发，R 换弹
- AK-47 GLB 枪模挂载相机（注意 scene.add(camera) 必须）
- 红/蓝双阵营野怪（猩红石像/蔚蓝石像），追逐 AI + 警戒区
- 野怪视觉：主色红/蓝 + 胸口魔纹 + 背部尖刺 + 发光眼睛 + 头顶宝石
- 击中白色闪烁 + userData.originalColor 恢复
- 后坐力系统：相机上抬回正 + 随机水平偏移 + 武器枪口上翘 + 准星扩散
- 合成音效 (开枪/命中/爆头/换弹三段/击杀/结算/脚步)
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
- **移动速度档位**：`MOVE_SPEED_WALK/SPRINT/RELOAD/FIRING = 4.2/7.2/3.2/2.4`，优先级 **开枪 > 换弹 > 疾跑 > 慢走**（开枪要求非换弹中，故前两者互斥）。速度由 `getTargetMoveSpeed()` 单点产出，输入幅度只在 `locomotion.speed` 里乘一次。
- **⚠️ 移动方向必须无条件归一化**：写 `if (moveDir.length() > 0) moveDir.normalize()`，**不要退回 `if (length() > 1)`** —— 摇杆半推杆时长度 0.5 不会被归一化，幅度就同时留在 `moveDir` 里又乘进 speed，缩放两次。实测位移速度只有报告值的一半（报 2.1、实走 1.051）。键盘满杆长度恰好 1.0，所以这个 bug **只在摇杆模拟量下暴露**，靠读代码看不出来，CDP 位移法探针是唯一能抓到它的手段。
- **相机摆动与脚步同源**：`getSwayOffset()` 的垂直分量 `-amp*cos(2φ)` 在 `φ=kπ` 取最低点，脚步触发 `stepsTriggered()` 判的也是跨 π 整数倍 —— 同一个 `Math.PI` 定义，结构上不可能不同步。`swayPhase`/`breathPhase` **只在 `updateLocomotion` 内推进**，而它只被 `updateMovement` 调用（`playing` 块内），这是「暂停时相位不推进」的结构性保证，**不要挪到 `updateCamera` 旁边**（后者在 `paused` 下也执行）。
- **武器 bob 速率**：`weaponBobPhase += locomotion.speed * WEAPON_BOB_SPEED_GAIN * dt`，`WEAPON_BOB_SPEED_GAIN = 6 / MOVE_SPEED_WALK`。**改慢走档常量时必须同步调这个增益**，否则默认档的武器摆动节奏会跟着变。
- **步频由等效步幅导出**（`STRIDE_WALK/SPRINT`），不是按档位写死 —— 这样摇杆半推杆时步频随速度减半，脚不打滑。疾跑 ×1.6 是编码进 `STRIDE_SPRINT` 的。
- **⚠️ `input.shootPressed` 卡死有三条路径**，每条都会导致「持续自动开火 + 被永久压在开枪档 2.4」：① 移动端三处缺 `touchcancel`（joystick / look / shoot）；② 桌面 `mouseup` 挂在 canvas 上，指针锁定丢失时收不到（**已改挂 `window`**，`mousedown` 仍留 canvas 避免点 UI 误触发）；③ `startGame()` 不复位输入瞬态。另 `pauseGame()` 会清 `keys` 与输入瞬态，防 Alt-Tab 卡住 Shift/W 导致恢复后一直疾跑。
- **CDP 的 `Input.dispatchTouchEvent{type:'touchCancel'}` 在 headless 下不合成 DOM `touchcancel` 事件**（实测监听器计数器保持 0）。要测 `touchcancel` 处理路径，必须用 `Runtime.evaluate` 手工 `dispatchEvent(new TouchEvent('touchcancel', {changedTouches:[...]}))` —— 仍走真实监听器。`touchEnd` 正常触发。
- **调试快照 `window.__SNAPSHOT__()`**：ES Module 内部变量在 CDP 里取不到，故暴露只读快照；另有 `.speedFor` / `.swayOffsetFor` / `.stepsTriggered` / `.stepRateFor` 直接指向真实实现，避免测试脚本复制一份导致漂移。**注意 `footstepLog` 有 32 条上限会被 shift 截断，测步频要用单调递增的 `footstepCount`**（曾用 `footstepLog.length` 做差，算出 5.0 的假比值）。
- **脚步音是「采样优先、失败回退合成」**：`FOOTSTEP_FILES`（12 个 CC0 硬地面变体，`assets/sfx/footsteps/`）+ `playFootstep()` 随机挑变体（**刻意避开与上一步相同的那一个**），采样未就绪时回退 `synthFootstep()`。采样与武器音效共用 `sfxBuffers` 表与同一套预加载逻辑，启动日志显示 `SFX 16/16 已加载`。
- **⚠️ 12 个脚步变体不要随意删减**：疾跑 4.16 声/秒，变体数量直接决定听感是否像复读机。加上每步 ±8% 音高 / ±15% 音量抖动才够用。
- **采样规格与既有换弹音效一致**：单声道 / 22.05kHz / 16bit WAV。转码用 `loudnorm=I=-20:TP=-2` 做响度归一 + 3ms 首淡入 / 20ms 尾淡出（防爆音），转码后峰值 -2.0~-3.7dB。
- **⚠️ 转码时不要用 `silenceremove` 激进裁剪**：曾用 `-45dB` 阈值裁剪，把 0.154s 的样本剪成 0.037s（内容全被当静音削掉）。样本本身就很短，只需要响度归一 + 淡入淡出，不需要裁静音。
- **素材许可**：脚步采样全部 CC0，来源与核实过程见 `assets/sfx/CREDITS.md`。**注意包内无许可文件，属页面级声明** —— 这与本项目既有的 OGA 换弹音效标准一致。Freesound.org 实测不可用（下载强制登录，API 无 token 401）。
- **素材内容未经试听验证**：「石质/地铁硬地」的判断来自页面描述与文件名。如需确认音色是否合适，须人工试听。
- **场地碰撞**：`solidObstacles`（XZ 平面 AABB 数组）+ `resolveObstacleCollisions(pos)`（圆 vs AABB 推出）。当前 9 个实体障碍：2 个射击道隔断（0.3×14×1.8）+ 7 根掩体柱（1.2×1.2×3）。玩家半径 `PLAYER_RADIUS = 0.4`。
- **⚠️ 碰撞体由几何体自己登记**：`createDivider` / `createPillar` 内部调 `registerSolid(x, z, w, d, h)`。**挪动柱子或改尺寸时碰撞盒自动跟随**，不要另外维护一张坐标表 —— 那样两边迟早会各改各的。
- **⚠️ 外围边界墙不在 `solidObstacles` 里**，由 `updateMovement` 末尾的 clamp（x∈[-26,26], z∈[-46,12]）兜底。调用顺序必须是「应用移动 → `resolveObstacleCollisions` → clamp」：反过来的话，贴边的柱子会把玩家推出去、再被 clamp 推回来，产生抖动。
- **推出方向沿最近点法线，因此天然支持贴墙滑行** —— 只有垂直于墙面的分量被抵消，切向保留，玩家撞墙不会被卡死。这是「圆 vs AABB」相对「逐轴 clamp」的关键优势，不要改成逐轴处理。
- **⚠️ 摆放约束：两个障碍的间距必须 ≥ 玩家直径（0.8m）**。窄于玩家直径时圆 vs AABB 的推出解**在数学上不存在**（两个盒子互相把玩家推来推去），解算器修不了。`registerSolid` 在登记时会 `console.warn` 拦截，把问题暴露在摆放阶段而不是玩到那里才发现。
- **调试快照新增**：`__SNAPSHOT__()` 里的 `obstacleCount`、`__SNAPSHOT__.obstacles()`（返回碰撞盒副本）、`__SNAPSHOT__.restart()`（重开一局，便于探针分段测多个位置）。
- **野怪碰撞 + 绕行**：野怪与玩家共用 `resolveObstacleCollisions(pos, radius)`（`radius` 默认玩家半径，返回是否发生过推出）。`MONSTER_RADIUS = 0.65`（躯干宽 1.2、含肩甲最宽 1.9，取略小值让身体边缘轻微陷入柱子，视觉上是「贴着」而非「隔空停住」）。
- **⚠️ 绕行必须朝「外扩拐角」走，不能只做垂直于朝向的平移**。实测：垂直平移让野怪沿长墙来回蹭，蹭到墙尽头后又被朝玩家的方向拉回墙的阴影里，**永远绕不过去**（仿真里卡了 3451 帧仍未到达）。改为朝 `findDetourCorner()` 选出的外扩角走后，158 帧绕过。
- **⚠️ 路径通畅性探测半径必须小于碰撞半径**（`MONSTER_PROBE_RADIUS = MONSTER_RADIUS * 0.6`）。玩家常常紧贴障碍站立，若用完整半径，**玩家本身就落在障碍的外扩区里**，导致任何拐角的路径判定都不通畅、绕行直接失效。
- **⚠️ `isPathClear` 的采样步数必须有硬上限**（`Math.min(256, ...)`）。曾因 `MONSTER_PROBE_RADIUS` 声明丢失导致 `null * 0.5 = 0` → `dist / 0 = Infinity` → `Math.ceil(Infinity)` → **for 循环挂死**，脚本两分钟不返回。任何「距离 ÷ 常量」算循环步数的地方都要防这个。
- **野怪绕行的判定链**：`getAdvance()` 算本帧朝玩家的有效推进量 → `isMonsterHeadOnBlocked(advance, step)` 判断是「正面顶住」还是「沿墙滑行」（阈值 `MONSTER_BLOCKED_ADVANCE_MIN = 0.3`）→ 只有正面顶住才进入绕行模式。斜向撞墙靠法线推出的切向分量自然滑行，不需要干预。
- **⚠️ 测试脚本不要放系统 Temp**：2026-09-14 被 Windows 清理掉过一次，`esm-lint.js` / `collision-test.js` / `walk-probe.js` 等全部消失（项目 MEMORY 里当时到处引用 Temp 路径，一并失效）。现已移入 **`.workbuddy/tests/`**：`esm-lint.js`（静态门禁）、`collision-test.js`（碰撞数值 29 条）、`steering-test.js`（绕行仿真 30 条）、`monster-probe.js`（野怪实机）、`walk-probe.js`（行走回归）。脚本内 `ROOT` 一律用 `path.resolve(__dirname, '../..')` 推导，不硬编码。
- **⚠️ 本环境的两个工具坑**：① shell heredoc 会把 `\` 变成 `\`（写正则转义会被吃掉，函数抽取改用括号配对而非正则）；② Write/文件类工具会**静默失败或截断**（报成功但文件不存在/不完整），**每次写完都要用 bash `grep`/`ls` 复核**。
