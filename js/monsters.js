// ============================================
// 怪种工厂（设计文档 §8.0：红/蓝/蟹/精英/Boss 共用 spawn 骨架，读 (type, mul)）
// ============================================
// M0.5③ 自 game.js 搬移 + export，不改行为：模型构建函数逐字迁移，
// 数值与迁移前逐位相等。蟹/精英/Boss 怪种（M3/M5a）在本文件扩展
// MONSTER_SPECS 基座与对应 build 函数。
// 攻击状态机（红近战挥击 / 蓝吟唱施法的逐帧逻辑）暂留 game.js，M3 迁 AI 时一并入本文件。
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
const MONSTER_SPECS = {
  // 红怪：贴脸近战（1.8m）；追速 5.0（原 2.5 翻倍：慢走 4.2 甩不掉，需疾跑或绕掩体）
  red:  { maxHealth: 150, chaseSpeed: 5.0, stopDist: 1.8 },
  // 蓝怪：远程施法，停在射程处只丢弹不靠近
  blue: { maxHealth: 100, chaseSpeed: 5.0, stopDist: BLUE_CAST_RANGE },
};

/** 构建猩红石像 (Red Buff) — 猩红色主导 + 细节 */
function createRedBuff() {
  const group = new THREE.Group();
  group.name = 'redBuff';

  // === 颜色调色板 (存储到 userData 供击中闪烁恢复) ===
  const palette = {
    body:     new THREE.MeshStandardMaterial({ color: '#cc1a1a', roughness: 0.3, metalness: 0.1, emissive: '#330000', emissiveIntensity: 0.3 }),
    limbs:    new THREE.MeshStandardMaterial({ color: '#991111', roughness: 0.35, metalness: 0.12, emissive: '#220000', emissiveIntensity: 0.2 }),
    shoulder: new THREE.MeshStandardMaterial({ color: '#ff2222', roughness: 0.25, metalness: 0.2, emissive: '#550000', emissiveIntensity: 0.5 }),
    dark:     new THREE.MeshStandardMaterial({ color: '#2a1111', roughness: 0.5, metalness: 0.1 }),
    eye:      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, emissive: '#ffffff', emissiveIntensity: 1.5 }),
    gem:      new THREE.MeshStandardMaterial({ color: '#ff2200', roughness: 0.1, metalness: 0.6, emissive: '#ff2200', emissiveIntensity: 2.5 }),
    rune:     new THREE.MeshStandardMaterial({ color: '#ff6633', roughness: 0.1, emissive: '#ff3300', emissiveIntensity: 2 }),
  };

  // 躯干（猩红色主体）
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

  // 肩甲（亮红发光）
  const shoulderGeo = new THREE.SphereGeometry(0.5, 10, 8);
  const shoulderL = new THREE.Mesh(shoulderGeo, palette.shoulder); shoulderL.position.set(-0.75, 1.65, 0); shoulderL.castShadow = true; group.add(shoulderL);
  const shoulderR = new THREE.Mesh(shoulderGeo, palette.shoulder); shoulderR.position.set( 0.75, 1.65, 0); shoulderR.castShadow = true; group.add(shoulderR);

  // 手臂（深红）
  const armGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8);
  const armL = new THREE.Mesh(armGeo, palette.limbs); armL.position.set(-0.85, 0.85, 0); armL.castShadow = true; armL.name = 'armL'; group.add(armL);
  const armR = new THREE.Mesh(armGeo, palette.limbs); armR.position.set( 0.85, 0.85, 0); armR.castShadow = true; armR.name = 'armR'; group.add(armR);

  // 拳头（亮红 + 臂部关节环）
  const fistGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const fistL = new THREE.Mesh(fistGeo, palette.shoulder); fistL.position.set(-0.85, 0.15, 0); group.add(fistL);
  const fistR = new THREE.Mesh(fistGeo, palette.shoulder); fistR.position.set( 0.85, 0.15, 0); group.add(fistR);
  // 腕部护甲环
  const bracerGeo = new THREE.TorusGeometry(0.28, 0.05, 8, 8);
  const bracerL = new THREE.Mesh(bracerGeo, palette.gem); bracerL.position.set(-0.85, 0.35, 0); group.add(bracerL);
  const bracerR = new THREE.Mesh(bracerGeo, palette.gem); bracerR.position.set( 0.85, 0.35, 0); group.add(bracerR);

  // 双腿（深红）
  const legGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8);
  const legL = new THREE.Mesh(legGeo, palette.limbs); legL.position.set(-0.3, -0.4, 0); legL.castShadow = true; group.add(legL);
  const legR = new THREE.Mesh(legGeo, palette.limbs); legR.position.set( 0.3, -0.4, 0); legR.castShadow = true; group.add(legR);

  // 脚（暗色底座）
  const footGeo = new THREE.BoxGeometry(0.35, 0.15, 0.5);
  const footL = new THREE.Mesh(footGeo, palette.dark); footL.position.set(-0.3, -0.85, 0.1); group.add(footL);
  const footR = new THREE.Mesh(footGeo, palette.dark); footR.position.set( 0.3, -0.85, 0.1); group.add(footR);

  // 头部（猩红）
  const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const head = new THREE.Mesh(headGeo, palette.body); head.position.y = 2.0; head.castShadow = true; head.name = 'head'; group.add(head);

  // 正面两颗白色发光眼睛
  const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, palette.eye); eyeL.position.set(-0.15, 2.1, 0.31); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, palette.eye); eyeR.position.set( 0.15, 2.1, 0.31); group.add(eyeR);

  // 头顶红色发光宝石
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), palette.gem);
  gem.position.y = 2.45;
  gem.name = 'gem';
  group.add(gem);

  // 腰部护甲带
  const beltGeo = new THREE.TorusGeometry(0.5, 0.06, 8, 16);
  const belt = new THREE.Mesh(beltGeo, palette.dark); belt.position.y = 0.55; belt.name = 'belt'; group.add(belt);

  // 头顶血条
  const healthBar = createHealthBar('#ff3b3b');
  healthBar.position.y = HEALTH_BAR_Y;
  group.add(healthBar);

  // 存储每个 mesh 的原始颜色，供击中闪烁后恢复
  group.traverse(c => {
    if (c.isMesh && c.material && c.material.color) {
      c.userData.originalColor = c.material.color.clone();
    }
  });
  group.userData = { type: 'red', gem, palette, bodyColor: '#cc1a1a', maxHealth: 150, healthBar };
  return group;
}

