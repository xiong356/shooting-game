// ============================================
// 怪种工厂（设计文档 §8.0：红/蓝/蟹/精英/Boss 共用 spawn 骨架，读 (type, mul)）
// ============================================
// M0.5③ 自 game.js 搬移 + export。M3① 扩展五种怪：
//   红蓝 → 提取公共 buildBuffModel 骨架（原 130 行双胞胎合一），palette 注入区分；
//   精英红/精英蓝 → 同骨架 + 紫魔纹/大宝石 palette + group.scale ×1.3（血条随 group 同步放大）；
//   迅捷蟹 → 独立贴地建模（无 head mesh：低头打、无爆头加成；壳顶小宝石保留
//   「野怪皆有符文宝石」视觉语言 + game.js 宝石自转的 ud.gem 依赖）。
// 攻击状态机（红近战 / 蓝吟唱 / 蟹突进的逐帧逻辑）在 game.js MONSTER ATTACK 区块
// （M3 评估过迁移：需穿 isPathClear/damagePlayer/音效依赖，收益小，推迟到 M5a 统一评估）。
import * as THREE from 'three';

// ============================================
// 头顶血条（怪物 UI）
// ============================================
const HEALTH_BAR_PIXELS = { w: 160, h: 20 };   // 血条画布分辨率
const HEALTH_BAR_SIZE = { w: 1.92, h: 0.24 };  // 血条世界尺寸（8:1，随距离自然缩放）
export const HEALTH_BAR_Y = 3.05;              // 血条高度（宝石在 2.45）
// 扣血缓动：主血条瞬时掉落后，白色残影延迟启动、指数追赶（见 updateHealthBarAnimations）
export const HEALTH_TRAIL_DELAY = 0.18;        // 残影延迟启动（秒）
const HEALTH_TRAIL_SPEED = 6;                  // 追赶速率，约 0.4s 追平

/** 创建头顶血条。Sprite 天生朝向相机，无需手动 billboard。 */
function createHealthBar(borderColor) {
  const canvas = document.createElement('canvas');
  canvas.width = HEALTH_BAR_PIXELS.w;
  canvas.height = HEALTH_BAR_PIXELS.h;

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,   // 血条是 UI，不参与场景色调映射，颜色才准
  });

  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(HEALTH_BAR_SIZE.w, HEALTH_BAR_SIZE.h, 1);
  sprite.name = 'healthBar';
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  sprite.userData.borderColor = borderColor;
  // 扣血缓动状态：displayRatio 是白色残影当前值，向 targetRatio 追赶（见 updateHealthBarAnimations）
  sprite.userData.displayRatio = 1;
  sprite.userData.targetRatio = 1;
  sprite.userData.trailDelay = 0;
  sprite.userData.animating = false;

  return sprite;
}

/**
 * 重绘血条。
 * 静止时只在血量变化时调用；扣血缓动期间由 updateHealthBarAnimations 每帧驱动——
 * 仅动画中的血条进循环，静止零开销（canvas 重绘 + 纹理上传比画个矩形贵得多）。
 * 绘制顺序：底槽 → 白色残影（displayRatio，缓动追赶）→ 主血条（目标 ratio）→ 外框。
 * @param {boolean} flash 受击白闪
 */
export function drawHealthBar(sprite, ratio, flash = false) {
  if (!sprite) return;
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  // 注意：canvas 元素的尺寸属性是 width / height（不是 w / h）
  const W = canvas.width;
  const H = canvas.height;
  const r = Math.max(0, Math.min(1, ratio));
  const pad = 3;

  ctx.clearRect(0, 0, W, H);

  // 底槽
  ctx.fillStyle = 'rgba(8, 12, 18, 0.85)';
  ctx.fillRect(0, 0, W, H);

  // 白色残影：扣血后延迟缓动追赶的旧血量（只在高于主条时可见）
  const trail = Math.max(0, Math.min(1, sprite.userData.displayRatio));
  if (trail > r) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(pad, pad, Math.round((W - pad * 2) * trail), H - pad * 2);
  }

  // 血量条
  ctx.fillStyle = flash ? '#ffffff' : sprite.userData.borderColor;
  ctx.fillRect(pad, pad, Math.round((W - pad * 2) * r), H - pad * 2);

  // 外框（受击时白色高亮）
  ctx.strokeStyle = flash ? '#ffffff' : sprite.userData.borderColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  sprite.userData.tex.needsUpdate = true;
}

