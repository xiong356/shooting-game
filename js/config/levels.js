// ============================================
// 关卡配置表（设计文档 §4 总表 / §8.1 schema，§8.0 四文件拆分）
// ============================================
// M1①：L1-L5 数据填入（§11 路线图 M1 =「L1-L5 纯数值递增版」）。
//   - L4/L5 的蟹/精英怪 M3 才实现，暂用红蓝替身（血池对齐见各行注释），M3 换回真身；
//   - L6/L7 M5b/M5a 才实现，届时按 §4 总表追加行（id 自动连续）；
//   - layout M1 全部 'default'：§5.2 场地变体 M2 落地后再改行，避免配置宣称游戏做不到的行为；
//   - reward.weapon（L3 霰弹枪 / L5 射手步枪）M4 切枪框架落地后补入。
// 静态校验：esm-lint 对本表常驻跑 validateLevels（§8.1）。

// §2 全局血池校准系数 k = 187 ÷ 125 ≈ 1.50（M0 标定输出）。
// 实际生成 HP = 怪种基座 HP × 本关 hpMul × HP_CALIB_MUL。
// 适用范围：仅 L1-L6；L7 Boss 不吃 k（§2「适用范围」条款，Boss 独立推导见 §5.3）。
// 只缩放血量，不缩放怪物伤害（§2 注意条款）。
export const HP_CALIB_MUL = 1.5;

// L1-L5 关卡行。血池推导（怪种基座 红150/蓝100，见 js/monsters.js MONSTER_SPECS）：
//   L1  红×4                = 600 ×1.0×1.5 =  900（§4 同值）
//   L2  红×3+蓝×3           = 750 ×1.0×1.5 = 1125（§4 同值）
//   L3  红×4+蓝×3           = 900 ×1.1×1.5 = 1485（§4 同值）
//   L4  红×4+蓝×3（替身）    = 900 ×1.1×1.5 = 1485（§4 目标 1521，−2.4%，M3 换蟹×4 红×3 蓝×2）
//   L5  红×5+蓝×3（替身）    =1050 ×1.1×1.5 = 1733（§4 同值，M3 换精英红×1 红×3 蓝×3）
// parTime = §4 纯输出时长 ×8（§6 公式：38=4.8×8 … 74=9.2×8），S 档时间门 = parTime×1.2。
// reward.unlock 指向下一关；L5 → 6 指向尚不存在的 L6，选关渲染按 LEVELS.length 截断（M5b 追加后自然接上）。
export const LEVELS = [
  { id: 1, name: '峡谷初见', hpMul: 1.0, dmgMul: 1.0, spdMul: 1.0,
    spawns: [{ type: 'red', count: 4 }], layout: 'default',
    parTime: 38, maxAlive: 8, reward: { unlock: 2 } },
  { id: 2, name: '蔚蓝威胁', hpMul: 1.0, dmgMul: 1.0, spdMul: 1.0,
    spawns: [{ type: 'red', count: 3 }, { type: 'blue', count: 3 }], layout: 'default',
    parTime: 48, maxAlive: 8, reward: { unlock: 3 } },
  { id: 3, name: '野区窄道', hpMul: 1.1, dmgMul: 1.1, spdMul: 1.0,
    spawns: [{ type: 'red', count: 4 }, { type: 'blue', count: 3 }], layout: 'default',
    parTime: 63, maxAlive: 8, reward: { unlock: 4 } },   // weapon:'shotgun' M4 补入（§4 L3 通关奖励）
  { id: 4, name: '蟹群来袭', hpMul: 1.1, dmgMul: 1.1, spdMul: 1.0,
    spawns: [{ type: 'red', count: 4 }, { type: 'blue', count: 3 }], layout: 'default',
    parTime: 65, maxAlive: 8, reward: { unlock: 5 } },   // M3 替换为 crab×4 red×3 blue×2
  { id: 5, name: '暗影先锋', hpMul: 1.1, dmgMul: 1.1, spdMul: 1.0,
    spawns: [{ type: 'red', count: 5 }, { type: 'blue', count: 3 }], layout: 'default',
    parTime: 74, maxAlive: 8, reward: { unlock: 6 } },   // M3 替换为 eliteRed×1 red×3 blue×3
];

// §6 评级阈值常量（S/A/B/F）。命中率门 = 标定中位数 ± offset（M0 标定 n=14），
// 爆头门/时间门为固定值；fallback 固定阈值仅当 calibratedAccuracyMedian 为 null 时使用。
export const GRADE_CONFIG = {
  calibratedAccuracyMedian: 70.7,   // M0 实测池化命中率（%），null = 未标定走 fallback
  sAccuracyOffset: 5,               // S 门 = 中位数 +5 → 75.7
  aAccuracyOffset: -5,              // A 门 = 中位数 −5 → 65.7
  sAccuracyThreshold: 75,           // fallback S 门（未标定时）
  aAccuracyThreshold: 65,           // fallback A 门（未标定时）
  sHeadshotThreshold: 40,           // S 档爆头门（%），口径 = 爆头数/总命中（与 M0 池化一致）
  sTimeMul: 1.2,                    // S 档时间门 = parTime × 1.2
};

/**
 * 评级（§6 S/A/B/F）。纯函数，与 validateLevels 同住配置层——零依赖、浏览器/node 均可 import
 * （level-test 直接 import 本实现做门禁，game.js 结算屏与 __SNAPSHOT__.gradeFor 共用）。
 * 口径：accuracy = shotsHit/shotsFired（与 M0 池化标定一致）；
 * headshotRate = headshots/shotsHit（§2 标定口径，非爆头/开枪）。
 * 命中率门 = 标定中位数 ± offset，标定值 null 回退固定阈值；S 档另要求爆头 ≥40% 且
 * 用时 ≤ parTime×1.2；B = 通关保底；F = 阵亡。
 * @param {{died:boolean, shotsFired:number, shotsHit:number, headshots:number, elapsedSec:number}} stats
 * @param {{parTime:number}} level 关卡行
 * @returns {'S'|'A'|'B'|'F'}
 */
