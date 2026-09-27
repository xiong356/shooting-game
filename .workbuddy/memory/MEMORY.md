# 项目记忆 - 王者峡谷 PvE 野怪追逐（FPS）

## 概述与结构
Web 第一人称射击，Three.js 0.160（CDN importmap），纯 HTML/CSS/JS ES Module 零构建。红/蓝双阵营野怪（猩红/蔚蓝石像）追逐 AI，击杀减计数，无时间限制。
```
index.html(UI overlay) / css/styles.css / js/game.js(~2000行) / server.js(静态服务+自动开浏览器) / start.bat(纯ASCII!) / assets/ak47.glb(47KB唯一枪模)
```
启动：start.bat → http://127.0.0.1:3000。**必须 HTTP**（file:// 拦 ES Module）。

## 环境与启动坑
- **start.bat 必须纯 ASCII**（cmd GBK 解析，中文变乱码命令）；中文提示放 server.js 输出。
- **启动守卫**：game.js 顶部设 `window.__GAME_BOOTED__=true`，index.html 6 秒探测未置位则显示 #boot-guard。改 index.html 脚本顺序别破坏它。
- **指针锁定/手势 API 必须同步调用**（click 调用栈内），setTimeout 会丢 transient activation。统一走 `requestPointerLock()` 帮助函数。
- Google Fonts 国内不可达：已改 `media="print" onload` 非阻塞加载，CSS 系统字体兜底别删。
- EADDRINUSE 用 `server.on('error')` 处理，不是 uncaughtException。
- 枪模 `loadFirstAvailableModel([...])` 是通用兜底机制，单元素也别删。ak47_2.glb 已删（残档），需高模要重新下完整 GLB。

## 移动/视角系统
- 速度档 `MOVE_SPEED_WALK/SPRINT/RELOAD/FIRING=4.2/7.2/3.2/2.4`，优先级 开枪>换弹>疾跑>慢走，`getTargetMoveSpeed()` 单点产出。
- **⚠️ moveDir 无条件归一化**（`if(length()>0)`，不是 `>1`）——摇杆半推杆会双重缩放，只有 CDP 位移探针能抓到。
- 相机摆动与脚步同源（同一个 `swayPhase`，垂直 `-amp*cos(2φ)` 最低点=脚步触发点）；相位**只在 updateLocomotion 推进**（暂停不走的结构性保证，别挪）。
- 武器 bob：`WEAPON_BOB_SPEED_GAIN=6/MOVE_SPEED_WALK`，改慢走档必须同步调。步频由等效步幅 `STRIDE_WALK/SPRINT` 导出。
- **⚠️ shootPressed 卡死三路径**：①移动端 touchcancel（三处都已补）；②mouseup 挂 window（mousedown 留 canvas）；③startGame 复位输入瞬态。pauseGame 清 keys+瞬态。
- 后坐力是独立偏移叠加（`cameraAngleV+recoilPitch`），不累加进视角变量。

## 战斗/野怪规格
- 玩家 100 HP，**无局内回血**。AK：`shootCooldown=0.12`（理论 DPS 283，含换弹循环上限 200，按 50% 命中 → 有效 DPS 设计锚点 120）。
- 红 150 血 / 蓝 100 血；`BASE_DAMAGE=34`，爆头 ×2（mesh name='head'）。红近战 `RED_MELEE_DAMAGE=25`、追速 5.0、stopDist 1.8；**蓝是远程施法怪**：`BLUE_CAST_RANGE=12 / TIME=0.4s 吟唱 / COOLDOWN=1.5s / DAMAGE=10`。
- 计分：`SCORE_PER_HIT=10 / HEADSHOT=25 / KILL=100`；评级原二值（胜利 S / 阵亡 F）。
- 死亡：`DEATH_DURATION=0.9s / DISTANCE=3m / ELEVATION=22° / SCALE_TO=2`；`dying=true` 立即从 raycast 与 HUD 计数排除，动画完才 removeMonster+释放资源。
- 血条：3D Sprite+CanvasTexture（y=3.05），仅血量变化时重绘。**坑：canvas 尺寸属性是 width/height 不是 w/h**。
- 击中闪烁恢复统一走 `userData.originalColor`，不按 name 匹配。
- 换弹：`RELOAD_MAG_IN_AT=0.55` 是弹药补满进度点（非结束才补）；动画 `RELOAD_KEYFRAMES`+Catmull-Rom 插值，**别退回逐段 easeOutCubic**（边界 9°/帧 抽动）。

