/**
 * Valorant Training Range - 3D Third-Person Shooter
 * Three.js 0.160 | ES Module
 *
 * Features:
 * - Third-person camera with mouse orbit
 * - WASD movement + jumping
 * - Shooting with raycasting
 * - Multiple target types (static, moving, popup)
 * - Score tracking with combo system
 * - 60-second timed rounds
 * - Synthesized sound effects
 * - Particle effects system
 * - Responsive mobile touch controls
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 启动标记：index.html 的「启动守卫」靠它判断脚本是否真的跑起来了。
// 若浏览器拦截了 ES Module（典型场景：用 file:// 直接打开页面），这里不会执行，
// 守卫会给出「请用 start.bat 启动」的提示，而不是让按钮静默失效。
window.__GAME_BOOTED__ = true;

// ============================================
// DOM ELEMENTS
// ============================================
const canvas     = document.getElementById('game-canvas');
const hud        = document.getElementById('hud');
const startScreen = document.getElementById('start-screen');
const endScreen  = document.getElementById('end-screen');
const pausedInd  = document.getElementById('paused-indicator');
const hitMarker  = document.getElementById('hit-marker');
const killFeed   = document.getElementById('kill-feed');
const mobileCtrl = document.getElementById('mobile-controls');
const crosshair  = document.getElementById('crosshair');

// UI elements that update
const ammoCurrentEl   = document.getElementById('ammo-current');
const reloadHint      = document.getElementById('reload-hint');
const reloadProgress  = document.getElementById('reload-progress');
const healthCurrentEl = document.getElementById('health-current');
const healthFillEl    = document.getElementById('health-fill');
const damageFlashEl   = document.getElementById('damage-flash');

// ---- 玩家血量上限 ----
// ⚠️ 必须声明在 state 对象之前：state 在模块加载期求值，引用后声明的 const 会 TDZ 报错
const PLAYER_MAX_HEALTH = 100;

// ============================================
// GAME STATE
// ============================================
const state = {
  status: 'menu', // 'menu' | 'playing' | 'paused' | 'ended'
  timeLeft: 120,
  maxAmmo: 30,
  currentAmmo: 30,
  reloading: false,
  reloadTimer: 0,
  reloadDuration: 1.5,
  ammoRefilled: false, // 本次换弹是否已补满弹药（补弹发生在插弹匣那一刻，不是换弹结束）
  isPointerLocked: false,
  isMobile: false,
  lastTime: 0,
  redAlive: 0,
  blueAlive: 0,
  playerHealth: PLAYER_MAX_HEALTH,
};

// ============================================
// THREE.JS SETUP
// ============================================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1119');
scene.fog = new THREE.Fog('#0b1119', 20, 80);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(0, 6, 8);
camera.lookAt(0, 1.5, 0);

// ============================================
// LIGHTING
// ============================================
function createLighting() {
  // Ambient
  const ambient = new THREE.AmbientLight('#2a3a50', 1.2);
  scene.add(ambient);

  // Main directional (sun)
  const sun = new THREE.DirectionalLight('#fff5e8', 4.5);
  sun.position.set(20, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.width  = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = 100;
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  = 30;
  sun.shadow.camera.top    = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // Accent light (pink rim)
  const rimPink = new THREE.PointLight('#ff4655', 8, 25, 2);
  rimPink.position.set(-8, 4, -5);
  scene.add(rimPink);

  // Accent light (blue rim)
  const rimBlue = new THREE.PointLight('#00d4ff', 6, 25, 2);
  rimBlue.position.set(8, 4, -5);
  scene.add(rimBlue);

  // Hemisphere (ground bounce)
  const hemi = new THREE.HemisphereLight('#4a6a90', '#1a2a3a', 0.8);
  scene.add(hemi);

  return { sun, rimPink, rimBlue };
}

// ============================================
// ENVIRONMENT: TRAINING RANGE
// ============================================
/**
 * 场地实体障碍的碰撞体（XZ 平面上的 AABB）。
 * 由 createDivider / createPillar 在**创建几何体的同时**登记，保证两者不会各改各的 ——
 * 挪动柱子时碰撞盒自动跟随，不需要另外维护一张坐标表。
 * 注意：外围边界墙**不在这里**，它们由 updateMovement 末尾的 clamp 兜底（见那里的注释）。
 */
const solidObstacles = [];   // { minX, maxX, minZ, maxZ, height }

/**
 * 登记一个以 (x,z) 为中心、底面贴地、高 height 的实体方块。
 *
 * 摆放约束：两个障碍的间距不能小于玩家直径（PLAYER_RADIUS * 2）。
 * 若缝隙比玩家还窄，圆 vs AABB 的推出解在数学上不存在 —— 玩家挤不进去也推不出来，
 * 两个盒子会互相把玩家推来推去导致抖动。这是关卡摆放的约束，解算器修不了，
 * 所以在登记时就报警，而不是等玩到那里才发现。
 */
function registerSolid(x, z, width, depth, height) {
  const box = {
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
    height,
  };

  for (const o of solidObstacles) {
    const gapX = Math.max(o.minX - box.maxX, box.minX - o.maxX);
    const gapZ = Math.max(o.minZ - box.maxZ, box.minZ - o.maxZ);
    if (gapX < 0 && gapZ < 0) continue;   // 两轴都重叠 = 障碍本身相交，不算间隙
    const gap = Math.max(gapX, gapZ);     // 分离轴上的真实间距
    if (gap < PLAYER_RADIUS * 2) {
      console.warn('障碍间距 ' + gap.toFixed(2) + 'm 小于玩家直径 ' + (PLAYER_RADIUS * 2) +
        'm，玩家会被卡在缝隙里 — 位置 (' + x + ', ' + z + ')');
    }
  }

  solidObstacles.push(box);
}

function createEnvironment() {
  const env = new THREE.Group();
  scene.add(env);

  // --- Ground ---
  const groundGeo = new THREE.PlaneGeometry(60, 80);
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#2a2a32',
    roughness: 0.75,
    metalness: 0.15,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.01, -15);
  ground.receiveShadow = true;
  env.add(ground);

  // Grid lines on ground
  const grid = new THREE.GridHelper(80, 40, '#3a3a45', '#2e2e38');
  grid.position.set(0, 0, -15);
  env.add(grid);

  // --- Platform (elevated shooting area) ---
  const platformGeo = new THREE.BoxGeometry(10, 0.3, 8);
  const platformMat = new THREE.MeshStandardMaterial({
    color: '#3a3a48',
    roughness: 0.5,
    metalness: 0.3,
  });
  const platform = new THREE.Mesh(platformGeo, platformMat);
  platform.position.set(0, -0.15, 2);
  platform.castShadow = true;
  platform.receiveShadow = true;
  env.add(platform);

  // Platform edge glow
  const edgeGeo = new THREE.BoxGeometry(10.1, 0.05, 8.1);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: '#ff4655',
    roughness: 0.3,
    metalness: 0.5,
    emissive: '#ff4655',
    emissiveIntensity: 0.3,
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.set(0, 0.01, 2);
  env.add(edge);

  // --- Side Walls (Valorant angular style) ---
  function createWall(width, height, depth, x, z, color = '#3a3a45') {
    const group = new THREE.Group();

    // Main wall
    const bodyGeo = new THREE.BoxGeometry(width, height, depth);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.25,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Angled top strip (pink accent)
    const stripGeo = new THREE.BoxGeometry(width + 0.1, 0.2, depth + 0.4);
    const stripMat = new THREE.MeshStandardMaterial({
      color: '#ff4655',
      roughness: 0.3,
      metalness: 0.5,
      emissive: '#ff4655',
      emissiveIntensity: 0.25,
    });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.y = height + 0.1;
    group.add(strip);

    // Bottom glow strip (cyan)
    const bottomGeo = new THREE.BoxGeometry(width + 0.05, 0.08, depth + 0.15);
    const bottomMat = new THREE.MeshStandardMaterial({
      color: '#00d4ff',
      roughness: 0.2,
      metalness: 0.5,
      emissive: '#00d4ff',
      emissiveIntensity: 0.3,
    });
    const bottomStrip = new THREE.Mesh(bottomGeo, bottomMat);
    bottomStrip.position.y = 0.04;
    group.add(bottomStrip);

    // Warning stripe pattern (alternating blocks along top)
    const stripeCount = Math.floor(width / 2);
    for (let i = 0; i < stripeCount; i++) {
      const segGeo = new THREE.BoxGeometry(1.5, 0.04, depth + 0.35);
      const segMat = new THREE.MeshStandardMaterial({
        color: '#ffd700',
        roughness: 0.2,
        metalness: 0.4,
        emissive: '#ffd700',
        emissiveIntensity: 0.15,
      });
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.position.set(-width / 2 + 1 + i * 2, height + 0.22, 0);
      group.add(seg);
    }

    group.position.set(x, 0, z);
    return group;
  }

  // ===== BOUNDARY WALLS (expanded arena) =====
  // Left wall: X=-27, spans Z from -47 to 13
  env.add(createWall(0.8, 5, 62, -27, -17));
  // Right wall: X=27, spans Z from -47 to 13
  env.add(createWall(0.8, 5, 62, 27, -17));
  // Back wall: Z=-47, spans X from -27 to 27
  env.add(createWall(56, 5, 0.8, 0, -47));
  // Front wall: Z=13, spans X from -27 to 27
  env.add(createWall(56, 5, 0.8, 0, 13));

  // --- Shooting Lane Dividers ---
  function createDivider(x, z, length = 12) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.3, 1.8, length);
    registerSolid(x, z, 0.3, length, 1.8);   // 碰撞体随几何体一起登记
    const mat = new THREE.MeshStandardMaterial({
      color: '#444455',
      roughness: 0.5,
      metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.9;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Top accent
    const topGeo = new THREE.BoxGeometry(0.35, 0.06, length + 0.2);
    const topMat = new THREE.MeshStandardMaterial({
      color: '#00d4ff',
      roughness: 0.3,
      metalness: 0.5,
      emissive: '#00d4ff',
      emissiveIntensity: 0.2,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 1.8;
    group.add(top);

    group.position.set(x, 0, z);
    return group;
  }

  env.add(createDivider(-8, -4, 14));
  env.add(createDivider(8, -4, 14));

  // --- Distance Markers ---
  function createDistanceMarker(z, label) {
    const group = new THREE.Group();

    // Line across lane
    const lineGeo = new THREE.PlaneGeometry(12, 0.15);
    const lineMat = new THREE.MeshStandardMaterial({
      color: '#ffd700',
      roughness: 0.4,
      emissive: '#ffd700',
      emissiveIntensity: 0.2,
    });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    group.add(line);

    group.position.set(0, 0, z);
    return group;
  }

  env.add(createDistanceMarker(-10));
  env.add(createDistanceMarker(-20));
  env.add(createDistanceMarker(-30));
  env.add(createDistanceMarker(-40));

  // --- Cover Pillars ---
  function createPillar(x, z) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1.2, 3, 1.2);
    registerSolid(x, z, 1.2, 1.2, 3);   // 碰撞体随几何体一起登记
    const mat = new THREE.MeshStandardMaterial({
      color: '#4a4a58',
      roughness: 0.5,
      metalness: 0.4,
    });
    const pillar = new THREE.Mesh(geo, mat);
    pillar.position.y = 1.5;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);

    // Accent stripe
    const stripeGeo = new THREE.BoxGeometry(1.3, 0.2, 1.3);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#00d4ff',
      roughness: 0.3,
      emissive: '#00d4ff',
      emissiveIntensity: 0.15,
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 2;
    group.add(stripe);

    group.position.set(x, 0, z);
    return group;
  }

  env.add(createPillar(-15, -12));
  env.add(createPillar(15, -12));
  env.add(createPillar(-15, -28));
  env.add(createPillar(15, -28));
  env.add(createPillar(0, -35));
  env.add(createPillar(-20, -40));
  env.add(createPillar(20, -40));

  return env;
}

// ============================================
// PLAYER CHARACTER
// ============================================
function createPlayer() {
  const group = new THREE.Group();
  group.name = 'player';

  const torsoColor = '#1a1a2e';
  const accentColor = '#00d4ff';
  const skinColor = '#d4956b';

  // --- Torso ---
  const torsoGeo = new THREE.BoxGeometry(0.55, 0.9, 0.35);
  const torsoMat = new THREE.MeshStandardMaterial({
    color: torsoColor,
    roughness: 0.4,
    metalness: 0.3,
  });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);

  // Shoulder pads (Valorant style)
  const shoulderGeo = new THREE.BoxGeometry(0.4, 0.15, 0.3);
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: '#2a2a40',
    roughness: 0.3,
    metalness: 0.5,
  });
  const shoulderL = new THREE.Mesh(shoulderGeo, shoulderMat);
  shoulderL.position.set(-0.38, 1.55, 0);
  shoulderL.rotation.z = -0.2;
  group.add(shoulderL);
  const shoulderR = new THREE.Mesh(shoulderGeo, shoulderMat);
  shoulderR.position.set(0.38, 1.55, 0);
  shoulderR.rotation.z = 0.2;
  group.add(shoulderR);

  // --- Legs ---
  const legGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8);
  const legMat = new THREE.MeshStandardMaterial({
    color: '#12121e',
    roughness: 0.5,
    metalness: 0.2,
  });
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.15, 0.45, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.15, 0.45, 0);
  legR.castShadow = true;
  group.add(legR);

  // --- Arms ---
  const armGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.7, 8);
  const armMat = new THREE.MeshStandardMaterial({
    color: torsoColor,
    roughness: 0.4,
    metalness: 0.3,
  });
  const armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-0.4, 1.3, 0);
  armL.rotation.z = 0.15;
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(0.4, 1.3, 0);
  armR.rotation.z = -0.15;
  armR.castShadow = true;
  group.add(armR);

  // --- Head ---
  const headGroup = new THREE.Group();

  const headGeo = new THREE.SphereGeometry(0.18, 16, 16);
  const headMat = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.6,
    metalness: 0.05,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.scale.set(1, 1.05, 1);
  head.position.y = 0;
  head.castShadow = true;
  headGroup.add(head);

  // Helmet/visor
  const visorGeo = new THREE.BoxGeometry(0.2, 0.08, 0.26);
  const visorMat = new THREE.MeshStandardMaterial({
    color: '#00d4ff',
    roughness: 0.2,
    metalness: 0.6,
    emissive: '#00d4ff',
    emissiveIntensity: 0.15,
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.05, 0.1);
  headGroup.add(visor);

  headGroup.position.y = 1.75;
  group.add(headGroup);

  // --- Weapon (held in right arm area) ---
  const weaponGroup = new THREE.Group();

  // Gun body
  const gunBodyGeo = new THREE.BoxGeometry(0.06, 0.08, 0.35);
  const gunMat = new THREE.MeshStandardMaterial({
    color: '#222233',
    roughness: 0.3,
    metalness: 0.7,
  });
  const gunBody = new THREE.Mesh(gunBodyGeo, gunMat);
  gunBody.position.set(0, 0, 0);
  weaponGroup.add(gunBody);

  // Barrel
  const barrelGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.15, 8);
  const barrel = new THREE.Mesh(barrelGeo, gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.2);
  weaponGroup.add(barrel);

  // Grip
  const gripGeo = new THREE.BoxGeometry(0.04, 0.12, 0.05);
  const grip = new THREE.Mesh(gripGeo, gunMat);
  grip.position.set(0, -0.08, 0.06);
  grip.rotation.x = 0.3;
  weaponGroup.add(grip);

  // Accent on gun
  const gunAccentGeo = new THREE.BoxGeometry(0.07, 0.02, 0.08);
  const gunAccentMat = new THREE.MeshStandardMaterial({
    color: '#ff4655',
    roughness: 0.2,
    metalness: 0.5,
    emissive: '#ff4655',
    emissiveIntensity: 0.2,
  });
  const gunAccent = new THREE.Mesh(gunAccentGeo, gunAccentMat);
  gunAccent.position.set(0, 0.02, 0.1);
  weaponGroup.add(gunAccent);

  weaponGroup.position.set(0.42, 1.3, 0.15);
  weaponGroup.rotation.y = 0.3;
  group.add(weaponGroup);
  group.userData = { weaponGroup, headGroup, torso };

  return group;
}

// ============================================
// MONSTERS SYSTEM — 王者峡谷野怪
// ============================================
const monsters = [];

// ---- 血量与伤害 ----
const BASE_DAMAGE = 34;            // 单发基础伤害（红 5 枪 / 蓝 3 枪）
const HEADSHOT_MULTIPLIER = 2;     // 爆头（命中 name='head' 的 mesh）伤害倍率

