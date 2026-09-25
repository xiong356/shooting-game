// 碰撞解算数值验证（玩家 + 野怪共用同一套）
// 方法论：从真实源码正则抽取函数体 + new Function 求值，注入模拟障碍数组 —— 不复制实现
// 位置说明：原先放在系统 Temp，2026-09-14 被清理掉过，故移入项目内。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');   // 从脚本自身位置推导，避免硬编码路径写错
// 多源拼接：M0.5 拆分后碰撞函数可能位于子模块，正则抽取需覆盖全部源文件。
// 缺失文件跳过——拆分前仅 game.js 存在，行为与单源完全一致。
const SRC_FILES = ['js/game.js', 'js/config/weapons.js', 'js/config/levels.js', 'js/monsters.js', 'js/save.js'];
const SRC = SRC_FILES
  .filter(function (f) { return fs.existsSync(path.join(ROOT, f)); })
  .map(function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); })
  .join('\n');

const fnMatch = SRC.match(/function resolveObstacleCollisions\(pos[^)]*\) \{[\s\S]*?\n\}/);
if (!fnMatch) { console.log('抽不到 resolveObstacleCollisions'); process.exit(1); }
// resolveObstacleCollisions 现在委托给 pushCircleOutOfObstacles，必须先拼进来
const helperMatch = SRC.match(/function pushCircleOutOfObstacles\([\s\S]*?\n\}/);
if (!helperMatch) { console.log('抽不到 pushCircleOutOfObstacles'); process.exit(1); }
const grab = (name) => {
  const m = SRC.match(new RegExp('^const ' + name + ' = ([^;]+);', 'm'));
  if (!m) { console.log('抽不到常量 ' + name); process.exit(1); }
  return m[1];
};

// 注意：这里刻意不用模板字符串（反引号在 shell heredoc 里出过问题），改用字符串拼接
const build = new Function('obstacles',
  'const PLAYER_RADIUS = ' + grab('PLAYER_RADIUS') + ';\n' +
  'const COLLISION_ITERATIONS = ' + grab('COLLISION_ITERATIONS') + ';\n' +
  'const MONSTER_RADIUS = ' + grab('MONSTER_RADIUS') + ';\n' +
  'const solidObstacles = obstacles;\n' +
  helperMatch[0] + '\n' +
  fnMatch[0] + '\n' +
  'return { resolveObstacleCollisions, PLAYER_RADIUS, COLLISION_ITERATIONS, MONSTER_RADIUS };'
);

const R = build([]).PLAYER_RADIUS;
const MR = build([]).MONSTER_RADIUS;
let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};

const box = (x, z, w, d, h) => ({ minX: x - w/2, maxX: x + w/2, minZ: z - d/2, maxZ: z + d/2, height: h });
const pos = (x, y, z) => ({ x, y, z });
// 点到 AABB 的最短距离（独立实现，用于断言，不复用被测代码）
const distTo = (p, o) => {
  const cx = Math.max(o.minX, Math.min(p.x, o.maxX));
  const cz = Math.max(o.minZ, Math.min(p.z, o.maxZ));
  return Math.hypot(p.x - cx, p.z - cz);
};

console.log('=== 组 1：不接触时不动 ===');
{
  const obs = [box(0, -35, 1.2, 1.2, 3)];
  const run = build(obs).resolveObstacleCollisions;
  let p = pos(0, 0, 0);
  const pushed = run(p);
  ok(p.x === 0 && p.z === 0, '远处完全不改坐标', JSON.stringify(p));
  ok(pushed === false, '未接触时返回 false', pushed);
  // 明确在半径之外（+1e-6）：不推动、返回 false
  p = pos(0, 0, -34.4 + R + 1e-6);
  const before = { x: p.x, z: p.z };
  const pushed2 = run(p);
  ok(p.x === before.x && p.z === before.z, '半径之外不推动', distTo(p, obs[0]).toFixed(8));
  ok(pushed2 === false, '半径之外返回 false', pushed2);
  // 注：刻意不测「恰好相切」—— -34.4 + 0.4 在 float64 下未必恰好等于 0.4，
  // 相切是浮点刀锋，断言它会变成在测浮点误差而不是测逻辑。改测刚进半径内的表现。
  p = pos(0, 0, -34.4 + R - 1e-6);
  const before2 = { x: p.x, z: p.z };
  const pushed3 = run(p);
  ok(pushed3 === true, '刚进半径内返回 true', pushed3);
  ok(Math.hypot(p.x - before2.x, p.z - before2.z) < 1e-5, '刚进半径内位移极小（不跳变）',
     Math.hypot(p.x - before2.x, p.z - before2.z).toExponential(2));
}

console.log('=== 组 2：推出到恰好相切 + 返回值 ===');
{
  const obs = [box(0, 0, 1.2, 1.2, 3)];
  const run = build(obs).resolveObstacleCollisions;
  const p = pos(0, 0, 0.6 + R - 0.1);
  const pushed = run(p);
  const d = distTo(p, obs[0]);
  ok(Math.abs(d - R) < 1e-9, '推出后距离恰为半径', d);
  ok(Math.abs(p.z - (0.6 + R)) < 1e-9, '沿最近面法线推出（+Z）', p.z);
  ok(p.x === 0, '垂直于推出方向的分量不变', p.x);
  ok(pushed === true, '发生推出时返回 true', pushed);
}