/**
 * 扣血缓动：只处理 animating 的血条。残影延迟 HEALTH_TRAIL_DELAY 后
 * 向 targetRatio 指数追赶，追平即停（静止零开销）。
 * @param {Array} monsters game.js 的活跃怪数组（血条系统随工厂入本文件，数组所有权仍在主循环）
 */
export function updateHealthBarAnimations(monsters, dt) {
  for (const monster of monsters) {
    const bar = monster.userData.healthBar;
    const ud = bar && bar.userData;
    if (!ud || !ud.animating) continue;

    if (ud.trailDelay > 0) {
      ud.trailDelay -= dt;
    } else {
      ud.displayRatio += (ud.targetRatio - ud.displayRatio) * (1 - Math.exp(-HEALTH_TRAIL_SPEED * dt));
    }

    if (Math.abs(ud.displayRatio - ud.targetRatio) < 0.005) {
      ud.displayRatio = ud.targetRatio;
      ud.animating = false;
    }
    drawHealthBar(bar, ud.targetRatio, false);
  }
}

// ============================================
// 怪种数值基座（§2 基线）
// ============================================
// 蓝怪施法射程同时是它的停步距离（shouldChase 在「距离 ≤ stopDist 且视线通畅」时返回
// false，进射程即停下开火；视线被挡时仍会绕行找角度，不会隔墙干瞪眼）。
// 吟唱/姿态等攻击状态机行为常量在 game.js MONSTER ATTACK 区块，M3 迁 AI 时随行为入本文件。
export const BLUE_CAST_RANGE = 12;   // 施法射程 (m)：也是蓝怪的停步距离（stopDist）

// 关卡倍率（§5.1）经 createMonster(type, mul) 施加，不写入基座，基座恒为「基准关」数值。
// 伤害基座（meleeDamage/projDamage）同理为基准值，dmgMul 由 game.js damagePlayer 施加。
const MONSTER_SPECS = {
  // 红怪：贴脸近战（1.8m）；追速 5.0（原 2.5 翻倍：慢走 4.2 甩不掉，需疾跑或绕掩体）
  red:  { maxHealth: 150, chaseSpeed: 5.0, stopDist: 1.8, meleeDamage: 25 },
  // 蓝怪：远程施法，停在射程处只丢弹不靠近
  blue: { maxHealth: 100, chaseSpeed: 5.0, stopDist: BLUE_CAST_RANGE, projDamage: 10 },
  // ---- M3 新怪种（§5.3）----
  // 迅捷蟹：贴地高速突进。8.0 > 疾跑 7.2（跑不掉）；转向角速度 ≤120°/s（转向半径
  // v/ω = 8/(120°/s) ≈ 3.8m——横向滑步能甩掉的几何来源，弱点可读 P2）。
  // 碰撞半径 0.35（0.6m 宽壳）；无 head mesh（爆头不加成）。
  crab: { maxHealth: 68, chaseSpeed: 8.0, stopDist: 0.9, radius: 0.35, meleeDamage: 5 },
  // 精英红：压迫型坦克——HP×2、伤害×1.5、追速 5.0×0.9=4.5（速度降档给风筝解）、体型×1.3
  eliteRed: { maxHealth: 300, chaseSpeed: 4.5, stopDist: 1.8, meleeDamage: 37.5, scale: 1.3 },
  // 精英蓝：法术坦克——HP×2.2（纯×2 太脆，不足以制造集火决策窗口，§5.3）、伤害×1.5
  eliteBlue: { maxHealth: 220, chaseSpeed: 4.5, stopDist: BLUE_CAST_RANGE, projDamage: 15, scale: 1.3 },
};

/**
 * 石像族公共建模骨架（M3① 提取：原 createRedBuff/createBlueBuff 逐行相同的 130 行合一）。
 * 调色板/血条色/宝石尺寸注入，几何逐位等于迁移前。返回 { group, gem } 供调用方写 userData。
 * @param {Object} palette 七种材质（body/limbs/shoulder/dark/eye/gem/rune）
 * @param {string} barColor 血条边框色
 * @param {string} groupLabel group.name
 * @param {number} [gemRadius=0.25] 宝石半径（精英 ×1.3 → 0.33）
 */