/** 构建蔚蓝石像 (Blue Buff) — 海蓝色主导 + 细节 */
function createBlueBuff() {
  const group = new THREE.Group();
  group.name = 'blueBuff';

  const palette = {
    body:     new THREE.MeshStandardMaterial({ color: '#1a4dcc', roughness: 0.3, metalness: 0.1, emissive: '#000833', emissiveIntensity: 0.3 }),
    limbs:    new THREE.MeshStandardMaterial({ color: '#113a99', roughness: 0.35, metalness: 0.12, emissive: '#000622', emissiveIntensity: 0.2 }),
    shoulder: new THREE.MeshStandardMaterial({ color: '#2266ff', roughness: 0.25, metalness: 0.2, emissive: '#001555', emissiveIntensity: 0.5 }),
    dark:     new THREE.MeshStandardMaterial({ color: '#111a33', roughness: 0.5, metalness: 0.1 }),
    eye:      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, emissive: '#ffffff', emissiveIntensity: 1.5 }),
    gem:      new THREE.MeshStandardMaterial({ color: '#0066ff', roughness: 0.1, metalness: 0.6, emissive: '#0066ff', emissiveIntensity: 2.5 }),
    rune:     new THREE.MeshStandardMaterial({ color: '#3399ff', roughness: 0.1, emissive: '#0066ff', emissiveIntensity: 2 }),
  };

  // 躯干
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

  // 肩甲
  const shoulderGeo = new THREE.SphereGeometry(0.5, 10, 8);
  const shoulderL = new THREE.Mesh(shoulderGeo, palette.shoulder); shoulderL.position.set(-0.75, 1.65, 0); shoulderL.castShadow = true; group.add(shoulderL);
  const shoulderR = new THREE.Mesh(shoulderGeo, palette.shoulder); shoulderR.position.set( 0.75, 1.65, 0); shoulderR.castShadow = true; group.add(shoulderR);

  // 手臂
  const armGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8);
  const armL = new THREE.Mesh(armGeo, palette.limbs); armL.position.set(-0.85, 0.85, 0); armL.castShadow = true; armL.name = 'armL'; group.add(armL);
  const armR = new THREE.Mesh(armGeo, palette.limbs); armR.position.set( 0.85, 0.85, 0); armR.castShadow = true; armR.name = 'armR'; group.add(armR);

  // 拳头 + 腕甲
  const fistGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const fistL = new THREE.Mesh(fistGeo, palette.shoulder); fistL.position.set(-0.85, 0.15, 0); group.add(fistL);
  const fistR = new THREE.Mesh(fistGeo, palette.shoulder); fistR.position.set( 0.85, 0.15, 0); group.add(fistR);
  const bracerGeo = new THREE.TorusGeometry(0.28, 0.05, 8, 8);
  const bracerL = new THREE.Mesh(bracerGeo, palette.gem); bracerL.position.set(-0.85, 0.35, 0); group.add(bracerL);
  const bracerR = new THREE.Mesh(bracerGeo, palette.gem); bracerR.position.set( 0.85, 0.35, 0); group.add(bracerR);

  // 双腿
  const legGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8);
  const legL = new THREE.Mesh(legGeo, palette.limbs); legL.position.set(-0.3, -0.4, 0); legL.castShadow = true; group.add(legL);
  const legR = new THREE.Mesh(legGeo, palette.limbs); legR.position.set( 0.3, -0.4, 0); legR.castShadow = true; group.add(legR);

  // 脚
  const footGeo = new THREE.BoxGeometry(0.35, 0.15, 0.5);
  const footL = new THREE.Mesh(footGeo, palette.dark); footL.position.set(-0.3, -0.85, 0.1); group.add(footL);
  const footR = new THREE.Mesh(footGeo, palette.dark); footR.position.set( 0.3, -0.85, 0.1); group.add(footR);

  // 头部
  const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const head = new THREE.Mesh(headGeo, palette.body); head.position.y = 2.0; head.castShadow = true; head.name = 'head'; group.add(head);

  // 正面两颗白色发光眼睛
  const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, palette.eye); eyeL.position.set(-0.15, 2.1, 0.31); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, palette.eye); eyeR.position.set( 0.15, 2.1, 0.31); group.add(eyeR);

  // 头顶蓝色发光宝石
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), palette.gem);
  gem.position.y = 2.45;
  gem.name = 'gem';
  group.add(gem);

  // 腰部护甲带
  const beltGeo = new THREE.TorusGeometry(0.5, 0.06, 8, 16);
  const belt = new THREE.Mesh(beltGeo, palette.dark); belt.position.y = 0.55; belt.name = 'belt'; group.add(belt);

  // 头顶血条
  const healthBar = createHealthBar('#3b8cff');
  healthBar.position.y = HEALTH_BAR_Y;
  group.add(healthBar);

  // 存储每个 mesh 的原始颜色，供击中闪烁后恢复
  group.traverse(c => {
    if (c.isMesh && c.material && c.material.color) {
      c.userData.originalColor = c.material.color.clone();
    }
  });
  group.userData = { type: 'blue', gem, palette, bodyColor: '#1a4dcc', maxHealth: 100, healthBar };
  return group;
}

