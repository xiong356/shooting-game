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

  return sprite;
}

/**
 * 重绘血条。
 * 只在血量变化时调用，不进每帧循环——canvas 重绘 + 纹理上传比画个矩形贵得多。
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

  ctx.clearRect(0, 0, W, H);

  // 底槽
  ctx.fillStyle = 'rgba(8, 12, 18, 0.85)';
  ctx.fillRect(0, 0, W, H);

  // 血量条
  const pad = 3;
  ctx.fillStyle = flash ? '#ffffff' : sprite.userData.borderColor;
  ctx.fillRect(pad, pad, Math.round((W - pad * 2) * r), H - pad * 2);

  // 外框（受击时白色高亮）
  ctx.strokeStyle = flash ? '#ffffff' : sprite.userData.borderColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  sprite.userData.tex.needsUpdate = true;
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
  const armL = new THREE.Mesh(armGeo, palette.limbs); armL.position.set(-0.85, 0.85, 0); armL.castShadow = true; group.add(armL);
  const armR = new THREE.Mesh(armGeo, palette.limbs); armR.position.set( 0.85, 0.85, 0); armR.castShadow = true; group.add(armR);

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
  const armL = new THREE.Mesh(armGeo, palette.limbs); armL.position.set(-0.85, 0.85, 0); armL.castShadow = true; group.add(armL);
  const armR = new THREE.Mesh(armGeo, palette.limbs); armR.position.set( 0.85, 0.85, 0); armR.castShadow = true; group.add(armR);

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
      alertZone: 12,
      chaseSpeed: 2.5,
      stopDist: 1.8,
      originalPos: new THREE.Vector3(x, 0, z),
      originalRot: monster.rotation.y,
      health: monster.userData.maxHealth,
      dying: false,
    };

    // 血条画成满血
    drawHealthBar(monster.userData.healthBar, 1);

    // AlertZone 可视化圆环
    const ringGeo = new THREE.TorusGeometry(12, 0.15, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ff4444', transparent: true, opacity: 0.25, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.name = 'alertRing';
    monster.add(ring);

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

  drawHealthBar(ud.healthBar, ud.health / ud.maxHealth, true);
  setTimeout(() => {
    if (!ud.dying) drawHealthBar(ud.healthBar, ud.health / ud.maxHealth, false);   // 死亡时血条已隐藏
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

  if (ud.healthBar) ud.healthBar.visible = false;

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
  const entries = Object.entries(SFX_FILES);
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
canvas.addEventListener('mouseup', (e) => {
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

  joystickBase.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickId) {
        joystickId = null;
        input.joystickX = 0;
        input.joystickY = 0;
        joystickThumb.style.transform = 'translate(0px, 0px)';
      }
    }
  });

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

  document.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookId) {
        lookId = null;
        input.touchLookX = 0;
        input.touchLookY = 0;
      }
    }
  });

  // Shoot button
  shootBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.shootPressed = true;
  });
  shootBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    input.shootPressed = false;
  });

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
const moveSpeed = 6;
const jumpForce = 6;
let isGrounded = true;
let verticalVelocity = 0;

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
  let isMoving = false;
  if (state.isPointerLocked || state.isMobile) {
    if (state.isPointerLocked) {
      forward = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
      right   = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
    }
    if (state.isMobile) {
      forward = -input.joystickY;
      right   = input.joystickX;
    }
    isMoving = Math.abs(forward) > 0.1 || Math.abs(right) > 0.1;
  }

  // Forward/right relative to camera horizontal angle
  const forwardDir = new THREE.Vector3(-Math.sin(cameraAngleH), 0, -Math.cos(cameraAngleH));
  const rightDir   = new THREE.Vector3(Math.cos(cameraAngleH), 0, -Math.sin(cameraAngleH));

  const moveDir = new THREE.Vector3()
    .addScaledVector(forwardDir, forward)
    .addScaledVector(rightDir, right);

  if (moveDir.length() > 1) moveDir.normalize();

  // Apply movement
  playerPosition.x += moveDir.x * moveSpeed * dt;
  playerPosition.z += moveDir.z * moveSpeed * dt;

  // Clamp player to arena bounds (walls at X=±27, Z=-47, Z=13)
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

  // Weapon bob
  weaponBobPhase += (isMoving ? moveSpeed * dt : 0);
}

function updateCamera() {
  // First-person camera at eye level
  const eyeY = playerPosition.y + eyeHeight;
  camera.position.set(playerPosition.x, eyeY, playerPosition.z);

  // Set camera rotation from look angles + recoil offset (recoil decays back to 0)
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
    m.traverse(c => { if (c.isMesh && c.name !== 'alertRing') monsterMeshes.push(c); });
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

    // Toggle alert ring visibility
    const ring = monster.getObjectByName('alertRing');
    if (ring) ring.visible = true; // 调试期始终显示

    if (ud.alert) {
      // 面朝玩家
      monster.lookAt(playerPosition.x, monster.position.y, playerPosition.z);

      // 追逐（匀速，保持距离）
      if (dist > ud.stopDist) {
        const dir = new THREE.Vector3().subVectors(playerPosition, monster.position);
        dir.y = 0;
        dir.normalize();
        monster.position.add(dir.multiplyScalar(ud.chaseSpeed * dt));
      }
    } else if (wasAlert) {
      // 刚刚脱离警惕——停在当前位置
    }

    // 宝石旋转动画
    if (ud.gem) {
      ud.gem.rotation.y += dt * 2;
    }
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
  shootTimer = 0;
  canShoot = true;
  recoilPitch = 0;
  recoilYaw = 0;
  weaponKick = 0;

  playerPosition.set(0, 0, 2);
  cameraAngleH = 0;
  cameraAngleV = 0;
  weaponBobPhase = 0;
  // Reset weapon to base position
  if (fpsWeapon && fpsWeapon.userData.basePosition) {
    fpsWeapon.position.copy(fpsWeapon.userData.basePosition);
    fpsWeapon.rotation.copy(fpsWeapon.userData.baseRotation);
  }
  verticalVelocity = 0;
  isGrounded = true;

  // Clear old monsters and spawn new ones
  monsters.forEach(m => { scene.remove(m); });
  spawnMonsters(6 + Math.floor(Math.random() * 3)); // 6~8

  // Update UI
  updateUI();
  updateAmmoUI();

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
}

function resumeGame() {
  if (state.status !== 'paused') return;
  state.status = 'playing';
  pausedInd.classList.add('hidden');
  requestPointerLock();
}

function endGame() {
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

  document.getElementById('end-score').textContent = '训练完成';
  document.getElementById('end-kills').textContent    = '--';
  document.getElementById('end-headshots').textContent = '--';
  document.getElementById('end-accuracy').textContent  = '--';
  document.getElementById('end-combo').textContent     = '--';

  document.getElementById('grade-letter').textContent = 'PvE';
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

// Boot
init();
