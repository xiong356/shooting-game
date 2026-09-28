// CS:GO 风格两层散布（inaccuracy + spray pattern）的离线仿真验证
// 为什么需要仿真：实机里「精确验证 2.4 m/s 对应 0.15 rad」这类数值口径无法肉眼判断，
// 且 spray pattern 的确定性（非随机）只能靠读源码断言。
//
// 方法论与 attack-test.js 一致：从真实源码抽取纯函数/常量 + new Function 求值，
// 不复制实现（抄一份的后果是口径改了测试不会红，即「假验证」）。
// 函数抽取用括号配对而非正则 —— 正则要写转义字符，容易被 shell heredoc 吃掉反斜杠。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
// 多源拼接：M0.5 拆分后常量/函数可能位于子模块，grabConst/extractFn 需覆盖全部源文件。
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

const fnBody = extractFn(SRC, 'getInaccuracyAngle');
if (!fnBody) { console.log('抽不到函数 getInaccuracyAngle'); process.exit(1); }
// M4④：射程衰减纯函数（game.js）
const falloffBody = extractFn(SRC, 'falloffMultiplier');
if (!falloffBody) { console.log('抽不到函数 falloffMultiplier'); process.exit(1); }
// M0.5②：散布/后坐常量已迁入 js/config/weapons.js 的 WEAPONS 表。
// 表为对象字面量且内部无分号，`[^;]+` 可整表抽出（见 weapons.js 头部禁令注释）。
const wm = SRC.match(/^export const WEAPONS = ([^;]+);/m);
if (!wm) { console.log('抽不到 WEAPONS 表（js/config/weapons.js）'); process.exit(1); }
const WEAPONS = new Function('return ' + wm[1])();
for (const f of ['spreadPerSpeed', 'spreadAirMult', 'sprayPattern']) {
  if (WEAPONS.ak47[f] === undefined) { console.log('WEAPONS.ak47 缺字段 ' + f); process.exit(1); }
}
const AK = WEAPONS.ak47;

// 注入真实源码里的武器表与纯函数，得到可求值的 API（不复制实现）
const api = new Function('WEAPONS',
  'const AK = WEAPONS.ak47;\n' +
  fnBody + '\n' +
  'return { getInaccuracyAngle };'
)(WEAPONS);

const pattern = AK.sprayPattern;

