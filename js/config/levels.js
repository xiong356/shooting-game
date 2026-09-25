// ============================================
// 关卡配置表（设计文档 §4 总表 / §8.1 schema，§8.0 四文件拆分）
// ============================================
// M0.5⑤：文件骨架 + schema 校验器（纯数据，无运行时依赖，浏览器与 node 均可 import）。
// LEVELS 数据（L1-L7）由 M1 按 §4 总表填入；静态校验接入 esm-lint（§8.1
// 「新增关卡配置 schema 校验进 esm-lint」，接入动作为 M0.5⑥）。

// §2 全局血池校准系数 k = 187 ÷ 125 ≈ 1.50（M0 标定输出）。
// 实际生成 HP = 怪种基座 HP × 本关 hpMul × HP_CALIB_MUL。
// 适用范围：仅 L1-L6；L7 Boss 不吃 k（§2「适用范围」条款，Boss 独立推导见 §5.3）。
// 只缩放血量，不缩放怪物伤害（§2 注意条款）。
export const HP_CALIB_MUL = 1.5;

// L1-L7 关卡行（M1 按 §4 总表填入）。空表 = 关卡系统未启用，游戏走现有单局逻辑。
export const LEVELS = [];

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
