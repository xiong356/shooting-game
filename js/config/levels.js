// ============================================
// 关卡配置表（设计文档 §4 总表 / §8.1 schema，§8.0 四文件拆分）
// ============================================
// M1①：L1-L5 数据填入（§11 路线图 M1 =「L1-L5 纯数值递增版」）。
//   - L4/L5 已换 M3 真身（迅捷蟹/精英石像）；
//   - layout 已按 §4 场地列落地（M2③）：L1/L2 default，L3/L4 variantA（野区窄道），L5/L6 variantB（开阔祭坛）；
//   - reward.weapon（L3 霰弹枪 / L5 射手步枪）M4② 切枪框架落地后补入；
//   - L6/L7 M5a 落地（提前于原 M5b 排期）：validateLevels 强制 id = 下标+1（线性解锁不跳号），
//     L7 行无法脱离 L6 单独存在——L6 仅是配置行（全怪种已存在），补位队列仍在 M5b
//     （先例：L4 总数 9 > maxAlive 8 也是先全量刷，见 L4 行注释）。
// 静态校验：esm-lint 对本表常驻跑 validateLevels + 逐预设 validateLayout（§8.1）。

// §2 全局血池校准系数 k = 187 ÷ 125 ≈ 1.50（M0 标定输出）。
// 实际生成 HP = 怪种基座 HP × 本关 hpMul × HP_CALIB_MUL。
// 适用范围：仅 L1-L6；L7 Boss 不吃 k（§2「适用范围」条款，Boss 独立推导见 §5.3）。
// 只缩放血量，不缩放怪物伤害（§2 注意条款）。
export const HP_CALIB_MUL = 1.5;

// 迅捷蟹避障参数（§9 指定落位于此；game.js stepCrabChase 消费）。
// 排斥半径 = 障碍 AABB 外扩 1.0m，力 = (1 - d/radius) × strength 线性衰减，多障碍矢量叠加。
// 蟹不用 findDetourCorner 强绕行——那会把「转向钝」弱点消掉（§9 蟹群×绕行算法风险行）。
export const CRAB_CONFIG = { avoidRadius: 1.0, avoidStrength: 8.0 };

