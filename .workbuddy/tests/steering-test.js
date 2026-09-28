// 野怪绕行行为的离线仿真验证
// 为什么需要仿真：实机里「野怪正好从柱子背面直线冲过来」的场景很难自然出现
// （20 秒实测里 avoidSide 一次都没触发），只能靠构造几何 + 仿真来验证。
//
// 方法论：从真实源码抽取纯函数 + new Function 求值，注入障碍数组与桩，不复制实现。
// 函数抽取用括号配对而非正则 —— 正则要写转义字符，容易被 shell heredoc 吃掉反斜杠。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
// 多源拼接：M0.5 拆分后寻路函数/怪物常量可能位于 js/monsters.js 等子模块，extractFn/grabConst 需覆盖全部源文件。
// 缺失文件跳过——拆分前仅 game.js 存在，行为与单源完全一致。
const SRC_FILES = ['js/game.js', 'js/config/weapons.js', 'js/config/levels.js', 'js/monsters.js', 'js/save.js'];
const SRC = SRC_FILES
  .filter(function (f) { return fs.existsSync(path.join(ROOT, f)); })
  .map(function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); })
  .join('\n');

/** 从源码里按括号配对抠出一个函数的完整定义（含函数体），不依赖正则转义 */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

const FN_NAMES = ['resolveObstacleCollisions', 'pushCircleOutOfObstacles',
                  'resolveShoulderCollisions', 'isCapsulePathClear', 'getAdvance',
                  'isMonsterHeadOnBlocked',
                  'getAvoidDir', 'stepMonsterChase', 'isPathClear', 'findDetourCorner',
                  'shouldChase', 'stepCrabChase'];

/** 取一个顶层 const 的右值 */
function grabConst(src, name) {
  const re = new RegExp('^const ' + name + ' = ([^;]+);', 'm');
  const m = src.match(re);
  return m ? m[1] : null;
}

/** 取一个 export const 的右值（levels.js 是 ESM 导出） */
function grabExport(src, name) {
  const re = new RegExp('^export const ' + name + ' = ([^;]+);', 'm');
  const m = src.match(re);
  return m ? m[1] : null;
}

let fns = '';
for (const n of FN_NAMES) {
  const body = extractFn(SRC, n);
  if (!body) { console.log('抽不到函数 ' + n); process.exit(1); }
  fns += body + '\n';
}

// 确定性随机：避免仿真结果每次不同
let rngValue = 0.9;
const MathStub = Object.create(Math);
MathStub.random = function () { return rngValue; };

// steering=false 时注入一个恒返回 false 的 isMonsterHeadOnBlocked 覆盖原实现
// （同一作用域内，后声明的函数声明胜出）
function build(obstacles, steering) {
  const override = steering ? '' : 'function isMonsterHeadOnBlocked() { return false; }\n';
  const consts = ['PLAYER_RADIUS', 'COLLISION_ITERATIONS', 'MONSTER_RADIUS',
                  'MONSTER_SHOULDER_OFFSET', 'MONSTER_SHOULDER_RADIUS',
                  'MONSTER_DETOUR_MARGIN',
                  'MONSTER_BLOCKED_ADVANCE_MIN', 'MONSTER_AVOID_STRENGTH',
                  'MONSTER_PROBE_RADIUS', 'CRAB_TURN_RATE', 'CRAB_BOUNDS',
                  'CRAB_RUSH_MAX', 'CRAB_HOP_TIME', 'CRAB_HOP_SPEED', 'CRAB_HOP_RANGE']
    .map(function (n) { return 'const ' + n + ' = ' + grabConst(SRC, n) + ';'; })
    .join('\n');
  // CRAB_CONFIG 真身在 js/config/levels.js（ESM export），抽取右值内联求值（§9 参数落位于彼）
  const crabCfg = grabExport(SRC, 'CRAB_CONFIG');
  if (!crabCfg) { console.log('抽不到 CRAB_CONFIG'); process.exit(1); }
  const ret = 'return { ' + FN_NAMES.join(', ') +
              ', MONSTER_RADIUS, MONSTER_BLOCKED_ADVANCE_MIN, MONSTER_AVOID_STRENGTH };';
  return new Function('obstacles', 'Math',
    'const solidObstacles = obstacles;\n' + consts + '\nconst CRAB_CONFIG = ' + crabCfg + ';\n' + fns + override + ret
  )(obstacles, MathStub);
}

let pass = 0, fail = 0;
const ok = function (cond, label, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};