function buildBuffModel(palette, barColor, groupLabel, gemRadius = 0.25) {
  const group = new THREE.Group();
  group.name = groupLabel;

  // 躯干（主体色）
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.8), palette.body);
  torso.position.y = 1.0;
  torso.castShadow = true;
  torso.name = 'body';
  group.add(torso);

  // 胸口3条发光魔纹
  for (let i = 0; i < 3; i++) {
    const runeGeo = new THREE.BoxGeometry(0.06, 1.0, 0.06);
    const rune = new THREE.Mesh(runeGeo, palette.rune);
    rune.position.set(-0.15 + i * 0.15, 1.0, 0.41);
    rune.name = 'rune';
    group.add(rune);
  }

  // 背部4枚尖刺
  for (let i = 0; i < 4; i++) {
    const spikeGeo = new THREE.ConeGeometry(0.12, 0.7, 6);
    const spike = new THREE.Mesh(spikeGeo, palette.shoulder);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 8;
    const radius = 0.35;
    spike.position.set(Math.cos(angle) * radius, 1.0, -0.5 + Math.sin(angle) * 0.2);
    spike.rotation.z = Math.cos(angle) * 0.4;
    spike.rotation.x = -0.3;
    spike.name = 'spike';
    group.add(spike);
  }

  // 肩甲（亮色发光）
  const shoulderGeo = new THREE.SphereGeometry(0.5, 10, 8);
  const shoulderL = new THREE.Mesh(shoulderGeo, palette.shoulder); shoulderL.position.set(-0.75, 1.65, 0); shoulderL.castShadow = true; group.add(shoulderL);
  const shoulderR = new THREE.Mesh(shoulderGeo, palette.shoulder); shoulderR.position.set( 0.75, 1.65, 0); shoulderR.castShadow = true; group.add(shoulderR);

  // 手臂
  const armGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8);
  const armL = new THREE.Mesh(armGeo, palette.limbs); armL.position.set(-0.85, 0.85, 0); armL.castShadow = true; armL.name = 'armL'; group.add(armL);
  const armR = new THREE.Mesh(armGeo, palette.limbs); armR.position.set( 0.85, 0.85, 0); armR.castShadow = true; armR.name = 'armR'; group.add(armR);

  // 拳头（亮色 + 臂部关节环）
  const fistGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const fistL = new THREE.Mesh(fistGeo, palette.shoulder); fistL.position.set(-0.85, 0.15, 0); group.add(fistL);
  const fistR = new THREE.Mesh(fistGeo, palette.shoulder); fistR.position.set( 0.85, 0.15, 0); group.add(fistR);
  // 腕部护甲环
  const bracerGeo = new THREE.TorusGeometry(0.28, 0.05, 8, 8);
  const bracerL = new THREE.Mesh(bracerGeo, palette.gem); bracerL.position.set(-0.85, 0.35, 0); group.add(bracerL);
  const bracerR = new THREE.Mesh(bracerGeo, palette.gem); bracerR.position.set( 0.85, 0.35, 0); group.add(bracerR);

  // 双腿
  const legGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8);
  const legL = new THREE.Mesh(legGeo, palette.limbs); legL.position.set(-0.3, -0.4, 0); legL.castShadow = true; group.add(legL);
  const legR = new THREE.Mesh(legGeo, palette.limbs); legR.position.set( 0.3, -0.4, 0); legR.castShadow = true; group.add(legR);

  // 脚（暗色底座）
  const footGeo = new THREE.BoxGeometry(0.35, 0.15, 0.5);
  const footL = new THREE.Mesh(footGeo, palette.dark); footL.position.set(-0.3, -0.85, 0.1); group.add(footL);
  const footR = new THREE.Mesh(footGeo, palette.dark); footR.position.set( 0.3, -0.85, 0.1); group.add(footR);

  // 头部（爆头判定：命中 name='head' 的 mesh）
  const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const head = new THREE.Mesh(headGeo, palette.body); head.position.y = 2.0; head.castShadow = true; head.name = 'head'; group.add(head);

  // 正面两颗白色发光眼睛
  const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, palette.eye); eyeL.position.set(-0.15, 2.1, 0.31); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, palette.eye); eyeR.position.set( 0.15, 2.1, 0.31); group.add(eyeR);

  // 头顶发光宝石（game.js 施法动画会改 gem 的 emissiveIntensity，引用存入 userData）
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(gemRadius), palette.gem);
  gem.position.y = 2.45;
  gem.name = 'gem';
  group.add(gem);

  // 腰部护甲带
  const beltGeo = new THREE.TorusGeometry(0.5, 0.06, 8, 16);
  const belt = new THREE.Mesh(beltGeo, palette.dark); belt.position.y = 0.55; belt.name = 'belt'; group.add(belt);

  // 头顶血条
  const healthBar = createHealthBar(barColor);
  healthBar.position.y = HEALTH_BAR_Y;
  group.add(healthBar);

  // 存储每个 mesh 的原始颜色，供击中闪烁后恢复
  group.traverse(c => {
    if (c.isMesh && c.material && c.material.color) {
      c.userData.originalColor = c.material.color.clone();
    }
  });
  return { group, gem, healthBar };
}

