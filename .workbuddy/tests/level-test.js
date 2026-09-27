// M1 关卡系统门禁：§7 存档规则 + §6 评级矩阵 + P4 血池推导
// 方法论与 esm-lint 同构：不复制实现，import 真实模块求值。
//   - save 规则组：js/save.js 复制为 .mjs 副本，import 前先装内存版 localStorage
//     （save.js 零 import、localStorage 全在 try/catch 内，node 可安全求值；
//      query 串区分缓存，每个 scenario 拿到全新模块状态）。
//   - 评级/血池组：js/config/levels.js 纯数据+纯函数，.mjs 副本直接 import
//     （gradeFor/LEVELS/HP_CALIB_MUL）；MONSTER_SPECS 所在的 monsters.js import 了
//     three 无法在 node 求值，用正则读基座数字字面量（只读数字，不求值）。
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

/** 内存版 localStorage（save.js 的唯一外部依赖；privacy-mode 用 setItem 抛错模拟） */
function mockStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    store,
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
}

/** js/<name>.js → .mjs 副本 + 独立 query import：每个 scenario 全新模块状态 */
async function freshModule(relPath, tag, initialStorage) {
  const dest = path.join(TMP, path.basename(relPath).replace(/\.js$/, '.mjs'));
  fs.copyFileSync(path.join(ROOT, relPath), dest);
  globalThis.localStorage = mockStorage(initialStorage);
  const mod = await import(pathToFileURL(dest).href + '?case=' + tag);
  return { mod, ls: globalThis.localStorage };
}

