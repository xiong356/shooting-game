// M5b 补位队列门禁：splitSpawns 切分矩阵（§4.1 同场上限 + FIFO 保序）
// 方法论与 boss-test 同构：js/config/levels.js 纯数据+纯函数，.mjs 副本直接 import
// 真实实现（Mimosa 钩子拦截测试侧 new Function 抽取——纯函数进配置层是既定解法）。
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');
const TMP = path.join(__dirname, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  [OK] ' + label); }
  else { fail++; console.log('  [FAIL] ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const expand = (groups) => groups.flatMap(g => Array(g.count).fill(g.type));

(async function main() {
  fs.copyFileSync(path.join(ROOT, 'js/config/levels.js'), path.join(TMP, 'levels.mjs'));
  const L = await import(pathToFileURL(path.join(TMP, 'levels.mjs')).href + '?queue');
  const split = L.splitSpawns;

  console.log('=== 组 1：不超编关卡 → 队列恒空（L1 红×4 / L2 红×3蓝×3 / L5 共7）===');
  {
    for (const id of [1, 2, 5]) {
      const lv = L.LEVELS[id - 1];
      const r = split(lv.spawns, lv.maxAlive);
      ok(expand(r.queue).length === 0, 'L' + id + '（' + expand(lv.spawns).length + ' 只 ≤ ' + lv.maxAlive + '）queue 空', r.queue);
      ok(expand(r.initial).length === expand(lv.spawns).length, 'L' + id + ' initial = 全量', r.initial);
    }
  }

  console.log('=== 组 2：L4 组跨界拆分（9 > 8 → 最后 1 只蓝怪入队，§4.1 FIFO 保序）===');
  {
    const lv = L.LEVELS[3];
    const r = split(lv.spawns, lv.maxAlive);
    ok(expand(r.initial).length === 8 && expand(r.queue).length === 1, 'L4 切分 8 + 1', r);
    ok(expand(r.queue)[0] === 'blue', '队列唯一条目 = blue（组成表末组末只）', r.queue);
    ok(JSON.stringify(expand(r.initial).slice(-2)) === '["red","blue"]',
      'initial 末尾 = 红3后接蓝1（跨界拆分保序，不整组丢弃）', expand(r.initial));
  }

  console.log('=== 组 3：L6 整组入队（11 > 8 → 蟹×3 排队）===');
  {
    const lv = L.LEVELS[5];
    const r = split(lv.spawns, lv.maxAlive);
    ok(expand(r.initial).length === 8 && expand(r.queue).length === 3, 'L6 切分 8 + 3', r);
    ok(JSON.stringify(expand(r.queue)) === '["crab","crab","crab"]', 'queue = 蟹×3（FIFO 保组成表顺序）', r.queue);
    ok(JSON.stringify(expand(r.initial)) === JSON.stringify(['eliteRed', 'eliteBlue', 'red', 'red', 'red', 'blue', 'blue', 'blue']),
      'initial = 精英红1+精英蓝1+红3+蓝3（组成表顺序）', expand(r.initial));
  }

  console.log('=== 组 4：不变式与边界 ===');
  {
    // 求和不变式：initial + queue 恒等于原总数（任何切分不丢怪）
    let invariant = true;
    for (const lv of L.LEVELS) {
      const r = split(lv.spawns, lv.maxAlive);
      const total = expand(r.initial).length + expand(r.queue).length;
      const expect = lv.spawns.reduce((s, g) => s + g.count, 0);
      if (lv.spawns.length && total !== expect) invariant = false;
    }
    ok(invariant, '全表不变式：initial + queue = 原总数（不丢怪）');
    ok(L.LEVELS[6].spawns.length === 0,
      'L7 spawns 空 → 切分全空（Boss 关不走队列，§4.1）');

    // maxAlive = Infinity → 全量开局（菜单背景语义）
    const LIKE = [{ type: 'red', count: 2 }, { type: 'blue', count: 1 }];
    const inf = split(LIKE, Infinity);
    ok(inf.initial.length === 2 && expand(inf.queue).length === 0, 'Infinity 不设限 → 全量 initial', inf);
    // maxAlive = 0 → 全量入队（防御边界；实际不出现）
    const zero = split(LIKE, 0);
    ok(zero.initial.length === 0 && expand(zero.queue).length === 3, 'maxAlive 0 → 全量入队（防御边界）', zero);
  }

  console.log('');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