/** 石像调色板公共基座：身体/四肢/肩甲/暗色按阵营染色，魔纹与宝石由精英覆写为紫。 */
function buffPalette(base) {
  return {
    body:     new THREE.MeshStandardMaterial({ color: base.body, roughness: 0.3, metalness: 0.1, emissive: base.bodyEmissive, emissiveIntensity: 0.3 }),
    limbs:    new THREE.MeshStandardMaterial({ color: base.limbs, roughness: 0.35, metalness: 0.12, emissive: base.limbsEmissive, emissiveIntensity: 0.2 }),
    shoulder: new THREE.MeshStandardMaterial({ color: base.shoulder, roughness: 0.25, metalness: 0.2, emissive: base.shoulderEmissive, emissiveIntensity: 0.5 }),
    dark:     new THREE.MeshStandardMaterial({ color: base.dark, roughness: 0.5, metalness: 0.1 }),
    eye:      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, emissive: '#ffffff', emissiveIntensity: 1.5 }),
    gem:      new THREE.MeshStandardMaterial({ color: base.gem, roughness: 0.1, metalness: 0.6, emissive: base.gemEmissive, emissiveIntensity: 2.5 }),
    rune:     new THREE.MeshStandardMaterial({ color: base.rune, roughness: 0.1, emissive: base.runeEmissive, emissiveIntensity: 2 }),
  };
}

/** 构建猩红石像 (Red Buff) */
function createRedBuff() {
  const { group, gem, healthBar } = buildBuffModel(buffPalette({
    body: '#cc1a1a', bodyEmissive: '#330000',
    limbs: '#991111', limbsEmissive: '#220000',
    shoulder: '#ff2222', shoulderEmissive: '#550000',
    dark: '#2a1111',
    gem: '#ff2200', gemEmissive: '#ff2200',
    rune: '#ff6633', runeEmissive: '#ff3300',
  }), '#ff3b3b', 'redBuff');
  group.userData = { type: 'red', gem, bodyColor: '#cc1a1a', maxHealth: 150, healthBar };
  return group;
}

/** 构建蔚蓝石像 (Blue Buff) */
function createBlueBuff() {
  const { group, gem, healthBar } = buildBuffModel(buffPalette({
    body: '#1a4dcc', bodyEmissive: '#000833',
    limbs: '#113a99', limbsEmissive: '#000622',
    shoulder: '#2266ff', shoulderEmissive: '#001555',
    dark: '#111a33',
    gem: '#0066ff', gemEmissive: '#0066ff',
    rune: '#3399ff', runeEmissive: '#0066ff',
  }), '#3b8cff', 'blueBuff');
  group.userData = { type: 'blue', gem, bodyColor: '#1a4dcc', maxHealth: 100, healthBar };
  return group;
}

/**
 * 精英石像（§5.3）：同阵营放大强化——魔纹改紫、宝石加大（×1.3 体型同款放大），
 * 行为完全复用红/蓝状态机（数值差异走 MONSTER_SPECS + createMonster）。
 */