// L1-L7 关卡行。血池推导（怪种基座见 js/monsters.js MONSTER_SPECS）：
//   L1  红×4                      = 600  ×1.0×1.5 =  900（§4 同值）
//   L2  红×3+蓝×3                 = 750  ×1.0×1.5 = 1125（§4 同值）
//   L3  红×4+蓝×3                 = 900  ×1.1×1.5 = 1485（§4 同值）
//   L4  蟹×4+红×3+蓝×2（M3 真身）  = 922  ×1.1×1.5 = 1521（§4 同值；蟹 68×4+450+200）
//   L5  精英红+红×3+蓝×3（M3 真身）=1050  ×1.1×1.5 = 1733（§4 同值；300+450+300）
//   L6  精英红+精英蓝+红×3+蓝×3+蟹×3 = 1474 ×1.2×1.5 = 2653（§4 同值；300+220+450+300+204）
//   L7  主宰 6000 独立推导（§5.3 脚注†，不吃 k；召唤蟹走 MONSTER_SPECS 蟹基座 × k）
// parTime = §4 纯输出时长 ×8（§6 公式：38=4.8×8 … 114=14.2×8），S 档时间门 = parTime×1.2。
// L7 特例：parTime 固定 180（§6 Boss 关不适用 ×8 公式）。
// parTimeMul（§6 步枪关卡容忍）：L6 起玩家已持有穿云，步枪有效 DPS ≈ AK 的 1/1.5，
// 故 S 档时间门再 ×1.5；gradeFor 消费（缺省 1）。playtest 若步枪玩家 S 达成率 >20% 可回收。
// reward.unlock 指向下一关；L7 unlock:7 指向自身（通关后全关可重玩，unlocked 封顶由 save.js 把守）。
// 注意：L4 总数 9 / L6 总数 11 > maxAlive 8——补位队列是 M5b 交付，先全量刷（§4.1 排期一致）。
export const LEVELS = [
  { id: 1, name: '峡谷初见', hpMul: 1.0, dmgMul: 1.0, spdMul: 1.0,
    spawns: [{ type: 'red', count: 4 }], layout: 'default',
    parTime: 38, maxAlive: 8, reward: { unlock: 2 } },
  { id: 2, name: '蔚蓝威胁', hpMul: 1.0, dmgMul: 1.0, spdMul: 1.0,
    spawns: [{ type: 'red', count: 3 }, { type: 'blue', count: 3 }], layout: 'default',
    parTime: 48, maxAlive: 8, reward: { unlock: 3 } },
  { id: 3, name: '野区窄道', hpMul: 1.1, dmgMul: 1.1, spdMul: 1.0,
    spawns: [{ type: 'red', count: 4 }, { type: 'blue', count: 3 }], layout: 'variantA',
    parTime: 63, maxAlive: 8, reward: { unlock: 4, weapon: 'shotgun' } },
  { id: 4, name: '蟹群来袭', hpMul: 1.1, dmgMul: 1.1, spdMul: 1.0,
    spawns: [{ type: 'crab', count: 4 }, { type: 'red', count: 3 }, { type: 'blue', count: 2 }], layout: 'variantA',
    parTime: 65, maxAlive: 8, reward: { unlock: 5 } },
  { id: 5, name: '暗影先锋', hpMul: 1.1, dmgMul: 1.1, spdMul: 1.0,
    spawns: [{ type: 'eliteRed', count: 1 }, { type: 'red', count: 3 }, { type: 'blue', count: 3 }], layout: 'variantB',
    parTime: 74, maxAlive: 8, reward: { unlock: 6, weapon: 'rifle' } },
  // ---- M5a：L6 毕业考 + L7 Boss 关（§4 总表）----
  { id: 6, name: '风暴前夕', hpMul: 1.2, dmgMul: 1.2, spdMul: 1.05,
    spawns: [{ type: 'eliteRed', count: 1 }, { type: 'eliteBlue', count: 1 }, { type: 'red', count: 3 }, { type: 'blue', count: 3 }, { type: 'crab', count: 3 }],
    layout: 'variantB',
    parTime: 114, parTimeMul: 1.5, maxAlive: 8, reward: { unlock: 7 } },
  // L7：Boss「主宰」三阶段（§5.3）。spawns 留空——Boss 不入 spawns（怪种 schema 注释），
  // startGame 消费 boss 字段单独生成；P3 召唤蟹等阶段 adds 由 Boss 状态机自管（§4.1），
  // 补位队列不适用 Boss 关。行为参数全部 [PLACEHOLDER]+推导，⚗️ M6 playtest 收口。
  { id: 7, name: '主宰降临', hpMul: 1.0, dmgMul: 1.0, spdMul: 1.0,
    spawns: [], layout: 'default',
    parTime: 180, parTimeMul: 1.5, maxAlive: 8, reward: { unlock: 7 },
    boss: {
      // 近战拍击（§5.3 P1：红怪同款放大；伤害走 MONSTER_SPECS.boss.meleeDamage 35）
      melee: { range: 4.0, hitRange: 4.5, windup: 0.7, strike: 0.2, lungeSpeed: 4, cooldown: 1.6 },
      // 法球三连（§5.3 P2：蓝怪吟唱放大，0.8s 预警；伤害走 projDamage 15）
      orb: { chant: 0.8, count: 3, interval: 0.22, speed: 11, radius: 0.45, cooldown: 4.0, range: 20 },
      // 召唤蟹×3（§5.3 P3：每 20s 一波；存活蟹 ≥6 跳过本波；落位 ≥15m + 1s 光柱预警）
      summon: { count: 3, interval: 20, firstDelay: 2.5, maxAliveAdds: 6, telegraph: 1.0, minDist: 15 },
      // 破阶段转场：2s 无敌 + 吼叫震屏 + 玩家回 30 HP（§5.3；heal 30 ⚗️ 满血进 P3 则降 20）
      transition: { invuln: 2, heal: 30, shakeAmp: 0.12, shakeTime: 0.7 },
      // 入场演出：光柱 1.5s @(6,-40)（避让 default 中央柱 (0,-35) 的视线遮挡）
      entrance: { x: 6, z: -40, duration: 1.5 },
      // 阶段阈值（P1 100-70 / P2 70-40 / P3 40-0；HUD 血条 70%/40% 刻度线同源 §9）
      phases: [0.7, 0.4],
    } },
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
  // parTimeMul（§6 武器差异容忍）：步枪关卡（L6/L7）S 档时间门再 ×1.5，缺省 1
  const timeOk = stats.elapsedSec <= level.parTime * GRADE_CONFIG.sTimeMul * (level.parTimeMul || 1);
  if (accPct >= sAcc && hsPct >= GRADE_CONFIG.sHeadshotThreshold && timeOk) return 'S';
  if (accPct >= aAcc) return 'A';
  return 'B';
}