console.log('=== 组 3：圆心在盒内 -> 沿最浅面推出 ===');
{
  const obs = [box(0, 0, 2, 2, 3)];
  const run = build(obs).resolveObstacleCollisions;
  let p = pos(0.9, 0, 0);
  run(p);
  ok(Math.abs(p.x - (1 + R)) < 1e-9, '从最浅面(+X)推出', 'x=' + p.x.toFixed(4) + ' z=' + p.z.toFixed(4));
  ok(distTo(p, obs[0]) >= R - 1e-9, '推出后不再相交', distTo(p, obs[0]).toFixed(4));
  p = pos(0, 0, -0.9);
  run(p);
  ok(Math.abs(p.z - (-1 - R)) < 1e-9, '从最浅面(-Z)推出', 'x=' + p.x.toFixed(4) + ' z=' + p.z.toFixed(4));
}

console.log('=== 组 4：贴墙滑行（切向分量必须保留）===');
{
  const obs = [box(-8, -4, 0.3, 14, 1.8)];
  const run = build(obs).resolveObstacleCollisions;
  const p = pos(-7.85 + R + 0.05, 0, 0);
  const z0 = p.z;
  p.x -= 0.1; p.z -= 0.1;
  run(p);
  ok(p.x >= -7.85 + R - 1e-9, 'X 被墙挡住（未穿模）', p.x.toFixed(4));
  ok(Math.abs(p.z - (z0 - 0.1)) < 1e-9, 'Z 分量完整保留（能滑行）', p.z.toFixed(4));
}

console.log('=== 组 5：凹角（两面墙成 90 度）===');
{
  const obs = [box(-8, -4, 0.3, 14, 1.8), box(-6.075, 3.15, 4.15, 0.3, 1.8)];
  const run = build(obs).resolveObstacleCollisions;
  const p = pos(-7.5, 0, 2.8);
  run(p);
  const d0 = distTo(p, obs[0]), d1 = distTo(p, obs[1]);
  ok(d0 >= R - 1e-6, '脱离第一面墙', d0.toFixed(6));
  ok(d1 >= R - 1e-6, '脱离第二面墙', d1.toFixed(6));
}

console.log('=== 组 6：高度门控 ===');
{
  const obs = [box(0, 0, 2, 2, 3)];
  const run = build(obs).resolveObstacleCollisions;
  let p = pos(0, 3.0, 0);
  run(p); ok(p.x === 0 && p.z === 0, 'y >= height 时不碰撞', JSON.stringify(p));
  p = pos(0, 2.99, 0);
  run(p); ok(p.x !== 0 || p.z !== 0, 'y < height 时正常碰撞');
}

console.log('=== 组 7：真实场地坐标 ===');
{
  const obs = [
    box(-8, -4, 0.3, 14, 1.8), box(8, -4, 0.3, 14, 1.8),
    box(-15,-12,1.2,1.2,3), box(15,-12,1.2,1.2,3), box(-15,-28,1.2,1.2,3),
    box(15,-28,1.2,1.2,3), box(0,-35,1.2,1.2,3), box(-20,-40,1.2,1.2,3), box(20,-40,1.2,1.2,3),
  ];
  const run = build(obs).resolveObstacleCollisions;
  let p = pos(0, 0, -34.4 + R - 0.5);
  run(p);
  ok(Math.abs(p.z - (-34.4 + R)) < 1e-9, '玩家被正前方柱子挡在 z=-34.0', p.z.toFixed(4));
  p = pos(-7.85 + R - 0.5, 0, 2);
  run(p);
  ok(Math.abs(p.x - (-7.85 + R)) < 1e-9, '玩家被左侧隔断挡在 x=-7.45', p.x.toFixed(4));
}

console.log('=== 组 8：野怪半径（本次新增）===');
{
  const obs = [box(0, -35, 1.2, 1.2, 3)];
  const run = build(obs).resolveObstacleCollisions;
  ok(MR > R, '野怪半径大于玩家半径', 'MONSTER=' + MR + ' PLAYER=' + R);
  let p = pos(0, 0, -34.4 + R - 0.3);
  run(p, R);
  ok(Math.abs(p.z - (-34.4 + R)) < 1e-9, '玩家半径 0.4 -> 停在 z=-34.0', p.z.toFixed(4));
  p = pos(0, 0, -34.4 + MR - 0.3);
  run(p, MR);
  ok(Math.abs(p.z - (-34.4 + MR)) < 1e-9, '野怪半径 0.65 -> 停在 z=-33.75（比玩家更早停下）', p.z.toFixed(4));
  ok(distTo(p, obs[0]) >= MR - 1e-9, '野怪推出后不在障碍内', distTo(p, obs[0]).toFixed(4));
  p = pos(0, 0, -34.4 + R - 0.3);
  run(p);
  ok(Math.abs(p.z - (-34.4 + R)) < 1e-9, '不传半径时默认用玩家半径', p.z.toFixed(4));
  p = pos(0, 0, -35);
  run(p, MR);
  ok(distTo(p, obs[0]) >= MR - 1e-9, '圆心在盒内时用野怪半径推出', distTo(p, obs[0]).toFixed(4));
}

console.log('=== 组 9：反向对照 ===');
{
  const noop = () => false;
  const obs = [box(0, 0, 1.2, 1.2, 3)];
  const p = pos(0, 0, 0.6 + R - 0.1);
  const pushed = noop(p);
  ok(distTo(p, obs[0]) < R - 1e-6, '空实现确实会被「推出到相切」断言拒绝', distTo(p, obs[0]).toFixed(4));
  ok(pushed === false, '空实现也不会声称推出过');
}

console.log('');
console.log('PLAYER_RADIUS=' + R + '  MONSTER_RADIUS=' + MR +
  '  COLLISION_ITERATIONS=' + build([]).COLLISION_ITERATIONS);
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