function createEliteRedBuff() {
  const { group, gem, healthBar } = buildBuffModel(buffPalette({
    body: '#cc1a1a', bodyEmissive: '#330000',
    limbs: '#991111', limbsEmissive: '#220000',
    shoulder: '#ff2222', shoulderEmissive: '#550000',
    dark: '#2a1111',
    gem: '#8b5cf6', gemEmissive: '#7c3aed',   // 宝石紫（宝石=能量核心，精英的辨识主色）
    rune: '#a855f7', runeEmissive: '#7c3aed', // 魔纹紫
  }), '#ff3b3b', 'eliteRedBuff', 0.33);
  group.userData = { type: 'eliteRed', gem, bodyColor: '#cc1a1a', maxHealth: 300, healthBar };
  return group;
}

function createEliteBlueBuff() {
  const { group, gem, healthBar } = buildBuffModel(buffPalette({
    body: '#1a4dcc', bodyEmissive: '#000833',
    limbs: '#113a99', limbsEmissive: '#000622',
    shoulder: '#2266ff', shoulderEmissive: '#001555',
    dark: '#111a33',
    gem: '#8b5cf6', gemEmissive: '#7c3aed',
    rune: '#a855f7', runeEmissive: '#7c3aed',
  }), '#3b8cff', 'eliteBlueBuff', 0.33);
  group.userData = { type: 'eliteBlue', gem, bodyColor: '#1a4dcc', maxHealth: 220, healthBar };
  return group;
}

/**
 * 构建迅捷蟹 (Crab, §5.3)——「瞄准纪律的破坏者」。
 * 贴地 0.6m 级宽体；无 head mesh（低头打的新目标轴，爆头不加成）；
 * 壳顶小宝石保留「野怪皆有符文宝石」的视觉语言（game.js 宝石自转也依赖 ud.gem）。
 */
function createCrab() {
  const group = new THREE.Group();
  group.name = 'crab';

  const palette = {
    shell: new THREE.MeshStandardMaterial({ color: '#c98a3b', roughness: 0.4, metalness: 0.15, emissive: '#3a2405', emissiveIntensity: 0.3 }),
    limb:  new THREE.MeshStandardMaterial({ color: '#a06a28', roughness: 0.45, metalness: 0.1, emissive: '#2a1a05', emissiveIntensity: 0.2 }),
    claw:  new THREE.MeshStandardMaterial({ color: '#8f5a20', roughness: 0.35, metalness: 0.2, emissive: '#241402', emissiveIntensity: 0.25 }),
    eye:   new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, emissive: '#ffffff', emissiveIntensity: 1.5 }),
    gem:   new THREE.MeshStandardMaterial({ color: '#ffb347', roughness: 0.1, metalness: 0.6, emissive: '#ff9900', emissiveIntensity: 2.5 }),
  };

  // 壳：压扁球体贴地（0.55 半径 × 拉伸 ≈ 0.7m 长 0.55m 宽，§5.3「0.6m 级宽」）
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), palette.shell);
  shell.scale.set(1.0, 0.5, 1.25);
  shell.position.y = 0.35;
  shell.castShadow = true;
  shell.name = 'body';
  group.add(shell);

  // 壳顶符文宝石
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), palette.gem);
  gem.position.y = 0.78;
  gem.name = 'gem';
  group.add(gem);

  // 壳前缘两颗眼（贴地生物的高对比弱点提示）
  const eyeGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const eyeL = new THREE.Mesh(eyeGeo, palette.eye); eyeL.position.set(-0.15, 0.5, 0.5); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, palette.eye); eyeR.position.set( 0.15, 0.5, 0.5); group.add(eyeR);

  // 四条斜插腿（两侧各二，静态——蟹的动感来自高速突进本身）
  const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.55, 6);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Mesh(legGeo, palette.limb);
    leg.position.set(sx * 0.42, 0.2, sz * 0.28);
    leg.rotation.z = sx * 0.9;
    leg.castShadow = true;
    group.add(leg);
  }

  // 双钳（前伸，扑击的视觉焦点）
  const clawGeo = new THREE.SphereGeometry(0.16, 8, 6);
  const clawL = new THREE.Mesh(clawGeo, palette.claw); clawL.position.set(-0.26, 0.28, 0.58); clawL.castShadow = true; group.add(clawL);
  const clawR = new THREE.Mesh(clawGeo, palette.claw); clawR.position.set( 0.26, 0.28, 0.58); clawR.castShadow = true; group.add(clawR);

  // 血条低挂（贴地生物，3.05m 高度会飘在半空看不见）
  const healthBar = createHealthBar('#ffb347');
  healthBar.position.y = 1.15;
  group.add(healthBar);

  // 存储每个 mesh 的原始颜色，供击中闪烁后恢复
  group.traverse(c => {
    if (c.isMesh && c.material && c.material.color) {
      c.userData.originalColor = c.material.color.clone();
    }
  });
  group.userData = { type: 'crab', gem, bodyColor: '#c98a3b', maxHealth: 68, healthBar };
  return group;
}