/**
 * Boss 阶段判定（§5.3 三阶段：P1 100-70% 近战 / P2 70-40% +法球三连 / P3 40-0% +召唤蟹）。
 * 纯函数与 validateLevels 同住配置层——boss-test 门禁直接 import 本实现，
 * game.js updateBoss 与 HUD 阶段刻度共用，避免测试与实现漂移。
 * 边界口径：ratio 恰好落在阈值上算下一阶段（>0.7 才是 P1）——「破阶段」发生在血量
 * 跌破阈值的瞬间，与 §9 血条 70%/40% 刻度线的视觉分界一致。
 * @param {number} ratio 血量比 0~1
 * @param {[number, number]} [phases] 阶段阈值（L7 行 boss.phases，缺省 [0.7, 0.4]）
 * @returns {1|2|3}
 */
export function bossPhaseFor(ratio, phases) {
  const p = phases || [0.7, 0.4];
  if (ratio > p[0]) return 1;
  if (ratio > p[1]) return 2;
  return 3;
}

/**
 * P3 召唤节流（§5.3，M5a）：存活蟹达到同场上限即跳过本波。
 * 纯函数与 bossPhaseFor 同住配置层（boss-test 直接 import，game.js bossSummonWave 共用；
 * Mimosa 钩子拦截测试侧 new Function 抽取——纯函数进配置模块是本项目既定解法，见 gradeFor 先例）。
 * 边界口径：恰在上限（===）也跳过——严格小于才放行；清蟹速度决定波次密度。
 * @param {number} aliveAdds 场上存活蟹数
 * @param {number} maxAliveAdds 召唤蟹同场上限（L7 boss.summon.maxAliveAdds）
 * @returns {boolean} true = 放行本波召唤
 */
export function bossShouldSummon(aliveAdds, maxAliveAdds) {
  return aliveAdds < maxAliveAdds;
}

// ---- schema 取值域 ----
// 怪种：红/蓝（现有）+ 蟹/精英红/精英蓝（M3）；'boss' 不入 spawns（§4.1 Boss 关 adds 自管）。
const SPAWN_TYPES = ['red', 'blue', 'crab', 'eliteRed', 'eliteBlue'];
// 武器 id（M4① 定枪收紧：§8.1「reward.weapon 枚举 M4 定枪时收紧」）
const WEAPON_IDS = ['ak47', 'shotgun', 'rifle'];

// ---- 场地布局预设（§5.2 布局即数据，M2①）----
// 关卡行 layout 字段引用此处预设名；game.js applyLayout 按 descriptor 重建障碍组。
// descriptor：{type:'divider', x, z, len, dir:'v'|'h'} | {type:'pillar', x, z}
//   divider 厚 0.3×高 1.8（v = 沿 Z 纵放 / h = 沿 X 横放）；pillar 1.2×1.2 底、高 3——与 game.js 网格一致。
// 坐标系：可玩区 x∈[-26,26]，z∈[-46,12]（边界墙靠 clamp，不入 solidObstacles）。
// 约束（validateLayout 静态把关）：出生点 (0,2) 净空 0.8m；任意两障碍分离间距 ≥0.8m（玩家直径）。
export const LAYOUTS = {
  // 现有布局（§2 基线）：2 纵隔断 + 7 柱 = 9 个碰撞障碍
  default: [
    { type: 'divider', x: -8, z: -4, len: 14, dir: 'v' },
    { type: 'divider', x: 8, z: -4, len: 14, dir: 'v' },
    { type: 'pillar', x: -15, z: -12 },
    { type: 'pillar', x: 15, z: -12 },
    { type: 'pillar', x: -15, z: -28 },
    { type: 'pillar', x: 15, z: -28 },
    { type: 'pillar', x: 0, z: -35 },
    { type: 'pillar', x: -20, z: -40 },
    { type: 'pillar', x: 20, z: -40 },
  ],
  // 变体 A「野区窄道」（§5.2，S 形窄道方案）：default 全量 + 中路 2 道错位横隔断。
  //   H1 左端贴齐西纵隔断内侧面（x=-7.85），右留 3.0m 窄口；H2 右端贴齐东纵隔断，左留 3.0m 窄口
  //   → 中路 S 形推进（2 处 3m 窄口），左右 18m 宽侧翼可绕行但空旷暴露。
  variantA: [
    { type: 'divider', x: -8, z: -4, len: 14, dir: 'v' },
    { type: 'divider', x: 8, z: -4, len: 14, dir: 'v' },
    { type: 'pillar', x: -15, z: -12 },
    { type: 'pillar', x: 15, z: -12 },
    { type: 'pillar', x: -15, z: -28 },
    { type: 'pillar', x: 15, z: -28 },
    { type: 'pillar', x: 0, z: -35 },
    { type: 'pillar', x: -20, z: -40 },
    { type: 'pillar', x: 20, z: -40 },
    { type: 'divider', x: -1.5, z: -14, len: 12.7, dir: 'h' },
    { type: 'divider', x: 1.5, z: -26, len: 12.7, dir: 'h' },
  ],
  // 变体 B「开阔祭坛」（§5.2）：撤隔断，2×3 对称双柱阵（精英/Boss 战风筝位）= 6 个碰撞障碍
  variantB: [
    { type: 'pillar', x: -10, z: -10 },
    { type: 'pillar', x: 10, z: -10 },
    { type: 'pillar', x: -10, z: -24 },
    { type: 'pillar', x: 10, z: -24 },
    { type: 'pillar', x: -10, z: -38 },
    { type: 'pillar', x: 10, z: -38 },
  ],
};

