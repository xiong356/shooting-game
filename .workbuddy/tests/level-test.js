// M1 关卡系统门禁：§7 存档规则 + 评级矩阵 + 血池推导
// 方法论与 attack-test.js 一致：不复制实现。
//   - save 规则组：js/save.js 复制为 .mjs 副本，import 前先装内存版 localStorage
//     （save.js 零 import、localStorage 全在 try/catch 内，node 可安全求值；
//      query 串区分缓存，每个 scenario 拿到全新模块状态）。
//   - 评级/血池组：extractFn/grabConst 从真实源码抽取纯函数与常量（M1⑥ 补齐）。
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

/** save.js → .mjs 副本 + 独立 query import：每个 scenario 全新模块状态 */
async function freshSaveModule(tag, initialStorage) {
  const dest = path.join(TMP, 'save-under-test.mjs');
  fs.copyFileSync(path.join(ROOT, 'js/save.js'), dest);
  globalThis.localStorage = mockStorage(initialStorage);
  const mod = await import(pathToFileURL(dest).href + '?case=' + tag);
  return { mod, ls: globalThis.localStorage };
}

(async function main() {
  console.log('=== 组 1：首次读档 = 默认档（§7）===');
  {
    const { mod, ls } = await freshSaveModule('fresh');
    const r = mod.readSave();
    ok(r.save.unlocked === 1, 'unlocked 初始为 1', r.save.unlocked);
    ok(r.save.weapons.length === 1 && r.save.weapons[0] === 'ak47', 'weapons 初始只有 ak47', r.save.weapons);
    ok(r.save.revision === 0 && r.save.schemaVersion === 1, 'revision 0 / schemaVersion 1', r.save);
    ok(r.meta.reset === false && r.meta.memoryMode === false, 'meta 无异常标记', r.meta);
    ok(ls.store.has('wk.pve.save.v1'), '默认档已落盘', [...ls.store.keys()]);
  }

  console.log('=== 组 2：过关结算事务（unlock/取优/clears/revision）===');
  {
    const { mod } = await freshSaveModule('apply');
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
    const { mod, ls } = await freshSaveModule('corrupt', { 'wk.pve.save.v1': '{broken json' });
    const r = mod.readSave();
    ok(r.meta.reset === true, 'meta.reset 置位', r.meta);
    ok(r.save.unlocked === 1, '重置为默认档', r.save);
    ok(ls.store.get('wk.pve.save.v1.backup') === '{broken json', '原值备份到 backup key', ls.store.get('wk.pve.save.v1.backup'));
    ok(JSON.parse(ls.store.get('wk.pve.save.v1')).schemaVersion === 1, '主 key 已重写为合法默认档');
  }

  console.log('=== 组 4：schemaVersion 不匹配 → 备份 + 重置（§7）===');
  {
    const { mod, ls } = await freshSaveModule('schema', { 'wk.pve.save.v1': JSON.stringify({ schemaVersion: 99, unlocked: 5 }) });
    const r = mod.readSave();
    ok(r.meta.reset === true && r.save.unlocked === 1, '版本门拦截并重置', [r.meta, r.save.unlocked]);
    ok(ls.store.get('wk.pve.save.v1.backup').includes('"schemaVersion":99'), '旧档备份');
  }

  console.log('=== 组 5：写失败 → 内存档降级，恢复后可续写（§7）===');
  {
    const { mod, ls } = await freshSaveModule('degrade');
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
    const { mod } = await freshSaveModule('unlockall');
    mod.unlockAll();
    ok(mod.getSave().unlocked === 7, 'unlockAll 封顶 7（§7）', mod.getSave().unlocked);
    const t = mod.applyLevelResult(7, { grade: 'S', score: 1, combo: 1 });
    ok(t.unlockedTo === 7, 'L7 通关不越界（min 封顶）', t.unlockedTo);
  }

  console.log('=== 组 7：消毒（normalizeSave 字段容错）===');
  {
    const { mod } = await freshSaveModule('normalize', {
      'wk.pve.save.v1': JSON.stringify({ schemaVersion: 1, unlocked: 3, weapons: ['shotgun'], revision: 2 }),
    });
    const s = mod.getSave();
    ok(s.unlocked === 3 && s.revision === 2, '合法字段保留', s);
    ok(s.weapons[0] === 'ak47' && s.weapons.includes('shotgun'), 'ak47 永远在列（消毒补回）', s.weapons);
  }

  console.log('');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