// M3① 分派映射：新怪种 = MONSTER_SPECS 加 key + 本表加 builder，不再改 createMonster 本体
const MONSTER_BUILDERS = {
  red: createRedBuff,
  blue: createBlueBuff,
  crab: createCrab,
  eliteRed: createEliteRedBuff,
  eliteBlue: createEliteBlueBuff,
};

/**
 * 怪种工厂：返回带数值基座与血条的怪物体（未摆位、未入场景——那是 spawnMonsters 的职责）。
 * §8.1：创建函数读 (type, mul) 而非硬编码，旧调用走默认倍率 = 现行为。
 * 基座字段写入 userData：maxHealth/chaseSpeed（× mul）、stopDist、meleeDamage/projDamage
 * （per-type 伤害基座，dmgMul 由 game.js damagePlayer 施加）、radius（蟹 0.35，其余 0.65）、
 * baseScale（精英 1.3，死亡动画乘算用）、armL/armR（挥臂动画引用，蟹为 null——蟹动画只用 bodyPivot）。
 * @param {'red'|'blue'|'crab'|'eliteRed'|'eliteBlue'} type 怪种（Boss 由 M5a 扩展）
 * @param {{hp?:number, spd?:number}} [mul] 关卡倍率（§5.1），默认全 1.0
 */
export function createMonster(type, mul = {}) {
  const spec = MONSTER_SPECS[type];
  if (!spec) throw new Error('未知怪种: ' + type);
  const hpMul = mul.hp === undefined ? 1 : mul.hp;
  const spdMul = mul.spd === undefined ? 1 : mul.spd;

  const group = MONSTER_BUILDERS[type]();

  // ---- 数值基座 × 关卡倍率（mul=1 时与旧硬编码逐位相等）----
  group.userData.maxHealth = spec.maxHealth * hpMul;
  group.userData.chaseSpeed = spec.chaseSpeed * spdMul;
  group.userData.stopDist = spec.stopDist;
  if (spec.meleeDamage !== undefined) group.userData.meleeDamage = spec.meleeDamage;
  if (spec.projDamage !== undefined) group.userData.projDamage = spec.projDamage;
  group.userData.radius = spec.radius ?? 0.65;
  // 精英体型（§5.3）：血条是 group 子节点随 scale 同步放大（§5.4 worldScale ×1.3）
  group.userData.baseScale = spec.scale ?? 1;
  if (spec.scale) group.scale.setScalar(spec.scale);

  // ---- spawn 骨架：身体俯仰支点 ----
  // lookAt 只管 monster 的 yaw，攻击动画的前倾/后仰只转
  // bodyPivot.rotation.x —— 两者正交，不会在同一欧拉角上打架。
  // 支点取怪物的原点（脚底高度），前倾时绕脚转而不是绕身体中心翻。
  // 血条是 UI 不进支点，否则前倾时会跟着歪。
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'bodyPivot';
  for (const child of [...group.children]) {
    if (child !== group.userData.healthBar) bodyPivot.add(child);
  }
  group.add(bodyPivot);
  group.userData.bodyPivot = bodyPivot;
  // 攻击动画要转手臂，缓存引用省得每帧 getObjectByName（蟹无手臂，为 null——蟹动画只用 bodyPivot）
  group.userData.armL = group.getObjectByName('armL');
  group.userData.armR = group.getObjectByName('armR');
  // 防御性重链：血条必须挂 userData（bodyPivot 组装排除它 + spawnMonsters 首绘 /
  // damageMonster 扣血 / killMonster 隐藏都经此引用）。M3① 重构曾漏挂导致血条全灭。
  group.userData.healthBar = group.getObjectByName('healthBar');

  return group;
}