// descriptor → AABB（与 game.js registerSolid 产物同构；校验与测试共用，勿与网格尺寸漂移）
export function layoutAABB(o) {
  if (o.type === 'divider') {
    const w = o.dir === 'h' ? o.len : 0.3;
    const d = o.dir === 'h' ? 0.3 : o.len;
    return { minX: o.x - w / 2, maxX: o.x + w / 2, minZ: o.z - d / 2, maxZ: o.z + d / 2, height: 1.8 };
  }
  if (o.type === 'pillar') {
    return { minX: o.x - 0.6, maxX: o.x + 0.6, minZ: o.z - 0.6, maxZ: o.z + 0.6, height: 3 };
  }
  return null;
}

// 可玩区边界与出生点净空（§5.2 走廊净宽 ≥0.8m 玩家直径条款的静态把关）
const FIELD = { minX: -26, maxX: 26, minZ: -46, maxZ: 12 };
const SPAWN = { x: 0, z: 2, clearance: 0.8 };

/**
 * 布局预设校验：返回错误列表（空数组 = 通过）。esm-lint 常驻调用（§8.1）。
 * 查：descriptor 合法性 / AABB 出界 / 出生点净空 / 两两间距 <0.8m（镜像 game.js registerSolid warn，
 * 配置层升级为错误——摆放期拦截，不进运行时）。
 * @param {Array} obstacles LAYOUTS 预设的 descriptor 数组
 * @returns {string[]} 错误描述列表
 */
export function validateLayout(obstacles) {
  const errors = [];
  if (!Array.isArray(obstacles) || obstacles.length === 0) return ['布局必须是非空数组'];
  const aabbs = [];
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const at = 'obstacles[' + i + ']';
    if (!o || typeof o !== 'object') { errors.push(at + ' 必须是对象'); continue; }
    if (o.type !== 'divider' && o.type !== 'pillar') { errors.push(at + '.type 非法（divider|pillar）'); continue; }
    if (typeof o.x !== 'number' || !Number.isFinite(o.x) || typeof o.z !== 'number' || !Number.isFinite(o.z)) {
      errors.push(at + '.x/z 必须是有限数');
      continue;
    }
    if (o.type === 'divider') {
      if (typeof o.len !== 'number' || !Number.isFinite(o.len) || o.len <= 0) { errors.push(at + '.len 必须是 >0 的有限数'); continue; }
      if (o.dir !== 'v' && o.dir !== 'h') { errors.push(at + ".dir 必须是 'v'|'h'"); continue; }
    }
    const bb = layoutAABB(o);
    if (bb.minX < FIELD.minX || bb.maxX > FIELD.maxX || bb.minZ < FIELD.minZ || bb.maxZ > FIELD.maxZ) {
      errors.push(at + ' AABB 出界（可玩区 x∈[-26,26] z∈[-46,12]）');
    }
    if (bb.minX - SPAWN.clearance <= SPAWN.x && SPAWN.x <= bb.maxX + SPAWN.clearance &&
        bb.minZ - SPAWN.clearance <= SPAWN.z && SPAWN.z <= bb.maxZ + SPAWN.clearance) {
      errors.push(at + ' 距出生点 (0,2) 不足 0.8m 净空');
    }
    aabbs.push({ at, bb });
  }
  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      const a = aabbs[i].bb, b = aabbs[j].bb;
      const overlapX = a.minX <= b.maxX && b.minX <= a.maxX;
      const overlapZ = a.minZ <= b.maxZ && b.minZ <= a.maxZ;
      if (overlapX && overlapZ) { errors.push(aabbs[i].at + ' 与 ' + aabbs[j].at + ' 重叠'); continue; }
      const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX);
      const gapZ = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ);
      const gap = Math.max(gapX, gapZ);
      if (gap < 0.8) errors.push(aabbs[i].at + ' 与 ' + aabbs[j].at + ' 间距 ' + gap.toFixed(2) + 'm < 0.8m（玩家会被卡住）');
    }
  }
  return errors;
}

