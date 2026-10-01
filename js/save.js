// ============================================
// localStorage 读写层（设计文档 §7 规则的实现载体，§8.0 四文件拆分）
// ============================================
// M0.5④ 自 game.js 搬移 M0 标定存储，不改行为：
//   读异常（隐私模式 / JSON 损坏 / 无值）→ 返回 fallback（内存档）；
//   写异常（隐私模式 / 配额）→ 返回 false，调用方维持内存档继续累积。
// M1②：§7 存档系统（wk.pve.save.v1）在本文件落地——备份重置 / schemaVersion 门 /
//   revision 乐观锁 / storage 事件合并 / 仅过关写盘。标定存储是其读写包装的第一个消费者。

/** JSON 读取：任何异常返回 fallback。 */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}

/** JSON 写入：返回是否成功；失败即降级为内存档。 */
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) { return false; }
}

/** 删除：返回是否成功（无持久化可清时 false）。 */
function removeKey(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) { return false; }
}

// ============================================
// M0 标定样本（§12 假设 #1/#1b：跨局按原始计数池化求命中率/爆头率）
// ============================================
// 纯被动记录，不参与任何游戏逻辑。独立于 M1 存档系统，写在专属 key。
export const CALIB_KEY = 'wk.pve.calib.v1';

let calibSamples = (() => {
  const arr = readJSON(CALIB_KEY, []);
  return Array.isArray(arr) ? arr : [];
})();

/** 追加一条样本并持久化（持久化失败 = 内存档，当次会话仍可继续累积）。 */
export function pushCalibSample(sample) {
  calibSamples.push(sample);
  writeJSON(CALIB_KEY, calibSamples);
}

/** 样本副本（探针用，防外部改写内部数组）。 */
export function getCalibSamples() {
  return calibSamples.slice();
}

export function clearCalibSamples() {
  calibSamples.length = 0;
  removeKey(CALIB_KEY);
}

/** 池化统计：所有样本原始计数相加后再求比率（对各局比率取平均会因样本量不同失真）。
 *  M5b：补胜利局用时统计（elapsedSec 埋点）——§6 S 档 parTime P75 收紧的数据入口，
 *  只做只读汇总，不参与评级。 */
export function calibSummary() {
  let f = 0, h = 0, hs = 0;
  for (const s of calibSamples) { f += s.shotsFired; h += s.shotsHit; hs += s.headshots; }
  const victoryElapsed = calibSamples
    .filter(s => s.result === 'victory' && Number.isFinite(s.elapsedSec))
    .map(s => s.elapsedSec)
    .sort((a, b) => a - b);
  return {
    n: calibSamples.length,                 // 样本局数；§10 要求 ≥10
    pooledAccuracy: f > 0 ? h / f : 0,       // Σ命中 / Σ开枪
    pooledHeadshotRate: h > 0 ? hs / h : 0,  // Σ爆头 / Σ命中
    totalShotsFired: f, totalShotsHit: h, totalHeadshots: hs,
    victoryRuns: victoryElapsed.length,      // 有用时数据的胜利局数
    // 胜利局用时中位数（偶数取中位右值，粗粒度够 P75 档位参考）
    medianVictorySec: victoryElapsed.length ? victoryElapsed[victoryElapsed.length >> 1] : null,
  };
}

// ============================================
// M1② 关卡进度存档（§7 全表规则）
// ============================================
// 写入时机：仅过关结算（applyLevelResult），阵亡不写盘（§7）。
// 并发：read-modify-write + revision 乐观锁；storage 事件合并（取优，不整体覆盖）。

export const SAVE_KEY = 'wk.pve.save.v1';
export const SAVE_BACKUP_KEY = 'wk.pve.save.v1.backup';
export const SAVE_MAX_UNLOCK = 7;      // §7：通关 L7 后 unlocked 封顶 7

const GRADE_RANK = { S: 3, A: 2, B: 1, F: 0 };   // bestGrade 取优用

function defaultSave() {
  return { schemaVersion: 1, revision: 0, unlocked: 1, weapons: ['ak47'], levels: {} };
}

function cloneSave(s) {
  return JSON.parse(JSON.stringify(s));
}