const box = function (x, z, w, d, h) {
  return { minX: x - w/2, maxX: x + w/2, minZ: z - d/2, maxZ: z + d/2, height: h };
};
const WALL   = box(-8, -4, 0.3, 14, 1.8);   // 射击道隔断：x[-8.15,-7.85] z[-11,3]
const PILLAR = box(0, -35, 1.2, 1.2, 3);    // 掩体柱：x[-0.6,0.6] z[-35.6,-34.4]

/** 仿真：野怪从起点追玩家，返回与玩家的最近距离 */
function simulate(obstacles, start, player, frames, steering, rng) {
  rngValue = rng;
  const api = build(obstacles, steering);
  const pos = { x: start.x, z: start.z };
  const ud = { avoidSide: 0 };
  const dt = 1 / 60, speed = 2.5, stopDist = 1.8;
  let minDist = Infinity, avoidTicks = 0, sideUsed = 0;
  for (let i = 0; i < frames; i++) {
    const d0 = Math.hypot(pos.x - player.x, pos.z - player.z);
    if (d0 < minDist) minDist = d0;
    // 用从源码抽取的真实门控，不在这里抄一份 —— 抄一份的话门控改了测试不会红
    if (!api.shouldChase(d0, stopDist, pos, player.x, player.z)) break;
    api.stepMonsterChase(pos, ud, player.x, player.z, speed, dt);
    if (ud.avoidSide) { avoidTicks++; sideUsed = ud.avoidSide; }
    if (process.env.TRACE && i % 300 === 0) {
      console.log("    f" + i + " pos=(" + pos.x.toFixed(2) + "," + pos.z.toFixed(2) +
                  ") dist=" + d0.toFixed(2) + " avoid=" + ud.avoidSide);
    }
  }
  const dEnd = Math.hypot(pos.x - player.x, pos.z - player.z);
  if (dEnd < minDist) minDist = dEnd;
  return { minDist: minDist, pos: pos, avoidTicks: avoidTicks, sideUsed: sideUsed };
}

const PR = Number(grabConst(SRC, 'PLAYER_RADIUS'));
const MR_NUM = Number(grabConst(SRC, 'MONSTER_RADIUS'));

/**
 * 线段是否穿过任一障碍的实体部分（独立实现，不复用被测代码）。
 * 端点不算 —— 贴障碍站立是合法状态。
 */
function blocked(ax, az, bx, bz, obstacles) {
  const steps = 400;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    for (const o of obstacles) {
      if (px > o.minX && px < o.maxX && pz > o.minZ && pz < o.maxZ) return true;
    }
  }
  return false;
}

/**
 * 「追到了」的完整判据：距离够近 **且** 终点与玩家之间没有障碍。
 * ⚠️ 只用距离是不够的 —— 隔断厚 0.3m 时圆心距 0.3+PR+MR 可能已小于 stopDist，
 * 野怪会隔着隔断就停下并「达标」。那种情况必须判失败。
 */
function reached(r, player, obstacles) {
  return r.minDist <= 1.85 && !blocked(r.pos.x, r.pos.z, player.x, player.z, obstacles);
}

function reachedMsg(r, player, obstacles) {
  const los = !blocked(r.pos.x, r.pos.z, player.x, player.z, obstacles);
  return r.minDist.toFixed(2) + 'm  视线' + (los ? '通畅' : '被挡') + '  绕行' + r.avoidTicks + ' 帧';
}

console.log('=== 组 1：getAdvance ===');
{
  const api = build([], true);
  ok(Math.abs(api.getAdvance(0, 0, 1, 0, 1, 0) - 1) < 1e-12, '沿期望方向走满 -> 推进量=位移');
  ok(Math.abs(api.getAdvance(0, 0, 0, 1, 1, 0)) < 1e-12, '垂直于期望方向 -> 推进量=0');
  ok(Math.abs(api.getAdvance(0, 0, -1, 0, 1, 0) + 1) < 1e-12, '反向 -> 推进量为负');
}

console.log('=== 组 2：isMonsterHeadOnBlocked 阈值 ===');
{
  const api = build([], true);
  const MIN = api.MONSTER_BLOCKED_ADVANCE_MIN;
  ok(api.isMonsterHeadOnBlocked(0.01, 1) === true, '推进量 1% -> 判定为正面顶住');
  ok(api.isMonsterHeadOnBlocked(0.29, 1) === true, '推进量 29% -> 正面顶住');
  ok(api.isMonsterHeadOnBlocked(MIN, 1) === false, '恰好等于阈值 -> 不算顶住（严格小于）');
  ok(api.isMonsterHeadOnBlocked(0.31, 1) === false, '推进量 31% -> 算滑行');
  ok(api.isMonsterHeadOnBlocked(0, 1) === true, '推进量 0（完全顶死）-> 正面顶住');
}

