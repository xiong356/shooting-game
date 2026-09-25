// 蓝怪魔法弹判定的离线仿真验证
// 为什么需要仿真：实机里「弹丸擦着障碍边/玩家身高边界飞过」的临界场景很难自然出现，
// 只能靠构造几何 + 仿真来验证判定边界。
//
// 方法论与 steering-test.js 一致：从真实源码抽取纯函数 + new Function 求值，
// 注入障碍数组与常量，不复制实现（抄一份的后果是判定改了测试不会红，即「假验证」）。
// 函数抽取用括号配对而非正则 —— 正则要写转义字符，容易被 shell heredoc 吃掉反斜杠。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
// 多源拼接：M0.5 拆分后函数/常量可能位于 js/monsters.js 等子模块，extractFn/grabConst 需覆盖全部源文件。
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

const FN_NAMES = ['projectileHitObstacle', 'projectileHitPlayer', 'rayHitObstacleDistance'];

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

function build(obstacles) {
  const consts = ['PLAYER_RADIUS', 'PLAYER_HEIGHT', 'BLUE_PROJ_RADIUS']
    .map(function (n) { return 'const ' + n + ' = ' + grabConst(SRC, n) + ';'; })
    .join('\n');
  const ret = 'return { projectileHitObstacle, projectileHitPlayer, rayHitObstacleDistance, PLAYER_RADIUS, PLAYER_HEIGHT, BLUE_PROJ_RADIUS };';
  return new Function('obstacles',
    'const solidObstacles = obstacles;\n' + consts + '\n' + fns + ret
  )(obstacles);
}

let pass = 0, fail = 0;
const ok = function (cond, label, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};

// 障碍：中心 (0,0)，2×2×2 的盒子 → minX/maxX/minZ/maxZ = ±1，height = 2
const box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 2 };

console.log('=== 组 1：空旷处不命中 ===');
{
  const api = build([]);
  ok(!api.projectileHitObstacle(5, 1, 5, api.BLUE_PROJ_RADIUS), '无障碍时不命中障碍');
  ok(!api.projectileHitPlayer(5, 1, 5, 0, 0, api.BLUE_PROJ_RADIUS), '远离玩家时不命中玩家');
}

console.log('=== 组 2：障碍 AABB 判定（含外扩半径与高度门控）===');
{
  const api = build([box]);
  const r = api.BLUE_PROJ_RADIUS;
  ok(api.projectileHitObstacle(0, 1, 0, r), '盒子内部命中');
  ok(api.projectileHitObstacle(1 + r * 0.5, 1, 0, r), '外扩区内命中');
  ok(!api.projectileHitObstacle(1 + r * 2, 1, 0, r), '外扩区外不命中');
  ok(api.projectileHitObstacle(0, 1.9, 0, r), 'y 低于障碍高度时命中');
  ok(!api.projectileHitObstacle(0, 2.5, 0, r), 'y 高于障碍高度时穿过（高度门控）');
  ok(!api.projectileHitObstacle(0, 2.0, 0, r), 'y 恰好等于高度时穿过（>= 边界）');
}

console.log('=== 组 3：玩家判定（水平距离 + 身高边界）===');
{
  const api = build([]);
  const r = api.BLUE_PROJ_RADIUS;
  const reach = api.PLAYER_RADIUS + r;   // 命中半径 = 玩家半径 + 弹半径
  ok(api.projectileHitPlayer(reach * 0.5, 1, 0, 0, 0, r), '水平距离在命中半径内');
  ok(!api.projectileHitPlayer(reach * 1.5, 1, 0, 0, 0, r), '水平距离超出命中半径');
  ok(api.projectileHitPlayer(0, 0, 0, 0, 0, r), 'y=0（脚底）命中');
  ok(api.projectileHitPlayer(0, api.PLAYER_HEIGHT, 0, 0, 0, r), 'y=身高（头顶）命中');
  ok(!api.projectileHitPlayer(0, api.PLAYER_HEIGHT + 0.5, 0, 0, 0, r), 'y 高于头顶不命中');
  ok(!api.projectileHitPlayer(0, -0.1, 0, 0, 0, r), 'y 低于地面不命中');
}

