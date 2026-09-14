// 野怪绕行行为的离线仿真验证
// 为什么需要仿真：实机里「野怪正好从柱子背面直线冲过来」的场景很难自然出现
// （20 秒实测里 avoidSide 一次都没触发），只能靠构造几何 + 仿真来验证。
//
// 方法论：从真实源码抽取纯函数 + new Function 求值，注入障碍数组与桩，不复制实现。
// 函数抽取用括号配对而非正则 —— 正则要写转义字符，容易被 shell heredoc 吃掉反斜杠。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');

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

const FN_NAMES = ['resolveObstacleCollisions', 'getAdvance', 'isMonsterHeadOnBlocked',
                  'getAvoidDir', 'stepMonsterChase', 'isPathClear', 'findDetourCorner'];

/** 取一个顶层 const 的右值 */
function grabConst(src, name) {
  const re = new RegExp('^const ' + name + ' = ([^;]+);', 'm');
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
                  'MONSTER_BLOCKED_ADVANCE_MIN', 'MONSTER_AVOID_STRENGTH',
                  'MONSTER_PROBE_RADIUS']
    .map(function (n) { return 'const ' + n + ' = ' + grabConst(SRC, n) + ';'; })
    .join('\n');
  const ret = 'return { ' + FN_NAMES.join(', ') +
              ', MONSTER_RADIUS, MONSTER_BLOCKED_ADVANCE_MIN, MONSTER_AVOID_STRENGTH };';
  return new Function('obstacles', 'Math',
    'const solidObstacles = obstacles;\n' + consts + '\n' + fns + override + ret
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
    if (d0 <= stopDist) break;                 // 与游戏里一致：到 stopDist 就停
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
  ok(withS.minDist <= 1.85, '【关键】有绕行时追到了玩家身边', withS.minDist.toFixed(2));
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
    ok(withS.minDist <= 1.85, '【关键】' + sides[k][1] + '时绕过去追到了玩家', withS.minDist.toFixed(2));
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
  ok(r.minDist <= 1.85, '正常追到玩家', r.minDist.toFixed(2));
}

console.log('=== 组 7：斜向接近（主要靠沿墙滑行）===');
{
  const player = { x: -6, z: -9 };
  const start  = { x: -16, z: 0 };
  const r = simulate([WALL], start, player, 3600, true, 0.9);
  console.log('  最近 ' + r.minDist.toFixed(2) + 'm，绕行触发 ' + r.avoidTicks + ' 帧');
  ok(r.minDist <= 1.85, '斜向情况下也能追到玩家', r.minDist.toFixed(2));
}

console.log('');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