console.log('=== 组 3：getAvoidDir 几何性质 ===');
{
  const api = build([], true);
  const dirs = [[1,0],[0,1],[0.6,0.8],[-0.6,0.8]];
  for (let k = 0; k < dirs.length; k++) {
    const dx = dirs[k][0], dz = dirs[k][1];
    const a = api.getAvoidDir(dx, dz, 1);
    const b = api.getAvoidDir(dx, dz, -1);
    const lenA = Math.hypot(a.x, a.z);
    const dot = a.x * dx + a.z * dz;
    ok(Math.abs(lenA - 1) < 1e-12, 'avoidSide=+1 得到单位向量 (' + dx + ',' + dz + ')', lenA);
    ok(Math.abs(dot) < 1e-12, '与朝向垂直（点积=0）(' + dx + ',' + dz + ')', dot);
    ok(Math.abs(a.x + b.x) < 1e-12 && Math.abs(a.z + b.z) < 1e-12, '左右两侧互为反向 (' + dx + ',' + dz + ')');
  }
}

console.log('=== 组 4：柱子正面（野怪在柱正后方，玩家在柱正前方）===');
{
  const player = { x: 0, z: -34 };   // 柱子 +Z 侧
  const start  = { x: 0, z: -40 };   // 柱子正后方，方向完全正对
  const withS = simulate([PILLAR], start, player, 2400, true, 0.9);
  const noS   = simulate([PILLAR], start, player, 2400, false, 0.9);
  console.log('  有绕行: 最近 ' + withS.minDist.toFixed(2) + 'm，绕行触发 ' + withS.avoidTicks + ' 帧，侧=' + withS.sideUsed);
  console.log('  无绕行: 最近 ' + noS.minDist.toFixed(2) + 'm（顶在柱子上）');
  ok(noS.minDist > 2.0, '【对照】无绕行时确实追不到（被柱子挡住）', noS.minDist.toFixed(2));
  ok(withS.avoidTicks > 0, '【关键】绕行逻辑被触发', withS.avoidTicks);
  ok(reached(withS, player, [PILLAR]), '【关键】有绕行时追到了玩家身边（距离+视线）',
     reachedMsg(withS, player, [PILLAR]));
  ok(withS.minDist < noS.minDist - 0.3, '有绕行明显优于无绕行',
     withS.minDist.toFixed(2) + ' vs ' + noS.minDist.toFixed(2));
}

console.log('=== 组 5：长隔断正面（绕行距离更长）===');
{
  const player = { x: -6, z: 0 };    // 隔断 +X 侧
  const start  = { x: -15, z: 0 };   // 另一侧，正对隔断
  const sides = [[0.9, '右侧绕行'], [0.1, '左侧绕行']];
  for (let k = 0; k < sides.length; k++) {
    const withS = simulate([WALL], start, player, 3600, true, sides[k][0]);
    console.log('  ' + sides[k][1] + ': 最近 ' + withS.minDist.toFixed(2) + 'm，触发 ' +
                withS.avoidTicks + ' 帧，侧=' + withS.sideUsed);
    ok(reached(withS, player, [WALL]), '【关键】' + sides[k][1] + '时绕过去追到了玩家（距离+视线）',
       reachedMsg(withS, player, [WALL]));
  }
  const noS = simulate([WALL], start, player, 3600, false, 0.9);
  console.log('  无绕行: 最近 ' + noS.minDist.toFixed(2) + 'm（顶在隔断上）');
  ok(noS.minDist > 2.5, '【对照】无绕行时够不着', noS.minDist.toFixed(2));
}

console.log('=== 组 6：畅通路径不应触发绕行 ===');
{
  const player = { x: 10, z: -10 };
  const start  = { x: 10, z: 0 };    // 直线可达，无障碍
  const r = simulate([PILLAR, WALL], start, player, 1200, true, 0.9);
  ok(r.avoidTicks === 0, '无障碍时不触发绕行（不误伤正常追击）', r.avoidTicks);
  ok(reached(r, player, [PILLAR, WALL]), '正常追到玩家（距离+视线）',
     reachedMsg(r, player, [PILLAR, WALL]));
}

console.log('=== 组 7：斜向接近（主要靠沿墙滑行）===');
{
  const player = { x: -6, z: -9 };
  const start  = { x: -16, z: 0 };
  const r = simulate([WALL], start, player, 3600, true, 0.9);
  console.log('  最近 ' + r.minDist.toFixed(2) + 'm，绕行触发 ' + r.avoidTicks + ' 帧');
  ok(reached(r, player, [WALL]), '斜向情况下也能追到玩家（距离+视线）',
     reachedMsg(r, player, [WALL]));
}

