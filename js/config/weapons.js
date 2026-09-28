// ============================================
// 武器参数表（设计文档 §8.0：配置即数据）
// ============================================
// 所有 per-weapon 数值的唯一真源。M0.5② 自 game.js 顶层常量迁入，
// 数值与迁移前逐位相等——本文件只做搬移，不改行为。
// 保持全局、不迁入本表的参数（§8.0，理由：与武器无关的运动学/UI/手感统一参数）：
//   SPREAD_RECOVER（急停回零速率）、SPREAD_CROSSHAIR_PX / SPREAD_CROSSHAIR_MAX（准星映射）、
//   recoilRecover（回正速率统一手感）
// M4 切枪框架接入后，game.js 以 currentWeapon 取代本文件导出的 AK 别名读取。
// 注意：对象字面量内禁止出现分号——离线门禁（spread-test）用
// 正则 `[^;]+` 抽取本表求值，内部分号会截断抽取结果。
export const WEAPONS = {
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    // ---- 伤害 / 射速 / 弹匣 / 换弹（§2 基线）----
    damage: 34,             // 单发基础伤害（红 5 枪 / 蓝 3 枪）
    headshotMult: 2,        // 爆头（命中 name='head' 的 mesh）伤害倍率
    fireInterval: 0.12,     // 射速 (s/发)
    magSize: 30,            // 弹匣容量
    reloadTime: 1.5,        // 换弹时长 (s)
    // ---- 层 1：移动 inaccuracy ----
    spreadPerSpeed: 0.0625, // rad/(m/s)：开火移速 2.4 → 0.15 rad → 10m 处散布半径约 1.5m（轻微档）
    spreadAirMult: 2.5,     // 空中（未落地）惩罚倍率：跳射大幅变飘
    // ---- 层 2：后坐 + spray pattern ----
    recoilPerShot: 0.012,   // 单发垂直后坐量 (0.69°)
    recoilYawPerShot: 0.005,// 单发最大水平偏移
    recoilMaxPitch: 0.30,   // 垂直后坐上限 (~17°)
    recoilMaxYaw: 0.06,     // 水平偏移上限
    // 确定性水平后坐图案（单位 = recoilYawPerShot），按连发序号取模循环。
    // 首项 0 → 单发点射近似垂直上抬；后续正负交替形成可练习的固定弹道形状。
    sprayPattern: [0, 0.4, -0.3, 0.6, -0.5, 0.8, -0.7, 0.5, -0.9, 0.7],
    // ---- 弹丸 / 射程衰减 / 曳光（§5.4 新枪接入时填非默认值）----
    pelletCount: 1,         // 每次开火弹丸数（霰弹 >1 时逐丸 raycast）
    damageFalloff: null,    // 射程衰减 { start, end }，null = 无衰减（霰弹 0-12m 全伤、12-20m 线性归零）
    tracerCount: 1,         // 曳光条数上限（霰弹 8 弹丸合并渲染 ≤3）
    tracer: {
      speed: 100,           // 视觉飞行速度 (m/s)——真实弹速肉眼不可读，CS:GO 同款取舍
      length: 7,            // 尾迹长度 (m)
      radius: 0.018,        // 光束半径 (m)，8 段圆管避免低段数的「三角棱面」观感
      fade: 0.22            // 到达落点后淡出时长 (s)
    }
  },
  // ---- M4① 霰弹枪「裂空」（§5.4：蟹群/贴脸的答案；L3 通关解锁）----
  shotgun: {
    id: 'shotgun',
    name: '裂空',
    // ---- 伤害 / 射速 / 弹匣 / 换弹（§5.4 表）----
    damage: 9,              // 每丸基础伤害（独立判定）
    headshotMult: 1,        // 爆头不加成（§5.4：每丸恒 9 伤）
    fireInterval: 0.8,      // 泵动节奏
    magSize: 6,
    reloadTime: 2.2,
    // ---- 层 1：移动 inaccuracy（§8.0 迁移清单定值）----
    spreadPerSpeed: 0.10,
    spreadAirMult: 3.0,
    // ---- 层 2：后坐 + spray pattern（数值为设计占位 ⚗️ playtest 观察）----
    recoilPerShot: 0.03,    // 一泵一响：单发垂直后坐 ≈ AK 2.5 倍
    recoilYawPerShot: 0.005,
    recoilMaxPitch: 0.35,
    recoilMaxYaw: 0.06,
    sprayPattern: [],       // 空数组 = 发射时跳过 yaw 累加（§8.0：判 pattern.length === 0）
    // ---- 弹丸 / 射程衰减 / 曳光（§5.4 弹丸散布规格）----
    pelletCount: 8,
    pelletCountMobile: 6,   // 移动端性能降档（§9 霰弹×移动端帧率风险行）
    pelletConeHalf: 0.0698, // 4°（rad）：3m 处散布半径 ≈0.21m
    damageFalloff: { start: 12, end: 20 },  // 0-12m 全伤，12-20m 线性归零，>20m 不判伤
    tracerCount: 3,         // 8 丸曳光合并 ≤3 条（视觉足够、性能可控）
    tracer: {
      speed: 100,
      length: 7,
      radius: 0.018,
      fade: 0.22
    }
  },
  // ---- M4① 射手步枪「穿云」（§5.4：精英/Boss 的答案；L5 通关解锁）----
  rifle: {
    id: 'rifle',
    name: '穿云',
    // ---- 伤害 / 射速 / 弹匣 / 换弹（§5.4 表）----
    damage: 85,
    headshotMult: 2.5,      // 爆头 ×2.5 = 212（§5.4）
    fireInterval: 0.5,
    magSize: 8,
    reloadTime: 1.8,
    // ---- 层 1：移动 inaccuracy（§8.0 迁移清单定值）----
    spreadPerSpeed: 0.03,
    spreadAirMult: 2.0,
    // ---- 层 2：后坐 + spray pattern（数值为设计占位 ⚗️ playtest 观察）----
    recoilPerShot: 0.014,
    recoilYawPerShot: 0.005,
    recoilMaxPitch: 0.32,
    recoilMaxYaw: 0.06,
    sprayPattern: [0, 0.5, -0.6, 0.8],   // 4 发小图案（§8.0：步枪 = 4 元素小数组）
    // ---- 弹丸 / 射程衰减 / 曳光 ----
    pelletCount: 1,
    damageFalloff: null,    // 无衰减
    tracerCount: 1,
    tracer: {
      speed: 100,
      length: 7,
      radius: 0.018,
      fade: 0.22
    }
  }
};

/**
 * 射程衰减系数（M4③ §5.4）：≤start 全伤 → start~end 线性归零 → >end 为 0。
 * 纯函数与武器参数同住配置层（同 gradeFor 之于 levels.js 的先例）——零依赖、
 * node 门禁可直接 import（spread-test 组 5 边界验收），game.js 经 import 使用。
 * falloff 为 null（AK/步枪）时恒 1。
 * @param {number} dist 弹丸飞行距离（m）
 * @param {{start:number, end:number}|null} falloff 武器表的 damageFalloff 字段
 * @returns {number} 0~1 伤害系数
 */
export function falloffMultiplier(dist, falloff) {
  if (!falloff) return 1;
  if (dist <= falloff.start) return 1;
  if (dist >= falloff.end) return 0;
  return 1 - (dist - falloff.start) / (falloff.end - falloff.start);
}