console.log('=== 组 4：负向对照（半径传 0 → 退化为点检测）===');
{
  const api = build([box]);
  ok(api.projectileHitObstacle(0, 1, 0, 0), '半径 0：盒内点仍命中');
  ok(!api.projectileHitObstacle(1.001, 1, 0, 0), '半径 0：盒外点不命中（无外扩）');
  ok(api.projectileHitPlayer(api.PLAYER_RADIUS * 0.5, 1, 0, 0, 0, 0), '半径 0：玩家半径内仍命中');
  ok(!api.projectileHitPlayer(api.PLAYER_RADIUS * 1.5, 1, 0, 0, 0, 0), '半径 0：玩家半径外不命中');
}

console.log('=== 组 5：子弹射线遮挡 rayHitObstacleDistance（穿墙修复）===');
{
  const api = build([box]);
  const inf = Infinity;
  // 正对盒子：从 x=-5 朝 +x 打，入射面 minX=-1 → t=4
  ok(Math.abs(api.rayHitObstacleDistance(-5, 1, 0, 1, 0, 0) - 4) < 1e-9, '正对障碍命中，t=入射面距离');
  // 高度门控：y=3 高于盒顶（height=2）的水平射线穿过
  ok(api.rayHitObstacleDistance(-5, 3, 0, 1, 0, 0) === inf, '弹道高于障碍时不遮挡');
  // 侧向擦边：z=2 在盒体外（maxZ=1）
  ok(api.rayHitObstacleDistance(-5, 1, 2, 1, 0, 0) === inf, '射线从旁边飞过不遮挡');
  // 反向：障碍在身后不遮挡
  ok(api.rayHitObstacleDistance(-5, 1, 0, -1, 0, 0) === inf, '背对障碍不遮挡');
  // 起点在盒内：贴墙时枪口探进墙体，不算遮挡
  ok(api.rayHitObstacleDistance(0, 1, 0, 1, 0, 0) === inf, '起点在盒内跳过该盒');
  // 斜向对角入射：origin(-5,1,-5) dir(1,0,1)/√2 → 角点(-1,-1)，t=4√2
  const d = 1 / Math.SQRT2;
  ok(Math.abs(api.rayHitObstacleDistance(-5, 1, -5, d, 0, d) - 4 * Math.SQRT2) < 1e-9, '斜向命中角点，t=4√2');
  // 俯射：origin(-5,4,0) dir(0.8,-0.6,0)，入 x 面时 t=5、y=1（在盒高内）→ 命中正面
  ok(Math.abs(api.rayHitObstacleDistance(-5, 4, 0, 0.8, -0.6, 0) - 5) < 1e-9, '俯射：降到盒高范围内命中正面 t=5');
  // 仰射穿过：origin(-5,1,0) dir(0.6,0.8,0)，入 x 面（t≈6.67）时 y 已超盒顶 → 不遮挡
  ok(api.rayHitObstacleDistance(-5, 1, 0, 0.6, 0.8, 0) === inf, '仰射：升到盒顶以上穿过');
  // 多障碍取最近：远处再放一个同轴盒子（t=10），乱序传入验证不是取第一个命中
  const boxFar = { minX: 5, maxX: 7, minZ: -1, maxZ: 1, height: 2 };
  const api2 = build([boxFar, box]);
  ok(Math.abs(api2.rayHitObstacleDistance(-5, 1, 0, 1, 0, 0) - 4) < 1e-9, '多障碍返回最近者');
  // 无障碍
  ok(build([]).rayHitObstacleDistance(0, 1, 0, 1, 0, 0) === inf, '空旷处永远不遮挡');
}

console.log('\nPLAYER_RADIUS=' + build([]).PLAYER_RADIUS +
  '  PLAYER_HEIGHT=' + build([]).PLAYER_HEIGHT +
  '  BLUE_PROJ_RADIUS=' + build([]).BLUE_PROJ_RADIUS);
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
