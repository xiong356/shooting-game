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
  }
};
