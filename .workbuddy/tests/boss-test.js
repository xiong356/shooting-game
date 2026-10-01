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
const expandW = (groups) => groups.flatMap(g => Array(g.count).fill(g.type));

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

    // 逐阶段追速 / 递进召唤 schema（M5b+）
    const bad8 = JSON.parse(JSON.stringify(L.LEVELS));
    bad8[6].boss.chaseSpeeds = [3.2, 4.4];   // 缺 P3
    ok(L.validateLevels(bad8).some(e => e.includes('.boss.chaseSpeeds')), 'chaseSpeeds 非三元被拦截');
    const bad9 = JSON.parse(JSON.stringify(L.LEVELS));
    bad9[6].boss.chaseSpeeds = [5.6, 4.4, 3.2];   // 递减
    ok(L.validateLevels(bad9).some(e => e.includes('.boss.chaseSpeeds')), 'chaseSpeeds 递减被拦截');
    const bad10 = JSON.parse(JSON.stringify(L.LEVELS));
    bad10[6].boss.summon.waves['1'] = [];
    ok(L.validateLevels(bad10).some(e => e.includes('.summon.waves[1]')), '空波次被拦截');
    const bad11 = JSON.parse(JSON.stringify(L.LEVELS));
    bad11[6].boss.summon.waves['2'][0].type = 'dragon';
    ok(L.validateLevels(bad11).some(e => e.includes('.type 非法')), '召唤类型越枚举被拦截（crab|red|blue|elite）');
    const bad12 = JSON.parse(JSON.stringify(L.LEVELS));
    bad12[6].boss.summon.caps = { crab: 6 };
    ok(L.validateLevels(bad12).some(e => e.includes('.summon.caps')), 'caps 缺类别被拦截');

    // parTimeMul（§6）
    const bad13 = JSON.parse(JSON.stringify(L.LEVELS));
    bad13[6].parTimeMul = 0;
    ok(L.validateLevels(bad13).some(e => e.includes('.parTimeMul')), 'parTimeMul = 0 被拦截');
    const bad14 = JSON.parse(JSON.stringify(L.LEVELS));
    bad14[6].parTimeMul = 'x';
    ok(L.validateLevels(bad14).some(e => e.includes('.parTimeMul')), 'parTimeMul 非数被拦截');
  }

  console.log('=== 组 3：gradeFor 时间门（§6；M5b+ parTimeMul 已回收）===');
  {
    const l7 = L.LEVELS[6];
    const l5 = L.LEVELS[4];
    ok(l7.parTime === 180 && l7.parTimeMul === undefined, 'L7 配置口径（parTime 180 / parTimeMul 已回收，§6）', l7);
    ok(l5.reward.weapon === 'negev', 'L5 通关奖励 = 内格夫（M5b+ 换枪）', l5.reward);
    // 优等生统计：acc 90% / hs 50%（远超 S 双门），只考时间门
    const stats = (t) => ({ died: false, shotsFired: 1000, shotsHit: 900, headshots: 450, elapsedSec: t });
    ok(L.gradeFor(stats(216), l7) === 'S', 'L7 S 门 = 180×1.2 = 216s 边界（≤ 收，容忍回收后收紧）');
    ok(L.gradeFor(stats(216.1), l7) === 'A', 'L7 超时 0.1s → A');
    ok(L.gradeFor(stats(300), l7) === 'A', 'L7 300s（旧 ×1.5 口径的 S）→ 回收后 A');
    ok(L.gradeFor(stats(89), l5) === 'A', 'L5 时间门 = 74×1.2 = 88.8s：89s → A');
    ok(L.gradeFor(stats(88), l5) === 'S', 'L5 88s → S');
    // 机制保留验证：parTimeMul 字段本身仍被 gradeFor 消费（当前无关卡使用，留给未来武器差异）
    const mul = { parTime: 100, parTimeMul: 1.5 };
    ok(L.gradeFor(stats(180), mul) === 'S', 'parTimeMul 机制仍在：100×1.2×1.5 = 180s 边界（≤ 收）');
    ok(L.gradeFor(stats(180.1), mul) === 'A', 'parTimeMul 超时 0.1s → A');
  }

  console.log('=== 组 4：L6/L7 配置口径（§4 总表落地断言）===');
  {
    const l6 = L.LEVELS[5];
    const l7 = L.LEVELS[6];
    ok(l6.hpMul === 1.2 && l6.dmgMul === 1.2 && l6.spdMul === 1.05, 'L6 倍率 ×1.2/×1.2/×1.05（§5.1 毕业考）', l6);
    ok(l6.parTime === 114, 'L6 parTime = 14.2×8 = 114（§6 公式）', l6.parTime);
    const total = l6.spawns.reduce((s, x) => s + x.count, 0);
    ok(total === 11, 'L6 总数 11（同场上限 8 + 补位队列 3，M5b）', total);
    ok(l7.spawns.length === 0, 'L7 spawns 空（Boss 不入 spawns，§4.1）');
    ok(l7.layout === 'default', 'L7 场地 = default（§4 场地列）');
    ok(l7.hpMul === 1.0 && l7.dmgMul === 1.0, 'L7 倍率全 1.0（Boss 数值独立，不吃关倍率/k）', l7);
    ok(l7.reward.unlock === 7, 'L7 reward.unlock 自指（通关后全关可重玩，封顶由 save.js 把守）');
    ok(JSON.stringify(l7.boss.phases) === '[0.7,0.4]', 'boss.phases [0.7, 0.4]（HUD 刻度线同源 §9）');
    ok(l7.boss.transition.heal === 30 && l7.boss.transition.invuln === 2, '转场回血 30 / 无敌 2s（§5.3 ⚗️）');
    // M5b+ 机制改版（用户点单）：逐阶段加速 + 递进召唤 + 类别封顶
    ok(JSON.stringify(l7.boss.chaseSpeeds) === '[3.2,4.4,5.6]', '逐阶段追速 3.2/4.4/5.6（凶猛档，P2/P3 越过走路 4.2）', l7.boss.chaseSpeeds);
    ok(l7.boss.summon.interval === 15 && l7.boss.summon.firstDelay === 2.5, '波间隔 15s / 首波延迟 2.5s（用户点单）');
    ok(JSON.stringify(expandW(l7.boss.summon.waves['1'])) === '["crab","crab","crab"]', 'P1 波 = 蟹×3（从 P1 开始召唤）');
    ok(JSON.stringify(expandW(l7.boss.summon.waves['2'])) === '["crab","crab","red","blue"]', 'P2 波 = 蟹×2+红×1+蓝×1', l7.boss.summon.waves['2']);
    const w3 = l7.boss.summon.waves['3'];
    ok(w3.some(e => e.type === 'elite') && w3.length === 4, 'P3 波 = 蟹×2+红×1+蓝×1+精英×1（轮换伪类型）', w3);
    const caps = l7.boss.summon.caps;
    ok(caps.crab === 6 && caps.humanoid === 4 && caps.elite === 2, '类别封顶 蟹6/红蓝4/精英2', caps);
  }

  console.log('=== 组 5：召唤类别映射与封顶判定（bossSummonCategory / bossCanSummon，配置层共用实现）===');
  {
    ok(typeof L.bossSummonCategory === 'function' && typeof L.bossCanSummon === 'function',
      'levels.js 导出 bossSummonCategory / bossCanSummon（game.js bossSummonWave 共用）');
    ok(L.bossSummonCategory('crab') === 'crab', '蟹 → crab（单列封顶）');
    ok(L.bossSummonCategory('red') === 'humanoid' && L.bossSummonCategory('blue') === 'humanoid', '红/蓝 → humanoid（合并封顶）');
    ok(L.bossSummonCategory('eliteRed') === 'elite' && L.bossSummonCategory('eliteBlue') === 'elite' && L.bossSummonCategory('elite') === 'elite',
      '精英红/蓝/轮换伪类型 → elite');
    const caps = { crab: 6, humanoid: 4, elite: 2 };
    ok(L.bossCanSummon('crab', { crab: 5 }, caps) === true, '蟹 5 < 6 → 放行');
    ok(L.bossCanSummon('crab', { crab: 6 }, caps) === false, '蟹恰 6 → 跳过（严格小于口径）');
    ok(L.bossCanSummon('humanoid', { humanoid: 4 }, caps) === false, '红蓝 4 → 封顶');
    ok(L.bossCanSummon('elite', { elite: 1 }, caps) === true, '精英 1 < 2 → 放行');
    ok(L.bossCanSummon('crab', {}, caps) === true, '空存活表 → 放行（0 值缺省防御）');
  }

  console.log('');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
