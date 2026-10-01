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
    // ---- 伤害 / 射速 / 弹匣 / 换弹（§5.4 表 + playtest 调整：贴脸 15/丸）----
    damage: 15,             // 每丸基础伤害（独立判定）——playtest 反馈 9 偏低，上调至 15
    headshotMult: 1,        // 爆头不加成（§5.4：每丸独立判定，恒 15 伤）
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
    damageFalloff: { start: 9, end: 16 },   // playtest 调整：0-9m 全伤，9-16m 线性归零（原 12-20 收紧——贴脸更强、更远更废）
    tracerCount: 3,         // 8 丸曳光合并 ≤3 条（视觉足够、性能可控）
    tracer: {
      speed: 100,
      length: 7,
      radius: 0.018,
      fade: 0.22
    }
  },
  // ---- M5b+ 轻机枪「内格夫」（用户点单换枪：射手步枪「穿云」除名；L5 通关解锁）----
  // 定位「召唤潮/车轮战的答案」：火力凶猛档（用户确认）+ playtest 首轮回调单发 24→27
  // （用户点单「太刮痧」）——持续 DPS 238 略超 AK（4050÷17s），9→12s 不间断火力压制
  // 召唤潮/补位车轮。制衡（§5.4「侧向展开不是上位替代」）：爆头仅 ×1.5、移动散布惩罚
  // 全游戏最重、5s 换弹真空期、**移速 ×0.85**（机枪重量；疾跑 6.12 > P3 主宰追速 5.6，
  // 「疾跑必能脱战」承诺不破——开火 2.4 上限不受惩罚）。§10 B 级观察：若「新枪上位替代」按 playtest 削。
  negev: {
    id: 'negev',
    name: '内格夫',
    // ---- 伤害 / 射速 / 弹匣 / 换弹（用户确认火力凶猛档 + 首轮回调 27）----
    damage: 27,             // 单发基础伤害（playtest 回调：24 刮痧 → 27，蟹 102 血 4 发）
    headshotMult: 1.5,      // 爆头 ×1.5 = 40.5——弹幕武器不点名（点名的答案在 AK）
    fireInterval: 0.08,     // 12.5 发/s（AK 8.3）
    magSize: 150,           // 弹链：12s 不间断火力（AK 3.6s 一断）
    reloadTime: 5.0,        // 换弹链是长真空期（AK 1.5 的 3.3 倍）
    // ---- per-weapon 移速惩罚（M5b+ 新字段；缺省 1 = 无惩罚）----
    // 作用于走路/疾跑/换弹态，开火 2.4 上限豁免（口径经用户确认）
    moveSpeedMul: 0.85,
    // ---- 层 1：移动 inaccuracy（全游戏最差：压制需站桩/半站桩）----
    spreadPerSpeed: 0.11,   // rad/(m/s)：开火移速 2.4 → 0.264 rad → 10m 处散布半径约 2.6m
    spreadAirMult: 3.0,
    // ---- 层 2：后坐 + spray pattern（设计占位 ⚗️ playtest 观察）----
    recoilPerShot: 0.006,   // 单发轻但 12.5 发/s 持续施压（爬升速率 ≈ AK 的 0.75）
    recoilYawPerShot: 0.005,
    recoilMaxPitch: 0.28,
    recoilMaxYaw: 0.08,
    // 12 元素横扫：先小幅爬升后大幅左右横漂（弹链扫射的固定形状，可练习）
    sprayPattern: [0, 0.3, -0.3, 0.5, -0.5, 0.7, -0.7, 0.9, -0.9, 1.0, -1.0, 0.8],
    // ---- 弹丸 / 射程衰减 / 曳光 ----
    pelletCount: 1,
    damageFalloff: null,    // 无衰减——压制价值在中近距离密度，远程由散布自然惩罚
    tracerCount: 2,         // 12.5 发/s 曳光合并 ≤2 条（§9 性能口径）
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