export function gradeFor(stats, level) {
  if (stats.died) return 'F';
  const accPct = stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired * 100 : 0;
  const hsPct = stats.shotsHit > 0 ? stats.headshots / stats.shotsHit * 100 : 0;
  const calibrated = GRADE_CONFIG.calibratedAccuracyMedian !== null;
  const sAcc = calibrated ? GRADE_CONFIG.calibratedAccuracyMedian + GRADE_CONFIG.sAccuracyOffset : GRADE_CONFIG.sAccuracyThreshold;
  const aAcc = calibrated ? GRADE_CONFIG.calibratedAccuracyMedian + GRADE_CONFIG.aAccuracyOffset : GRADE_CONFIG.aAccuracyThreshold;
  const timeOk = stats.elapsedSec <= level.parTime * GRADE_CONFIG.sTimeMul;
  if (accPct >= sAcc && hsPct >= GRADE_CONFIG.sHeadshotThreshold && timeOk) return 'S';
  if (accPct >= aAcc) return 'A';
  return 'B';
}

// ---- schema 取值域 ----
// 怪种：红/蓝（现有）+ 蟹/精英红/精英蓝（M3）；'boss' 不入 spawns（§4.1 Boss 关 adds 自管）。
const SPAWN_TYPES = ['red', 'blue', 'crab', 'eliteRed', 'eliteBlue'];
// 场地：现有布局 + §5.2 两套变体。
const LAYOUTS = ['default', 'variantA', 'variantB'];

function isPosInt(v) { return Number.isInteger(v) && v > 0; }
function isPosNum(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

/**
 * schema 校验：返回错误列表（空数组 = 通过）。
 * 字段口径见 §8.1 示例行 + §5.1 倍率表 + §4.1 同场上限 + §6 parTime 公式：
 *   id        正整数且 = 下标+1（线性解锁，编号不得跳号）
 *   name      非空字符串（选关卡片显示）
 *   hpMul / dmgMul / spdMul  >0 有限数（§5.1 关卡间相对增量，另叠乘 HP_CALIB_MUL）
 *   spawns    [{ type ∈ SPAWN_TYPES, count 正整数 }]，非空
 *   layout    ∈ LAYOUTS
 *   parTime   >0 秒数（§6：纯输出时长 × 8；L7 固定 180）
 *   maxAlive  正整数（§4.1 同场上限，默认 8 [PLACEHOLDER]）
 *   reward    { unlock?: 正整数, weapon?: 非空字符串 }，至少一项
 *             （§4 奖励列：解锁下一关 / 发武器；weapon id 枚举 M4 定枪时收紧）
 *   boss      仅 id=7 的关卡可携带（M5a 定义内部字段，此处只查归属）
 * @param {Array} levels
 * @returns {string[]} 错误描述列表
 */
export function validateLevels(levels) {
  const errors = [];
  if (!Array.isArray(levels)) return ['LEVELS 必须是数组'];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    const at = 'LEVELS[' + i + ']';
    if (!lv || typeof lv !== 'object') { errors.push(at + ' 必须是对象'); continue; }

    if (!isPosInt(lv.id)) errors.push(at + '.id 必须是正整数');
    else if (lv.id !== i + 1) errors.push(at + '.id 必须等于下标+1（线性解锁，编号不得跳号）');

    if (typeof lv.name !== 'string' || lv.name.length === 0) errors.push(at + '.name 必须是非空字符串');

    for (const m of ['hpMul', 'dmgMul', 'spdMul']) {
      if (!isPosNum(lv[m])) errors.push(at + '.' + m + ' 必须是 >0 的有限数');
    }

    if (!Array.isArray(lv.spawns) || lv.spawns.length === 0) {
      errors.push(at + '.spawns 必须是非空数组');
    } else {
      lv.spawns.forEach(function (s, j) {
        const sat = at + '.spawns[' + j + ']';
        if (!s || typeof s !== 'object') { errors.push(sat + ' 必须是对象'); return; }
        if (!SPAWN_TYPES.includes(s.type)) errors.push(sat + '.type 非法（取值：' + SPAWN_TYPES.join('|') + '）');
        if (!isPosInt(s.count)) errors.push(sat + '.count 必须是正整数');
      });
    }

    if (!LAYOUTS.includes(lv.layout)) errors.push(at + '.layout 非法（取值：' + LAYOUTS.join('|') + '）');

    if (!isPosNum(lv.parTime)) errors.push(at + '.parTime 必须是 >0 的有限数（秒）');

    if (!isPosInt(lv.maxAlive)) errors.push(at + '.maxAlive 必须是正整数');

    if (!lv.reward || typeof lv.reward !== 'object') {
      errors.push(at + '.reward 必须是对象');
    } else {
      if (lv.reward.unlock !== undefined && !isPosInt(lv.reward.unlock)) errors.push(at + '.reward.unlock 必须是正整数');
      if (lv.reward.weapon !== undefined && (typeof lv.reward.weapon !== 'string' || lv.reward.weapon.length === 0)) {
        errors.push(at + '.reward.weapon 必须是非空字符串');
      }
      if (lv.reward.unlock === undefined && lv.reward.weapon === undefined) errors.push(at + '.reward 至少含 unlock 或 weapon 之一');
    }

    if (lv.boss !== undefined && lv.id !== 7) errors.push(at + '.boss 字段仅 L7（Boss 关）可携带');
  }
  return errors;
}