const HEALTH_BAR_PIXELS = { w: 160, h: 20 };   // 血条画布分辨率
const HEALTH_BAR_SIZE = { w: 1.92, h: 0.24 };  // 血条世界尺寸（8:1，随距离自然缩放）
const HEALTH_BAR_Y = 3.05;                     // 血条高度（宝石在 2.45）
// 扣血缓动：主血条瞬时掉落后，白色残影延迟启动、指数追赶（见 updateHealthBarAnimations）
const HEALTH_TRAIL_DELAY = 0.18;               // 残影延迟启动（秒）
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
function drawHealthBar(sprite, ratio, flash = false) {
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
 */
function updateHealthBarAnimations(dt) {
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

/** 在地面随机位置生成野怪（避开玩家出生点） */
function spawnMonsters(count) {
  monsters.length = 0;
  const rng = (min, max) => Math.random() * (max - min) + min;

  for (let i = 0; i < count; i++) {
    let x, z;
    do {
      x = rng(-24, 24);
      z = rng(-44, 10);
    } while (Math.sqrt(x * x + (z - 2) * (z - 2)) < 10); // 避开玩家出生点 (0,0,2)

    const isRed = i < Math.ceil(count / 2);
    const monster = isRed ? createRedBuff() : createBlueBuff();
    monster.position.set(x, 0, z);

    // 随机初始朝向
    monster.rotation.y = Math.random() * Math.PI * 2;

    monster.userData = {
      ...monster.userData,
      id: i,
      alert: false,
      alertZone: 16,
      chaseSpeed: 2.5,
      // 红怪贴脸近战（1.8m）；蓝怪停在施法射程处只丢弹不靠近，体现远程定位。
      // 蓝怪用 BLUE_CAST_RANGE：shouldChase 在「距离 ≤ stopDist 且视线通畅」时返回
      // false，进射程即停下开火；视线被挡时仍会绕行找角度（不会隔墙干瞪眼）。
      stopDist: isRed ? 1.8 : BLUE_CAST_RANGE,
      originalPos: new THREE.Vector3(x, 0, z),
      originalRot: monster.rotation.y,
      health: monster.userData.maxHealth,
      dying: false,
      // 正面被挡住时选定的绕行侧（-1 左 / +1 右 / 0 未选）。
      // 必须保持到脱离障碍为止，否则每帧重新随机会让野怪左右抖动、原地打转。
      avoidSide: 0,
      // ---- 攻击状态机（红近战 / 蓝远程，见 MONSTER ATTACK 区块）----
      attackState: 'idle',   // 红怪：'idle' | 'windup' | 'strike'
      attackT: 0,
      attackCooldown: 0,
      meleeHitDone: false,
      castState: 'idle',     // 蓝怪：'idle' | 'casting' | 'recoil'
      castT: 0,
      castCooldown: 0,
    };

    // 身体俯仰支点：lookAt 只管 monster 的 yaw，攻击动画的前倾/后仰只转
    // bodyPivot.rotation.x —— 两者正交，不会在同一欧拉角上打架。
    // 支点取怪物的原点（脚底高度），前倾时绕脚转而不是绕身体中心翻。
    // 血条是 UI 不进支点，否则前倾时会跟着歪。
    const bodyPivot = new THREE.Group();
    bodyPivot.name = 'bodyPivot';
    for (const child of [...monster.children]) {
      if (child !== monster.userData.healthBar) bodyPivot.add(child);
    }
    monster.add(bodyPivot);
    monster.userData.bodyPivot = bodyPivot;
    // 攻击动画要转手臂，缓存引用省得每帧 getObjectByName
    monster.userData.armL = monster.getObjectByName('armL');
    monster.userData.armR = monster.getObjectByName('armR');

    // 血条画成满血
    drawHealthBar(monster.userData.healthBar, 1);

    scene.add(monster);
    monsters.push(monster);
  }
}

// ============================================
// 伤害 · 死亡动画
// ============================================
const DEATH_DURATION = 0.9;        // 秒
const DEATH_DISTANCE = 3.0;        // 漂移总距离（位移向量长度，米）
const DEATH_ELEVATION_DEG = 22;    // 抬升仰角 → 水平 2.78m + 垂直 1.12m，合位移 3.00m
const DEATH_SCALE_TO = 2;          // 放大到 2 倍
// 与玩家可活动范围一致，避免尸体飘出实体墙外
const DEATH_BOUNDS = { x: 26, zMin: -46, zMax: 12 };

/**
 * 对野怪造成伤害。返回是否因此击杀。
 * @param {boolean} isHeadshot 命中头部（名为 'head' 的 mesh）
 */
function damageMonster(monster, isHeadshot) {
  const ud = monster.userData;
  if (ud.dying) return false;

  const dmg = BASE_DAMAGE * (isHeadshot ? HEADSHOT_MULTIPLIER : 1);
  ud.health = Math.max(0, ud.health - dmg);
  const ratio = ud.health / ud.maxHealth;

  // 主血条瞬时掉落（白闪帧），白色残影延迟后缓动追赶（见 updateHealthBarAnimations）
  const bar = ud.healthBar;
  if (bar) {
    bar.userData.targetRatio = ratio;
    bar.userData.trailDelay = HEALTH_TRAIL_DELAY;
    bar.userData.animating = true;
  }

  drawHealthBar(ud.healthBar, ratio, true);
  setTimeout(() => {
    if (!ud.dying) drawHealthBar(ud.healthBar, ud.healthBar.userData.targetRatio, false);   // 死亡时血条已隐藏
  }, 90);

  if (ud.health <= 0) { killMonster(monster); return true; }
  return false;
}

/** 判定死亡：停 AI、不可再被击中、立刻从存活数扣除，并启动死亡动画 */
function killMonster(monster) {
  const ud = monster.userData;
  if (ud.dying) return;
  ud.dying = true;
  ud.deathT = 0;

  // 漂移方向：远离玩家（水平面内）
  const away = new THREE.Vector3().subVectors(monster.position, playerPosition);
  away.y = 0;
  if (away.lengthSq() < 1e-6) away.set(0, 0, -1);
  away.normalize();
  ud.deathDir = away;

  ud.deathStartPos = monster.position.clone();
  ud.deathEndPos = computeDeathEnd(monster.position, away);

  if (ud.healthBar) {
    ud.healthBar.visible = false;
    ud.healthBar.userData.animating = false;   // 停缓动，防止尸体血条残留重绘
  }

  // 材质切透明供淡出。每只野怪的材质都是独立创建的，不会波及其它个体。
  monster.traverse(c => {
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => { m.transparent = true; m.depthWrite = false; });
    }
  });

  addKillFeed(ud.type === 'red' ? '猩红石像' : '蔚蓝石像', ud.type);
  playKillSound();
  updateUI();   // 存活数要立刻掉，不能等动画播完
}

/** 计算漂移终点（含边界钳制） */
function computeDeathEnd(from, dir) {
  const rad = DEATH_ELEVATION_DEG * Math.PI / 180;
  const horizontal = DEATH_DISTANCE * Math.cos(rad);
  const vertical = DEATH_DISTANCE * Math.sin(rad);
  return new THREE.Vector3(
    Math.max(-DEATH_BOUNDS.x, Math.min(DEATH_BOUNDS.x, from.x + dir.x * horizontal)),
    from.y + vertical,
    Math.max(DEATH_BOUNDS.zMin, Math.min(DEATH_BOUNDS.zMax, from.z + dir.z * horizontal)),
  );
}

/** 推进死亡动画：漂移 + 放大 + 淡出，三者同时进行 */
function updateDeathAnimation(monster, dt) {
  const ud = monster.userData;
  ud.deathT += dt;
  const t = Math.min(ud.deathT / DEATH_DURATION, 1);

  // 位移与放大：easeOutCubic（起步快、收尾慢，像被击飞后减速）
  const e = 1 - Math.pow(1 - t, 3);
  monster.position.lerpVectors(ud.deathStartPos, ud.deathEndPos, e);
  monster.scale.setScalar(1 + (DEATH_SCALE_TO - 1) * e);

  // 淡出：t² 让后半段加速消失，避免留下"半透明僵尸"
  const opacity = 1 - t * t;
  monster.traverse(c => {
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => { m.opacity = opacity; });
    }
  });

  if (t >= 1) removeMonster(monster);
}

/** 动画播完：从场景移除并释放 geometry / material / texture */
function removeMonster(monster) {
  scene.remove(monster);
  monster.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    const mats = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
    mats.forEach(m => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });
  const i = monsters.indexOf(monster);
  if (i >= 0) monsters.splice(i, 1);
}

/** 击杀播报（#kill-feed 元素此前一直未被使用） */
function addKillFeed(label, type) {
  if (!killFeed) return;
  const el = document.createElement('div');
  el.className = 'kill-feed-entry';
  el.dataset.type = type;
  el.textContent = '击杀 ' + label;
  killFeed.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/** 击杀确认音（合成，不在采样范围内） */
function playKillSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [880, 1320].forEach((f, i) => {
    const at = now + i * 0.07;
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, at);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + 0.18);
  });
}

/** 玩家受击闷响：低频短促，照抄 playKillSound 的 oscillator + gain 包络模式 */
function playHurtSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

/** 红怪挥击破空声：高频噪声感的快速下滑音 */
function playSwingSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.12);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

/** 蓝怪发射魔法弹：中频上扬短音 */
function playCastSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

// ============================================
// PARTICLE SYSTEM
// ============================================
const particles = [];

function spawnParticles(position, color = '#ff4655', count = 15) {
  for (let i = 0; i < count; i++) {
    const size = 0.02 + Math.random() * 0.05;
    const geo = new THREE.SphereGeometry(size, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
    });
    const particle = new THREE.Mesh(geo, mat);

    // Position with random offset
    particle.position.copy(position);
    particle.position.x += (Math.random() - 0.5) * 0.4;
    particle.position.y += (Math.random() - 0.5) * 0.4;
    particle.position.z += (Math.random() - 0.5) * 0.4;

    // Velocity
    particle.userData = {
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 6 + 2,
        (Math.random() - 0.5) * 4,
      ),
      life: 0.5 + Math.random() * 0.8,
      maxLife: 0.5 + Math.random() * 0.8,
    };

    scene.add(particle);
    particles.push(particle);
  }
}

function spawnMuzzleFlash(position, direction) {
  const flashGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const flashMat = new THREE.MeshBasicMaterial({
    color: '#ffdd88',
    transparent: true,
    opacity: 1,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(position);
  flash.userData = {
    velocity: direction.clone().multiplyScalar(0.5),
    life: 0.08,
    maxLife: 0.08,
    isFlash: true,
  };
  scene.add(flash);
  particles.push(flash);

  // Light flash
  const light = new THREE.PointLight('#ffdd88', 15, 8, 2);
  light.position.copy(position);
  scene.add(light);
  setTimeout(() => {
    scene.remove(light);
    light.dispose();
  }, 60);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const ud = p.userData;

    ud.life -= dt;
    if (ud.life <= 0) {
      scene.remove(p);
      p.geometry.dispose();
      p.material.dispose();
      particles.splice(i, 1);
      continue;
    }

    const progress = 1 - ud.life / ud.maxLife;

    if (ud.isFlash) {
      p.material.opacity = 1 - progress;
      p.scale.setScalar(1 + progress * 3);
    } else {
      // Apply gravity
      ud.velocity.y -= 9.8 * dt;
      p.position.x += ud.velocity.x * dt;
      p.position.y += ud.velocity.y * dt;
      p.position.z += ud.velocity.z * dt;

      p.material.opacity = 1 - progress;
      p.scale.setScalar(1 - progress * 0.7);
    }
  }
}

// ============================================
// BULLET TRAIL
// ============================================
const bulletTrails = [];

function spawnBulletTrail(from, to) {
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();

  const geo = new THREE.CylinderGeometry(0.01, 0.01, length, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: '#ffaa44',
    transparent: true,
    opacity: 0.8,
  });
  const trail = new THREE.Mesh(geo, mat);

  trail.position.copy(mid);
  trail.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );

  trail.userData = {
    life: 0.1,
    maxLife: 0.1,
  };

  scene.add(trail);
  bulletTrails.push(trail);
}

function updateBulletTrails(dt) {
  for (let i = bulletTrails.length - 1; i >= 0; i--) {
    const t = bulletTrails[i];
    t.userData.life -= dt;
    if (t.userData.life <= 0) {
      scene.remove(t);
      t.geometry.dispose();
      t.material.dispose();
      bulletTrails.splice(i, 1);
    } else {
      t.material.opacity = t.userData.life / t.userData.maxLife;
    }
  }
}

// ============================================
// MONSTER PROJECTILES
// ============================================
// 蓝怪的魔法弹：直线飞行（发射瞬间定格方向，不追踪），可走位躲避、被障碍拦截。
// 判定抽成纯函数（projectileHitObstacle / projectileHitPlayer）供离线仿真验证。
const monsterProjectiles = [];

/** 弹丸是否落入任一障碍的 AABB（外扩 radius，含高度门控）。抽纯函数供离线测试。 */
function projectileHitObstacle(x, y, z, radius) {
  for (const o of solidObstacles) {
    if (y >= o.height) continue;   // 弹道高于障碍时穿过
    if (x > o.minX - radius && x < o.maxX + radius &&
        z > o.minZ - radius && z < o.maxZ + radius) return true;
  }
  return false;
}

/** 弹丸是否命中玩家（水平距离 < 玩家半径+弹半径，且高度在玩家身高内）。抽纯函数供离线测试。 */
function projectileHitPlayer(px, py, pz, playerX, playerZ, radius) {
  const dx = px - playerX;
  const dz = pz - playerZ;
  return dx * dx + dz * dz < (PLAYER_RADIUS + radius) * (PLAYER_RADIUS + radius) &&
         py >= 0 && py <= PLAYER_HEIGHT;
}

/** 从宝石位置朝玩家胸口发射一枚魔法弹（方向发射瞬间定格，直线飞行） */
function spawnMonsterProjectile(monster) {
  const ud = monster.userData;
  const from = ud.gem.getWorldPosition(new THREE.Vector3());
  const to = new THREE.Vector3(playerPosition.x, playerPosition.y + 1.2, playerPosition.z);
  const dir = new THREE.Vector3().subVectors(to, from);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();

  const geo = new THREE.SphereGeometry(BLUE_PROJ_RADIUS, 10, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: '#3399ff',
    emissive: '#0066ff',
    emissiveIntensity: 2.5,
    roughness: 0.2,
  });
  const proj = new THREE.Mesh(geo, mat);
  proj.position.copy(from);
  proj.userData = {
    velocity: dir.multiplyScalar(BLUE_PROJ_SPEED),
    life: BLUE_PROJ_LIFE,
  };

  scene.add(proj);
  monsterProjectiles.push(proj);
  playCastSound();
}

function disposeProjectile(p) {
  scene.remove(p);
  p.geometry.dispose();
  p.material.dispose();
}

function updateMonsterProjectiles(dt) {
  for (let i = monsterProjectiles.length - 1; i >= 0; i--) {
    const p = monsterProjectiles[i];
    const ud = p.userData;

    ud.life -= dt;
    if (ud.life <= 0) {
      disposeProjectile(p);
      monsterProjectiles.splice(i, 1);
      continue;
    }

    p.position.x += ud.velocity.x * dt;
    p.position.y += ud.velocity.y * dt;
    p.position.z += ud.velocity.z * dt;

    // 撞障碍 → 爆粒子消失
    if (projectileHitObstacle(p.position.x, p.position.y, p.position.z, BLUE_PROJ_RADIUS)) {
      spawnParticles(p.position, '#3399ff', 10);
      disposeProjectile(p);
      monsterProjectiles.splice(i, 1);
      continue;
    }

    // 命中玩家 → 扣血 + 爆粒子消失
    if (projectileHitPlayer(p.position.x, p.position.y, p.position.z, playerPosition.x, playerPosition.z, BLUE_PROJ_RADIUS)) {
      damagePlayer(BLUE_CAST_DAMAGE);
      spawnParticles(p.position, '#3399ff', 10);
      disposeProjectile(p);
      monsterProjectiles.splice(i, 1);
      continue;
    }

    // 飞出场地边界 → 移除防泄漏
    if (Math.abs(p.position.x) > DEATH_BOUNDS.x ||
        p.position.z < DEATH_BOUNDS.zMin || p.position.z > DEATH_BOUNDS.zMax) {
      disposeProjectile(p);
      monsterProjectiles.splice(i, 1);
    }
  }
}

