// ============================================
// 标定报告生成器（tools/calib-report.js，M6）
// ============================================
// 用法：把浏览器 console 导出的标定 JSON 存为 tools/calib.json，然后运行：
//   node tools/calib-report.js
// 输出：real/auto 分列 → 池化命中率/爆头率 vs §6 门 → 各关用时分位数 vs 当前 parTime
//   对照与收紧建议 → 武器使用率占比 vs §10「AK ≥30%」线 → L7 Boss 局明细。
// 只读分析，不写任何游戏文件。LEVELS/评级门经 levels.mjs 副本 import 真实实现（防漂移）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// 仓库根 = 当前工作目录（从仓库根运行本工具）
const ROOT = process.cwd();
const LEVELS_SRC = path.join(ROOT, 'js', 'config', 'levels.js');
const LEVELS_TMP = path.join(os.tmpdir(), 'calib-report-levels.mjs');
const INPUT = path.join(ROOT, 'tools', 'calib.json');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function pct(x) { return (x * 100).toFixed(1) + '%'; }
function fmtSec(v) { return (v === null || v === undefined) ? '—' : v.toFixed(1) + 's'; }

async function main() {
  if (!fs.existsSync(LEVELS_SRC)) { console.log('FATAL: 未找到 ' + LEVELS_SRC + '（请从仓库根目录运行）'); process.exit(1); }
  if (!fs.existsSync(INPUT)) { console.log('FATAL: 未找到 ' + INPUT + '——把浏览器导出的标定 JSON 存成该文件后再运行'); process.exit(1); }
  const samples = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  if (!Array.isArray(samples)) { console.log('FATAL: tools/calib.json 内容不是数组'); process.exit(1); }

  fs.copyFileSync(LEVELS_SRC, LEVELS_TMP);
  const L = await import(pathToFileURL(LEVELS_TMP).href + '?report');

  const real = samples.filter(s => !s.auto);
  const auto = samples.length - real.length;
  console.log(`样本 ${samples.length} 局（real ${real.length} / auto ${auto}——auto 为调试对局，已排除）`);

  // ---- 全局命中口径 vs §6 门 ----
  const withShots = real.filter(s => s.shotsFired > 0);
  const SF = withShots.reduce((a, s) => a + s.shotsFired, 0);
  const SH = withShots.reduce((a, s) => a + s.shotsHit, 0);
  const HS = withShots.reduce((a, s) => a + s.headshots, 0);
  const acc = SF > 0 ? SH / SF : 0, hsRate = SH > 0 ? HS / SH : 0;
  const G = L.GRADE_CONFIG;
  const sAcc = (G.calibratedAccuracyMedian !== null ? G.calibratedAccuracyMedian + G.sAccuracyOffset : G.sAccuracyThreshold) / 100;
  const aAcc = (G.calibratedAccuracyMedian !== null ? G.calibratedAccuracyMedian + G.aAccuracyOffset : G.aAccuracyThreshold) / 100;
  console.log(`\n== 命中口径（§6 门核对）==`);
  console.log(`池化命中率 ${pct(acc)}（门 S ${pct(sAcc)} / A ${pct(aAcc)}）  池化爆头率 ${pct(hsRate)}（门 ${G.sHeadshotThreshold}%）`);
  console.log(`判定：${acc >= sAcc && hsRate * 100 >= G.sHeadshotThreshold ? '池化达 S 级准度——门保持' : acc >= aAcc ? '池化在 A 档——门保持' : '池化低于 A 门——关注'}`);

  // ---- 各关用时 vs parTime ----
  console.log(`\n== 各关用时分位数 vs 当前 parTime（P75 > S 门 = 门偏紧/关偏难；P75 ≤ parTime×0.5 = parTime 收紧候选）==`);
  const byLevel = {};
  for (const s of real) {
    if (s.level === undefined || !Number.isFinite(s.elapsedSec)) continue;
    const b = byLevel[s.level] || (byLevel[s.level] = { v: [], d: 0 });
    if (s.result === 'victory') b.v.push(s.elapsedSec); else b.d++;
  }
  let anyLevel = false;
  for (const lv of L.LEVELS) {
    const b = byLevel[lv.id];
    if (!b) continue;
    anyLevel = true;
    const v = b.v.sort((a, c) => a - c);
    const sMul = (lv.parTimeMul || 1);
    const gate = lv.parTime * 1.2 * sMul;
    const p50 = percentile(v, 0.5), p75 = percentile(v, 0.75);
    let advice = v.length < 3 ? '样本不足' :
      p75 > gate ? '时间门偏紧或关偏难——先看难度再谈门' :
      p75 <= lv.parTime * 0.5 ? `parTime 收紧候选 ≈ ${Math.round(p75 / 0.75)}` : '门合适';
    console.log(`  L${lv.id} ${lv.name.padEnd(4)}  胜${v.length} 负${b.d}  P50 ${fmtSec(p50)}  P75 ${fmtSec(p75)}  | parTime ${lv.parTime}s  S门 ${Math.round(gate)}s  → ${advice}`);
  }
  const noLevel = real.filter(s => s.level === undefined);
  if (noLevel.length) {
    const oldV = noLevel.filter(s => s.result === 'victory' && Number.isFinite(s.elapsedSec)).map(s => s.elapsedSec).sort((a, c) => a - c);
    console.log(`  （另有 ${noLevel.length} 局旧样本无 level 字段，未分关${oldV.length ? `——全局胜利用时 P50 ${fmtSec(percentile(oldV, 0.5))}` : ''}）`);
  }
  if (!anyLevel && !noLevel.length) console.log('  （无带用时样本）');

  // ---- 武器使用率 ----
  const usage = {};
  for (const s of real) {
    if (!s.weaponShots) continue;
    for (const w of Object.keys(s.weaponShots)) usage[w] = (usage[w] || 0) + s.weaponShots[w];
  }
  const totalW = Object.values(usage).reduce((a, b) => a + b, 0);
  console.log(`\n== 武器使用率（开火次数口径，§10「AK ≥30%」线）==`);
  if (!totalW) { console.log('  （无 weaponShots 数据——需 M6 后新攒的样本）'); }
  else {
    for (const w of Object.keys(usage).sort((a, b) => usage[b] - usage[a])) {
      console.log(`  ${w.padEnd(8)} ${String(usage[w]).padStart(5)} 发  ${pct(usage[w] / totalW)}`);
    }
    const akShare = (usage.ak47 || 0) / totalW;
    console.log(`  判定：AK 占比 ${pct(akShare)} ${akShare >= 0.3 ? '≥30% —— 万金油地位成立' : '<30% —— 触发 §10 B 级「新枪上位替代」信号，按 playtest 削新枪'}`);
  }

  // ---- L7 Boss 局明细 ----
  const boss = real.filter(s => s.level === 7);
  console.log(`\n== L7 Boss 局明细（${boss.length} 局）==`);
  for (const s of boss) {
    console.log(`  ${s.result === 'victory' ? '胜' : '负'}  ${Number.isFinite(s.elapsedSec) ? s.elapsedSec.toFixed(0) + 's' : '—'}  ${s.shotsFired} 发 / 命中 ${s.shotsHit} / 爆头 ${s.headshots}`);
  }
  if (boss.length >= 2) {
    const wins = boss.filter(s => s.result === 'victory').length;
    const rate = wins / boss.length;
    console.log(`  通过率 ${pct(rate)} —— ${rate < 0.34 ? '低于 1/3：§10 A 级数值墙区间，按难度下调处置' : rate > 0.8 ? '偏高：Boss 偏软信号，关注' : '区间内'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('报告失败:', e); process.exit(1); });