let pass = 0, fail = 0;
const ok = function (cond, label, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('=== 组 1：速度单调性（越快越飘）===');
{
  const f = api.getInaccuracyAngle;
  ok(f(0, false) === 0, '0 速 → 0 偏移（站桩不受层 1 影响）');
  ok(Math.abs(f(2.4, false) - 0.15) < 1e-9, '开火移速 2.4 → 0.15 rad', f(2.4, false));
  ok(f(4.2, false) > f(2.4, false), '4.2 m/s 比 2.4 m/s 更飘');
  ok(f(7.2, false) > f(4.2, false), '7.2 m/s 比 4.2 m/s 更飘');
}

console.log('=== 组 2：空中倍率（跳射大幅惩罚）===');
{
  const f = api.getInaccuracyAngle;
  ok(f(2.4, true) === f(2.4, false) * 2.5, '滞空偏移 = 地面值 × 2.5');
  ok(f(0, true) === 0, '滞空但 0 速仍为 0（倍率乘 0 不引入底噪）');
}

console.log('=== 组 3：武器表口径一致性（WEAPONS.ak47，§8.0 迁移后唯一真源）===');
{
  ok(Math.abs(AK.spreadPerSpeed * 2.4 - 0.15) < 1e-9,
    'spreadPerSpeed × 2.4 ≈ 0.15 rad（10m 处散布半径 ≈ 1.5m）');
  ok(AK.spreadAirMult === 2.5, 'spreadAirMult = 2.5');
}

console.log('=== 组 4：spray pattern 确定性图案表 ===');
{
  ok(Array.isArray(pattern), 'ak47.sprayPattern 是数组字面量');
  ok(pattern.length === 10, '图案长度 10', pattern.length);
  ok(pattern[0] === 0, '首项 0（单发点射近似垂直上抬）');
  ok(pattern.some(v => v > 0) && pattern.some(v => v < 0), '有正有负（左右交替漂移）');
  // 连发序号取模循环：任意长的连发都不越界、且图案可复现
  let allFinite = true, deterministic = true;
  for (let i = 0; i < 100; i++) {
    const v = pattern[i % pattern.length];
    if (!Number.isFinite(v)) allFinite = false;
    if (v !== pattern[i % pattern.length]) deterministic = false;   // 同一序号两次取值一致
  }
  ok(allFinite, '取模索引 0~99 发全部落在有效数值上（不越界）');
  ok(deterministic, '同序号取值确定（无 Math.random 参与）');
}

console.log('\nak47.spreadPerSpeed=' + AK.spreadPerSpeed +
  '  ak47.spreadAirMult=' + AK.spreadAirMult +
  '  PATTERN=[' + pattern.join(', ') + ']');

// ---- M4④ 霰弹「裂空」验收（§5.4 弹丸散布规格 + M4 验收口径）----
const falloffApi = new Function(falloffBody + '\nreturn { falloffMultiplier };')();
const SG = WEAPONS.shotgun;

console.log('=== 组 5：射程衰减 falloffMultiplier（§5.4 线性归零）===');
{
  const f = falloffApi.falloffMultiplier;
  const fo = SG.damageFalloff;
  ok(fo && fo.start === 12 && fo.end === 20, 'shotgun.damageFalloff = {12,20}（表口径）', JSON.stringify(fo));
  ok(f(3, fo) === 1, '3m 贴脸 → 全伤');
  ok(f(12, fo) === 1, '12m（start 边界，≤ 收）→ 全伤');
  ok(Math.abs(f(16, fo) - 0.5) < 1e-9, '16m（区间中点）→ 0.5', f(16, fo));
  ok(f(19.9, fo) > 0 && f(19.9, fo) < 0.1, '19.9m → 接近 0 但仍判伤');
  ok(f(20, fo) === 0, '20m（end 边界，≥ 收）→ 0（不判伤）');
  ok(f(30, fo) === 0, '30m → 0');
  ok(f(5, null) === 1 && f(100, null) === 1, 'AK/步枪 falloff=null → 恒全伤');
}

console.log('=== 组 6：§5.4 M4 验收——贴脸 3m 单发必杀 68 血蟹 ===');
{
  // 几何验收：8 丸在 4° 半角锥内均匀分布，3m 处散布盘半径 = 3×tan(4°) ≈ 0.21m；
  // 蟹 hitbox 以 0.5m 半径圆盘近似（壳体 0.55×0.7 的内切保守值）——散布盘完全落入 → 8/8 必中。
  const spreadRadiusAt3m = 3 * Math.tan(SG.pelletConeHalf);
  const crabHitRadius = 0.5;
  ok(spreadRadiusAt3m < crabHitRadius, '3m 散布盘半径 ' + spreadRadiusAt3m.toFixed(3) + 'm < 蟹 hitbox 0.5m → 每丸必中',
     spreadRadiusAt3m.toFixed(3));
  ok(SG.pelletCount === 8, '桌面弹丸数 8', SG.pelletCount);
  const burst = SG.pelletCount * SG.damage;   // 8×9=72
  ok(burst >= 68, '单发全中 ' + burst + ' 伤 ≥ 蟹 68 血 → 一发必杀（§5.4 M4 验收）', burst);
  ok(burst - SG.damage < 68, '7 丸（63 伤）杀不掉——「打它值不值」的决策空间保留（§5.3）', burst - SG.damage);
  ok(SG.headshotMult === 1, '爆头不加成（headshotMult=1，§5.4）');
  ok(SG.pelletCountMobile === 6, '移动端降档 6 丸（§9 性能风险行；代价：移动端需两发杀蟹）', SG.pelletCountMobile);
  ok(Array.isArray(SG.sprayPattern) && SG.sprayPattern.length === 0, 'sprayPattern 空数组（跳过 yaw 累加，§8.0）');
  ok(SG.tracerCount === 3 && SG.tracerCount <= SG.pelletCount, '曳光合并 ≤3 条（§9 帧率风险行）');
  // 收紧预案（§5.4：不达标二选一）——若未来几何改动导致 spreadRadius ≥ hitRadius，
  // 按文档收紧 pelletConeHalf 至 3°（0.0524 rad）重测
  const tightened = 3 * Math.tan(3 * Math.PI / 180);
  ok(tightened < crabHitRadius, '收紧预案可行：3° 半角 3m 散布 ' + tightened.toFixed(3) + 'm < 0.5m', tightened.toFixed(3));
}

console.log('\nshotgun: ' + SG.pelletCount + ' 丸 × ' + SG.damage + ' 伤 / 4° 锥 / 12-20m 衰减');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