// ============================================
// AUDIO SYSTEM (Web Audio API)
// ============================================
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    preloadWeaponSfx();   // 首次拿到 AudioContext 后立刻预加载采样（不阻塞）
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// ============================================
// WEAPON SFX — 按武器分发的音效注册表
// ============================================
// 新增枪械只需两步：① 在 SFX_FILES 里登记文件；② 在 WEAPON_SFX 里加一条映射。
// 播放逻辑（playWeaponSfx / 各处调用点）完全不用动。
const SFX_FILES = {
  'ak47/shot':   'assets/sfx/ak47-shot.wav',
  'ak47/magOut': 'assets/sfx/mag-out.wav',
  'ak47/magIn':  'assets/sfx/mag-in.wav',
  'ak47/bolt':   'assets/sfx/bolt-click.mp3',
};

/**
 * 脚步采样（CC0 1.0，来源与许可见 assets/sfx/CREDITS.md）。
 * 12 个硬地面单次脚步变体：01~06 石质/硬表面，07~12 地铁站硬地。
 * 脚步是全局最高频音效（疾跑 4.16 声/秒），变体数量直接决定听感是否像复读机 —— 不要随意删减。
 * 采样未加载完时 playFootstep 会自动回退到程序化合成（synthFootstep）。
 */
const FOOTSTEP_FILES = [
  'assets/sfx/footsteps/footstep-01.wav',
  'assets/sfx/footsteps/footstep-02.wav',
  'assets/sfx/footsteps/footstep-03.wav',
  'assets/sfx/footsteps/footstep-04.wav',
  'assets/sfx/footsteps/footstep-05.wav',
  'assets/sfx/footsteps/footstep-06.wav',
  'assets/sfx/footsteps/footstep-07.wav',
  'assets/sfx/footsteps/footstep-08.wav',
  'assets/sfx/footsteps/footstep-09.wav',
  'assets/sfx/footsteps/footstep-10.wav',
  'assets/sfx/footsteps/footstep-11.wav',
  'assets/sfx/footsteps/footstep-12.wav',
];
const FOOTSTEP_KEY_PREFIX = 'footstep/';   // sfxBuffers 里的 key 前缀

/**
 * 每把武器的音效映射。
 * - 各字段值为 SFX_FILES 的 key；缺省该字段时自动回退到程序化合成音。
 * - pitchJitter：每发抖动的播放速率范围，避免连发时听感像复读机。
 */
const WEAPON_SFX = {
  ak47: {
    shot:        'ak47/shot',
    magOut:      'ak47/magOut',
    magIn:       'ak47/magIn',
    bolt:        'ak47/bolt',
    shotVolume:  0.85,
    mechVolume:  0.55,
    pitchJitter: [0.96, 1.04],
  },
};

/** 当前手持武器 ID。换枪时改这里即可让所有音效自动切换。 */
let currentWeaponId = 'ak47';

const sfxBuffers = new Map();     // key -> AudioBuffer
const sfxStatus = { requested: 0, loaded: 0, failed: [] };

/** 预加载全部采样。失败不抛错——播放时会自动回退到合成音。 */
async function preloadWeaponSfx() {
  if (!audioCtx) return;
  // 武器音效与脚步采样共用同一张 sfxBuffers 表、同一套「失败回退合成音」逻辑
  const entries = [
    ...Object.entries(SFX_FILES),
    ...FOOTSTEP_FILES.map((url, i) => [FOOTSTEP_KEY_PREFIX + i, url]),
  ];
  sfxStatus.requested = entries.length;

  await Promise.all(entries.map(async ([key, url]) => {
    if (sfxBuffers.has(key)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      sfxBuffers.set(key, await audioCtx.decodeAudioData(buf));
      sfxStatus.loaded++;
    } catch (e) {
      sfxStatus.failed.push(key + ': ' + e.message);
      console.warn('音效加载失败，将回退合成音 —', key, url, e.message);
    }
  }));

  console.log(`%c SFX %c ${sfxStatus.loaded}/${sfxStatus.requested} 已加载`,
    'color: #ffd700;', sfxStatus.failed.length ? 'color: #ff4655;' : 'color: #14b866;');
}

/**
 * 播放指定武器的某类音效。
 * @returns {boolean} true = 已用采样播放；false = 无可用采样，调用方应回退合成音
 */
function playWeaponSfx(slot, { volume, pitchRange } = {}) {
  const weapon = WEAPON_SFX[currentWeaponId];
  if (!audioCtx || !weapon) return false;

  const buffer = sfxBuffers.get(weapon[slot]);
  if (!buffer) return false;

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;

  const jitter = pitchRange || weapon.pitchJitter;
  if (jitter) src.playbackRate.value = jitter[0] + Math.random() * (jitter[1] - jitter[0]);

  const gain = audioCtx.createGain();
  gain.gain.value = volume !== undefined ? volume : (weapon.shotVolume || 0.8);

  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
  return true;
}

/** 枪声：优先真实采样，缺失时回退合成 */
function playGunshot() {
  if (playWeaponSfx('shot')) return;
  synthGunshot();
}

function synthGunshot() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // Noise burst
  const bufferSize = audioCtx.sampleRate * 0.15;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const t = i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 25) * 0.6;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  // Bandpass filter
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 0.8;

  // Gain envelope
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.15);

  // Low thump
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + 0.08);

  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.3, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  osc.connect(oscGain);
  oscGain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

function playHitSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

function playHeadshotSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // High pitched ring
  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.15);

  // Bell-like overtone
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(2400, now);
  osc2.frequency.exponentialRampToValueAtTime(1200, now + 0.15);

  const gain2 = audioCtx.createGain();
  gain2.gain.setValueAtTime(0.1, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc2.connect(gain2);
  gain2.connect(audioCtx.destination);
  osc2.start(now);
  osc2.stop(now + 0.2);
}

/**
 * 换弹音效拆成三段，由换弹状态机在对应进度点触发（不再用 setTimeout 硬编码延迟）。
 * 这样音效与枪械动作、弹药数值三者严格对齐，暂停时也不会出现"声画错位"。
 * 三段均优先使用武器采样，缺失时回退到下面的合成实现。
 */

/** 拔出弹匣 */
function playMagOutSound() {
  const w = WEAPON_SFX[currentWeaponId];
  if (playWeaponSfx('magOut', { volume: (w && w.mechVolume) || 0.55, pitchRange: null })) return;
  synthMagOutSound();
}

/** 推入新弹匣（与弹药补满同帧触发） */
function playMagInSound() {
  const w = WEAPON_SFX[currentWeaponId];
  if (playWeaponSfx('magIn', { volume: (w && w.mechVolume) || 0.55, pitchRange: null })) return;
  synthMagInSound();
}

/** 拉枪机上膛（换弹完成同帧触发） */
function playBoltSound() {
  const w = WEAPON_SFX[currentWeaponId];
  if (playWeaponSfx('bolt', { volume: (w && w.mechVolume) || 0.55, pitchRange: null })) return;
  synthBoltSound();
}

/** 拔出弹匣（合成实现） */
function synthMagOutSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  const bufferSize = audioCtx.sampleRate * 0.2;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.2);
}

/** 推入新弹匣（合成实现）—— 低频"咔哒" */
function synthMagInSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

/** 拉枪机上膛（合成实现）—— 短促高频金属声 */
function synthBoltSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(320, now + 0.07);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.09, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

// ---- 脚步声（程序化合成，零素材）----
// 变体表：lp = 鞋底低通 Hz，bp = 摩擦带通 Hz，q = 带通 Q，
// decay = 噪声衰减系数（越大越干脆），thumpFrom/To = 体重共振扫频起止 Hz。
// 三个维度一起变，4 个变体的辨识度才够。
const FOOTSTEP_VARIANTS = [
  { lp: 190, bp: 2800, q: 0.9, decay: 26, thumpFrom: 82, thumpTo: 52 },
  { lp: 215, bp: 3300, q: 1.1, decay: 31, thumpFrom: 76, thumpTo: 48 },
  { lp: 170, bp: 2450, q: 0.7, decay: 22, thumpFrom: 88, thumpTo: 55 },
  { lp: 205, bp: 3050, q: 1.3, decay: 28, thumpFrom: 80, thumpTo: 50 },
];
const FOOTSTEP_VOLUME        = 0.18; // 合成音基础音量
// 采样基础音量。采样经 ffmpeg loudnorm I=-20 归一，电平明显低于原来的合成音，
// 故单独给一个增益，而不是和合成音共用 FOOTSTEP_VOLUME。
const FOOTSTEP_SAMPLE_VOLUME = 0.50;
const FOOTSTEP_VOL_JITTER   = 0.15; // 音量随机抖动 ±15%
const FOOTSTEP_RATE_JITTER  = 0.08; // 播放速率随机抖动 ±8%
const FOOTSTEP_SPRINT_BOOST = 0.06; // 疾跑音量增量（踩得更重）
const FOOTSTEP_DURATION     = 0.18; // 噪声缓冲时长（秒）
const FOOTSTEP_LOG_MAX      = 32;   // 落脚记录条数（供自动化验证回溯）
const footstepLog = [];             // 最近若干次落脚 { phase, speed }（有上限，会被 shift 截断）
let footstepCount = 0;              // 累计落脚次数（单调递增，不受上限影响，用于测步频）

let lastFootstepIdx = -1;

/** 随机挑一个已加载的脚步采样。刻意避开与上一步相同的变体——连续同音最容易被听出来。 */
function pickFootstepBuffer() {
  const n = FOOTSTEP_FILES.length;
  if (n === 0) return null;
  let idx = (Math.random() * n) | 0;
  if (n > 1 && idx === lastFootstepIdx) idx = (idx + 1 + ((Math.random() * (n - 1)) | 0)) % n;
  const buf = sfxBuffers.get(FOOTSTEP_KEY_PREFIX + idx);
  if (!buf) return null;
  lastFootstepIdx = idx;
  return buf;
}

/**
 * 脚步落地声入口：**采样优先，失败回退程序化合成**。
 * 采样是 CC0 真实录音（12 个硬地面变体）；合成音作为加载失败/未就绪时的兜底，
 * 保证即使音频文件全挂掉，脚步也不会静音。
 */
function playFootstep({ sprint = 0 } = {}) {
  if (!audioCtx) return;

  const buffer = pickFootstepBuffer();
  if (!buffer) { synthFootstep({ sprint }); return; }

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  // 每步随机音高，在 12 个变体之外再加一层变化
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * FOOTSTEP_RATE_JITTER;

  const gain = audioCtx.createGain();
  gain.gain.value = FOOTSTEP_SAMPLE_VOLUME * (1 + (Math.random() * 2 - 1) * FOOTSTEP_VOL_JITTER)
                  + FOOTSTEP_SPRINT_BOOST * sprint;

  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
}

function synthFootstep({ sprint = 0 } = {}) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const v = FOOTSTEP_VARIANTS[(Math.random() * FOOTSTEP_VARIANTS.length) | 0];

  // 每步随机：速率（同时改变音色与有效时长）+ 音量 + 变体 —— 避免脚步听起来像机关枪
  const rate = 1 + (Math.random() * 2 - 1) * FOOTSTEP_RATE_JITTER;
  const vol  = FOOTSTEP_VOLUME * (1 + (Math.random() * 2 - 1) * FOOTSTEP_VOL_JITTER)
             + FOOTSTEP_SPRINT_BOOST * sprint;

  // 本步总线：统一承载音量抖动
  const out = audioCtx.createGain();
  out.gain.value = vol;
  out.connect(audioCtx.destination);

  // 噪声源：指数衰减包络直接烘进采样（与 synthGunshot 同一手法）
  const len = Math.floor(audioCtx.sampleRate * FOOTSTEP_DURATION);
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-(i / len) * v.decay);
  }

  // ① 鞋底拍地：主体，最响
  const slapSrc = audioCtx.createBufferSource();
  slapSrc.buffer = buffer;
  slapSrc.playbackRate.value = rate;
  const slapFilter = audioCtx.createBiquadFilter();
  slapFilter.type = 'lowpass';
  slapFilter.frequency.setValueAtTime(v.lp + sprint * 40, now);
  const slapGain = audioCtx.createGain();
  slapGain.gain.setValueAtTime(1.0, now);
  slapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  slapSrc.connect(slapFilter);
  slapFilter.connect(slapGain);
  slapGain.connect(out);
  slapSrc.start(now);

  // ② 高频摩擦：鞋面擦地的「沙」，副层，短促。
  //    playbackRate 取 rate*1.05 让两层不完全相关（同一个噪声波形）
  const scuffSrc = audioCtx.createBufferSource();
  scuffSrc.buffer = buffer;
  scuffSrc.playbackRate.value = rate * 1.05;
  const scuffFilter = audioCtx.createBiquadFilter();
  scuffFilter.type = 'bandpass';
  scuffFilter.frequency.setValueAtTime(v.bp + sprint * 350, now);
  scuffFilter.Q.value = v.q;
  const scuffGain = audioCtx.createGain();
  scuffGain.gain.setValueAtTime(0.35, now);
  scuffGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  scuffSrc.connect(scuffFilter);
  scuffFilter.connect(scuffGain);
  scuffGain.connect(out);
  scuffSrc.start(now);

  // ③ 体重共振：低频「咚」，给脚步一点分量感
  const thump = audioCtx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(v.thumpFrom * rate, now);
  thump.frequency.exponentialRampToValueAtTime(v.thumpTo * rate, now + 0.09);
  const thumpGain = audioCtx.createGain();
  thumpGain.gain.setValueAtTime(0.5, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  thump.connect(thumpGain);
  thumpGain.connect(out);
  thump.start(now);
  thump.stop(now + 0.14);
}

function playGameEndSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  [0, 0.15, 0.3].forEach((delay, i) => {
    const freq = [523, 659, 784][i];
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.2, now + delay + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.3);
  });
}

// ============================================
// INPUT HANDLING
// ============================================
const keys = {};
const input = {
  moveForward:  0,
  moveRight:    0,
  jump:         false,
  jumpPressed:  false,
  shootPressed: false,
  reloadPressed: false,
  mouseX: 0,
  mouseY: 0,
  touchLookX: 0,
  touchLookY: 0,
  joystickX: 0,
  joystickY: 0,
  touchShoot: false,
};

// Keyboard
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r' && state.status === 'playing') {
    input.reloadPressed = true;
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// Mouse movement (for pointer lock)
document.addEventListener('mousemove', (e) => {
  if (state.isPointerLocked && state.status === 'playing') {
    input.mouseX += e.movementX;
    input.mouseY += e.movementY;
  }
});

// Pointer lock
/**
 * 请求指针锁定。必须在用户手势（click）的同步调用栈内执行，
 * 否则浏览器会抛 NotAllowedError: A user gesture is required to request Pointer Lock.
 * 这里同时吞掉 Promise 的 reject，避免在控制台产生未捕获错误。
 */
function requestPointerLock() {
  if (state.isMobile) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    // 少数浏览器不支持 Pointer Lock，静默降级为「点击画面重新锁定」
  }
}

canvas.addEventListener('click', () => {
  if (state.status === 'playing' && !state.isMobile) {
    requestPointerLock();
  }
  if (state.status === 'paused') {
    resumeGame();
  }
});

document.addEventListener('pointerlockchange', () => {
  state.isPointerLocked = document.pointerLockElement === canvas;
  if (!state.isPointerLocked && state.status === 'playing') {
    pauseGame();
  }
});

// 指针锁定失败时给出可操作提示，避免「进了游戏但鼠标转不了视角」的迷惑状态
document.addEventListener('pointerlockerror', () => {
  console.warn('Pointer Lock 被浏览器拒绝 —— 点击游戏画面即可重新锁定鼠标视角。');
});

// Shoot
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && state.status === 'playing') {
    input.shootPressed = true;
  }
});
// mouseup 必须挂 window 而不是 canvas：指针锁定中途丢失时（例如按 Esc），
// 松开的鼠标事件会落到别的元素上，挂 canvas 就收不到 → shootPressed 永久为 true
// → 持续自动开火，且在新速度模型下被永久压在开枪档（2.4）。
// mousedown 仍留 canvas，避免点击 UI 按钮误触发开火。
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.shootPressed = false;
});