(async function main() {
  // 评级/血池组共用的 levels 模块（纯数据+纯函数，node 可 import）
  const { mod: L } = await freshModule('js/config/levels.js', 'levels');

  console.log('=== 组 1：首次读档 = 默认档（§7）===');
  {
    const { mod, ls } = await freshModule('js/save.js', 'fresh');
    const r = mod.readSave();
    ok(r.save.unlocked === 1, 'unlocked 初始为 1', r.save.unlocked);
    ok(r.save.weapons.length === 1 && r.save.weapons[0] === 'ak47', 'weapons 初始只有 ak47', r.save.weapons);
    ok(r.save.revision === 0 && r.save.schemaVersion === 1, 'revision 0 / schemaVersion 1', r.save);
    ok(r.meta.reset === false && r.meta.memoryMode === false, 'meta 无异常标记', r.meta);
    ok(ls.store.has('wk.pve.save.v1'), '默认档已落盘', [...ls.store.keys()]);
  }

  console.log('=== 组 2：过关结算事务（unlock/取优/clears/revision）===');
  {
    const { mod } = await freshModule('js/save.js', 'apply');
    mod.applyLevelResult(1, { grade: 'A', score: 4200, combo: 12 });
    mod.applyLevelResult(1, { grade: 'B', score: 9999, combo: 20 });   // 分数更高、评级更低
    const t3 = mod.applyLevelResult(1, { grade: 'S', score: 100, combo: 5 }); // 评级更高、分数更低
    const s = mod.getSave();
    const lv = s.levels['1'];
    ok(lv && lv.bestGrade === 'S', 'bestGrade 取优（A→B 不降，S 收口）', lv);
    ok(lv.bestScore === 9999, 'bestScore 取大', lv.bestScore);
    ok(lv.bestCombo === 20, 'bestCombo 取大', lv.bestCombo);
    ok(lv.clears === 3, 'clears 累加 3 次', lv.clears);
    ok(s.unlocked === 2, 'L1 通关解锁 L2', s.unlocked);
    ok(t3.unlockedTo === 2 && t3.ok === true, '返回值含 unlockedTo/ok', t3);
    ok(s.revision === 3, 'revision 每次写事务 +1', s.revision);

    mod.applyLevelResult(2, { grade: 'B', score: 500, combo: 3 });
    ok(mod.getSave().unlocked === 3, 'L2 通关解锁 L3', mod.getSave().unlocked);

    const tW = mod.applyLevelResult(3, { grade: 'B', score: 1, combo: 1, weapons: ['shotgun'] });
    const tW2 = mod.applyLevelResult(3, { grade: 'B', score: 1, combo: 1, weapons: ['shotgun'] });
    ok(mod.getSave().weapons.includes('shotgun'), '发武器入 weapons', mod.getSave().weapons);
    ok(tW.weaponGranted.length === 1 && tW2.weaponGranted.length === 0, '重复发枪去重', [tW.weaponGranted, tW2.weaponGranted]);
  }

  console.log('=== 组 3：坏 JSON → 备份 + 重置（§7）===');
  {
    const { mod, ls } = await freshModule('js/save.js', 'corrupt', { 'wk.pve.save.v1': '{broken json' });
    const r = mod.readSave();
    ok(r.meta.reset === true, 'meta.reset 置位', r.meta);
    ok(r.save.unlocked === 1, '重置为默认档', r.save);
    ok(ls.store.get('wk.pve.save.v1.backup') === '{broken json', '原值备份到 backup key', ls.store.get('wk.pve.save.v1.backup'));
    ok(JSON.parse(ls.store.get('wk.pve.save.v1')).schemaVersion === 1, '主 key 已重写为合法默认档');
  }

  console.log('=== 组 4：schemaVersion 不匹配 → 备份 + 重置（§7）===');
  {
    const { mod, ls } = await freshModule('js/save.js', 'schema', { 'wk.pve.save.v1': JSON.stringify({ schemaVersion: 99, unlocked: 5 }) });
    const r = mod.readSave();
    ok(r.meta.reset === true && r.save.unlocked === 1, '版本门拦截并重置', [r.meta, r.save.unlocked]);
    ok(ls.store.get('wk.pve.save.v1.backup').includes('"schemaVersion":99'), '旧档备份');
  }

  console.log('=== 组 5：写失败 → 内存档降级，恢复后可续写（§7）===');
  {
    const { mod, ls } = await freshModule('js/save.js', 'degrade');
    mod.readSave();
    const diskBefore = ls.store.get('wk.pve.save.v1');   // 读档时默认档已合法落盘
    const realSet = ls.setItem;
    ls.setItem = () => { throw new Error('QuotaExceededError'); };   // 模拟隐私模式/配额
    const t = mod.applyLevelResult(1, { grade: 'A', score: 700, combo: 4 });
    ok(t.ok === false, '写事务返回 ok:false', t.ok);
    ok(mod.getSave().unlocked === 2 && mod.getSave().levels['1'], '内存档继续累积', mod.getSave());
    ok(mod.getSaveMeta().memoryMode === true, 'meta.memoryMode 置位（选关角标数据源）', mod.getSaveMeta());
    ok(ls.store.get('wk.pve.save.v1') === diskBefore, '降级写期间磁盘未被改动');
    ls.setItem = realSet;                                            // 隐私模式解除
    mod.applyLevelResult(2, { grade: 'B', score: 10, combo: 1 });
    const s = mod.getSave();
    ok(s.unlocked === 3 && s.levels['1'] && s.levels['2'], '降级期间进度随下次写事务落盘', s);
    ok(mod.getSaveMeta().memoryMode === false, '恢复后 memoryMode 复位', mod.getSaveMeta());
  }

  console.log('=== 组 6：unlockAll 封顶与消毒 ===');
  {
    const { mod } = await freshModule('js/save.js', 'unlockall');
    mod.unlockAll();
    ok(mod.getSave().unlocked === 7, 'unlockAll 封顶 7（§7）', mod.getSave().unlocked);
    const t = mod.applyLevelResult(7, { grade: 'S', score: 1, combo: 1 });
    ok(t.unlockedTo === 7, 'L7 通关不越界（min 封顶）', t.unlockedTo);
  }

  console.log('=== 组 7：消毒（字段容错）===');
  {
    const { mod } = await freshModule('js/save.js', 'normalize', {
      'wk.pve.save.v1': JSON.stringify({ schemaVersion: 1, unlocked: 3, weapons: ['shotgun'], revision: 2 }),
    });
    const s = mod.getSave();
    ok(s.unlocked === 3 && s.revision === 2, '合法字段保留', s);
    ok(s.weapons[0] === 'ak47' && s.weapons.includes('shotgun'), 'ak47 永远在列（消毒补回）', s.weapons);
  }

  console.log('=== 组 8：gradeFor 评级矩阵（§6 S/A/B/F）===');
  {
    ok(typeof L.gradeFor === 'function', 'levels.js 导出 gradeFor（game.js/门禁共用实现）');
    const g = L.gradeFor;
    const par = { parTime: 40 };
    // shotsFired 固定 1000（0.1pp 粒度，够测 75.7/65.7 的 0.1pp 边界）；hs% 换算爆头原始计数
    const stats = (acc, hs, t, died) => {
      const hit = Math.round(acc * 10);
      return { died: !!died, shotsFired: 1000, shotsHit: hit, headshots: Math.round(hit * hs / 100), elapsedSec: t };
    };
    ok(g(stats(50, 10, 10, true), par) === 'F', '阵亡一律 F（无论数据多好）');
    ok(g(stats(80, 45, 40), par) === 'S', '全优 → S');
    ok(g(stats(75.7, 45, 40), par) === 'S', '命中率门 75.7 边界（≥ 收）');
    ok(g(stats(75.6, 45, 40), par) === 'A', '命中率 75.6（< 门 0.1pp）→ A');
    ok(g(stats(80, 40, 40), par) === 'S', '爆头门 40 边界（≥ 收）');
    ok(g(stats(80, 39, 40), par) === 'A', '爆头 39（< 门）→ A');
    ok(g(stats(80, 45, 48), par) === 'S', '时间门 parTime×1.2 边界（≤ 收）');
    ok(g(stats(80, 45, 48.1), par) === 'A', '超时 0.1s → A');
    ok(g(stats(65.7, 10, 100), par) === 'A', 'A 门 65.7 边界（≥ 收，不看爆头/时间）');
    ok(g(stats(65.6, 50, 10), par) === 'B', '命中率 65.6 → B（保底）');
    ok(g(stats(0, 0, 200), par) === 'B', '零命中通关 → B');
  }

  console.log('=== 组 9：血池推导断言（P4：§4 总表 × k=1.5）===');
  {
    // 怪种基座 HP：monsters.js import three 无法求值，正则读数字字面量（只读数字，不求值）
    const monstersSrc = fs.readFileSync(path.join(ROOT, 'js/monsters.js'), 'utf8');
    const baseHP = {};
    for (const m of monstersSrc.matchAll(/^\s{2}(red|blue|crab|eliteRed|eliteBlue):\s*\{ maxHealth: (\d+)/gm)) {
      baseHP[m[1]] = Number(m[2]);
    }
    ok(baseHP.red === 150 && baseHP.blue === 100, '怪种基座读取（红150/蓝100，§2）', baseHP);
    ok(baseHP.crab === 68 && baseHP.eliteRed === 300 && baseHP.eliteBlue === 220,
      'M3 新怪种基座（蟹68/精英红300/精英蓝220，§5.3）', baseHP);

    // §4 总表血池列（M3 真身版：L4 蟹×4红×3蓝×2 / L5 精英红+红×3蓝×3）
    const EXPECTED = [900, 1125, 1485, 1521, 1733];
    ok(L.LEVELS.length === EXPECTED.length, 'LEVELS 行数 = 5（M1 范围）', L.LEVELS.length);
    for (let i = 0; i < L.LEVELS.length; i++) {
      const lv = L.LEVELS[i];
      const pre = lv.spawns.reduce((sum, s) => sum + baseHP[s.type] * s.count, 0);
      const pool = pre * lv.hpMul * L.HP_CALIB_MUL;
      const target = EXPECTED[i];
      ok(Math.abs(pool - target) / target <= 0.01,
        'L' + lv.id + ' 血池 ' + Math.round(pool) + ' ≈ ' + target + '（±1%）', { pre, pool, target });
    }
  }

  console.log('=== 组 10：场地布局预设（M2 §5.2 布局即数据）===');
  {
    ok(typeof L.validateLayout === 'function' && typeof L.layoutAABB === 'function', 'levels.js 导出 validateLayout/layoutAABB');
    for (const name of Object.keys(L.LAYOUTS)) {
      const errs = L.validateLayout(L.LAYOUTS[name]);
      ok(errs.length === 0, 'LAYOUTS.' + name + ' 过 validateLayout', errs);
    }
    ok(L.LAYOUTS.default.length === 9 && L.LAYOUTS.variantA.length === 11 && L.LAYOUTS.variantB.length === 6,
      '预设障碍数 9/11/6（§2 基线 + S形窄道 + 双柱阵）', [L.LAYOUTS.default.length, L.LAYOUTS.variantA.length, L.LAYOUTS.variantB.length]);

    // variantA S 形窄口：H1 右口 / H2 左口，均 3.0m ±0.05（对照 ±8 纵隔断内侧面，非 magic number）
    const hDivs = L.LAYOUTS.variantA.filter(o => o.type === 'divider' && o.dir === 'h');
    ok(hDivs.length === 2, 'variantA 含 2 道横隔断', hDivs.length);
    const eastInner = L.layoutAABB(L.LAYOUTS.variantA.find(o => o.type === 'divider' && o.dir === 'v' && o.x > 0)).minX;
    const westInner = L.layoutAABB(L.LAYOUTS.variantA.find(o => o.type === 'divider' && o.dir === 'v' && o.x < 0)).maxX;
    const [hLeft, hRight] = hDivs.map(L.layoutAABB).sort((p, q) => p.maxX - q.maxX);
    const gapA = eastInner - hLeft.maxX;    // H1 右端 → 东隔断内侧面
    const gapB = hRight.minX - westInner;   // 西隔断内侧面 → H2 左端
    ok(Math.abs(gapA - 3.0) <= 0.05 && Math.abs(gapB - 3.0) <= 0.05, 'S 形窄口均 3.0m ±0.05（§5.2 走廊 2.5-4m 带内）', [gapA, gapB]);

    // 关卡行引用（§4 场地列）
    const layoutOf = id => L.LEVELS[id - 1].layout;
    ok(layoutOf(1) === 'default' && layoutOf(2) === 'default', 'L1/L2 → default');
    ok(layoutOf(3) === 'variantA' && layoutOf(4) === 'variantA', 'L3/L4 → variantA');
    ok(layoutOf(5) === 'variantB', 'L5 → variantB');
    // 薄隔断推挤覆盖说明：0.3m 薄墙的圆推出/贴墙滑行已由 collision-test 组 7「真实场地坐标」覆盖
    // （default 两道 0.3m 纵隔断）；横放仅旋转向、数学同路，不重复建组。
  }

  console.log('');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