/** 两份存档逐字段取优（§7 storage 合并 / 乐观锁冲突重试共用）。 */
function mergeSaves(a, b) {
  const out = cloneSave(a);
  out.revision = Math.max(a.revision || 0, b.revision || 0);
  out.unlocked = Math.max(a.unlocked || 1, b.unlocked || 1);
  if (Array.isArray(b.weapons)) {
    out.weapons = (Array.isArray(a.weapons) ? a.weapons.slice() : []);
    for (const w of b.weapons) if (!out.weapons.includes(w)) out.weapons.push(w);
  }
  out.levels = (a.levels && typeof a.levels === 'object') ? { ...a.levels } : {};
  if (b.levels && typeof b.levels === 'object') {
    for (const key of Object.keys(b.levels)) {
      const x = out.levels[key], y = b.levels[key];
      if (!x || typeof x !== 'object') { out.levels[key] = { ...y }; continue; }
      const rx = GRADE_RANK[x.bestGrade], ry = GRADE_RANK[y.bestGrade];
      out.levels[key] = {
        bestGrade: ry !== undefined && (rx === undefined || ry > rx) ? y.bestGrade : x.bestGrade,
        bestScore: Math.max(x.bestScore || 0, y.bestScore || 0),
        bestCombo: Math.max(x.bestCombo || 0, y.bestCombo || 0),
        clears: Math.max(x.clears || 0, y.clears || 0),
      };
    }
  }
  return out;
}

/** 磁盘数据消毒：字段缺失/类型不对时回默认值（宽容读，不因个别坏字段整档作废）。 */
function normalizeSave(p) {
  const s = defaultSave();
  if (Number.isInteger(p.unlocked)) s.unlocked = Math.min(Math.max(1, p.unlocked), SAVE_MAX_UNLOCK);
  if (Array.isArray(p.weapons)) s.weapons = p.weapons
    .filter(w => typeof w === 'string' && w)
    // M5b+ 换枪迁移：射手步枪「穿云」除名 → 老档 rifle 平移为 negev（不炸档、进度保留）
    .map(w => (w === 'rifle' ? 'negev' : w));
  if (!s.weapons.includes('ak47')) s.weapons.unshift('ak47');   // ak47 永远在列
  if (p.levels && typeof p.levels === 'object') {
    for (const key of Object.keys(p.levels)) {
      const lv = p.levels[key];
      if (!lv || typeof lv !== 'object') continue;
      s.levels[key] = {
        bestGrade: GRADE_RANK[lv.bestGrade] !== undefined ? lv.bestGrade : null,
        bestScore: Number.isFinite(lv.bestScore) ? lv.bestScore : 0,
        bestCombo: Number.isFinite(lv.bestCombo) ? lv.bestCombo : 0,
        clears: Number.isFinite(lv.clears) ? lv.clears : 0,
      };
    }
  }
  if (Number.isInteger(p.revision) && p.revision > 0) s.revision = p.revision;
  return s;
}

// ---- 内存档状态（写降级 / 重置角标的数据源）----
let currentSave = null;
let saveMetaState = { reset: false, memoryMode: false };
const mergedListeners = [];

/**
 * 读档（模块内缓存的真源）。解析异常或 schemaVersion≠1 → 原值备份 + 重置新档（§7），
 * meta.reset 供 UI 角标「存档已重置」。返回 { save, meta }，save 为副本。
 */
export function readSave() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { /* 隐私模式 */ }
  if (raw !== null) {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (parsed && typeof parsed === 'object' && parsed.schemaVersion === 1) {
      currentSave = normalizeSave(parsed);
      return { save: cloneSave(currentSave), meta: { ...saveMetaState } };
    }
    // 损坏 / 版本不匹配：原值备份后重置（§7），备份失败不阻断重置
    try { localStorage.setItem(SAVE_BACKUP_KEY, raw); } catch (e) { /* ignore */ }
    saveMetaState.reset = true;
  }
  currentSave = defaultSave();
  if (!writeJSON(SAVE_KEY, currentSave)) saveMetaState.memoryMode = true;
  return { save: cloneSave(currentSave), meta: { ...saveMetaState } };
}

function ensureLoaded() {
  if (!currentSave) readSave();
}