// Prevent context menu
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ============================================
// MOBILE TOUCH CONTROLS
// ============================================
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function setupMobileControls() {
  if (!state.isMobile) return;

  const joystickBase   = document.getElementById('joystick-base');
  const joystickThumb  = document.getElementById('joystick-thumb');
  const shootBtn       = document.getElementById('mobile-shoot-btn');
  const reloadBtn      = document.getElementById('mobile-reload-btn');
  const shootArea      = document.getElementById('mobile-shoot-area');

  let joystickId = null;
  let lookId     = null;
  let lookStartX = 0;
  let lookStartY = 0;

  // Joystick
  joystickBase.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joystickId === null) {
      const touch = e.changedTouches[0];
      joystickId = touch.identifier;
      updateJoystick(touch, joystickBase, joystickThumb);
    }
  }, { passive: false });

  joystickBase.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickId) {
        updateJoystick(touch, joystickBase, joystickThumb);
      }
    }
  }, { passive: false });

  // touchcancel 与 touchend 共用同一处理（changedTouches 语义相同）。
  // 触摸被系统中断（来电 / 通知下拉 / 手势返回）时若不处理，joystickId 会永久占位，
  // 表现为「玩家永久自动行走 + 脚步无限响」。
  const endJoystick = (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickId) {
        joystickId = null;
        input.joystickX = 0;
        input.joystickY = 0;
        joystickThumb.style.transform = 'translate(0px, 0px)';
      }
    }
  };
  joystickBase.addEventListener('touchend', endJoystick);
  joystickBase.addEventListener('touchcancel', endJoystick);

  // Look area (right side of screen for camera control)
  document.addEventListener('touchstart', (e) => {
    for (const touch of e.changedTouches) {
      // Check if touch is on the right half of screen (look/camera area)
      const isRightSide = touch.clientX > window.innerWidth / 3;
      const isOnShoot = shootArea.contains(document.elementFromPoint(touch.clientX, touch.clientY));
      const isOnJoystick = joystickBase.contains(document.elementFromPoint(touch.clientX, touch.clientY));
      const isOnReload = reloadBtn.contains(document.elementFromPoint(touch.clientX, touch.clientY));

      if (!isOnJoystick && !isOnShoot && !isOnReload && isRightSide && lookId === null) {
        lookId = touch.identifier;
        lookStartX = touch.clientX;
        lookStartY = touch.clientY;
      }
    }
  });

  document.addEventListener('touchmove', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookId) {
        input.touchLookX = touch.clientX - lookStartX;
        input.touchLookY = touch.clientY - lookStartY;
        lookStartX = touch.clientX;
        lookStartY = touch.clientY;
      }
    }
  });

  const endLook = (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookId) {
        lookId = null;
        input.touchLookX = 0;
        input.touchLookY = 0;
      }
    }
  };
  document.addEventListener('touchend', endLook);
  document.addEventListener('touchcancel', endLook);

  // Shoot button
  shootBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.shootPressed = true;
  });
  // touchcancel 必须处理：触摸被系统中断时若不置回，shootPressed 会卡在 true，
  // 表现为「持续自动开火」且在新速度模型下被永久压在开枪档（2.4）。
  const endShoot = (e) => {
    e.preventDefault();
    input.shootPressed = false;
  };
  shootBtn.addEventListener('touchend', endShoot);
  shootBtn.addEventListener('touchcancel', endShoot);

  // Reload button
  reloadBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.status === 'playing') input.reloadPressed = true;
  });
}

function updateJoystick(touch, base, thumb) {
  const rect = base.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxDist = rect.width / 2 - 24;

  let dx = touch.clientX - centerX;
  let dy = touch.clientY - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > maxDist) {
    dx = (dx / dist) * maxDist;
    dy = (dy / dist) * maxDist;
  }

  thumb.style.transform = `translate(${dx}px, ${dy}px)`;

  input.joystickX = dx / maxDist;
  input.joystickY = dy / maxDist;
}

// ============================================
// PLAYER MOVEMENT & CAMERA
// ============================================
let playerGroup, fpsWeapon;
const playerVelocity = new THREE.Vector3();
const playerPosition = new THREE.Vector3(0, 0, 2);
let cameraAngleH = 0;      // Horizontal camera angle (radians)
let cameraAngleV = 0;      // Vertical camera angle (radians)
const eyeHeight = 1.6;
let weaponBobPhase = 0;
const lookSensitivityX = 0.002;
const lookSensitivityY = 0.0004;
const touchLookSensitivityX = 0.006;
const touchLookSensitivityY = 0.006;
// ---- 移动速度档位（单位/秒）----
// 优先级：开枪 > 换弹 > 疾跑 > 慢走（开枪要求非换弹中，故前两者互斥）
const MOVE_SPEED_WALK   = 4.2;   // 慢走（默认，不按 Shift）
const MOVE_SPEED_SPRINT = 7.2;   // 疾跑（按住 Shift）
const MOVE_SPEED_RELOAD = 3.2;   // 换弹期间：比开枪略快，仍明显低于慢走
const MOVE_SPEED_FIRING = 2.4;   // 开枪期间：最低档
const MOVE_INPUT_DEADZONE = 0.1; // 移动输入死区（沿用原阈值）
const SPRINT_MAG_MIN = 0.85;     // 移动端推杆超过此值后开始向疾跑渐变

// 武器摆动速率基准：改动前 moveSpeed 恒为 6，慢走档乘该增益恰好回到原节奏，
// 保证「默认档武器摆动观感」与改动前逐帧一致。
const WEAPON_BOB_SPEED_GAIN = 6 / MOVE_SPEED_WALK;

// ---- 相机呼吸 / 行走摆动 ----
const BREATH_HZ  = 0.25;   // 待机呼吸频率（Hz）
const BREATH_AMP = 0.008;  // 待机呼吸幅度（±，垂直）
const SWAY_AMP_WALK    = 0.035;  // 行走摆动幅度（±，垂直）
const SWAY_AMP_SPRINT  = 0.055;  // 疾跑摆动幅度（±，垂直）
const SWAY_AMP_LATERAL = 0.018;  // 行走横向摆幅（±）

// ---- 步频 ----
// 步频由「等效步幅」导出，而不是按档位写死：摇杆推杆深度会缩放速度，
// 若步频固定，半推杆（速度减半）时脚会打滑一倍。用步幅把这个关系编码进去后，
// 慢走 4.2/1.615 = 2.6Hz，疾跑 7.2/1.731 = 4.16Hz，恰好是 2.6 × 1.6。
//
// ⚠️ 步频**不**按真实人类步速（约 1.9 步/秒）取。游戏移动速度是真实步速的约 3 倍，
// 用真实步频会让每步跨度达到 2.2 米，看起来像在滑冰。步幅压到 1.6~1.7 米后
// 脚步密度才与实际位移匹配 —— 这里要的是「看起来对」，不是「物理上对」。
const STEP_RATE_WALK        = 2.6;   // 慢走步频（步/秒）
const STEP_RATE_SPRINT_MULT = 1.6;   // 疾跑步频倍率 → 疾跑 4.16 步/秒
const STRIDE_WALK   = MOVE_SPEED_WALK   / STEP_RATE_WALK;                             // ≈1.615 m
const STRIDE_SPRINT = MOVE_SPEED_SPRINT / (STEP_RATE_WALK * STEP_RATE_SPRINT_MULT);   // ≈1.731 m

// ---- 速度/摆动混合 ----
const LOCO_BLEND_RATE = 8;             // 混合量指数趋近速率（时间常数 0.125s）
const LOCO_BLEND_EPS  = 0.001;         // 残渣归零阈值（同 updateRecoil 的做法）
const STEP_FOOTSTEP_MIN_BLEND = 0.35;  // 移动混合量超过此值才触发脚步

/**
 * 移动状态：本帧的档位 / 速度 / 动画混合量，供相机摆动、脚步触发、武器 bob 共用。
 * 必须提到模块级 —— 原来的 isMoving 是 updateMovement 的局部变量，相机与音效取不到；
 * 且武器 bob 相位推进速率原本与速度硬耦合，三方必须共享同一份数据。
 */
const locomotion = {
  speed: 0,               // 本帧实际速度（已含摇杆模拟量）
  isMoving: false,
  firing: false,
  reloading: false,
  inputMagnitude: 0,      // 0..1 摇杆推杆深度；键盘恒为 0 或 1
  moveBlend: 0,           // 0..1 平滑后的「正在移动」程度
  sprintBlend: 0,         // 0..1 平滑后的「疾跑」程度
  swayAmp: SWAY_AMP_WALK, // 当前垂直摆幅（随 sprintBlend 插值）
  stepRate: 0,            // 当前步频（步/秒）
};

// 摆动相位累加器。只在 updateLocomotion 内推进，而它只被 updateMovement 调用
// （updateMovement 只在 status === 'playing' 时执行）→ 暂停时自动冻结。
// ⚠️ 不要把相位推进挪进 updateCamera()：它在 paused 下也会执行。
let breathPhase = 0;   // 呼吸相位（rad）
let swayPhase   = 0;   // 摆动相位（rad）：每 +π = 一次落脚

const jumpForce = 6;
let isGrounded = true;
let verticalVelocity = 0;

/** 玩家碰撞半径。第一人称看不到自己的身体，取值以「贴墙走过时不穿模」为准 */
const PLAYER_RADIUS = 0.4;
const COLLISION_ITERATIONS = 2;   // 多跑一遍，处理夹在两个障碍物夹角里的情况

/**
 * 野怪碰撞半径（中心圆）。躯干宽 1.2，取 0.65 让身体边缘轻微陷入柱子 ——
 * 视觉上是「贴着柱子」，而不是「离柱子还有一段距离就停住」。
 * 肩甲/手臂的宽度（最远 1.25）由肩圆单独负责，见 MONSTER_SHOULDER_*。
 */
const MONSTER_RADIUS = 0.65;
/** 肩甲球心到躯干中心的水平距离（模型 SphereGeometry 位置 ±0.75） */
const MONSTER_SHOULDER_OFFSET = 0.75;
/** 肩甲球半径（与模型 SphereGeometry(0.5) 一致）；手臂/拳头横向范围 ⊂ 肩圆覆盖 */
const MONSTER_SHOULDER_RADIUS = 0.5;
/**
 * 绕行拐角的外扩距离：肩圆把有效碰撞体变成宽 2.5 的胶囊，绕过墙角时身体中心
 * 最坏需要离角点 偏移+半径 才不穿模，拐角目标必须按这个轮廓外扩。
 * ⚠️ 不要复用 MONSTER_PROBE_RADIUS：它服务于 isPathClear 的采样半径，
 * 受「必须小于 PLAYER_RADIUS」的承重不变量约束，两者职责不同。
 */
const MONSTER_DETOUR_MARGIN = MONSTER_SHOULDER_OFFSET + MONSTER_SHOULDER_RADIUS;
/** 正面顶住的判定：朝玩家的有效推进量低于 期望步长 × 该值 时，认定不是滑行而是顶住 */
const MONSTER_BLOCKED_ADVANCE_MIN = 0.3;
/** 绕行时每帧的侧向位移，以步长为单位（仅在找不到绕行拐角时的兜底路径上用） */
const MONSTER_AVOID_STRENGTH = 1.0;
/**
 * 路径通畅性的探测半径，刻意小于玩家碰撞半径 PLAYER_RADIUS。
 * 玩家常常紧贴障碍站立，若用完整半径，玩家本身就会落在障碍的「外扩区」内，
 * 导致任何拐角的路径判定都不通畅、绕行直接失效。
 * ⚠️ 承重不变量：必须严格小于 PLAYER_RADIUS，见紧随其后的断言。
 */
const MONSTER_PROBE_RADIUS = MONSTER_RADIUS * 0.6;

// 承重不变量：探测半径必须严格小于玩家碰撞半径。
// 玩家贴障碍时圆心距恰好被推出到 PLAYER_RADIUS，若 probe >= PLAYER_RADIUS，
// isPathClear 对「拐角 -> 玩家」的每次采样都落在障碍外扩区内 -> 恒返回 false
// -> findDetourCorner 永远返回 null -> 绕行静默退化成沿墙蹭。
// 实测 probe = 0.41（仅比 0.4 大 1cm）贴墙场景下绕行就完全失效 —— 故在这里钉死。
// 用 warn 而非 throw：与 registerSolid 的间距检查一致，坏掉的是手感不是数据。
if (MONSTER_PROBE_RADIUS >= PLAYER_RADIUS) {
  console.warn('MONSTER_PROBE_RADIUS (' + MONSTER_PROBE_RADIUS + ') 必须小于 PLAYER_RADIUS (' +
    PLAYER_RADIUS + ')：否则玩家贴障碍站立时所有绕行拐角都判为不通畅，绕行会静默失效');
}

/**
 * 本帧朝玩家方向的「有效推进量」——即实际位移在期望方向上的投影。
 * 斜向撞墙时切向分量保留，该值接近满步长；正面顶住时接近 0。
 */
function getAdvance(fromX, fromZ, toX, toZ, dirX, dirZ) {
  return (toX - fromX) * dirX + (toZ - fromZ) * dirZ;
}

/** 是否属于「正面顶住」（而非沿墙滑行）。抽成纯函数便于数值验证。 */
function isMonsterHeadOnBlocked(advance, step) {
  return advance < step * MONSTER_BLOCKED_ADVANCE_MIN;
}

/**
 * 绕行方向：垂直于「朝玩家方向」的单位向量，符号由 avoidSide 决定。
 * avoidSide 必须保持到脱离障碍为止，否则每帧重新随机会让野怪左右抖动、原地打转。
 */
function getAvoidDir(dirX, dirZ, avoidSide) {
  return { x: -dirZ * avoidSide, z: dirX * avoidSide };
}

/**
 * 两点之间的直线路径是否通畅（沿线段采样，检查是否穿过任何障碍的外扩区）。
 * 用 MONSTER_PROBE_RADIUS 而非碰撞半径 —— 理由见该常量的注释。
 */
function isPathClear(x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  // 探测半径取保护值 + 步数硬上限：任何一个常量为 0 或 undefined 时，
  // dist / 0 会得到 Infinity，没有上限的 for 循环会直接挂死。
  // ⚠️ probe 必须同时喂给 steps 和 r2。只兜 steps 的话，r2 会退化成 0 / NaN，
  // 比较恒为 false -> isPathClear 恒返回 true -> 绕行静默失效（不挂死，但更隐蔽）。
  const probe = MONSTER_PROBE_RADIUS > 0 ? MONSTER_PROBE_RADIUS : MONSTER_RADIUS;
  const steps = Math.max(2, Math.min(256, Math.ceil(dist / (probe * 0.5))));
  const r2 = probe * probe;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    for (const o of solidObstacles) {
      const cx = Math.max(o.minX, Math.min(px, o.maxX));
      const cz = Math.max(o.minZ, Math.min(pz, o.maxZ));
      const ex = px - cx;
      const ez = pz - cz;
      if (ex * ex + ez * ez < r2) return false;
    }
  }
  return true;
}

/**
 * 野怪是否应当继续追，而不是判定「已到位」停下。
 *
 * ⚠️ 不能只看距离。隔着 0.3m 隔断时，野怪与玩家的圆心距最小只有
 * 0.3 + PLAYER_RADIUS + MONSTER_RADIUS = 1.35m，已经小于 stopDist 1.8m ——
 * 纯距离门控会让野怪在掩体另一侧就判「到位」并停下，stepMonsterChase 一次都不进，
 * 整套绕行分支形同虚设（玩家只要贴住隔断，绕行就永远用不上）。
 * 故「到位」必须同时满足距离与视线：视线被挡就继续追，交给绕行去绕。
 *
 * 抽成纯函数是为了让离线仿真调用**真实实现**，而不是把门控抄一份进测试脚本 ——
 * 抄一份的后果是门控改了测试不会红，即 CONTRIBUTING.md 说的「假验证」。
 */
function shouldChase(dist, stopDist, mPos, playerX, playerZ) {
  return dist > stopDist || !isPathClear(mPos.x, mPos.z, playerX, playerZ);
}

/**
 * 找绕行目标点：所有障碍的「外扩角」里，到玩家路径通畅、且离野怪最近的那一个。
 * 朝拐角走 -> 绕过障碍 -> isPathClear 变真 -> 退出绕行恢复正常追逐。
 * 只靠「垂直于朝向平移」是不够的：长墙会让人沿着墙来回蹭，
 * 蹭到墙尽头后又被朝玩家的方向拉回墙的阴影里，永远绕不过去。
 * 外扩距离用 MONSTER_DETOUR_MARGIN（肩圆轮廓）：胶囊体绕过墙角时身体中心
 * 需要这么大的间隙，拐角太贴墙会导致绕行卡在角上转不过去。
 */
function findDetourCorner(fromX, fromZ, playerX, playerZ) {
  let best = null;
  let bestDist = Infinity;
  for (const o of solidObstacles) {
    const xs = [o.minX - MONSTER_DETOUR_MARGIN, o.maxX + MONSTER_DETOUR_MARGIN];
    const zs = [o.minZ - MONSTER_DETOUR_MARGIN, o.maxZ + MONSTER_DETOUR_MARGIN];
    for (const cx of xs) {
      for (const cz of zs) {
        if (!isPathClear(cx, cz, playerX, playerZ)) continue;
        const d = Math.hypot(cx - fromX, cz - fromZ);
        if (d < bestDist) { bestDist = d; best = { x: cx, z: cz }; }
      }
    }
  }
  return best;
}