/**
 * 怪种工厂：返回带数值基座与血条的怪物体（未摆位、未入场景——那是 spawnMonsters 的职责）。
 * §8.1：创建函数读 (type, mul) 而非硬编码 150/100，旧调用走默认倍率 = 现行为。
 * @param {'red'|'blue'} type 怪种（蟹/精英/Boss 由 M3/M5a 在 MONSTER_SPECS 扩展）
 * @param {{hp?:number, spd?:number}} [mul] 关卡倍率（§5.1），默认全 1.0；
 *        dmg 倍率由攻击结算侧（game.js）消费，不属 spawn 骨架，M1 接关卡时接入。
 */
export function createMonster(type, mul = {}) {
  const spec = MONSTER_SPECS[type];
  if (!spec) throw new Error('未知怪种: ' + type);
  const hpMul = mul.hp === undefined ? 1 : mul.hp;
  const spdMul = mul.spd === undefined ? 1 : mul.spd;

  const group = type === 'red' ? createRedBuff() : createBlueBuff();

  // ---- 数值基座 × 关卡倍率（mul=1 时与旧硬编码逐位相等）----
  group.userData.maxHealth = spec.maxHealth * hpMul;
  group.userData.chaseSpeed = spec.chaseSpeed * spdMul;
  group.userData.stopDist = spec.stopDist;

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
  // 攻击动画要转手臂，缓存引用省得每帧 getObjectByName
  group.userData.armL = group.getObjectByName('armL');
  group.userData.armR = group.getObjectByName('armR');

  return group;
}