console.log('=== 组 8：玩家贴隔断（stopDist 短路回归用例）===');
{
  // 隔断厚 0.3m -> 隔着隔断的最小圆心距 = 0.3 + PR + MR_NUM，
  // 修复前该值小于 stopDist，纯距离门控会让野怪在另一侧就判定「到位」并停下，
  // stepMonsterChase 一次都不进（绕行 0 帧）—— 这正是本组要钉死的行为。
  const player = { x: -7.85 + PR, z: 0 };   // 贴住隔断 +X 面
  const start  = { x: -22, z: 0 };          // 另一侧远处
  console.log('  隔着隔断的最小圆心距 = 0.3 + ' + PR + ' + ' + MR_NUM + ' = ' +
              (0.3 + PR + MR_NUM).toFixed(2) + 'm（stopDist = 1.8m）');
  const r = simulate([WALL], start, player, 3600, true, 0.9);
  console.log('  终点 (' + r.pos.x.toFixed(2) + ',' + r.pos.z.toFixed(2) + ')  ' +
              reachedMsg(r, player, [WALL]));
  ok(!blocked(r.pos.x, r.pos.z, player.x, player.z, [WALL]),
     '【关键】玩家贴隔断时野怪必须真的绕过来（而不是隔着隔断停下）',
     reachedMsg(r, player, [WALL]));
  ok(r.avoidTicks > 0, '绕行分支确实被进入（修复前恒为 0 帧，绕行形同虚设）', r.avoidTicks);

  // 对照组：玩家离开隔断 1.85m（组 5 的位置）—— 修复前后都应通过
  const far = { x: -6, z: 0 };
  const r2 = simulate([WALL], start, far, 3600, true, 0.9);
  ok(reached(r2, far, [WALL]), '【对照】玩家离隔断较远时同样追得到', reachedMsg(r2, far, [WALL]));
}

console.log('=== 组 9：variantA S 口（实机「卡在墙边缘」回归组）===');
{
  // L3/L4 野区窄道：中路 H1(z=-14)/H2(z=-26) 两道横隔断，野怪从口内/深处追北面玩家
  // 必须绕出 3m 窄口。实机报告：野怪常卡在隔断端点绕不过来 —— 本组钉死该回归。
  const VA = [
    WALL,
    box(8, -4, 0.3, 14, 1.8),
    box(-15, -12, 1.2, 1.2, 3), box(15, -12, 1.2, 1.2, 3),
    box(-15, -28, 1.2, 1.2, 3), box(15, -28, 1.2, 1.2, 3),
    box(0, -35, 1.2, 1.2, 3), box(-20, -40, 1.2, 1.2, 3), box(20, -40, 1.2, 1.2, 3),
    box(-1.5, -14, 12.7, 0.3, 1.8),   // H1：x[-7.85,4.85]  右侧 3m 窄口
    box(1.5, -26, 12.7, 0.3, 1.8),    // H2：x[-4.85,7.85]  左侧 3m 窄口
  ];
  const cases = [
    ['C1 口内→北', { x: 0, z: -20 }, { x: 0, z: 2 }, 5400, 0.9],
    ['C3 深处→北', { x: 0, z: -40 }, { x: 0, z: 2 }, 7200, 0.9],
    ['C5 口内→北(rng0.1)', { x: 0, z: -20 }, { x: 0, z: 2 }, 5400, 0.1],
  ];
  for (const [label, start, player, frames, rng] of cases) {
    const r = simulate(VA, start, player, frames, true, rng);
    console.log('  ' + label + ': ' + reachedMsg(r, player, VA));
    ok(reached(r, player, VA), '【关键】' + label + '：野怪绕出窄口追到玩家（距离+视线）',
       reachedMsg(r, player, VA));
  }
}

console.log('=== 组 10：绕墙端点（角落震荡回归组）===');
{
  // 单隔断端点场景：野怪沿墙滑到端点后，需绕过端点才能接近玩家。
  // 修复前：退出判定覆盖 1.14m < 身体轮廓 1.25m，在角附近提前退出绕行 → 立即再顶住 →
  // avoidSide 重新随机 → 在墙边缘原地震荡（实机截图：蓝怪停在隔断端点不动）。
  const cases = [
    ['A1 斜擦北端角(rng0.9)', { x: -11, z: 0 }, { x: -6, z: 4.5 }, 3600, 0.9],
    ['A2 斜擦北端角(rng0.1)', { x: -11, z: 0 }, { x: -6, z: 4.5 }, 3600, 0.1],
    ['B1 正对端点', { x: -10, z: 5 }, { x: -6, z: 5.5 }, 3600, 0.9],
  ];
  for (const [label, start, player, frames, rng] of cases) {
    const r = simulate([WALL], start, player, frames, true, rng);
    console.log('  ' + label + ': ' + reachedMsg(r, player, [WALL]));
    ok(reached(r, player, [WALL]), '【关键】' + label + '：绕过端点追到玩家（距离+视线）',
       reachedMsg(r, player, [WALL]));
  }
}