## 音效
- `SFX_FILES`+`WEAPON_SFX`+`playWeaponSfx(slot)`，采样缺失回退合成音。新枪只登记两条配置。
- 脚步：`FOOTSTEP_FILES` 12 个 CC0 变体（**别删减**，避开与上步重复）+±8% 音高/±15% 音量抖动，未就绪回退 synthFootstep。
- 采样规格：单声道/22.05kHz/16bit WAV，`loudnorm=I=-20:TP=-2`+3ms 淡入/20ms 淡出；**禁用 silenceremove 激进裁剪**。许可见 assets/sfx/CREDITS.md（页面级声明，Freesound 不可用）。

## 碰撞与 AI 绕行
- `solidObstacles`（XZ AABB）+`resolveObstacleCollisions`（圆 vs AABB 沿最近点法线推出→天然贴墙滑行，**别改逐轴 clamp**）。玩家半径 0.4，野怪 `MONSTER_RADIUS=0.65` 共用同一函数。
- **碰撞体由几何体自己登记**（createDivider/createPillar 调 registerSolid），不另维护坐标表。
- 外围边界靠 updateMovement 末尾 clamp（x∈[-26,26], z∈[-46,12]）；顺序必须 移动→碰撞→clamp。
- **障碍间距必须 ≥0.8m（玩家直径）**，否则推出解不存在；registerSolid 会 console.warn 拦截。
- 绕行：必须朝 `findDetourCorner()` 外扩拐角走（垂直平移会永远蹭墙）；`MONSTER_PROBE_RADIUS=RADIUS*0.6`（探测半径<碰撞半径，否则玩家贴障碍时判定全堵）；`isPathClear` 采样步数硬上限 `Math.min(256,...)` 防 距/0=Infinity 挂死。判定链：getAdvance→isMonsterHeadOnBlocked(阈值0.3)→只正面顶住才绕行。
- **⚠️ 绕行角点两道死锁防线（2026-09-27 卡墙边缘 bug 修复，组 9 钉死）**：① `findDetourCorner` 跳过 d<MONSTER_RADIUS 的近角——绕行会精确走到外扩角上，d=0 的自身角被贪心选中=目标是自己=位移恒 0 冻结；② 角点**承诺制**（ud.avoidCornerX/Y，走到到达/失效才重选）——每帧贪心取最近合法角会在相邻角点间乒乓（离角 0.67m 时身后的角又变最近），绝对不能改回无记忆重选。另有 45 帧无进展翻侧兜底（ud.avoidStall）。

## 测试与调试（全部在 `.workbuddy/tests/`，别放系统 Temp——会被 Windows 清掉）
- esm-lint.js（静态门禁）、collision-test.js、steering-test.js、monster-probe.js、walk-probe.js；ROOT 用 `path.resolve(__dirname,'../..')` 推导。
- **⚠️ `node --check` 对 .js 不可靠**（按 CommonJS 解析漏检括号），一律复制 .mjs 检查。曾因此漏 `});` 导致 game.js 全挂。
- 无头 Chrome CDP：必须 `--disable-features=OverscrollHistoryNavigation`+`Emulation.setTouchEmulationEnabled`+reload；`Input.dispatchTouchEvent touchCancel` 不合成 DOM 事件，要用 Runtime.evaluate 手工 dispatchEvent。
- `window.__SNAPSHOT__()` 只读快照+`.speedFor/.swayOffsetFor/.stepsTriggered/.stepRateFor` 指向真实实现；测步频用单调 `footstepCount`（footstepLog 有 32 条截断）；另有 `.obstacles()/.restart()`。
- 验证动画/曲线：从源码括号配对抽取函数+`new Function` 求值，别复制粘贴（会漂移）。

## 关卡系统（2026-09-20 设计定稿，未实现）
- 设计文档：`docs/level-system-design.md`（用户确认方向：线性闯关 7 关 + localStorage 存档 + 四轴差异：数值递增/场地变体/新怪种(迅捷蟹·精英石像·Boss主宰)/武器解锁(霰弹L3·射手步枪L5) + S/A/B/F 评级；**只交付设计文档，代码后做**）。
- 实现时关键：怪物 HP/伤害改读 `(type, mul)` 配置（`LEVELS` 表），同场上限 8 + FIFO 补位（等 removeMonster 才补），场地布局配置化且清场必须同步清 `solidObstacles`，存档 key `wk.pve.save.v1` 仅过关时写入。
- M0 先行：用 `__SNAPSHOT__` 实测 3 局命中率校准 50% 假设（错则全文血池同比例缩放）。

## 本机工具坑
- shell heredoc 会吃掉正则里的 `\` 转义（改用括号配对抽取）。
- Write/文件工具**可能静默失败/截断**——写完必须 bash `grep`/`ls` 复核。