function isPosInt(v) { return Number.isInteger(v) && v > 0; }
function isPosNum(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

/**
 * schema 校验：返回错误列表（空数组 = 通过）。
 * 字段口径见 §8.1 示例行 + §5.1 倍率表 + §4.1 同场上限 + §6 parTime 公式：
 *   id        正整数且 = 下标+1（线性解锁，编号不得跳号）
 *   name      非空字符串（选关卡片显示）
 *   hpMul / dmgMul / spdMul  >0 有限数（§5.1 关卡间相对增量，另叠乘 HP_CALIB_MUL）
 *   spawns    [{ type ∈ SPAWN_TYPES, count 正整数 }]，非空（Boss 关可为空——Boss 不入
 *             spawns，由 boss 字段承载，§4.1 adds 自管）
 *   layout    ∈ LAYOUTS
 *   parTime   >0 秒数（§6：纯输出时长 × 8；L7 固定 180）
 *   parTimeMul  可选 >0 有限数（§6 步枪关卡时间门容忍 ×1.5，缺省 1）
 *   maxAlive  正整数（§4.1 同场上限，默认 8 [PLACEHOLDER]）
 *   reward    { unlock?: 正整数, weapon?: 非空字符串 }，至少一项
 *             （§4 奖励列：解锁下一关 / 发武器；weapon id 枚举 M4 定枪时收紧）
 *   boss      仅 id=7 可携带，且 L7 必须携带（M5a §5.3，内部 schema 见 validateBossConfig）
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

    // Boss 关 spawns 可为空（Boss 不入 spawns，§4.1）；常规关必须非空
    if (!Array.isArray(lv.spawns) || (!lv.boss && lv.spawns.length === 0)) {
      errors.push(at + '.spawns 必须是非空数组（Boss 关可为空）');
    } else {
      lv.spawns.forEach(function (s, j) {
        const sat = at + '.spawns[' + j + ']';
        if (!s || typeof s !== 'object') { errors.push(sat + ' 必须是对象'); return; }
        if (!SPAWN_TYPES.includes(s.type)) errors.push(sat + '.type 非法（取值：' + SPAWN_TYPES.join('|') + '）');
        if (!isPosInt(s.count)) errors.push(sat + '.count 必须是正整数');
      });
    }

    if (!LAYOUTS[lv.layout]) errors.push(at + '.layout 非法（取值：' + Object.keys(LAYOUTS).join('|') + '）');

    if (!isPosNum(lv.parTime)) errors.push(at + '.parTime 必须是 >0 的有限数（秒）');

    if (lv.parTimeMul !== undefined && !isPosNum(lv.parTimeMul)) {
      errors.push(at + '.parTimeMul 必须是 >0 的有限数（§6 步枪关卡时间门容忍，缺省 1）');
    }

    if (!isPosInt(lv.maxAlive)) errors.push(at + '.maxAlive 必须是正整数');

    if (!lv.reward || typeof lv.reward !== 'object') {
      errors.push(at + '.reward 必须是对象');
    } else {
      if (lv.reward.unlock !== undefined && !isPosInt(lv.reward.unlock)) errors.push(at + '.reward.unlock 必须是正整数');
      if (lv.reward.weapon !== undefined) {
        if (typeof lv.reward.weapon !== 'string' || lv.reward.weapon.length === 0) {
          errors.push(at + '.reward.weapon 必须是非空字符串');
        } else if (!WEAPON_IDS.includes(lv.reward.weapon)) {
          errors.push(at + '.reward.weapon 非法（取值：' + WEAPON_IDS.join('|') + '）');
        }
      }
      if (lv.reward.unlock === undefined && lv.reward.weapon === undefined) errors.push(at + '.reward 至少含 unlock 或 weapon 之一');
    }

    // Boss 关（M5a §5.3）：boss 字段仅 L7 可携带，且 L7 必须携带
    if (lv.id === 7) {
      if (lv.boss === undefined) errors.push(at + '.boss 缺失（L7 为 Boss 关，§5.3）');
      else validateBossConfig(lv.boss, at + '.boss', errors);
    } else if (lv.boss !== undefined) {
      errors.push(at + '.boss 字段仅 L7（Boss 关）可携带');
    }
  }
  return errors;
}

/**
 * L7 boss 字段内部 schema（M5a §5.3）。数值基座（HP/追速/伤害）在 monsters.js
 * MONSTER_SPECS.boss，此处只管行为参数；全部 [PLACEHOLDER]+推导，校验只把守
 * 「字段在且为正数」的形态，数值本身由 playtest 收口。
 */
function validateBossConfig(b, bat, errors) {
  if (!b || typeof b !== 'object') { errors.push(bat + ' 必须是对象'); return; }
  // 近战拍击（P1：红怪同款放大）
  if (!b.melee || typeof b.melee !== 'object') { errors.push(bat + '.melee 必须是对象'); }
  else {
    for (const k of ['range', 'hitRange', 'windup', 'strike', 'lungeSpeed', 'cooldown']) {
      if (!isPosNum(b.melee[k])) errors.push(bat + '.melee.' + k + ' 必须是 >0 的有限数');
    }
  }
  // 法球三连（P2：蓝怪吟唱放大，0.8s 预警）
  if (!b.orb || typeof b.orb !== 'object') { errors.push(bat + '.orb 必须是对象'); }
  else {
    for (const k of ['chant', 'count', 'interval', 'speed', 'radius', 'cooldown', 'range']) {
      if (!isPosNum(b.orb[k])) errors.push(bat + '.orb.' + k + ' 必须是 >0 的有限数');
    }
  }
  // 召唤蟹（P3：每 20s 一波，光柱预警后才可行动）
  if (!b.summon || typeof b.summon !== 'object') { errors.push(bat + '.summon 必须是对象'); }
  else {
    for (const k of ['count', 'interval', 'firstDelay', 'maxAliveAdds', 'telegraph', 'minDist']) {
      if (!isPosNum(b.summon[k])) errors.push(bat + '.summon.' + k + ' 必须是 >0 的有限数');
    }
  }
  // 破阶段转场（2s 无敌 + 吼叫震屏 + 回血 30）
  if (!b.transition || typeof b.transition !== 'object') { errors.push(bat + '.transition 必须是对象'); }
  else {
    for (const k of ['invuln', 'heal', 'shakeAmp', 'shakeTime']) {
      if (!isPosNum(b.transition[k])) errors.push(bat + '.transition.' + k + ' 必须是 >0 的有限数');
    }
  }
  // 入场演出（光柱落位）
  if (!b.entrance || typeof b.entrance !== 'object') { errors.push(bat + '.entrance 必须是对象'); }
  else {
    if (!isPosNum(b.entrance.duration)) errors.push(bat + '.entrance.duration 必须是 >0 的有限数');
    if (typeof b.entrance.x !== 'number' || !Number.isFinite(b.entrance.x)) errors.push(bat + '.entrance.x 必须是有限数');
    if (typeof b.entrance.z !== 'number' || !Number.isFinite(b.entrance.z)) errors.push(bat + '.entrance.z 必须是有限数');
  }
  // 阶段阈值（1 > p0 > p1 > 0，降序二元数组；HUD 血条刻度线同源 §9）
  if (!Array.isArray(b.phases) || b.phases.length !== 2 ||
      !isPosNum(b.phases[0]) || !isPosNum(b.phases[1]) ||
      b.phases[0] >= 1 || b.phases[0] <= b.phases[1]) {
    errors.push(bat + '.phases 必须是降序二元数组（1 > p0 > p1 > 0，如 [0.7, 0.4]）');
  }
}
