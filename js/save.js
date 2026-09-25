// ============================================
// localStorage 读写层（设计文档 §7 规则的实现载体，§8.0 四文件拆分）
// ============================================
// M0.5④ 自 game.js 搬移 M0 标定存储，不改行为：
//   读异常（隐私模式 / JSON 损坏 / 无值）→ 返回 fallback（内存档）；
//   写异常（隐私模式 / 配额）→ 返回 false，调用方维持内存档继续累积。
// M1 存档系统（wk.pve.save.v1：备份重置 / schemaVersion / revision 乐观锁，§7 全表规则）
// 在本文件扩展，标定存储是其读写包装的第一个消费者。

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

/** 池化统计：所有样本原始计数相加后再求比率（对各局比率取平均会因样本量不同失真）。 */
export function calibSummary() {
  let f = 0, h = 0, hs = 0;
  for (const s of calibSamples) { f += s.shotsFired; h += s.shotsHit; hs += s.headshots; }
  return {
    n: calibSamples.length,                 // 样本局数；§10 要求 ≥10
    pooledAccuracy: f > 0 ? h / f : 0,       // Σ命中 / Σ开枪
    pooledHeadshotRate: h > 0 ? hs / h : 0,  // Σ爆头 / Σ命中
    totalShotsFired: f, totalShotsHit: h, totalHeadshots: hs,
  };
}