/**
 * 野怪单帧的追逐位移：朝玩家走一步 -> 碰撞解算（中心圆 + 肩圆）-> 若正面顶住则绕行。
 * 抽成纯函数（只依赖 pos 的 x/z 与 ud.avoidSide）是为了能离线仿真验证 ——
 * 碰撞与绕行是这块最容易出错的地方，而实机里「正面顶住」的场景很难自然出现。
 * 肩圆 (dx,dz) 即本帧朝向，与 updateMonsters 的 lookAt 朝向一致。
 * @param {{x:number,z:number}} pos        野怪位置，原地修改
 * @param {{avoidSide:number}} ud          野怪状态，会读写 avoidSide
 * @returns {number} 本帧朝玩家的有效推进量（正面顶住时接近 0）
 */
function stepMonsterChase(pos, ud, playerX, playerZ, speed, dt) {
  let dx = playerX - pos.x;
  let dz = playerZ - pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return 0;
  dx /= len;
  dz /= len;

  const step = speed * dt;

  // 绕行模式：朝外扩拐角走，直到整个身体到玩家的路径通畅为止
  if (ud.avoidSide) {
    if (isCapsulePathClear(pos, dx, dz, playerX, playerZ)) {
      ud.avoidSide = 0;   // 胶囊体已完全绕过，恢复正常追逐
    } else {
      const corner = findDetourCorner(pos.x, pos.z, playerX, playerZ);
      if (corner) {
        const cx = corner.x - pos.x;
        const cz = corner.z - pos.z;
        const cl = Math.hypot(cx, cz) || 1;
        pos.x += (cx / cl) * step;
        pos.z += (cz / cl) * step;
      } else {
        // 兜底：所有拐角都不通畅时，沿垂直于朝向的一侧平移
        const av = getAvoidDir(dx, dz, ud.avoidSide);
        pos.x += av.x * step * MONSTER_AVOID_STRENGTH;
        pos.z += av.z * step * MONSTER_AVOID_STRENGTH;
      }
      resolveObstacleCollisions(pos, MONSTER_RADIUS);
      resolveShoulderCollisions(pos, dx, dz);
      return 0;
    }
  }

  const fromX = pos.x;
  const fromZ = pos.z;
  pos.x += dx * step;
  pos.z += dz * step;

  const centerHit = resolveObstacleCollisions(pos, MONSTER_RADIUS);
  // 中心圆未挡也可能侧贴墙（肩甲插墙），肩圆必须独立执行。
  // 推出方向垂直于朝向，不削减有效推进量，不会误触发绕行门控。
  resolveShoulderCollisions(pos, dx, dz);
  if (!centerHit) return step;

  // 被障碍挡住。斜向撞上时切向分量会自然保留（沿墙滑行），
  // 只有「正面顶住」才需要进入绕行模式 —— 用朝玩家的有效推进量区分这两种情况。
  const advance = getAdvance(fromX, fromZ, pos.x, pos.z, dx, dz);
  if (isMonsterHeadOnBlocked(advance, step)) {
    if (!ud.avoidSide) ud.avoidSide = Math.random() < 0.5 ? -1 : 1;
  }
  return advance;
}

/**
 * 把一个圆形碰撞体 (cx,cz,radius) 推出所有相交的实体障碍（圆 vs AABB），位移落到 pos 上。
 * 推出方向沿「AABB 上离圆心最近的点 → 圆心」的法线，因此天然支持**贴墙滑行** ——
 * 只有垂直于墙面的分量被抵消，切向分量保留，不会撞上就被卡死。
 * cx/cz 允许与 pos 分离（肩圆场景：圆心在身体侧面，但被推时整个身体一起动）。
 * @param {{x:number,z:number,y?:number}} pos  身体位置，原地修改（只动 x/z，不动 y）
 * @param {number} cx        碰撞圆心 x
 * @param {number} cz        碰撞圆心 z
 * @param {number} radius    碰撞半径
 * @returns {boolean}        本次是否发生过推出
 */
function pushCircleOutOfObstacles(pos, cx, cz, radius) {
  let hit = false;
  const startX = pos.x;
  const startZ = pos.z;
  for (const o of solidObstacles) {
    // 已跳到障碍物顶面之上则不碰撞。当前跳跃高度 1.2m < 最矮障碍 1.8m，实际不会触发；
    // 留着是为了以后加平台/矮掩体时不用回头改这里。
    if (pos.y >= o.height) continue;

    // 圆心随身体一起动：同一轮里被前一个障碍推出后，圆心要跟着平移再算下一个最近点
    const ccx = cx + (pos.x - startX);
    const ccz = cz + (pos.z - startZ);

    // AABB 上离圆心最近的点
    const nx = Math.max(o.minX, Math.min(ccx, o.maxX));
    const nz = Math.max(o.minZ, Math.min(ccz, o.maxZ));
    const dx = ccx - nx;
    const dz = ccz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;

    hit = true;
    if (d2 > 1e-8) {
      // 圆心在盒外：沿最近点法线推出
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // 圆心已在盒内（高速穿入或与障碍重叠）：沿最浅的那个面推出
      const toMinX = ccx - o.minX;
      const toMaxX = o.maxX - ccx;
      const toMinZ = ccz - o.minZ;
      const toMaxZ = o.maxZ - ccz;
      const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (m === toMinX)      pos.x += (o.minX - radius) - ccx;
      else if (m === toMaxX) pos.x += (o.maxX + radius) - ccx;
      else if (m === toMinZ) pos.z += (o.minZ - radius) - ccz;
      else                   pos.z += (o.maxZ + radius) - ccz;
    }
  }
  return hit;
}

/**
 * 把一个圆形碰撞体推出所有相交的实体障碍（圆 vs AABB）。玩家与野怪共用这一套。
 * @param {THREE.Vector3} pos    位置，原地修改（只动 x/z，不动 y）
 * @param {number} radius        碰撞半径，默认玩家半径
 * @returns {boolean}            本次是否发生过推出（野怪靠它判断「被挡住了」）
 */
function resolveObstacleCollisions(pos, radius = PLAYER_RADIUS) {
  let pushedAny = false;
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    if (!pushCircleOutOfObstacles(pos, pos.x, pos.z, radius)) break;  // 没有相交就提前结束
    pushedAny = true;
  }
  return pushedAny;
}

/**
 * 胶囊体（中心 + 双肩圆）到玩家的直线路径是否全部通畅。
 * 绕行退出条件不能只看中心点：中心刚过墙角时视线已通，但拖在后面的肩圆
 * 还会被墙角挂住、把身体推回，推进量为负 → 误判「正面顶住」→ 重新进入绕行，
 * 表现为在墙角来回抖动。三个点都通畅才退出，保证整个身体真的绕过来了。
 */
function isCapsulePathClear(pos, dirX, dirZ, playerX, playerZ) {
  if (!isPathClear(pos.x, pos.z, playerX, playerZ)) return false;
  for (const side of [-1, 1]) {
    const sx = pos.x - dirZ * side * MONSTER_SHOULDER_OFFSET;
    const sz = pos.z + dirX * side * MONSTER_SHOULDER_OFFSET;
    if (!isPathClear(sx, sz, playerX, playerZ)) return false;
  }
  return true;
}

/**
 * 侧贴墙防穿模：两个随朝向 (dirX,dirZ) 旋转的「肩圆」，把整体 pos 推出障碍。
 * 中心圆 MONSTER_RADIUS 只管躯干，肩甲/手臂最远到 1.25，侧贴墙滑行时会插进墙里 ——
 * 肩圆与模型肩甲球同尺寸同位置，推出后肩甲恰好贴墙。推出方向垂直于朝向，
 * 不削减朝玩家的有效推进量，因此不会误触发绕行门控。
 */
function resolveShoulderCollisions(pos, dirX, dirZ) {
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    let hit = false;
    for (const side of [-1, 1]) {
      const sx = pos.x - dirZ * side * MONSTER_SHOULDER_OFFSET;
      const sz = pos.z + dirX * side * MONSTER_SHOULDER_OFFSET;
      if (pushCircleOutOfObstacles(pos, sx, sz, MONSTER_SHOULDER_RADIUS)) hit = true;
    }
    if (!hit) break;
  }
}

function updateMovement(dt) {
  // Update rotation from input
  if (state.isPointerLocked) {
    cameraAngleH -= input.mouseX * lookSensitivityX;
    cameraAngleV -= input.mouseY * lookSensitivityY;
    input.mouseX = 0;
    input.mouseY = 0;
  } else if (state.isMobile) {
    cameraAngleH -= input.touchLookX * touchLookSensitivityX;
    cameraAngleV -= input.touchLookY * touchLookSensitivityY;
    input.touchLookX = 0;
    input.touchLookY = 0;
  }

  // Clamp vertical angle (first-person: look up/down range)
  cameraAngleV = Math.max(-1.3, Math.min(1.3, cameraAngleV));

  // Get movement input
  let forward = 0;
  let right = 0;
  if (state.isPointerLocked || state.isMobile) {
    // 两分支互斥（isMobile 时不会建立指针锁定），用 else if 防止将来新增平台时静默取错值
    if (state.isPointerLocked) {
      forward = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
      right   = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
    } else if (state.isMobile) {
      forward = -input.joystickY;
      right   = input.joystickX;
    }
  }

  // Forward/right relative to camera horizontal angle
  const forwardDir = new THREE.Vector3(-Math.sin(cameraAngleH), 0, -Math.cos(cameraAngleH));
  const rightDir   = new THREE.Vector3(Math.cos(cameraAngleH), 0, -Math.sin(cameraAngleH));

  const moveDir = new THREE.Vector3()
    .addScaledVector(forwardDir, forward)
    .addScaledVector(rightDir, right);

  // 摇杆模拟量必须在归一化之前取：forwardDir/rightDir 正交且模为 1，故
  // moveDir.length() === hypot(forward, right)。键盘值 ∈ {0,±1} → 取 min 后恒为 0/1。
  const inputMagnitude = Math.min(moveDir.length(), 1);
  // ⚠️ 必须无条件归一化（只要长度非零）。旧代码的条件是 length() > 1，
  // 半推杆时长度 0.5 不会被归一化，幅度就同时留在 moveDir 里、又乘进了 speed —— 缩放两次，
  // 实测位移速度只有报告值的一半（2.1 报成 1.051）。幅度统一交给 locomotion.speed 承载。
  if (moveDir.length() > 0) moveDir.normalize();

  updateLocomotion(dt, inputMagnitude);

  // Apply movement
  playerPosition.x += moveDir.x * locomotion.speed * dt;
  playerPosition.z += moveDir.z * locomotion.speed * dt;

  // 内部障碍（隔断 / 掩体柱）碰撞。必须放在边界 clamp **之前**：
  // 否则贴着边界的柱子会把玩家推出去、再被 clamp 推回来，产生抖动。
  resolveObstacleCollisions(playerPosition);

  // Clamp player to arena bounds (walls at X=±27, Z=-47, Z=13)
  // 外围墙由这条 clamp 兜底（内侧面在 ±26.6 / -46.6 / 12.6，留出了玩家半径），
  // 所以没有单独登记碰撞体；它同时也是「任何情况下都跑不出场地」的最终保险。
  playerPosition.x = Math.max(-26, Math.min(26, playerPosition.x));
  playerPosition.z = Math.max(-46, Math.min(12, playerPosition.z));

  // Jump
  if (state.isPointerLocked && keys[' ']) {
    if (!input.jumpPressed && isGrounded) {
      input.jumpPressed = true;
      verticalVelocity = jumpForce;
      isGrounded = false;
    }
  } else {
    input.jumpPressed = false;
  }

  // Gravity
  if (!isGrounded) {
    verticalVelocity -= 15 * dt;
    playerPosition.y += verticalVelocity * dt;
    if (playerPosition.y <= 0) {
      playerPosition.y = 0;
      verticalVelocity = 0;
      isGrounded = true;
    }
  }

  // Hide player model in first-person; keep only position tracking
  if (playerGroup) {
    playerGroup.position.copy(playerPosition);
    playerGroup.visible = false;
  }

  // Weapon bob：速率乘 WEAPON_BOB_SPEED_GAIN，使慢走档的摆动节奏与改动前（moveSpeed 恒为 6）一致
  weaponBobPhase += locomotion.isMoving
    ? locomotion.speed * WEAPON_BOB_SPEED_GAIN * dt
    : 0;
}

// ---- 移动档位 / 速度 / 步频（纯函数，便于源码抽取后求值做数值验证）----

/**
 * 档位 + 输入模拟量 → 本帧目标速度。
 * 优先级：开枪 > 换弹 > 疾跑 > 慢走。
 */
function getTargetMoveSpeed({ firing, reloading, sprintInput, inputMagnitude }) {
  let base;
  if (firing)         base = MOVE_SPEED_FIRING;
  else if (reloading) base = MOVE_SPEED_RELOAD;
  else                base = MOVE_SPEED_WALK + (MOVE_SPEED_SPRINT - MOVE_SPEED_WALK) * sprintInput;
  return base * inputMagnitude;   // 摇杆模拟量只在这里乘一次
}

/**
 * 读疾跑力度。
 * 桌面：Shift 开关量（keydown 里做了 e.key.toLowerCase()，左右 Shift 统一为 'shift'）。
 * 移动端：推杆超过 SPRINT_MAG_MIN 后线性渐变到满疾跑 —— 用渐变而非硬阈值，
 * 否则推杆从 0.849 到 0.85 时速度会瞬跳 +71%，手感像被弹了一下。
 */
function readSprintInput(inputMagnitude) {
  if (state.isMobile) {
    if (inputMagnitude <= SPRINT_MAG_MIN) return 0;
    return (inputMagnitude - SPRINT_MAG_MIN) / (1 - SPRINT_MAG_MIN);
  }
  return keys['shift'] ? 1 : 0;
}

/** 步频（步/秒）：由速度与等效步幅导出，保证任何档位/推杆深度下脚都不打滑 */
function getStepRate(sprintBlend, speed, moveBlend) {
  const stride = STRIDE_WALK + (STRIDE_SPRINT - STRIDE_WALK) * sprintBlend;
  return (speed / stride) * moveBlend;
}

/** 本帧是否跨过落脚点（返回 0/1）。掉帧时单帧跨多个 π 也只算一次，避免同帧叠出连击音 */
function stepsTriggered(prevPhase, currPhase) {
  if (currPhase <= prevPhase) return 0;
  return Math.floor(currPhase / Math.PI) > Math.floor(prevPhase / Math.PI) ? 1 : 0;
}

/**
 * 推进移动状态：档位速度、混合量、摆动相位、脚步触发。
 * ⚠️ 只允许被 updateMovement 调用 —— updateMovement 只在 status === 'playing' 时执行，
 * 这条调用链是「暂停时相位不推进」的结构性保证。挪到 updateCamera 旁边会导致暂停了还在走。
 */
function updateLocomotion(dt, inputMagnitude) {
  locomotion.inputMagnitude = inputMagnitude;
  locomotion.reloading = state.reloading;
  // 用「按住扳机」而非 canShoot 判定：否则全自动射击时速度会以 8.3Hz 的冷却频率抖动
  locomotion.firing = input.shootPressed && !state.reloading && state.currentAmmo > 0;
  locomotion.isMoving = inputMagnitude > MOVE_INPUT_DEADZONE;

  const sprintInput = readSprintInput(inputMagnitude);
  locomotion.speed = getTargetMoveSpeed({
    firing: locomotion.firing,
    reloading: locomotion.reloading,
    sprintInput,
    inputMagnitude,
  });

  // 混合量指数趋近（与 updateRecoil 的 Math.exp(-k*dt) 同一手法，帧率无关）+ 残渣归零
  const k = 1 - Math.exp(-LOCO_BLEND_RATE * dt);
  locomotion.moveBlend   += ((locomotion.isMoving ? 1 : 0) - locomotion.moveBlend) * k;
  locomotion.sprintBlend += (sprintInput - locomotion.sprintBlend) * k;
  if (locomotion.moveBlend   < LOCO_BLEND_EPS) locomotion.moveBlend = 0;
  if (locomotion.sprintBlend < LOCO_BLEND_EPS) locomotion.sprintBlend = 0;

  locomotion.swayAmp  = SWAY_AMP_WALK + (SWAY_AMP_SPRINT - SWAY_AMP_WALK) * locomotion.sprintBlend;
  locomotion.stepRate = getStepRate(locomotion.sprintBlend, locomotion.speed, locomotion.moveBlend);

  breathPhase += Math.PI * 2 * BREATH_HZ * dt;      // 呼吸相位恒推进
  const prevSwayPhase = swayPhase;
  swayPhase += Math.PI * locomotion.stepRate * dt;  // 每 π = 一次落脚

  // 脚步：踩在摆动周期最低点（swayPhase 跨过 π 的整数倍）。
  // 触发点与 getSwayOffset 的垂直最低点共用同一个 π 定义，结构上不可能各走各的。
  // isGrounded 门控：跳跃过程中不踩空。
  if (isGrounded && locomotion.moveBlend >= STEP_FOOTSTEP_MIN_BLEND
      && stepsTriggered(prevSwayPhase, swayPhase)) {
    playFootstep({ sprint: locomotion.sprintBlend });
    footstepCount++;
    footstepLog.push({ phase: Math.ceil(prevSwayPhase / Math.PI) * Math.PI, speed: locomotion.speed });
    if (footstepLog.length > FOOTSTEP_LOG_MAX) footstepLog.shift();
  }
}