/**
 * 通用写事务：read-modify-write + revision 乐观锁。
 * mutator 就地修改待写档；写失败返回 {ok:false}（内存档已更新，当次会话继续玩，§7 降级）。
 * 磁盘 revision 领先于内存档（其他标签页写过）→ 先双方取优再应用 mutator，对方进度不丢。
 */
export function writeSave(mutator) {
  ensureLoaded();
  let base = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.schemaVersion === 1) base = parsed;
    }
  } catch (e) { /* 读失败按内存档续写 */ }

  const next = base ? mergeSaves(base, currentSave) : cloneSave(currentSave);
  mutator(next);
  next.revision = Math.max(next.revision || 0, base ? base.revision || 0 : 0) + 1;

  if (writeJSON(SAVE_KEY, next)) {
    currentSave = next;
    saveMetaState.memoryMode = false;
    return { ok: true, save: cloneSave(currentSave) };
  }
  currentSave = next;
  saveMetaState.memoryMode = true;
  return { ok: false, save: cloneSave(currentSave) };
}

/**
 * 过关结算事务（§7 写入时机：仅过关调用）。
 * unlock 下一关 + bestGrade 取优 + bestScore/bestCombo 取大 + clears+1 + 可选发武器。
 * @param {number} levelId 通关的关卡 id
 * @param {{grade?:string, score?:number, combo?:number, weapons?:string[]}} result 结算数据
 */
export function applyLevelResult(levelId, result) {
  const out = { unlockedTo: null, weaponGranted: [] };
  const ret = writeSave(function (s) {
    const key = String(levelId);
    const lv = s.levels[key] || { bestGrade: null, bestScore: 0, bestCombo: 0, clears: 0 };
    if (result.grade && GRADE_RANK[result.grade] !== undefined) {
      const curRank = GRADE_RANK[lv.bestGrade];
      lv.bestGrade = curRank === undefined || GRADE_RANK[result.grade] > curRank ? result.grade : lv.bestGrade;
    }
    if (Number.isFinite(result.score)) lv.bestScore = Math.max(lv.bestScore || 0, result.score);
    if (Number.isFinite(result.combo)) lv.bestCombo = Math.max(lv.bestCombo || 0, result.combo);
    lv.clears = (lv.clears || 0) + 1;
    s.levels[key] = lv;

    s.unlocked = Math.min(Math.max(s.unlocked, levelId + 1), SAVE_MAX_UNLOCK);
    if (Array.isArray(result.weapons)) {
      for (const w of result.weapons) {
        if (typeof w === 'string' && w && !s.weapons.includes(w)) {
          s.weapons.push(w);
          out.weaponGranted.push(w);
        }
      }
    }
    out.unlockedTo = s.unlocked;
  });
  return { ...ret, ...out };
}

/** 当前存档副本（自动初始化；UI 渲染选关卡片用）。 */
export function getSave() {
  ensureLoaded();
  return cloneSave(currentSave);
}

/** 存档状态角标数据：reset=「存档已重置」；memoryMode=「存档不可用，进度不保留」（§7）。 */
export function getSaveMeta() {
  return { ...saveMetaState };
}

/** 调试/测试：全关解锁（写盘走同一事务，probe 与浏览器冒烟用）。 */
export function unlockAll() {
  return writeSave(function (s) { s.unlocked = SAVE_MAX_UNLOCK; });
}

/** 订阅外部标签页合并事件（UI 刷新选关卡片用）；回调收到合并后的存档副本。 */
export function onSaveMerged(fn) {
  if (typeof fn === 'function') mergedListeners.push(fn);
}

// storage 事件：另一标签页写盘 → 双方取优合并进内存档，不整体覆盖（§7）。
// 只合并不回写：回写会与对方标签页形成写竞争，下一次 writeSave 的乐观锁自然会落盘。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', function (e) {
    if (e.key !== SAVE_KEY || e.newValue === null) return;
    let ext = null;
    try { ext = JSON.parse(e.newValue); } catch (err) { return; }
    if (!ext || typeof ext !== 'object' || ext.schemaVersion !== 1) return;
    ensureLoaded();
    currentSave = mergeSaves(ext, currentSave);
    const snapshot = cloneSave(currentSave);
    for (const fn of mergedListeners) {
      try { fn(snapshot); } catch (err) { /* 监听者异常不阻断其他监听者 */ }
    }
  });
}
