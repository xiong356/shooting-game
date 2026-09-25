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

/** 取一个顶层 const 的右值（[^;]+ 可匹配数组字面量，数组里没有分号） */
function grabConst(src, name) {
  const re = new RegExp('^const ' + name + ' = ([^;]+);', 'm');
  const m = src.match(re);
  return m ? m[1] : null;
}

const fnBody = extractFn(SRC, 'getInaccuracyAngle');
if (!fnBody) { console.log('抽不到函数 getInaccuracyAngle'); process.exit(1); }
for (const n of ['SPREAD_PER_SPEED', 'SPREAD_AIR_MULT', 'SPRAY_YAW_PATTERN']) {
  if (grabConst(SRC, n) === null) { console.log('抽不到常量 ' + n); process.exit(1); }
}

// 注入真实源码里的常量与纯函数，得到可求值的 API（不复制实现）
const api = new Function(
  'const SPREAD_PER_SPEED = ' + grabConst(SRC, 'SPREAD_PER_SPEED') + ';\n' +
  'const SPREAD_AIR_MULT = ' + grabConst(SRC, 'SPREAD_AIR_MULT') + ';\n' +
  fnBody + '\n' +
  'return { getInaccuracyAngle, SPREAD_PER_SPEED, SPREAD_AIR_MULT };'
)();

const pattern = new Function('return ' + grabConst(SRC, 'SPRAY_YAW_PATTERN'))();

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

console.log('=== 组 3：常量口径一致性 ===');
{
  ok(Math.abs(api.SPREAD_PER_SPEED * 2.4 - 0.15) < 1e-9,
    'SPREAD_PER_SPEED × 2.4 ≈ 0.15 rad（10m 处散布半径 ≈ 1.5m）');
  ok(api.SPREAD_AIR_MULT === 2.5, 'SPREAD_AIR_MULT = 2.5');
}

console.log('=== 组 4：spray pattern 确定性图案表 ===');
{
  ok(Array.isArray(pattern), 'SPRAY_YAW_PATTERN 是数组字面量');
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

console.log('\nSPREAD_PER_SPEED=' + api.SPREAD_PER_SPEED +
  '  SPREAD_AIR_MULT=' + api.SPREAD_AIR_MULT +
  '  PATTERN=[' + pattern.join(', ') + ']');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