/**
 * 复位移动 / 摆动状态。startGame 必须调用，否则重开局会带着上一局的相位与混合量，
 * 表现为「开局第一帧相机就偏在某个摆幅上」以及「开局立刻响一声脚步」。
 */
function resetLocomotionState() {
  breathPhase = 0;
  swayPhase = 0;
  footstepLog.length = 0;
  footstepCount = 0;
  locomotion.speed = 0;
  locomotion.isMoving = false;
  locomotion.firing = false;
  locomotion.reloading = false;
  locomotion.inputMagnitude = 0;
  locomotion.moveBlend = 0;
  locomotion.sprintBlend = 0;
  locomotion.swayAmp = SWAY_AMP_WALK;
  locomotion.stepRate = 0;
}

/**
 * 相机摆动偏移（纯函数）。
 * 约定：swayPhase 每 +π = 一次落脚，且 π 的整数倍正好是落脚瞬间 —— 此处垂直取最低点、
 * 横向取最外侧，两个分量的速度都为 0（脚刚踩实），故边界处天然 C¹ 连续，不会抽动。
 * 物理对应：y 的周期 = π = 一步（落脚最低、摆动腿过身体时最高）；
 *           x 的周期 = 2π = 一个完整步态（落脚时横向位移最大且左右交替）。
 */
function getSwayOffset(phase, amp, lateralAmp, moveBlend) {
  return {
    x: -lateralAmp * Math.cos(phase)     * moveBlend,
    y: -amp        * Math.cos(2 * phase) * moveBlend,
  };
}

function updateCamera() {
  // 视觉摆动只叠加在 camera.position 上，绝不污染 playerPosition
  // （与后坐力「独立偏移量、只在消费点叠加」的约定一致）。
  // 呼吸与行走互为补集（1-moveBlend / moveBlend），和恒为 1，起步/停止时不会两个摆动叠加；
  // 所有项都乘 moveBlend → 停止时相机精确回到中性位，不会停在半个摆幅上。
  const sway = getSwayOffset(swayPhase, locomotion.swayAmp, SWAY_AMP_LATERAL, locomotion.moveBlend);
  const breatheY = BREATH_AMP * (1 - locomotion.moveBlend) * Math.sin(breathPhase);

  // 受击抖动：只叠加 position 不改 rotation（与 sway 同款约定，准星与弹道仍一致）。
  // shakeT 由 update(dt) 递减，这里只消费。
  let shakeX = 0, shakeY = 0;
  if (shakeT > 0) {
    const k = shakeT / HURT_SHAKE_TIME;
    shakeX = (Math.random() - 0.5) * 2 * HURT_SHAKE_AMP * k;
    shakeY = (Math.random() - 0.5) * 2 * HURT_SHAKE_AMP * k;
  }

  camera.position.set(
    playerPosition.x + sway.x + shakeX,
    playerPosition.y + eyeHeight + breatheY + sway.y + shakeY,
    playerPosition.z
  );

  // Set camera rotation from look angles + recoil offset (recoil decays back to 0)
  // 摆动只改 position 不改 rotation → 准星与弹道仍然一致
  camera.rotation.order = 'YXZ';
  camera.rotation.set(cameraAngleV + recoilPitch, cameraAngleH + recoilYaw, 0);
}

function updateWeaponBob(dt) {
  if (!fpsWeapon) return;

  // Walking bob: sinusoidal motion
  const bobX = Math.sin(weaponBobPhase * Math.PI) * 0.015;
  const bobY = Math.abs(Math.cos(weaponBobPhase * Math.PI)) * 0.01;
  const bobZ = Math.sin(weaponBobPhase * Math.PI * 2) * 0.008;

  // Use the saved base position
  if (!fpsWeapon.userData.basePosition) {
    fpsWeapon.userData.basePosition = fpsWeapon.position.clone();
    fpsWeapon.userData.baseRotation = fpsWeapon.rotation.clone();
  }
  const bp = fpsWeapon.userData.basePosition;
  const br = fpsWeapon.userData.baseRotation;

  fpsWeapon.position.set(
    bp.x + bobX,
    bp.y - bobY,
    bp.z + bobZ,
  );

  fpsWeapon.rotation.set(
    br.x + bobY * 0.8,
    br.y + bobX * 0.6,
    br.z + bobX * 0.3,
  );

  // Shooting recoil: weapon kicks up/back, driven by recoil energy
  if (weaponKick > 0) {
    // 枪口上翘 + 后缩 + 随机偏摆（能量衰减时自然回弹）
    fpsWeapon.position.z += weaponKick * 0.09;   // 向后缩
    fpsWeapon.position.y -= weaponKick * 0.02;   // 轻微下沉
    fpsWeapon.rotation.x += weaponKick * 0.35;   // 枪口上抬
    fpsWeapon.rotation.y += (recoilYaw / recoilMaxYaw) * weaponKick * 0.08; // 水平摆动
  }

  // 换弹动作：沿用 bob / 后坐的「基准姿态 + 增量偏移」叠加方式，避免二次赋值打架
  if (state.reloading) {
    const progress = 1 - Math.max(state.reloadTimer, 0) / state.reloadDuration;
    const pose = getReloadPose(progress);
    fpsWeapon.position.x += pose.x;
    fpsWeapon.position.y += pose.y;
    fpsWeapon.position.z += pose.z;
    fpsWeapon.rotation.x += pose.rx;
    fpsWeapon.rotation.y += pose.ry;
    fpsWeapon.rotation.z += pose.rz;
  }
}

// ============================================
// FIRST-PERSON WEAPON
// ============================================
function createFirstPersonWeapon() {
  const group = new THREE.Group();

  const gunMat = new THREE.MeshStandardMaterial({
    color: '#1c1c2e',
    roughness: 0.25,
    metalness: 0.75,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: '#ff4655',
    roughness: 0.15,
    metalness: 0.5,
    emissive: '#ff4655',
    emissiveIntensity: 0.25,
  });
  const blueMat = new THREE.MeshStandardMaterial({
    color: '#00d4ff',
    roughness: 0.15,
    metalness: 0.5,
    emissive: '#00d4ff',
    emissiveIntensity: 0.2,
  });

  // Main body
  const bodyGeo = new THREE.BoxGeometry(0.09, 0.12, 0.6);
  const body = new THREE.Mesh(bodyGeo, gunMat);
  body.position.y = 0.02;
  group.add(body);

  // Top rail
  const railGeo = new THREE.BoxGeometry(0.04, 0.02, 0.4);
  const rail = new THREE.Mesh(railGeo, gunMat);
  rail.position.set(0, 0.08, -0.04);
  group.add(rail);

  // Barrel shroud
  const shroudGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.25, 8);
  const shroud = new THREE.Mesh(shroudGeo, gunMat);
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.02, -0.38);
  group.add(shroud);

  // Barrel (inner)
  const barrelGeo = new THREE.CylinderGeometry(0.012, 0.015, 0.3, 6);
  const barrel = new THREE.Mesh(barrelGeo, new THREE.MeshStandardMaterial({
    color: '#444455',
    roughness: 0.2,
    metalness: 0.9,
  }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.5);
  barrel.name = 'barrel';
  group.add(barrel);

  // Muzzle brake
  const muzzleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.06, 8);
  const muzzle = new THREE.Mesh(muzzleGeo, gunMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.02, -0.62);
  muzzle.name = 'muzzle';
  group.add(muzzle);

  // Grip
  const gripGeo = new THREE.BoxGeometry(0.05, 0.16, 0.07);
  const grip = new THREE.Mesh(gripGeo, new THREE.MeshStandardMaterial({
    color: '#2a2a38',
    roughness: 0.4,
    metalness: 0.3,
  }));
  grip.position.set(0, -0.12, 0.1);
  grip.rotation.x = 0.2;
  group.add(grip);

  // Magazine
  const magGeo = new THREE.BoxGeometry(0.05, 0.16, 0.05);
  const mag = new THREE.Mesh(magGeo, gunMat);
  mag.position.set(0, -0.18, 0.08);
  group.add(mag);

  // Accent stripe on body
  const stripeGeo = new THREE.BoxGeometry(0.095, 0.015, 0.12);
  const stripe = new THREE.Mesh(stripeGeo, accentMat);
  stripe.position.set(0, 0.04, 0.12);
  group.add(stripe);

  // Blue accent
  const blueAccentGeo = new THREE.BoxGeometry(0.095, 0.01, 0.08);
  const blueAccent = new THREE.Mesh(blueAccentGeo, blueMat);
  blueAccent.position.set(0, 0.02, -0.05);
  group.add(blueAccent);

  // Sight / scope
  const sightGeo = new THREE.BoxGeometry(0.05, 0.04, 0.08);
  const sight = new THREE.Mesh(sightGeo, gunMat);
  sight.position.set(0, 0.12, 0.02);
  group.add(sight);

  const sightLensGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.01, 8);
  const sightLens = new THREE.Mesh(sightLensGeo, new THREE.MeshStandardMaterial({
    color: '#8888ff',
    roughness: 0.1,
    metalness: 0.3,
    emissive: '#8888ff',
    emissiveIntensity: 0.4,
  }));
  sightLens.rotation.x = Math.PI / 2;
  sightLens.position.set(0, 0.14, -0.01);
  group.add(sightLens);

  return group;
}

// ============================================
// SHOOTING SYSTEM
// ============================================
const raycaster = new THREE.Raycaster();
const shootCooldown = 0.12;
let shootTimer = 0;
let canShoot = true;

// ---- Recoil state ----
let recoilPitch = 0;      // 相机垂直后坐（弧度，正=上抬）
let recoilYaw = 0;        // 相机水平后坐（弧度，随机左右）
let weaponKick = 0;       // 武器视觉后坐脉冲 0~1
const recoilPerShot = 0.012;    // 单发垂直后坐量 (0.69°)
const recoilYawPerShot = 0.005; // 单发最大水平偏移
const recoilMaxPitch = 0.30;    // 垂直后坐上限 (~17°)
const recoilMaxYaw = 0.06;      // 水平偏移上限
const recoilRecover = 3.5;      // 后坐力衰减速率（越大回正越快）

function getGunWorldPosition() {
  if (!fpsWeapon) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return camera.position.clone().add(dir.multiplyScalar(0.6));
  }

  // Try to find a named muzzle child
  const muzzle = fpsWeapon.getObjectByName('muzzle');
  if (muzzle) {
    return new THREE.Vector3().setFromMatrixPosition(muzzle.matrixWorld);
  }

  // Fallback: offset forward from weapon center
  const worldPos = new THREE.Vector3().setFromMatrixPosition(fpsWeapon.matrixWorld);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(fpsWeapon.getWorldQuaternion(new THREE.Quaternion()));
  worldPos.add(forward.multiplyScalar(0.5));
  return worldPos;
}

function shoot() {
  if (!canShoot || state.reloading || state.currentAmmo <= 0) return;
  if (state.currentAmmo <= 0) return;

  canShoot = false;
  shootTimer = shootCooldown;
  state.currentAmmo--;

  // Apply recoil: vertical kick + random horizontal drift (accumulates when full-auto)
  recoilPitch = Math.min(recoilPitch + recoilPerShot, recoilMaxPitch);
  recoilYaw = Math.max(-recoilMaxYaw, Math.min(recoilMaxYaw,
    recoilYaw + (Math.random() - 0.5) * recoilYawPerShot * 2));
  weaponKick = 1;

  // Muzzle flash
  const gunPos = getGunWorldPosition();
  const shootDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  spawnMuzzleFlash(gunPos.clone().add(shootDir.clone().multiplyScalar(0.3)), shootDir);

  // Recoil crosshair animation
  crosshair.classList.add('recoil');
  setTimeout(() => crosshair.classList.remove('recoil'), 120);

  // Update ammo UI
  updateAmmoUI();

  // Raycast for monster hit（已死亡的野怪不再参与命中判定）
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const monsterMeshes = [];
  monsters.forEach(m => {
    if (m.userData.dying) return;
    m.traverse(c => { if (c.isMesh) monsterMeshes.push(c); });
  });

  const intersects = raycaster.intersectObjects(monsterMeshes, false);
  let hitMonster = null;
  if (intersects.length > 0) {
    for (const m of monsters) {
      if (m.getObjectById(intersects[0].object.id)) { hitMonster = m; break; }
    }
  }

  if (hitMonster) {
    const hitPoint = intersects[0].point;
    const isHeadshot = intersects[0].object.name === 'head';
    const wasKilled = damageMonster(hitMonster, isHeadshot);

    spawnParticles(hitPoint, isHeadshot ? '#ffd700' : '#ffaa00', isHeadshot ? 18 : 12);
    if (isHeadshot) playHeadshotSound(); else playHitSound();
    showHitMarker(isHeadshot);
    spawnBulletTrail(gunPos, hitPoint);

    // Flash the monster briefly white, then restore original colors
    // 已死亡（材质转透明）的野怪不再闪烁，否则会把它从淡出中"提亮"回来
    if (!wasKilled && !hitMonster.userData.dying) {
      hitMonster.traverse(c => { if (c.isMesh && c.material && c.material.color) c.material.color.set('#ffffff'); });
      const savedMonster = hitMonster;
      setTimeout(() => {
        if (savedMonster && !savedMonster.userData.dying) {
          savedMonster.traverse(c => {
            if (c.isMesh && c.userData && c.userData.originalColor) {
              c.material.color.copy(c.userData.originalColor);
            }
          });
        }
      }, 100);
    }
  } else {
    const missPoint = gunPos.clone().add(shootDir.clone().multiplyScalar(40));
    spawnBulletTrail(gunPos, missPoint);
  }

  playGunshot();
}

// ============================================
// RELOAD ANIMATION
// ============================================
/** 弹匣推入、弹药补满的进度点（0~1）。放在 0.55 是因为此时动画上刚好"咔哒"一声装到位 */
const RELOAD_MAG_IN_AT = 0.55;

/**
 * 换弹动作关键帧。
 * 每行 = [进度, 位移x(左右), 位移y(上下), 位移z(前后), 旋转x(枪口俯仰), 旋转y(左右摆), 旋转z(侧倾)]
 * 三段语义：0~0.22 收枪放下 → 0.22~0.55 拔插弹匣 → 0.55~1.0 上膛复位
 */
const RELOAD_KEYFRAMES = [
  [0.00,  0.00,  0.00, 0.00,  0.00,  0.00,  0.00],  // 待机基准
  [0.22, -0.04, -0.15, 0.05,  0.45,  0.00,  0.26],  // 收枪放下，枪口下压
  [0.40, -0.06, -0.13, 0.06,  0.40,  0.10,  0.34],  // 抽出空弹匣（略向外摆）
  [0.55, -0.02, -0.15, 0.05,  0.43, -0.08,  0.18],  // 推入新弹匣（反向摆回）
  [0.78,  0.00, -0.05, 0.02,  0.16,  0.02,  0.06],  // 拉枪机上膛
  [1.00,  0.00,  0.00, 0.00,  0.00,  0.00,  0.00],  // 复位回基准
];

/** 关键帧的列顺序（进度之后的 6 个通道），与 RELOAD_KEYFRAMES 每行一一对应 */
const RELOAD_POSE_AXES = ['x', 'y', 'z', 'rx', 'ry', 'rz'];

/**
 * 按当前换弹进度在关键帧之间求姿态偏移，用 Catmull-Rom 样条插值。
 *
 * 为什么不用「逐段 easeOutCubic」：那样每一段起止速度都归零，跨关键帧时速度突变，
 * 60fps 下单帧姿态能跳近 8°，肉眼看就是一顿一顿的抽动。
 * Catmull-Rom 一阶连续，整段动作连得上，且天然经过每个关键帧。
 */