console.log('=== 组 11：迅捷蟹转向钝验收（§9 蟹群×绕行算法 / 蟹速度×场地死角）===');
{
  // §9 两条验收标准，用抽取的 stepCrabChase 真实实现离线仿真。
  // 空场（无障碍）：纯转向钝 vs 横向移动，排斥力不参与，几何弱点单独归因。

  // 场景一：玩家 3m/s 横向匀速往返（x∈[-5,5], z=0），蟹从 (0,-15) 突进 15s。
  // 「pursuit 接触帧占比」= 蟹与玩家距离 ≤1.2m 的帧数 / 总帧数。
  function pursuitRate(chaseFn, speed) {
    const api = build([], true);
    const pos = { x: 0, z: -15 };
    const ud = { crabHeading: 0, radius: 0.35, chaseSpeed: 8.0, avoidSide: 0, avoidStall: 0, crabState: 'rush', crabT: 0 };
    const dt = 1 / 60;
    let px = 0, pvx = 3, contact = 0;
    for (let i = 0; i < 900; i++) {
      px += pvx * dt;
      if (px > 5) { px = 5; pvx = -3; }
      if (px < -5) { px = -5; pvx = 3; }
      chaseFn(api, pos, ud, px, 0, dt, speed);
      if (Math.hypot(pos.x - px, pos.z - pz0()) <= 1.2) contact++;
    }
    function pz0() { return 0; }
    return contact / 900;
  }
  function crabChase(api, pos, ud, px, pz, dt) { api.stepCrabChase(pos, ud, px, pz, dt); }
  function redChase(api, pos, ud, px, pz, dt, speed) {
    const d0 = Math.hypot(pos.x - px, pos.z - pz);
    if (d0 > 0.9) api.stepMonsterChase(pos, ud, px, pz, speed, dt);
  }
  const crabRate = pursuitRate(crabChase);
  const redRate = pursuitRate(redChase, 5.0);
  console.log('  蟹（转向钝 8.0）接触占比 ' + (crabRate * 100).toFixed(1) + '%   红怪对照（即时转向 5.0）' + (redRate * 100).toFixed(1) + '%');
  ok(crabRate < 0.30, '【关键 §9】玩家横向匀速时蟹 pursuit 接触占比 <30%（转向钝弱点成立）',
     (crabRate * 100).toFixed(1) + '%');
  ok(redRate > 0.5, '【对照】红怪同场景接触占比 >50%（弱点是蟹专属，不是速度差）',
     (redRate * 100).toFixed(1) + '%');

  // 场景二：玩家贴场角静止，蟹从 ~15m 外突进到贴脸 ≥2.5s（后跳节奏窗口存在）。
  function cornerRushTime() {
    const api = build([], true);
    const pos = { x: -13, z: -33 };
    const ud = { crabHeading: Math.atan2(-11, -11), radius: 0.35, chaseSpeed: 8.0, crabState: 'rush', crabT: 0 };
    const dt = 1 / 60;
    for (let i = 0; i < 1800; i++) {
      api.stepCrabChase(pos, ud, -24, -44, dt);
      if (Math.hypot(pos.x + 24, pos.z + 44) <= 1.2) return i / 60;
    }
    return Infinity;
  }
  const rushT = cornerRushTime();
  console.log('  贴角 15m 突进到贴脸 ' + rushT.toFixed(2) + 's');
  // §9 验收 playtest 调整（2026-09-28）：后跳改为只在 4m 威胁圈内触发（中程后撤观感差），
  // 突进时间从 2.78s 降至 ~2.3s；反应窗口仍由「全程可见的突进 + 0.3s 扑击前摇」提供
  ok(rushT >= 2.0, '【关键 §9】贴角突进 ≥2.0s（playtest 调整后口径；原 2.5s）', rushT.toFixed(2));
  ok(rushT < 8, '【对照】蟹最终确实能贴脸（窗口≠追不上）', rushT.toFixed(2));
}

console.log('');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
