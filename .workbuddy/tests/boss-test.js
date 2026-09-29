// M5a Boss 门禁：bossPhaseFor 阈值边界 + L7 boss 字段 schema + parTimeMul 时间门
// + P3 召唤节流（§5.3 / §6 / §9）。
// 方法论与 level-test 同构：js/config/levels.js 纯数据+纯函数，.mjs 副本直接 import
// 真实实现（bossShouldSummon 也住配置层——Mimosa 钩子拦截测试侧 new Function 抽取，
// 纯函数进配置模块是本项目既定解法，见 gradeFor 先例）。
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

(async function main() {
  fs.copyFileSync(path.join(ROOT, 'js/config/levels.js'), path.join(TMP, 'levels.mjs'));
  const L = await import(pathToFileURL(path.join(TMP, 'levels.mjs')).href + '?boss');

  console.log('=== 组 1：bossPhaseFor 阶段阈值边界（§5.3 P1 100-70 / P2 70-40 / P3 40-0）===');
  {
    ok(L.bossPhaseFor(1.0) === 1, '满血 → P1');
    ok(L.bossPhaseFor(0.700001) === 1, '70.0001% → P1（> 阈值才守段）');
    ok(L.bossPhaseFor(0.7) === 2, '恰好 70% → P2（跌破即破阶段，与 §9 刻度线分界一致）');
    ok(L.bossPhaseFor(0.41) === 2, '41% → P2');
    ok(L.bossPhaseFor(0.4) === 3, '恰好 40% → P3');
    ok(L.bossPhaseFor(0.0) === 3, '0% → P3');
    ok(L.bossPhaseFor(0.6, [0.8, 0.5]) === 2, '自定义阈值 [0.8, 0.5]：60% → P2（配置化阈值生效）');
  }

  console.log('=== 组 2：L7 boss 字段 schema（validateLevels M5a 扩展）===');
  {
    ok(L.validateLevels(L.LEVELS).length === 0, '正式 LEVELS（含 L7 boss）全数通过');
    ok(L.LEVELS[6].boss !== undefined, 'L7 携带 boss 字段');

    // boss 字段落到非 L7 关 → 拦截
    const bad1 = JSON.parse(JSON.stringify(L.LEVELS));
    bad1[0].boss = JSON.parse(JSON.stringify(L.LEVELS[6].boss));
    ok(L.validateLevels(bad1).some(e => e.includes('.boss 字段仅 L7')), '非 L7 携带 boss 被拦截');

    // L7 缺 boss → 拦截（L7 必须是 Boss 关）
    const bad2 = JSON.parse(JSON.stringify(L.LEVELS));
    delete bad2[6].boss;
    ok(L.validateLevels(bad2).some(e => e.includes('.boss 缺失')), 'L7 缺 boss 被拦截');

    // Boss 关 spawns 空 = 合法；常规关 spawns 空 = 非法
    const bad3 = JSON.parse(JSON.stringify(L.LEVELS));
    bad3[0].spawns = [];
    ok(L.validateLevels(bad3).some(e => e.includes('.spawns')), '常规关 spawns 空被拦截（Boss 关豁免）');

    // 行为子对象缺字段 / 非法值
    const bad4 = JSON.parse(JSON.stringify(L.LEVELS));
    bad4[6].boss.melee.range = 0;
    ok(L.validateLevels(bad4).some(e => e.includes('.boss.melee.range')), 'melee.range = 0 被拦截');
    const bad5 = JSON.parse(JSON.stringify(L.LEVELS));
    delete bad5[6].boss.transition;
    ok(L.validateLevels(bad5).some(e => e.includes('.boss.transition')), '缺 transition 被拦截');
    const bad6 = JSON.parse(JSON.stringify(L.LEVELS));
    bad6[6].boss.phases = [0.4, 0.7];   // 升序
    ok(L.validateLevels(bad6).some(e => e.includes('.boss.phases')), 'phases 升序被拦截（须降序 1>p0>p1>0）');
    const bad7 = JSON.parse(JSON.stringify(L.LEVELS));
    bad7[6].boss.entrance.duration = -1;
    ok(L.validateLevels(bad7).some(e => e.includes('.boss.entrance.duration')), 'entrance.duration < 0 被拦截');

    // parTimeMul（§6）
    const bad8 = JSON.parse(JSON.stringify(L.LEVELS));
    bad8[6].parTimeMul = 0;
    ok(L.validateLevels(bad8).some(e => e.includes('.parTimeMul')), 'parTimeMul = 0 被拦截');
    const bad9 = JSON.parse(JSON.stringify(L.LEVELS));
    bad9[6].parTimeMul = 'x';
    ok(L.validateLevels(bad9).some(e => e.includes('.parTimeMul')), 'parTimeMul 非数被拦截');
  }

  console.log('=== 组 3：gradeFor parTimeMul（§6 步枪关卡时间门 ×1.5）===');
  {
    const l7 = L.LEVELS[6];
    const l5 = L.LEVELS[4];
    ok(l7.parTime === 180 && l7.parTimeMul === 1.5, 'L7 配置口径（parTime 180 / parTimeMul 1.5，§6 特例）', l7);
    ok(l5.parTimeMul === undefined, 'L5 无 parTimeMul（AK 口径，缺省 1）');
    // 优等生统计：acc 90% / hs 50%（远超 S 双门），只考时间门
    const stats = (t) => ({ died: false, shotsFired: 1000, shotsHit: 900, headshots: 450, elapsedSec: t });
    ok(L.gradeFor(stats(324), l7) === 'S', 'L7 S 门 = 180×1.2×1.5 = 324s 边界（≤ 收）');
    ok(L.gradeFor(stats(324.1), l7) === 'A', 'L7 超时 0.1s → A');
    ok(L.gradeFor(stats(216), l7) === 'S', 'L7 216s（无 parTimeMul 的老口径门）→ 有容忍后 S');
    ok(L.gradeFor(stats(89), l5) === 'A', 'L5 时间门 = 74×1.2 = 88.8s：89s → A（无 mul 关卡不受影响）');
    ok(L.gradeFor(stats(88), l5) === 'S', 'L5 88s → S');
  }

  console.log('=== 组 4：L6/L7 配置口径（§4 总表落地断言）===');
  {
    const l6 = L.LEVELS[5];
    const l7 = L.LEVELS[6];
    ok(l6.hpMul === 1.2 && l6.dmgMul === 1.2 && l6.spdMul === 1.05, 'L6 倍率 ×1.2/×1.2/×1.05（§5.1 毕业考）', l6);
    ok(l6.parTime === 114, 'L6 parTime = 14.2×8 = 114（§6 公式）', l6.parTime);
    const total = l6.spawns.reduce((s, x) => s + x.count, 0);
    ok(total === 11, 'L6 总数 11（补位队列 M5b 交付，先全量刷——L4 同款先例）', total);
    ok(l7.spawns.length === 0, 'L7 spawns 空（Boss 不入 spawns，§4.1）');
    ok(l7.layout === 'default', 'L7 场地 = default（§4 场地列）');
    ok(l7.hpMul === 1.0 && l7.dmgMul === 1.0, 'L7 倍率全 1.0（Boss 数值独立，不吃关倍率/k）', l7);
    ok(l7.reward.unlock === 7, 'L7 reward.unlock 自指（通关后全关可重玩，封顶由 save.js 把守）');
    ok(JSON.stringify(l7.boss.phases) === '[0.7,0.4]', 'boss.phases [0.7, 0.4]（HUD 刻度线同源 §9）');
    ok(l7.boss.transition.heal === 30 && l7.boss.transition.invuln === 2, '转场回血 30 / 无敌 2s（§5.3 ⚗️）');
  }

  console.log('=== 组 5：P3 召唤节流（bossShouldSummon，配置层共用实现）===');
  {
    ok(typeof L.bossShouldSummon === 'function', 'levels.js 导出 bossShouldSummon（game.js bossSummonWave 共用）');
    ok(L.bossShouldSummon(0, 6) === true, '0 存活 < 上限 6 → 放行召唤');
    ok(L.bossShouldSummon(5, 6) === true, '5 存活 < 6 → 放行');
    ok(L.bossShouldSummon(6, 6) === false, '恰好 6（= 上限）→ 跳过本波（严格小于口径）');
    ok(L.bossShouldSummon(9, 6) === false, '9 存活 > 6 → 跳过');
  }

  console.log('');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