function getReloadPose(progress) {
  const p = Math.min(Math.max(progress, 0), 1);
  const K = RELOAD_KEYFRAMES;

  // 定位当前落在哪一段
  let i = K.length - 2;
  for (let s = 0; s < K.length - 1; s++) {
    if (p <= K[s + 1][0]) { i = s; break; }
  }

  const a  = K[i];
  const b  = K[i + 1];
  const p0 = K[Math.max(i - 1, 0)];                  // 端点处复制自身，保证首尾严格归零
  const p3 = K[Math.min(i + 2, K.length - 1)];

  const span = b[0] - a[0];
  const t  = span > 0 ? (p - a[0]) / span : 0;
  const t2 = t * t;
  const t3 = t2 * t;

  const pose = {};
  for (let c = 0; c < RELOAD_POSE_AXES.length; c++) {
    const col = c + 1;
    const v0 = p0[col], v1 = a[col], v2 = b[col], v3 = p3[col];
    pose[RELOAD_POSE_AXES[c]] = 0.5 * (
      2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3
    );
  }
  return pose;
}

/** 同步换弹 HUD：进度条用 transform 驱动（不触发布局重排），并显隐「换弹中」提示 */
function updateReloadUI(progress) {
  const active = state.reloading;
  reloadHint.classList.toggle('hidden', !active);
  if (!reloadProgress) return;

  if (active) {
    reloadProgress.style.transform = 'scaleX(' + progress + ')';
    reloadProgress.style.opacity = '1';
  } else {
    // 结束时保留满格再淡出：若同时把 scaleX 归零，观感上像「进度倒回去了」
    reloadProgress.style.opacity = '0';
  }
}

/**
 * 开始换弹。触发条件（三条同时满足才生效）：
 *   ① 对局进行中 —— paused / ended 状态下不接受换弹请求
 *   ② 弹匣未满 —— 满弹时换弹无意义
 *   ③ 当前不在换弹流程中 —— 防止连按 R / 空弹连发时重复触发
 */
function reload() {
  if (state.status !== 'playing') return;
  if (state.reloading) return;
  if (state.currentAmmo >= state.maxAmmo) return;

  state.reloading = true;
  state.reloadTimer = state.reloadDuration;
  state.ammoRefilled = false;

  playMagOutSound();
  updateReloadUI(0);
}

/**
 * 中断换弹并复位状态，用于对局结束 / 重开。
 * 不调用的话武器会永久停在「收枪」姿态，且换弹计时器残留到下一局。
 * 已补满的弹药不回退 —— 弹匣既然已经装进去了，就该算数。
 */
function cancelReload() {
  if (!state.reloading) return;
  state.reloading = false;
  state.reloadTimer = 0;
  state.ammoRefilled = false;
  updateReloadUI(0);
}

/**
 * 推进换弹流程。
 * 关键点：弹药不是在换弹计时结束时才补满，而是在「弹匣推入」那一帧补满，
 * 让 HUD 数值跳变与玩家看到的动作对得上（这也是"动作衔接"的核心）。
 */
function updateReload(dt) {
  if (!state.reloading) return;

  state.reloadTimer -= dt;
  const progress = 1 - Math.max(state.reloadTimer, 0) / state.reloadDuration;

  // 弹匣推入：补满弹药 + 播「咔哒」音效，与动画同帧
  if (!state.ammoRefilled && progress >= RELOAD_MAG_IN_AT) {
    state.ammoRefilled = true;
    state.currentAmmo = state.maxAmmo;
    updateAmmoUI();
    playMagInSound();
  }

  // 上膛完成，退出换弹流程
  if (state.reloadTimer <= 0) {
    state.reloading = false;
    state.reloadTimer = 0;
    state.ammoRefilled = false;
    playBoltSound();
    updateReloadUI(0);
    return;
  }

  updateReloadUI(progress);
}

/** 后坐力指数衰减：松开扳机后视角/枪口平滑回正 */
function updateRecoil(dt) {
  const decay = Math.exp(-recoilRecover * dt);
  recoilPitch *= decay;
  recoilYaw *= decay;
  weaponKick *= decay;

  // 防止数值残渣累积
  if (Math.abs(recoilPitch) < 0.0001) recoilPitch = 0;
  if (Math.abs(recoilYaw) < 0.0001) recoilYaw = 0;
  if (weaponKick < 0.001) weaponKick = 0;
}

// ============================================
// TARGET UPDATE
// ============================================
function updateMonsters(dt) {
  // 倒序遍历：死亡动画播完会把自身从 monsters 里移除
  for (let i = monsters.length - 1; i >= 0; i--) {
    const monster = monsters[i];
    const ud = monster.userData;

    // 已死亡的野怪交给死亡动画，不再跑追逐 AI
    if (ud.dying) {
      updateDeathAnimation(monster, dt);
      continue;
    }

    const dist = monster.position.distanceTo(playerPosition);

    const wasAlert = ud.alert;
    ud.alert = dist <= ud.alertZone;

    if (ud.alert) {
      // 面朝玩家
      monster.lookAt(playerPosition.x, monster.position.y, playerPosition.z);

      // 攻击状态机（红近战 / 蓝远程）。攻击都要求视线通畅（isPathClear），
      // 隔着掩体时野怪只会继续绕行，不会攻击
      if (ud.type === 'red') updateMeleeAttack(monster, ud, dist, dt);
      else updateRangedAttack(monster, ud, dist, dt);

      // 追逐（匀速，保持距离）。碰撞与正面绕行都在 stepMonsterChase 内部。
      // 门控用 shouldChase（距离 + 视线），不是纯距离 —— 理由见该函数的注释。
      // 红怪挥击期间（windup/strike）锁移动，前冲由状态机自己驱动
      const meleeLocked = ud.type === 'red' && ud.attackState !== 'idle';
      if (!meleeLocked && shouldChase(dist, ud.stopDist, monster.position, playerPosition.x, playerPosition.z)) {
        stepMonsterChase(monster.position, ud, playerPosition.x, playerPosition.z, ud.chaseSpeed, dt);
      }
    } else if (wasAlert) {
      // 刚刚脱离警惕——停在当前位置，并复位攻击姿态（不能带着半截挥击/投掷动作站着）
      if (ud.type === 'red') {
        ud.attackState = 'idle';
        ud.attackT = 0;
        resetMeleePose(ud);
      } else {
        ud.castState = 'idle';
        ud.castT = 0;
        resetCastPose(ud);
      }
    }

    // 宝石旋转动画
    if (ud.gem) {
      ud.gem.rotation.y += dt * 2;
    }
  }

  // 血条扣血缓动（只重绘 animating 的血条，静止零开销）
  updateHealthBarAnimations(dt);
}

// ============================================
// MONSTER ATTACK
// ============================================
// --- 红怪近战（高难度）---
const RED_MELEE_DAMAGE = 25;
const RED_MELEE_COOLDOWN = 1.0;    // 两次挥击间隔（秒）
const RED_MELEE_RANGE = 2.6;       // 进入攻击的距离门限（> stopDist 1.8，含前冲余量）
const RED_MELEE_HIT_RANGE = 3.0;   // 挥击瞬间的判伤距离（含前冲位移）
const RED_MELEE_WINDUP = 0.35;     // 抬臂前摇（给玩家反应窗口）
const RED_MELEE_STRIKE = 0.15;     // 挥击 + 前冲时长
const RED_MELEE_LUNGE_SPEED = 6;   // 前冲速度（0.15s × 6 = 0.9m）
const RED_MELEE_ARM_LIFT = -1.2;   // 前摇结束时右臂 rotation.x（rad）
const RED_MELEE_LEAN = 0.1;        // 前摇时身体前倾（rad）
// --- 蓝怪远程（低伤害）---
const BLUE_CAST_DAMAGE = 10;
const BLUE_CAST_COOLDOWN = 1.5;
const BLUE_CAST_RANGE = 8;         // 追击途中开火的最大距离
const BLUE_CAST_TIME = 0.4;        // 吟唱（后仰蓄力 + 宝石亮起预警）
const BLUE_CAST_RECOIL = 0.15;     // 发射后的前倾投掷姿态时长，随后复位
const BLUE_CAST_LEAN_BACK = -0.15; // 吟唱后仰（rad）
const BLUE_CAST_ARM_LIFT = -1.4;   // 吟唱双臂抬起（rad）
const BLUE_CAST_LEAN_FWD = 0.12;   // recoil 前倾（rad）
const BLUE_CAST_ARM_PUSH = 0.6;    // recoil 双臂前推（rad）
const BLUE_GEM_GLOW = 5;           // 吟唱时宝石 emissiveIntensity（平时 2.5）
// --- 弹丸与玩家受击 ---
const BLUE_PROJ_SPEED = 9;         // 8m 飞行 ≈0.9s，走速 4.2 可躲
const BLUE_PROJ_RADIUS = 0.35;     // 弹丸命中半径
const BLUE_PROJ_LIFE = 4;          // 寿命上限防泄漏
const PLAYER_HEIGHT = 1.8;         // 玩家身高（弹丸高度判定用）
const HURT_SHAKE_AMP = 0.06;       // 相机抖动幅度（米）
const HURT_SHAKE_TIME = 0.25;      // 抖动衰减时长
const HURT_FLASH_PULSE = 0.6;      // 受击红闪脉冲不透明度
const HURT_FLASH_LOW_BASE = 0.35;  // 低血（<40%）红闪持续底值上限

/** 复位红怪近战姿态（身体与右臂归零） */
function resetMeleePose(ud) {
  if (ud.bodyPivot) ud.bodyPivot.rotation.x = 0;
  if (ud.armR) ud.armR.rotation.x = 0;
}

/**
 * 红怪近战状态机：idle → windup（抬臂预警）→ strike（前冲 + 判伤）→ idle。
 * windup/strike 期间锁移动（由 updateMonsters 的 meleeLocked 保证），
 * 前冲仍跑碰撞解算（含肩圆），不会穿墙追人。
 */
function updateMeleeAttack(monster, ud, dist, dt) {
  ud.attackCooldown -= dt;
  ud.attackT += dt;

  if (ud.attackState === 'idle') {
    if (dist <= RED_MELEE_RANGE && ud.attackCooldown <= 0 &&
        isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
      ud.attackState = 'windup';
      ud.attackT = 0;
    }
    return;
  }

  if (ud.attackState === 'windup') {
    // 抬臂 + 前倾：线性插值，给玩家反应窗口
    const t = Math.min(ud.attackT / RED_MELEE_WINDUP, 1);
    if (ud.armR) ud.armR.rotation.x = RED_MELEE_ARM_LIFT * t;
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = RED_MELEE_LEAN * t;
    if (ud.attackT >= RED_MELEE_WINDUP) {
      ud.attackState = 'strike';
      ud.attackT = 0;
      ud.meleeHitDone = false;
      playSwingSound();
    }
    return;
  }

  // strike：朝玩家前冲，第一帧判伤（之后前冲不再重复判）
  const dirX = playerPosition.x - monster.position.x;
  const dirZ = playerPosition.z - monster.position.z;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-6) {
    const nx = dirX / len, nz = dirZ / len;
    monster.position.x += nx * RED_MELEE_LUNGE_SPEED * dt;
    monster.position.z += nz * RED_MELEE_LUNGE_SPEED * dt;
    resolveObstacleCollisions(monster.position, MONSTER_RADIUS);
    resolveShoulderCollisions(monster.position, nx, nz);
  }

  if (!ud.meleeHitDone) {
    ud.meleeHitDone = true;
    if (dist <= RED_MELEE_HIT_RANGE &&
        isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
      damagePlayer(RED_MELEE_DAMAGE);
    }
  }

  if (ud.attackT >= RED_MELEE_STRIKE) {
    ud.attackState = 'idle';
    ud.attackT = 0;
    ud.attackCooldown = RED_MELEE_COOLDOWN;
    resetMeleePose(ud);
  }
}

/** 复位蓝怪施法姿态（身体、双臂、宝石发光） */
function resetCastPose(ud) {
  if (ud.bodyPivot) ud.bodyPivot.rotation.x = 0;
  if (ud.armL) ud.armL.rotation.x = 0;
  if (ud.armR) ud.armR.rotation.x = 0;
  if (ud.gem) ud.gem.material.emissiveIntensity = 2.5;
}

/**
 * 蓝怪远程状态机：idle → casting（后仰蓄力 + 双臂抬起 + 宝石渐亮预警）
 * → recoil（前倾投掷）→ idle。三个状态下移动都不中断（边追边丢）。
 */
function updateRangedAttack(monster, ud, dist, dt) {
  ud.castCooldown -= dt;
  ud.castT += dt;

  if (ud.castState === 'idle') {
    if (dist <= BLUE_CAST_RANGE && ud.castCooldown <= 0 &&
        isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
      ud.castState = 'casting';
      ud.castT = 0;
    }
    return;
  }

  if (ud.castState === 'casting') {
    const t = Math.min(ud.castT / BLUE_CAST_TIME, 1);
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = BLUE_CAST_LEAN_BACK * t;
    if (ud.armL) ud.armL.rotation.x = BLUE_CAST_ARM_LIFT * t;
    if (ud.armR) ud.armR.rotation.x = BLUE_CAST_ARM_LIFT * t;
    if (ud.gem) ud.gem.material.emissiveIntensity = 2.5 + (BLUE_GEM_GLOW - 2.5) * t;
    if (ud.castT >= BLUE_CAST_TIME) {
      spawnMonsterProjectile(monster);
      ud.castState = 'recoil';
      ud.castT = 0;
      // 前倾投掷姿态瞬间切换（不插值，突出释放感）
      if (ud.bodyPivot) ud.bodyPivot.rotation.x = BLUE_CAST_LEAN_FWD;
      if (ud.armL) ud.armL.rotation.x = BLUE_CAST_ARM_PUSH;
      if (ud.armR) ud.armR.rotation.x = BLUE_CAST_ARM_PUSH;
    }
    return;
  }

  // recoil：保持前倾姿态，时长到后复位
  if (ud.castT >= BLUE_CAST_RECOIL) {
    ud.castState = 'idle';
    ud.castT = 0;
    ud.castCooldown = BLUE_CAST_COOLDOWN;
    resetCastPose(ud);
  }
}

// ============================================
// UI HELPERS
// ============================================
function updateUI() {
  // Update monster count (separate elements)
  // 存活数：已判定死亡（正在播死亡动画）的野怪不再计入
  state.redAlive = monsters.filter(m => m.userData.type === 'red' && !m.userData.dying).length;
  state.blueAlive = monsters.filter(m => m.userData.type === 'blue' && !m.userData.dying).length;

  const redEl = document.getElementById('monster-count-red');
  const blueEl = document.getElementById('monster-count-blue');
  if (redEl) redEl.textContent = state.redAlive;
  if (blueEl) blueEl.textContent = state.blueAlive;

  // Alert indicator
  const alertEl = document.getElementById('alert-indicator');
  if (alertEl) {
    const anyAlert = monsters.some(m => m.userData.alert && !m.userData.dying);
    alertEl.classList.toggle('hidden', !anyAlert);
  }
}

function updateAmmoUI() {
  ammoCurrentEl.textContent = state.currentAmmo;
  if (state.currentAmmo <= 5) {
    ammoCurrentEl.classList.add('low');
  } else {
    ammoCurrentEl.classList.remove('low');
  }
}

function showHitMarker(isHeadshot) {
  hitMarker.classList.remove('hidden', 'show', 'headshot');
  void hitMarker.offsetWidth;
  if (isHeadshot) {
    hitMarker.classList.add('show', 'headshot');
  } else {
    hitMarker.classList.add('show');
  }
  setTimeout(() => {
    hitMarker.classList.remove('show', 'headshot');
    hitMarker.classList.add('hidden');
  }, 400);
}

// ============================================
// PLAYER HEALTH
// ============================================
// 玩家血量与受击反馈。无无敌帧、无回血（高难度定位）；血量归零 → 本局结束（endGame('death')）。
let shakeT = 0;          // 受击相机抖动剩余时长（updateCamera 消费，update 递减）
let hurtFlashOpacity = 0; // 红闪当前不透明度（脉冲 + 低血底值，update 里衰减）

function updateHealthUI() {
  if (healthCurrentEl) healthCurrentEl.textContent = Math.ceil(state.playerHealth);
  if (healthFillEl) healthFillEl.style.width = (state.playerHealth / PLAYER_MAX_HEALTH * 100) + '%';
  const low = state.playerHealth <= PLAYER_MAX_HEALTH * 0.3;
  if (healthCurrentEl) healthCurrentEl.classList.toggle('low', low);
}

/** 受击红闪：一次脉冲 0.6；低血（<40%）时另叠加持续底值，衰减在 update(dt) 推进 */
function flashDamage() {
  hurtFlashOpacity = Math.max(hurtFlashOpacity, HURT_FLASH_PULSE);
}

/** 红闪每帧推进：脉冲衰减回低血底值（无低血则衰减到 0） */
function updateDamageFlash(dt) {
  if (!damageFlashEl) return;
  const hpRatio = state.playerHealth / PLAYER_MAX_HEALTH;
  const base = hpRatio < 0.4 ? (1 - hpRatio) * HURT_FLASH_LOW_BASE : 0;
  if (hurtFlashOpacity > base) {
    hurtFlashOpacity = Math.max(base, hurtFlashOpacity - dt * 2.4);
  }
  damageFlashEl.style.opacity = hurtFlashOpacity;
  damageFlashEl.classList.toggle('hidden', hurtFlashOpacity <= 0.001);
}

function startCameraShake() {
  shakeT = HURT_SHAKE_TIME;
}

/**
 * 对玩家造成伤害（红怪近战 / 蓝怪魔法弹共用入口）。
 * 触发受击反馈三件套：红闪 + 闷响 + 相机抖动；血量归零 → 本局结束。
 */
function damagePlayer(amount) {
  if (state.status !== 'playing') return;
  state.playerHealth = Math.max(0, state.playerHealth - amount);
  updateHealthUI();
  flashDamage();
  playHurtSound();
  startCameraShake();
  if (state.playerHealth <= 0) {
    endGame('death');
  }
}

// ============================================
// GAME STATE MANAGEMENT
// ============================================
function startGame() {
  initAudio();

  state.status = 'playing';
  state.timeLeft = 120;
  state.currentAmmo = state.maxAmmo;
  state.reloading = false;
  state.reloadTimer = 0;
  state.ammoRefilled = false;
  state.redAlive = 0;
  state.blueAlive = 0;
  state.playerHealth = PLAYER_MAX_HEALTH;
  shootTimer = 0;
  canShoot = true;
  recoilPitch = 0;
  recoilYaw = 0;
  weaponKick = 0;
  // 受击反馈复位：否则重开局会带着上一局的抖动/红闪残渣
  shakeT = 0;
  hurtFlashOpacity = 0;
  if (damageFlashEl) {
    damageFlashEl.style.opacity = 0;
    damageFlashEl.classList.add('hidden');
  }

  playerPosition.set(0, 0, 2);
  cameraAngleH = 0;
  cameraAngleV = 0;
  weaponBobPhase = 0;
  // 移动/摆动状态必须复位，否则重开局会带着上一局的相位与混合量：
  // 表现为「开局第一帧相机偏在某个摆幅上」+「开局立刻响一声脚步」
  resetLocomotionState();
  // 输入瞬态也要复位：否则「按住扳机时结束对局」再重开，会开局即自动开火，
  // 并在新的速度模型下被永久压在开枪档（2.4）
  input.shootPressed = false;
  input.reloadPressed = false;
  // Reset weapon to base position
  if (fpsWeapon && fpsWeapon.userData.basePosition) {
    fpsWeapon.position.copy(fpsWeapon.userData.basePosition);
    fpsWeapon.rotation.copy(fpsWeapon.userData.baseRotation);
  }
  verticalVelocity = 0;
  isGrounded = true;

  // Clear old monsters and spawn new ones
  monsters.forEach(m => { scene.remove(m); });
  // 清掉上一局残留的魔法弹（否则重开局瞬间会被飞了一半的弹打中）
  monsterProjectiles.forEach(p => disposeProjectile(p));
  monsterProjectiles.length = 0;
  spawnMonsters(6 + Math.floor(Math.random() * 3)); // 6~8

  // Update UI
  updateUI();
  updateAmmoUI();
  updateHealthUI();

  // Show HUD, hide start screen
  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  hud.classList.remove('hidden');

  if (state.isMobile) {
    mobileCtrl.classList.remove('hidden');
  } else {
    mobileCtrl.classList.add('hidden');
    // 同步请求指针锁定：本函数由 click 事件直接调用，此刻用户激活仍有效。
    // 之前用 setTimeout(...,100) 会丢失 transient activation，导致锁定失败、无法转视角。
    requestPointerLock();
  }

  updateReloadUI(0);
}

function pauseGame() {
  if (state.status !== 'playing') return;
  state.status = 'paused';
  pausedInd.classList.remove('hidden');
  document.exitPointerLock();

  // 清掉按键与输入瞬态。暂停必然伴随指针锁定丢失（Esc / 切标签页），
  // 此时 keyup / mouseup 可能收不到 —— 不清的话恢复后会带着卡住的 Shift 持续疾跑、
  // 或者带着卡住的 W 持续行走。locomotion 的混合量会自行衰减回中性位。
  for (const k of Object.keys(keys)) keys[k] = false;
  input.shootPressed = false;
  input.reloadPressed = false;
  input.jumpPressed = false;
  input.mouseX = 0;
  input.mouseY = 0;
  input.touchLookX = 0;
  input.touchLookY = 0;
}

function resumeGame() {
  if (state.status !== 'paused') return;
  state.status = 'playing';
  pausedInd.classList.add('hidden');
  requestPointerLock();
}

function endGame(reason = 'time') {
  state.status = 'ended';
  state.isPointerLocked = false;
  document.exitPointerLock();

  // 换弹中途结束对局：必须复位，否则武器会停在下压姿态、计时器残留到下一局
  cancelReload();

  hud.classList.add('hidden');
  mobileCtrl.classList.add('hidden');
  pausedInd.classList.add('hidden');
  endScreen.classList.remove('hidden');

  playGameEndSound();

  // 死亡结算与正常结束区分：标题、评级不同
  const dead = reason === 'death';
  const titleEl = document.getElementById('end-title');
  if (titleEl) titleEl.textContent = dead ? '你已阵亡' : '训练结束';
  document.getElementById('end-score').textContent = dead ? '阵亡' : '训练完成';
  document.getElementById('end-kills').textContent    = '--';
  document.getElementById('end-headshots').textContent = '--';
  document.getElementById('end-accuracy').textContent  = '--';
  document.getElementById('end-combo').textContent     = '--';

  document.getElementById('grade-letter').textContent = dead ? 'F' : 'PvE';
}

function restartGame() {
  endScreen.classList.add('hidden');
  startGame();
}

// ============================================
// GAME LOOP
// ============================================
function update(dt) {
  // Cap delta time to avoid huge jumps
  const cappedDT = Math.min(dt, 0.1);

  if (state.status === 'playing') {
    // Shoot cooldown
    if (!canShoot) {
      shootTimer -= cappedDT;
      if (shootTimer <= 0) {
        canShoot = true;
      }
    }

    // Auto-shoot (hold to fire)
    if (input.shootPressed && canShoot && !state.reloading && state.currentAmmo > 0) {
      shoot();
    }

    // Reload：手动按 R（提前换弹用）
    if (input.reloadPressed) {
      input.reloadPressed = false;
      reload();
    }

    // 弹匣打空 → 自动换弹。被野怪追着打时还要腾出手按 R 是反人类设计
    if (state.currentAmmo <= 0 && !state.reloading) {
      reload();
    }

    // Update systems
    updateReload(cappedDT);
    updateMovement(cappedDT);
    updateRecoil(cappedDT);
    updateMonsters(cappedDT);
    updateParticles(cappedDT);
    updateBulletTrails(cappedDT);
    updateMonsterProjectiles(cappedDT);
    // 受击反馈衰减：抖动时长递减（updateCamera 消费），红闪向低血底值回落
    if (shakeT > 0) shakeT = Math.max(0, shakeT - cappedDT);
    updateDamageFlash(cappedDT);
    updateUI();
  }

  if (state.status === 'playing' || state.status === 'paused') {
    updateCamera();
    updateWeaponBob(cappedDT);
  }
}

function render() {
  renderer.render(scene, camera);
}

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  const dt = state.lastTime ? (timestamp - state.lastTime) / 1000 : 0.016;
  state.lastTime = timestamp;

  update(dt);
  render();
}

// ============================================
// RESIZE HANDLER
// ============================================
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ============================================
// VISIBILITY HANDLER
// ============================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.status === 'playing') {
    pauseGame();
  }
});

// ============================================
// PRE-LOAD AK-47 MODEL
// ============================================
const gltfLoader = new GLTFLoader();
let ak47Model = null;
let ak47RawSize = new THREE.Vector3(); // original model size before scaling

/**
 * 依次尝试多个枪模地址，返回第一个能成功解析且含网格的模型。
 * 保留为通用兜底机制：某个模型缺失或损坏时自动降级到下一个，而不是直接放弃。
 * 历史：ak47_2.glb 曾因下载中断而损坏（GLB 头声明 5068520 字节，实际只有 2056192 字节），
 * GLTFLoader 抛 "Invalid typed array length"；该残档已删除，当前枪模为 assets/ak47.glb。
 * 若日后重新下载完整高模，放回 assets/ 并在此数组前面加回路径即可。
 */
async function loadFirstAvailableModel(paths) {
  for (const p of paths) {
    try {
      const gltf = await gltfLoader.loadAsync(p);
      let meshCount = 0;
      gltf.scene.traverse(o => { if (o.isMesh) meshCount++; });
      if (meshCount === 0) throw new Error('模型不含任何网格数据');
      console.log('%c 枪模就绪 %c' + p + ' %c(meshes: ' + meshCount + ')',
        'color: #ffd700;', 'color: #00d4ff;', 'color: #14b866;');
      return gltf.scene;
    } catch (e) {
      console.warn('  枪模不可用 ' + p + ' — ' + e.message);
    }
  }
  return null;
}

try {
  ak47Model = await loadFirstAvailableModel(['assets/ak47.glb']);
  if (!ak47Model) throw new Error('所有枪模均不可用');

  // Compute bounding box
  const box = new THREE.Box3().setFromObject(ak47Model);
  box.getSize(ak47RawSize);
  console.log('%c AK-47 %c Raw bbox: W=%.3f H=%.3f L=%.3f',
    'color: #ffd700;', 'color: #ece8e1;',
    ak47RawSize.x, ak47RawSize.y, ak47RawSize.z);

  // Auto-scale to target visible length
  const targetLength = 0.6;
  const modelLength = Math.max(ak47RawSize.x, ak47RawSize.y, ak47RawSize.z);
  const autoScale = modelLength > 0.01 ? targetLength / modelLength : 1.0;
  ak47Model.scale.setScalar(autoScale);
  console.log('  Auto-scale: %.4f (%.3f → %.2f)', autoScale, modelLength, targetLength);

  // DON'T center here — do it per-instance in init()

  // Configure materials
  ak47Model.traverse((child) => {
    if (child.isMesh && child.material) {
      child.castShadow = true;
      child.renderOrder = 999;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => {
        if (m.roughness !== undefined) m.roughness = Math.min(m.roughness, 0.5);
        if (m.metalness !== undefined) m.metalness = Math.max(m.metalness, 0.4);
        if (m.emissive) m.emissive.set(m.color || new THREE.Color('#ffffff'));
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.2);
        m.needsUpdate = true;
      });
    }
  });

  console.log('%c AK-47 %c Ready (meshes: %d)',
    'color: #ffd700;', 'color: #00d4ff;', ak47Model.children.length);
} catch (err) {
  console.warn('AK-47 failed, fallback:', err.message);
}

// ============================================
// INITIALIZATION
// ============================================
function init() {
  // Detect mobile
  state.isMobile = isTouchDevice();

  // Create scene components
  createLighting();
  createEnvironment();

  // CRITICAL: camera must be in scene graph for children (weapon) to render
  scene.add(camera);

  // Create player model (hidden in first-person)
  playerGroup = createPlayer();
  playerGroup.position.copy(playerPosition);
  playerGroup.visible = false;
  scene.add(playerGroup);

  // Create first-person weapon (attached to camera)
  try {
    if (ak47Model) {
      fpsWeapon = ak47Model.clone(true);

      // Center geometry origin for clean FPS view positioning
      const wbox = new THREE.Box3().setFromObject(fpsWeapon);
      const wcenter = new THREE.Vector3();
      wbox.getCenter(wcenter);
      fpsWeapon.position.set(-wcenter.x, -wcenter.y, -wcenter.z);

      // Now position in camera space: bottom-right, pointing forward
      fpsWeapon.position.add(new THREE.Vector3(0.22, -0.2, -0.5));
      fpsWeapon.rotation.set(0, -0.08, 0);

      const wsz = new THREE.Vector3();
      wbox.getSize(wsz);
      console.log('%c FPS AK-47 %c center:(%.2f,%.2f,%.2f) size:(%.2f,%.2f,%.2f) %c✓',
        'color: #ffd700;', 'color: #ece8e1;',
        wcenter.x, wcenter.y, wcenter.z, wsz.x, wsz.y, wsz.z, 'color: #14b866;');
    } else {
      fpsWeapon = createFirstPersonWeapon();
      fpsWeapon.position.set(0.3, -0.22, -0.5);
      fpsWeapon.rotation.set(0, -0.25, 0);
      console.log('%c FPS Weapon %c Geometric fallback %c✓',
        'color: #00d4ff;', 'color: #ff4655;', 'color: #14b866;');
    }

    // DEBUG: bright red cube to verify camera-child rendering
    const debugGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const debugMat = new THREE.MeshBasicMaterial({ color: '#ff0000' });
    const debugCube = new THREE.Mesh(debugGeo, debugMat);
    debugCube.position.set(0, 0, -0.4);
    debugCube.name = '_debugCube';
    fpsWeapon.add(debugCube);
  } catch (e) {
    console.error('FPS weapon init ERROR:', e);
  }
  fpsWeapon.userData.basePosition = fpsWeapon.position.clone();
  fpsWeapon.userData.baseRotation = fpsWeapon.rotation.clone();
  camera.add(fpsWeapon);
  console.log('  Camera children:', camera.children.length);

  // Add weapon illumination light to camera
  const weaponLight = new THREE.PointLight('#ffffff', 1.5, 3);
  weaponLight.position.set(0.2, 0.3, 0);
  camera.add(weaponLight);

  // Create targets
  // Spawn initial monsters (6~8, mixed red/blue)
  spawnMonsters(7);

  // Button handlers
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('restart-btn').addEventListener('click', restartGame);

  // Keyboard start - allow spacebar or enter to start
  window.addEventListener('keydown', function startKeyHandler(e) {
    if (state.status === 'menu' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      startGame();
    }
    if (state.status === 'ended' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      restartGame();
    }
  });

  // Setup mobile controls
  if (state.isMobile) {
    setupMobileControls();
  }

  // Start render loop (renders menu background)
  state.lastTime = performance.now();
  requestAnimationFrame(gameLoop);

  console.log('%c VALORANT Training Range %c Ready ',
    'color: #ff4655; font-size: 18px; font-weight: bold;',
    'color: #00d4ff;');
  console.log('%c Click "进入训练" or press Enter to start',
    'color: #ece8e1;');
}

// ============================================
// 调试快照（仅供自动化验证读取）
// ============================================
/**
 * game.js 是 ES Module，内部变量在 CDP 的 Runtime.evaluate 里取不到。
 * 这里暴露一个只读快照，仿 index.html 启动守卫用 window.__GAME_BOOTED__ 的先例。
 * 不参与任何游戏逻辑，纯读取，无副作用。
 */
window.__SNAPSHOT__ = () => ({
  speed: locomotion.speed,
  firing: locomotion.firing,
  reloading: locomotion.reloading,
  moveBlend: locomotion.moveBlend,
  sprintBlend: locomotion.sprintBlend,
  stepRate: locomotion.stepRate,
  swayAmp: locomotion.swayAmp,
  swayPhase, breathPhase,
  camX: camera.position.x,
  camY: camera.position.y,
  playerX: playerPosition.x,
  playerY: playerPosition.y,
  playerZ: playerPosition.z,
  shootPressed: input.shootPressed,
  isGrounded,
  status: state.status,
  currentAmmo: state.currentAmmo,
  footstepLog: footstepLog.slice(),
  footstepCount,   // 单调递增，不受 FOOTSTEP_LOG_MAX 截断影响
  obstacleCount: solidObstacles.length,   // 已登记的实体障碍数（碰撞体与几何体同步）
  // 野怪位置与绕行状态，供自动化验证「不穿墙 / 不卡死」
  monsters: monsters.filter(m => !m.userData.dying).map(m => ({
    id: m.userData.id,
    x: m.position.x,
    z: m.position.z,
    alert: !!m.userData.alert,
    avoidSide: m.userData.avoidSide || 0,
  })),
});
// 让探针直接调真实实现，而不是复制一份到测试脚本里（避免测试与实现漂移）
window.__SNAPSHOT__.speedFor      = getTargetMoveSpeed;
window.__SNAPSHOT__.swayOffsetFor = getSwayOffset;
window.__SNAPSHOT__.stepsTriggered = stepsTriggered;
window.__SNAPSHOT__.stepRateFor   = getStepRate;
window.__SNAPSHOT__.pause         = pauseGame;
window.__SNAPSHOT__.resume        = resumeGame;
window.__SNAPSHOT__.restart       = restartGame;
window.__SNAPSHOT__.obstacles     = () => solidObstacles.map(o => ({...o}));

// Boot
init();
  x