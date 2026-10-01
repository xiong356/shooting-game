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
import { WEAPONS, falloffMultiplier } from './config/weapons.js';
import { LEVELS, HP_CALIB_MUL, LAYOUTS, CRAB_CONFIG, gradeFor, bossPhaseFor, bossSummonCategory, bossCanSummon, splitSpawns } from './config/levels.js';
import { createMonster, drawHealthBar, updateHealthBarAnimations, HEALTH_TRAIL_DELAY, BLUE_CAST_RANGE } from './monsters.js';
import { pushCalibSample, getCalibSamples, clearCalibSamples, calibSummary, applyLevelResult, readSave, getSave, getSaveMeta, onSaveMerged, unlockAll } from './save.js';

// 当前武器参数（M4②：由 const 升级为 let——语义 = 「当前手持武器的表项」，
// switchWeapon 切枪时整体换绑，全部 AK.* 消费点（伤害/射速/散布/后坐/换弹时长）
// 自动跟随，无需逐点改造。离线测试抽取源码时注入的 ak47 行为不变。）
let AK = WEAPONS.ak47;

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
// M1⑤ 选关 UI / 暂停放弃 / 存档角标
const levelSelectScreen = document.getElementById('level-select-screen');
const levelGrid         = document.getElementById('level-grid');
const saveBadge         = document.getElementById('save-badge');
// M5a Boss 血条（§9：主宰名牌 + 血条 + 70%/40% 阶段刻度线）
const bossBarEl  = document.getElementById('boss-bar');
const bossFillEl = document.getElementById('boss-health-fill');

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

// ---- 结算计分 ----
const SCORE_PER_HIT = 10;        // 命中一发
const SCORE_PER_HEADSHOT = 25;   // 爆头额外奖励
const SCORE_PER_KILL = 100;      // 击杀奖励

// ============================================
// GAME STATE
// ============================================
const state = {
  status: 'menu', // 'menu' | 'playing' | 'paused' | 'ended'
  currentLevelId: 1,   // 当前关（LEVELS[id-1]）；选关/继续游戏/重开时设定（M1③）
  levelStartTime: 0,   // 本局开始时刻（performance.now()，§6 评级时间门基准）
  currentLayout: 'default',   // 当前场地布局预设名（M2②，__SNAPSHOT__.layout 消费）
  maxAmmo: AK.magSize,
  currentAmmo: AK.magSize,
  reloading: false,
  reloadTimer: 0,
  reloadDuration: AK.reloadTime,
  ammoRefilled: false, // 本次换弹是否已补满弹药（补弹发生在插弹匣那一刻，不是换弹结束）
  weaponAmmo: { ak47: AK.magSize },   // 每把已拥有武器的当前弹匣（M4②：切枪分存，切回不重置）
  isPointerLocked: false,
  isMobile: false,
  lastTime: 0,
  redAlive: 0,
  blueAlive: 0,
  crabAlive: 0,   // 迅捷蟹存活数（M3③，HUD 第三计数）
  playerHealth: PLAYER_MAX_HEALTH,
  // 结算统计
  kills: 0,
  headshots: 0,      // 爆头命中次数
  shotsFired: 0,
  shotsHit: 0,
  combo: 0,          // 当前连续命中
  maxCombo: 0,
  score: 0,
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

/**
 * 射线 vs 实体障碍：返回沿射线方向最近命中的距离 t（米），无遮挡返回 Infinity。
 * 障碍是贴地长方体（y ∈ [0, height]），方向须为单位向量。slab 法逐轴求交集。
 * 起点在盒子内部时跳过该盒：贴墙时枪口/相机可能探进墙体 AABB，
 * 若按「命中」算会把整条视线误判成被挡。
 * 抽成纯函数供离线仿真验证（.workbuddy/tests/attack-test.js）。
 */
function rayHitObstacleDistance(ox, oy, oz, dx, dy, dz) {
  let best = Infinity;
  for (const o of solidObstacles) {
    const slabs = [
      [ox, o.minX, o.maxX, dx],
      [oy, 0, o.height, dy],
      [oz, o.minZ, o.maxZ, dz],
    ];
    let tmin = -Infinity, tmax = Infinity, miss = false;
    for (const [orig, lo, hi, d] of slabs) {
      if (Math.abs(d) < 1e-12) {
        if (orig < lo || orig > hi) { miss = true; break; }   // 平行且在该轴盒外 → 永不相交
        continue;
      }
      let t1 = (lo - orig) / d, t2 = (hi - orig) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { miss = true; break; }
    }
    if (miss) continue;
    if (tmin < 0) continue;                 // 起点在盒内，不算遮挡
    if (tmin < best) best = tmin;
  }
  return best;
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

  // 障碍物（隔断/柱）M2② 迁出：随关卡布局由 applyLayout 重建（§5.2 布局即数据），
  // 本函数只建跨布局不变的基础层（地面/平台/标记/边界墙，墙不入 solidObstacles）。

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

  return env;
}

// ============================================
// 场地布局（M2② §5.2 布局即数据：障碍组随关卡重建）
// ============================================

/** 纵/横隔断。dir 'v' = 沿 Z（现状），'h' = 沿 X。碰撞体随几何体一起登记（registerSolid）。 */
function createDivider(x, z, length = 12, dir = 'v') {
  const group = new THREE.Group();
  const geo = dir === 'h'
    ? new THREE.BoxGeometry(length, 1.8, 0.3)
    : new THREE.BoxGeometry(0.3, 1.8, length);
  if (dir === 'h') registerSolid(x, z, length, 0.3, 1.8);
  else registerSolid(x, z, 0.3, length, 1.8);
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
  const topGeo = dir === 'h'
    ? new THREE.BoxGeometry(length + 0.2, 0.06, 0.35)
    : new THREE.BoxGeometry(0.35, 0.06, length + 0.2);
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

/** 掩体柱（1.2×1.2 底、高 3） */
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

let obstacleGroup = null;
let currentLayoutName = null;

/**
 * 清场重建障碍组（§5.2 / §9 场地重建×碰撞风险行）。
 * 旧障碍组整体 remove + traverse dispose（removeMonster 同款释放范式），
 * solidObstacles 同步清空——不清就是「旧碰撞盒残留成隐形墙」，level-probe 有无残留回归用例。
 * 每次 startGame 都全量重建（§9 重开 = 配置重读；保证 solidObstacles ≡ 当前布局的不变量）。
 */
function applyLayout(name) {
  if (!LAYOUTS[name]) {
    console.warn('未知布局预设: ' + name + '，回退 default');
    name = 'default';
  }
  if (obstacleGroup) {
    scene.remove(obstacleGroup);
    obstacleGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      const mats = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
      mats.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    });
    obstacleGroup = null;
  }
  solidObstacles.length = 0;
  obstacleGroup = new THREE.Group();
  for (const o of LAYOUTS[name]) {
    if (o.type === 'divider') obstacleGroup.add(createDivider(o.x, o.z, o.len, o.dir));
    else if (o.type === 'pillar') obstacleGroup.add(createPillar(o.x, o.z));
  }
  scene.add(obstacleGroup);
  currentLayoutName = name;
  state.currentLayout = name;
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
// 单发伤害 / 爆头倍率已迁入 js/config/weapons.js（AK.damage / AK.headshotMult，§8.0）

// ---- 血条系统 / 怪种模型构建 / 怪种数值基座 ----
// M0.5③ 已整体迁入 js/monsters.js（§8.0 怪种工厂）。本文件经 import 使用：
// createMonster / drawHealthBar / updateHealthBarAnimations / HEALTH_TRAIL_DELAY / BLUE_CAST_RANGE。

// 菜单背景刷怪（观感用，与关卡/评级无关）：沿用 M0 时代「6~8 只红蓝各半」的观感
const MENU_COMPOSITION = [{ type: 'red', count: 4 }, { type: 'blue', count: 3 }];

// 怪物 id 序列（spawnMonsters 重置；Boss/召唤蟹/队列补位共用，__SNAPSHOT__ monsters.id 消费）
let monsterIdSeq = 0;

// 补位队列（§4.1 M5b）：开局超编的怪在此排队，每有 1 只死亡动画播完（removeMonster，
// 唯一移除点）出队 1 只补位。条目 {type, mul}；Boss 关 spawns 空 → 队列恒空（adds 自管）。
const spawnQueue = [];

/**
 * 野怪 userData 行为字段初始化契约（M5a 自 spawnMonsters 提取）。
 * 常规刷怪 / Boss 召唤蟹两条刷怪路径必须同构——状态机字段缺失会静默炸裂，
 * 故收拢为一个函数（数值基座 maxHealth/chaseSpeed 等由怪种工厂先写入，此处覆盖行为层）。
 */
function baseMonsterUserData(monster, id, x, z) {
  return {
    ...monster.userData,
    id,
    alert: false,
    alertZone: 24,
    originalPos: new THREE.Vector3(x, 0, z),
    originalRot: monster.rotation.y,
    health: monster.userData.maxHealth,
    dying: false,
    // 正面被挡住时选定的绕行侧（-1 左 / +1 右 / 0 未选）。
    // 必须保持到脱离障碍为止，否则每帧重新随机会让野怪左右抖动、原地打转。
    avoidSide: 0,
    // 绕行停滞计量（M2 修复「卡墙边缘」）：45 帧窗口的位移基准，见 stepMonsterChase
    avoidStall: 0,
    avoidMarkX: 0,
    avoidMarkZ: 0,
    // ---- 迅捷蟹字段（M3②；红/蓝怪闲置不用）----
    crabState: 'rush',
    crabT: 0,
    pounceCooldown: 0,
    crabHeading: Math.random() * Math.PI * 2,   // 初始朝向随机；蟹面向 heading 不 lookAt（转向钝可见）
    lungeX: 0,
    lungeZ: 0,
    // ---- 攻击状态机（红近战 / 蓝远程，见 MONSTER ATTACK 区块）----
    attackState: 'idle',   // 红怪：'idle' | 'windup' | 'strike'
    attackT: 0,
    attackCooldown: 0,
    meleeHitDone: false,
    castState: 'idle',     // 蓝怪：'idle' | 'casting' | 'recoil'
    castT: 0,
    castCooldown: 0,
  };
}

/**
 * 按组成表刷怪（避开玩家出生点）。composition 形如 [{type:'red',count:4}, …]；
 * mul 透传 createMonster（{hp,spd}；dmg 倍率在攻击结算侧 damagePlayer 消费，§5.1）。
 * 关卡倍率 × §2 全局血池校准 k（HP_CALIB_MUL）由 startGame 合成后传入。
 * maxAlive（§4.1 M5b）：同场上限——超编部分按组成表顺序进 FIFO 补位队列（splitSpawns），
 * 每有 1 只死亡动画播完出队补位；缺省 Infinity 不设限（菜单背景观感刷怪）。
 * 队列在此重置：startGame / abandonLevel / 回菜单都经本函数清场，无额外挂点。
 */
function spawnMonsters(composition, mul, maxAlive = Infinity) {
  monsters.length = 0;
  spawnQueue.length = 0;
  monsterIdSeq = 0;
  const split = splitSpawns(composition, maxAlive);
  const rng = (min, max) => Math.random() * (max - min) + min;

  const placeOne = (type) => {
    let x, z;
    do {
      x = rng(-24, 24);
      z = rng(-44, 10);
    } while (Math.sqrt(x * x + (z - 2) * (z - 2)) < 10); // 避开玩家出生点 (0,0,2)

    // M0.5③：模型/数值基座（maxHealth/chaseSpeed/stopDist）/俯仰支点由怪种工厂构建，
    // 默认倍率 1.0；M1③ 起关卡行经 lv.spawns × lv 倍率传入。
    const monster = createMonster(type, mul);
    monster.position.set(x, 0, z);

    // 随机初始朝向
    monster.rotation.y = Math.random() * Math.PI * 2;

    monster.userData = baseMonsterUserData(monster, monsterIdSeq++, x, z);

    // 血条画成满血
    drawHealthBar(monster.userData.healthBar, 1);

    scene.add(monster);
    monsters.push(monster);
  };

  for (const group of split.initial) {
    for (let n = 0; n < group.count; n++) placeOne(group.type);
  }
  // 超编 → 逐只入 FIFO 队列（保组成表顺序；mul 随条目携带，补位时同倍率生成）
  for (const group of split.queue) {
    for (let n = 0; n < group.count; n++) spawnQueue.push({ type: group.type, mul });
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
 * @param {number} [amount] 伤害值（M4③：由 shoot() 按当前武器/爆头/射程衰减算好后传入；
 *                          缺省 = 旧口径 AK.damage × 爆头倍率，兼容既有调用）
 */
function damageMonster(monster, isHeadshot, amount) {
  const ud = monster.userData;
  // dying：死亡动画中；invulnerable：Boss 入场/转场无敌（M5a §5.3——伤害输出无效，
  // 但子弹命中反馈（命中粒子/曳光）在 shoot 侧照常发生，与「转场期仅输出无效」口径一致）
  if (ud.dying || ud.invulnerable) return false;

  const dmg = amount !== undefined ? amount : AK.damage * (isHeadshot ? AK.headshotMult : 1);
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

// 击杀播报名字映射（M3③：蟹/精英加入，避免三元写死；M5a：Boss）
const MONSTER_NAMES = {
  red: '猩红石像',
  blue: '蔚蓝石像',
  crab: '迅捷蟹',
  eliteRed: '猩红石像·精英',
  eliteBlue: '蔚蓝石像·精英',
  boss: '主宰',
};

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

  addKillFeed(MONSTER_NAMES[ud.type] ?? '野怪', ud.type);
  playKillSound();
  if (ud.type === 'boss') {
    // Boss 死亡吼：主吼叫的更长更低变体（§5.3 死亡演出；与 0.9s→1.8s 的死亡动画对齐）
    playBossRoar({ duration: 2.0, lowFreq: 40, endFreq: 45 });
  }
  state.kills++;
  state.score += SCORE_PER_KILL;
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

/** 推进死亡动画：漂移 + 放大 + 淡出，三者同时进行。
 *  时长/放大倍率可被 ud.deathDuration/deathScaleTo 覆写（M5a：Boss 用更长更克制的演出，
 *  缺省 = 全怪通用的 DEATH_DURATION/DEATH_SCALE_TO）。 */
function updateDeathAnimation(monster, dt) {
  const ud = monster.userData;
  const duration = ud.deathDuration ?? DEATH_DURATION;
  const scaleTo = ud.deathScaleTo ?? DEATH_SCALE_TO;
  ud.deathT += dt;
  const t = Math.min(ud.deathT / duration, 1);

  // 位移与放大：easeOutCubic（起步快、收尾慢，像被击飞后减速）。
  // 乘 baseScale：精英基础体型 ×1.3（绝对 setScalar 会覆盖掉它，M3③）
  const e = 1 - Math.pow(1 - t, 3);
  monster.position.lerpVectors(ud.deathStartPos, ud.deathEndPos, e);
  monster.scale.setScalar((ud.baseScale ?? 1) * (1 + (scaleTo - 1) * e));

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
  // §4.1 补位（M5b）：死亡动画播完（本函数是怪物唯一移除点）才出队 1 只——
  // 濒死怪（dying）在动画期间仍占 monsters 名额但不触发补位（§9 风险行）
  if (spawnQueue.length > 0) {
    const entry = spawnQueue.shift();
    spawnReinforcementMonster(entry.type, entry.mul, 1.0, 15);
  }
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

/**
 * 红怪挥击破空声：高频噪声感的快速下滑音。
 * @param {number} [pitch=1] 音高倍率（M5a：Boss 大质量挥击传 0.45 降调；缺省不变，零风险）
 */
function playSwingSound(pitch = 1) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(900 * pitch, now);
  osc.frequency.exponentialRampToValueAtTime(220 * pitch, now + 0.12);
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

// ---- Boss 音效（M5a：合成先行 + 采样槽位预留）----
// 采样槽 'boss/roar' 已登记 SFX_FILES（暂缺文件 → playBossSfx 返回 false 回退合成，
// 与 M4 新枪同款链路）；wav 放进 assets/sfx/ 即自动顶替合成音，无需改代码。

/** Boss 采样槽：与 playWeaponSfx 同款「采样优先」链路，但不绑定 currentWeaponId。 */
function playBossSfx(slot) {
  const buffer = audioCtx ? sfxBuffers.get('boss/' + slot) : null;
  if (!buffer) return false;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.6;
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
  return true;
}

/**
 * Boss 吼叫（入场 + 每次破阶段；死亡吼走更长更低的参数变体）。
 * 两层合成：锯齿波滑音过低通（胸腔共鸣，playHurtSound 的放大版）
 * + 噪声带通（沙哑气声）。参数为设计值，⚗️ playtest 听感收口（§10 B 级）。
 */
function playBossRoar({ duration = BOSS_ROAR_DURATION, lowFreq = 55, endFreq = 70 } = {}) {
  if (playBossSfx('roar')) return;
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // 层 1：锯齿波 110→lowFreq→endFreq 滑音过低通 ~300Hz
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, now);
  osc.frequency.exponentialRampToValueAtTime(lowFreq, now + duration * 0.55);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;
  const g1 = audioCtx.createGain();
  g1.gain.setValueAtTime(0.0001, now);
  g1.gain.exponentialRampToValueAtTime(0.5, now + 0.06);
  g1.gain.exponentialRampToValueAtTime(0.35, now + duration * 0.6);
  g1.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(lp);
  lp.connect(g1);
  g1.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);

  // 层 2：噪声带通 ~150Hz（呼吸沙哑感）
  const noiseLen = Math.floor(audioCtx.sampleRate * duration);
  const noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-(i / noiseLen) * 3);
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 150;
  bp.Q.value = 0.8;
  const g2 = audioCtx.createGain();
  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(0.22, now + 0.08);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(bp);
  bp.connect(g2);
  g2.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + duration);
}

/** 召唤预警（P3 光柱期）：上行滑音——背后刷蟹看不见但要听得见（P2 预警多通道）。 */
function playSummonWarnSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.7);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.1, now + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.85);
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
// 曳光弹视觉：亮头沿弹道从枪口飞向落点，身后拖一条蓝白细长尾迹，到落点即停后淡出。
// 真实子弹 800 m/s 在 60fps 下单帧就飞完，肉眼不可读，故用「视觉速度」100 m/s
// （40m 脱靶 ≈0.4s 飞完，10m 命中 ≈0.1s）。命中粒子/伤害仍即时结算，光束纯装饰
// ——CS:GO 同款取舍：游戏反馈不能等弹道动画。
// 曳光参数已迁入武器表（AK.tracer，§8.0）；spawn 时快照进 userData，
// 使 update 阶段天然按「发射瞬间所用武器」的参数走（M4 多武器共存的前提）。
const bulletTrails = [];

function spawnBulletTrail(from, to) {
  const tr = AK.tracer;
  const direction = new THREE.Vector3().subVectors(to, from);
  const totalLen = direction.length();
  if (totalLen < 0.1) return;
  direction.normalize();

  // 圆柱轴心在头部（原点），尾部沿局部 -Y 延伸；顶点色 RGBA 沿高度做白→蓝→透明渐变
  const len = Math.min(tr.length, totalLen);
  const geo = new THREE.CylinderGeometry(tr.radius, tr.radius * 0.5, len, 8, 4, true);
  geo.translate(0, -len / 2, 0);
  const posAttr = geo.attributes.position;
  const colors = new Float32Array(posAttr.count * 4);
  for (let i = 0; i < posAttr.count; i++) {
    const t = -posAttr.getY(i) / len;   // 0=头 1=尾
    colors[i * 4]     = 1 - t * 0.6;    // r：白 → 蓝
    colors[i * 4 + 1] = 1 - t * 0.15;   // g：轻微衰减
    colors[i * 4 + 2] = 1;              // b：恒为蓝白基调
    colors[i * 4 + 3] = (1 - t) * (1 - t);   // alpha 二次衰减，尾端完全透明
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,   // 零构建无 bloom，additive 叠加模拟自发光
    depthWrite: false,
    side: THREE.DoubleSide,             // openEnded 圆管从内侧也可见，避免穿近处时消失
  });

  const trail = new THREE.Mesh(geo, mat);
  trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  trail.position.copy(from);
  trail.scale.y = 0.001;   // 首帧尾迹还没「拖出来」，下一帧起按头部行程拉伸

  trail.userData = {
    from: from.clone(),
    dir: direction,
    totalLen: totalLen,
    tailLen: len,
    headDist: 0,
    fadeT: -1,   // -1 = 飞行中；>=0 = 已到落点、淡出计时
    headSpeed: tr.speed,
    fadeDur: tr.fade
  };

  scene.add(trail);
  bulletTrails.push(trail);
}

function updateBulletTrails(dt) {
  for (let i = bulletTrails.length - 1; i >= 0; i--) {
    const t = bulletTrails[i];
    const ud = t.userData;
    if (ud.fadeT < 0) {
      // 飞行阶段：头部前移，尾迹长度 = min(头部行程, 尾迹长, 总行程)
      ud.headDist = Math.min(ud.headDist + ud.headSpeed * dt, ud.totalLen);
      t.position.copy(ud.from).addScaledVector(ud.dir, ud.headDist);
      t.scale.y = Math.max(0.001, Math.min(1, ud.headDist / ud.tailLen));
      if (ud.headDist >= ud.totalLen) ud.fadeT = 0;   // 到落点即停
    } else {
      ud.fadeT += dt;
      const k = 1 - ud.fadeT / ud.fadeDur;
      if (k <= 0) {
        scene.remove(t);
        t.geometry.dispose();
        t.material.dispose();
        bulletTrails.splice(i, 1);
      } else {
        t.material.opacity = k;
      }
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

/**
 * 从宝石位置朝玩家胸口发射一枚魔法弹（方向发射瞬间定格，直线飞行）。
 * @param {Object} [overrides] Boss 法球覆写（M5a）：{speed, radius, color, glow}；
 *                              缺省 = 蓝怪口径（BLUE_PROJ_*），精英蓝伤害走 ud.projDamage
 */
function spawnMonsterProjectile(monster, overrides = {}) {
  const ud = monster.userData;
  const speed = overrides.speed ?? BLUE_PROJ_SPEED;
  const radius = overrides.radius ?? BLUE_PROJ_RADIUS;
  const color = overrides.color ?? '#3399ff';
  const glow = overrides.glow ?? '#0066ff';
  const from = ud.gem.getWorldPosition(new THREE.Vector3());
  const to = new THREE.Vector3(playerPosition.x, playerPosition.y + 1.2, playerPosition.z);
  const dir = new THREE.Vector3().subVectors(to, from);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();

  const geo = new THREE.SphereGeometry(radius, 10, 8);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: glow,
    emissiveIntensity: 2.5,
    roughness: 0.2,
  });
  const proj = new THREE.Mesh(geo, mat);
  proj.position.copy(from);
  proj.userData = {
    velocity: dir.multiplyScalar(speed),
    life: BLUE_PROJ_LIFE,
    damage: ud.projDamage ?? BLUE_CAST_DAMAGE,   // per-type：精英蓝 ×1.5（M3③）
    radius,   // M5a：Boss 法球 0.45 > 蓝怪 0.35，命中判定按弹径逐弹读取
    color,
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
    // 弹径/弹色逐弹读取（M5a：Boss 法球 0.45 > 蓝怪 0.35）
    const radius = ud.radius ?? BLUE_PROJ_RADIUS;
    const color = ud.color ?? '#3399ff';

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
    if (projectileHitObstacle(p.position.x, p.position.y, p.position.z, radius)) {
      spawnParticles(p.position, color, 10);
      disposeProjectile(p);
      monsterProjectiles.splice(i, 1);
      continue;
    }

    // 命中玩家 → 扣血 + 爆粒子消失
    if (projectileHitPlayer(p.position.x, p.position.y, p.position.z, playerPosition.x, playerPosition.z, radius)) {
      damagePlayer(ud.damage);
      spawnParticles(p.position, color, 10);
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
// SPAWN TELEGRAPH（生成预警光柱，M5a）
// ============================================
// §4.1 P2 条款的视觉件：Boss 入场光柱与召唤蟹的落位预警共用。
// 半透明空心圆柱，淡入 → 呼吸脉动 → 收束消失；纯视觉，不参与碰撞/遮挡判定。
const telegraphs = [];

function spawnTelegraph(x, z, { radius = 1, height = 6, color = '#ffd700', duration = 1 } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 24, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, height / 2, z);
  scene.add(mesh);
  telegraphs.push({ mesh, t: 0, duration, maxOpacity: 0.45 });
}

function updateTelegraphs(dt) {
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const tg = telegraphs[i];
    tg.t += dt;
    const k = tg.t / tg.duration;
    if (k >= 1) {
      scene.remove(tg.mesh);
      tg.mesh.geometry.dispose();
      tg.mesh.material.dispose();
      telegraphs.splice(i, 1);
      continue;
    }
    // 淡入（前 20%）→ 呼吸脉动 → 收束（后 30% 渐灭）
    const fadeIn = Math.min(k / 0.2, 1);
    const fadeOut = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    tg.mesh.material.opacity = tg.maxOpacity * fadeIn * fadeOut * (0.75 + 0.25 * Math.sin(tg.t * 20));
  }
}

/** 清空全部预警光柱（startGame / abandonLevel 与怪物同级的清理）。 */
function clearTelegraphs() {
  for (const tg of telegraphs) {
    scene.remove(tg.mesh);
    tg.mesh.geometry.dispose();
    tg.mesh.material.dispose();
  }
  telegraphs.length = 0;
}

// ============================================
// REINFORCEMENT（§4.1 补位落位，M5b；Boss 召唤共用）
// ============================================

/**
 * 落位点选取（§4.1 退化梯子）：玩家 ≥minDist 的环形随机点 → 场内钳制（x∈[-24,24]
 * z∈[-44,10]）；12 次取不足 minDist×0.8 → 降级 minDist×2/3 再试 6 次 → 仍无解返回
 * 钳制后的最远候选。纯几何不查障碍——生成后由 resolveObstacleCollisions 兜底推出。
 * Boss 召唤（bossSummonWave）与队列补位（removeMonster）共用。
 */
function pickSpawnPointAway(minDist) {
  let best = null;
  let bestD = -1;
  const tryRing = (dist, attempts) => {
    for (let a = 0; a < attempts; a++) {
      const ang = Math.random() * Math.PI * 2;
      const x = Math.max(-24, Math.min(24, playerPosition.x + Math.sin(ang) * dist));
      const z = Math.max(-44, Math.min(10, playerPosition.z + Math.cos(ang) * dist));
      const d = Math.hypot(x - playerPosition.x, z - playerPosition.z);
      if (d > bestD) { bestD = d; best = { x, z }; }
      if (d >= minDist * 0.8) return true;
    }
    return false;
  };
  if (tryRing(minDist, 12)) return best;
  if (tryRing(minDist * 2 / 3, 6)) return best;   // 15m 无解 → 10m（§4.1 退化档）
  return best;                                     // 仍无解 → 场内最远候选
}

/**
 * 单只补位/召唤怪生成：落位 → 1s 光柱预警（spawnHold 期不可行动，§4.1 P2）→ 激活。
 * 统一永远播光柱——比 §4.1 原文「仅玩家背后 90° 视锥内才预警」口径更严：
 * 与 Boss 召唤蟹同款视觉语言、单一代码路径（偏差已记设计文档 §4.1 落地注记）。
 */
function spawnReinforcementMonster(type, mul, holdTime, minDist = 15) {
  const p = pickSpawnPointAway(minDist);
  const monster = createMonster(type, mul);
  monster.position.set(p.x, 0, p.z);
  monster.rotation.y = Math.random() * Math.PI * 2;
  monster.userData = baseMonsterUserData(monster, monsterIdSeq++, p.x, p.z);
  monster.userData.spawnHold = holdTime;
  resolveObstacleCollisions(monster.position, monster.userData.radius ?? 0.65);
  drawHealthBar(monster.userData.healthBar, 1);
  scene.add(monster);
  monsters.push(monster);
  spawnTelegraph(p.x, p.z, { radius: 1, height: 3, color: '#ffb347', duration: holdTime });
  return monster;
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
  // M4① 新枪射击音：采样文件暂缺 → playWeaponSfx 返回 false 自动回退合成音
  // （M5a 起新枪有专属合成实现；听感不达标进 §10 B 级信号：排期补采样或调合成参数）
  // M5b+ 换枪：内格夫射击采样暂缺 → 专属合成（synthNegevShot）；听感 §10 B 级观察
  'shotgun/shot': 'assets/sfx/shotgun-shot.wav',
  'negev/shot':   'assets/sfx/negev-shot.wav',
  // M5a Boss 吼叫采样槽（暂缺文件 → playBossSfx 回退 playBossRoar 合成）
  'boss/roar': 'assets/sfx/boss-roar.wav',
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
    shotVolume:  0.5,
    mechVolume:  0.55,
    pitchJitter: [0.96, 1.04],
  },
  // M4①/M5b+：射击采样暂缺回退专属合成音；换弹 magOut/magIn 复用现有采样。
  // bolt 槽缺省（内格夫换弹链走专属合成 synthNegevBoltSound；采样补齐后登记恢复映射）。
  shotgun: {
    shot:        'shotgun/shot',
    magOut:      'ak47/magOut',
    magIn:       'ak47/magIn',
    shotVolume:  0.6,
    mechVolume:  0.55,
    pitchJitter: [0.94, 1.02],
  },
  negev: {
    shot:        'negev/shot',
    magOut:      'ak47/magOut',
    magIn:       'ak47/magIn',
    shotVolume:  0.55,   // 12.5 发/s 连响，单发音量压低防爆音
    mechVolume:  0.55,
    pitchJitter: [0.95, 1.03],
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

/**
 * 枪声合成兜底分发（M5a：每枪专属合成，杜绝「新枪蹭 AK 声」）。
 * 采样优先已在 playWeaponSfx 内完成；此处只按武器挑合成实现。
 * esm-lint 规则④：WEAPONS 的每把枪都必须在本表有映射（照 sprayPattern 先例）。
 */
const WEAPON_SYNTH_SHOT = {
  ak47: synthGunshot,
  shotgun: synthShotgunShot,
  negev: synthNegevShot,
};

function playGunshot() {
  if (playWeaponSfx('shot')) return;
  (WEAPON_SYNTH_SHOT[currentWeaponId] || synthGunshot)();
}

/** AK-47（基线，M0 时代实现不动） */
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

/** 霰弹「裂空」射击（合成）：大口径轰鸣——宽噪声低通扫频 + 次低频 punch + 长尾 ~0.45s。 */
function synthShotgunShot() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // 宽噪声主体：低通 1400→180Hz 扫频，衰减比 AK 慢（0.45s 尾音 = 裂空的"宽"）
  const bufferSize = audioCtx.sampleRate * 0.45;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const t = i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 9) * 0.7;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, now);
  lp.frequency.exponentialRampToValueAtTime(180, now + 0.3);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.5, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  noise.connect(lp);
  lp.connect(g);
  g.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.45);

  // 次低频 punch：70→35Hz（比 AK 的 120→30 更沉更长，大口径的"顶胸口"感）
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(70, now);
  osc.frequency.exponentialRampToValueAtTime(35, now + 0.16);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.45, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  osc.connect(oscGain);
  oscGain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

/** 轻机枪「内格夫」射击（合成）：12.5 发/s 连响——短促中频弹壳声 + 轻低频，
 *  单次触发刻意做轻（高频复用，节点量与脚步同量级）。 */
function synthNegevShot() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // 短噪声主体：带通 600Hz（机枪弹壳"哒"声），0.07s 干脆收尾
  const bodyLen = audioCtx.sampleRate * 0.07;
  const bodyBuf = audioCtx.createBuffer(1, bodyLen, audioCtx.sampleRate);
  const bodyData = bodyBuf.getChannelData(0);
  for (let i = 0; i < bodyLen; i++) {
    const t = i / bodyLen;
    bodyData[i] = (Math.random() * 2 - 1) * Math.exp(-t * 26) * 0.5;
  }
  const body = audioCtx.createBufferSource();
  body.buffer = bodyBuf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 600;
  bp.Q.value = 0.9;
  const bg = audioCtx.createGain();
  bg.gain.setValueAtTime(0.3, now);
  bg.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  body.connect(bp);
  bp.connect(bg);
  bg.connect(audioCtx.destination);
  body.start(now);
  body.stop(now + 0.09);

  // 轻低频：100→60Hz 短促（连发时的"咚咚"底鼓，比 AK 的 120→30 浅）
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.06);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.22, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
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

/** 拉枪机上膛（换弹完成同帧触发）。合成兜底按武器分发（M5a：霰弹泵动/步枪栓动专属音色）。 */
function playBoltSound() {
  const w = WEAPON_SFX[currentWeaponId];
  if (playWeaponSfx('bolt', { volume: (w && w.mechVolume) || 0.55, pitchRange: null })) return;
  (WEAPON_SYNTH_BOLT[currentWeaponId] || synthBoltSound)();
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

// 机匣操作合成分发（M5a/M5b+）：ak47 = 基线 synthBoltSound；霰弹泵动 / 内格夫弹链见 WEAPON_SFX 槽位缺省注释
const WEAPON_SYNTH_BOLT = {
  ak47: synthBoltSound,
  shotgun: synthPumpSound,
  negev: synthNegevBoltSound,
};

/** 霰弹「裂空」泵动上膛（合成）：双段 clack——前后两行程噪声爆点，音色微差。 */
function synthPumpSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.12].forEach((delay, i) => {
    const at = now + delay;
    const segLen = audioCtx.sampleRate * 0.06;
    const segBuf = audioCtx.createBuffer(1, segLen, audioCtx.sampleRate);
    const segData = segBuf.getChannelData(0);
    for (let j = 0; j < segLen; j++) {
      segData[j] = (Math.random() * 2 - 1) * Math.exp(-(j / segLen) * 18);
    }
    const seg = audioCtx.createBufferSource();
    seg.buffer = segBuf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = i === 0 ? 900 : 700;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.18, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
    seg.connect(bp);
    bp.connect(g);
    g.connect(audioCtx.destination);
    seg.start(at);
    seg.stop(at + 0.08);
  });
}

/** 轻机枪「内格夫」换弹链（合成）：弹链箱拍合（低频闷响）+ 上膛双段，比栓动更钝更重。 */
function synthNegevBoltSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // 弹链箱拍合：低通噪声闷响
  const boxLen = audioCtx.sampleRate * 0.1;
  const boxBuf = audioCtx.createBuffer(1, boxLen, audioCtx.sampleRate);
  const boxData = boxBuf.getChannelData(0);
  for (let j = 0; j < boxLen; j++) {
    boxData[j] = (Math.random() * 2 - 1) * Math.exp(-(j / boxLen) * 14);
  }
  const box = audioCtx.createBufferSource();
  box.buffer = boxBuf;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const lg = audioCtx.createGain();
  lg.gain.setValueAtTime(0.2, now);
  lg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  box.connect(lp);
  lp.connect(lg);
  lg.connect(audioCtx.destination);
  box.start(now);
  box.stop(now + 0.12);

  // 上膛双段（比栓动低钝）
  [0.14, 0.24].forEach((delay, i) => {
    const at = now + delay;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(i === 0 ? 700 : 520, at);
    osc.frequency.exponentialRampToValueAtTime(i === 0 ? 380 : 300, at + 0.05);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.08, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + 0.08);
  });
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
  // M4② 数字键 1/2/3 切枪（§5.4 桌面键位）
  if (state.status === 'playing' && ['1', '2', '3'].includes(e.key)) {
    switchWeapon(WEAPON_SLOTS[Number(e.key) - 1]);
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

  // Weapon switch button (M4②)：循环下一把 owned 武器
  const weaponBtn = document.getElementById('mobile-weapon-btn');
  if (weaponBtn) {
    weaponBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (state.status === 'playing') cycleWeapon();
    });
  }
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
        // ⚠️ 「到达角点即冻结」防线（实机卡墙边缘 bug，组 9 C1 复现）：
        // 绕行会精确走到外扩角上；到达后 d=0 的自身角恰好是最近合法角
        // （中心线擦过扩展区外沿、肩圆仍被墙挡），选它 = 目标是自己 = 位移恒 0
        // → 永久冻结。距自身不足一个身位的角点视为「已到达」，改选次近角。
        if (d < MONSTER_RADIUS) continue;
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
      ud.avoidStall = 0;
      ud.avoidCornerX = undefined;
      ud.avoidCornerY = undefined;
    } else {
      // 角点承诺制：选定后走到「到达（d<身位，由 findDetourCorner 的近角跳过接管）或
      // 失效（角点→玩家被挡，玩家走位导致）」才重选。每帧贪心取「最近合法角」会在
      // 相邻角点间来回弹——离开角 0.67m 时身后的角又变成最近角，永远出不去（组 9 C1）。
      let corner = null;
      if (typeof ud.avoidCornerX === 'number' && typeof ud.avoidCornerY === 'number') {
        const dCorner = Math.hypot(ud.avoidCornerX - pos.x, ud.avoidCornerY - pos.z);
        if (dCorner >= MONSTER_RADIUS && isPathClear(ud.avoidCornerX, ud.avoidCornerY, playerX, playerZ)) {
          corner = { x: ud.avoidCornerX, z: ud.avoidCornerY };
        } else {
          ud.avoidCornerX = undefined;   // 已到达或已失效 → 本帧重选
        }
      }
      if (!corner) {
        corner = findDetourCorner(pos.x, pos.z, playerX, playerZ);
        if (corner) { ud.avoidCornerX = corner.x; ud.avoidCornerY = corner.z; }
      }
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
      // 停滞对策（兜底）：承诺制之外的残余停滞形态（如兜底侧移被墙抵消），
      // 45 帧（0.75s）位移不足期望步长 ×15% → 翻侧。状态全存 ud，纯函数可测。
      ud.avoidStall = (ud.avoidStall || 0) + 1;
      if (ud.avoidStall >= 45) {
        const markX = ud.avoidMarkX === undefined ? pos.x : ud.avoidMarkX;
        const markZ = ud.avoidMarkZ === undefined ? pos.z : ud.avoidMarkZ;
        if (Math.hypot(pos.x - markX, pos.z - markZ) < step * 45 * 0.15) {
          ud.avoidSide = -ud.avoidSide;
          ud.avoidCornerX = undefined;   // 翻侧后旧角点承诺作废
          ud.avoidCornerY = undefined;
        }
        ud.avoidStall = 0;
        ud.avoidMarkX = pos.x;
        ud.avoidMarkZ = pos.z;
      }
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
    if (!ud.avoidSide) {
      ud.avoidSide = Math.random() < 0.5 ? -1 : 1;
      // 停滞计量的基准点在进绕行时打标（上一段的残留标记会污染首个 45 帧窗口）
      ud.avoidStall = 0;
      ud.avoidMarkX = pos.x;
      ud.avoidMarkZ = pos.z;
    }
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
  // shakeT 由 update(dt) 递减，这里只消费。幅度/时长由 triggerShake 写入
  // （M5a 通用震屏 API：受击 0.06m/0.25s，Boss 吼叫等强震按参数覆盖）。
  let shakeX = 0, shakeY = 0;
  if (shakeT > 0) {
    const k = shakeT / shakeDur;
    shakeX = (Math.random() - 0.5) * 2 * shakeAmp * k;
    shakeY = (Math.random() - 0.5) * 2 * shakeAmp * k;
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
    fpsWeapon.rotation.y += (recoilYaw / AK.recoilMaxYaw) * weaponKick * 0.08; // 水平摆动
  }

  // 切枪动画（M4②）：V 形下沉-抬起的位移偏移（中点最深 0.2m），换绑由 updateWeaponSwitch 负责
  if (weaponSwitchT > 0) {
    const t = 1 - weaponSwitchT / WEAPON_SWITCH_TIME;   // 0→1
    fpsWeapon.position.y -= 0.2 * Math.sin(Math.PI * t);
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
/**
 * 霰弹枪「裂空」程序化低模（M4② §5.4：零外部素材）。
 * 双管 + 机匣 + 泵动护木 + 木托；muzzle 命名节点供 getGunWorldPosition/曳光起点。
 */
function createShotgunModel() {
  const group = new THREE.Group();
  group.name = 'fpsShotgun';

  const metal = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.35, metalness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.55, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#241d14', roughness: 0.6, metalness: 0.2 });

  // 双管（沿 -Z 前伸）
  const barrelGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.46, 8);
  const barrelL = new THREE.Mesh(barrelGeo, metal);
  barrelL.rotation.x = Math.PI / 2; barrelL.position.set(-0.026, 0.02, -0.26); group.add(barrelL);
  const barrelR = new THREE.Mesh(barrelGeo, metal);
  barrelR.rotation.x = Math.PI / 2; barrelR.position.set(0.026, 0.02, -0.26); group.add(barrelR);

  // 机匣
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.2), metal);
  receiver.position.set(0, 0, -0.04); group.add(receiver);

  // 泵动护木（射击时可做前后滑动动画的预留节点）
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.15), wood);
  pump.position.set(0, -0.02, -0.28); pump.name = 'pump'; group.add(pump);

  // 枪托
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.2), wood);
  stock.position.set(0, -0.035, 0.16); stock.rotation.x = 0.12; group.add(stock);

  // 握把
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.06), dark);
  grip.position.set(0, -0.07, 0.05); grip.rotation.x = -0.3; group.add(grip);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle'; muzzle.position.set(0, 0.02, -0.5); group.add(muzzle);

  return group;
}

/**
 * 轻机枪「内格夫」程序化低模（M5b+ 换枪）：机匣 + 长枪管 + 下挂弹链箱 + 两脚架 + 提把。
 */
function createNegevModel() {
  const group = new THREE.Group();
  group.name = 'fpsNegev';

  const metal = new THREE.MeshStandardMaterial({ color: '#323840', roughness: 0.35, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.5, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: '#ffb347', roughness: 0.3, emissive: '#ffb347', emissiveIntensity: 0.35 });

  // 长枪管（LMG 身份：比 AK 明显更长更粗）
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.4, 8), metal);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.32); group.add(barrel);

  // 枪口消焰器
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8), dark);
  brake.rotation.x = Math.PI / 2; brake.position.set(0, 0.02, -0.54); group.add(brake);

  // 机匣
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.26), metal);
  receiver.position.set(0, 0, -0.04); group.add(receiver);

  // 下挂弹链箱（内格夫辨识件）
  const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.13), dark);
  ammoBox.position.set(0, -0.12, -0.04); group.add(ammoBox);
  const ammoLid = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.015, 0.13), accent);
  ammoLid.position.set(0, -0.075, -0.04); group.add(ammoLid);

  // 提把
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.12), dark);
  handle.position.set(0, 0.09, -0.02); group.add(handle);
  const handleLegL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.02), dark);
  handleLegL.position.set(-0.008, 0.07, 0.03); group.add(handleLegL);
  const handleLegR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.02), dark);
  handleLegR.position.set(0.008, 0.07, 0.03); group.add(handleLegR);

  // 两脚架（折叠斜置于枪管下）
  const bipodGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6);
  const bipodL = new THREE.Mesh(bipodGeo, dark);
  bipodL.position.set(-0.02, -0.06, -0.38); bipodL.rotation.z = 0.35; bipodL.rotation.x = 0.2; group.add(bipodL);
  const bipodR = new THREE.Mesh(bipodGeo, dark);
  bipodR.position.set(0.02, -0.06, -0.38); bipodR.rotation.z = -0.35; bipodR.rotation.x = 0.2; group.add(bipodR);

  // 枪托
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2), dark);
  stock.position.set(0, -0.03, 0.16); group.add(stock);

  // 机械瞄具（准星片，无镜——LMG 不点名）
  const sightPost = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.008), accent);
  sightPost.position.set(0, 0.075, -0.2); group.add(sightPost);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle'; muzzle.position.set(0, 0.02, -0.58); group.add(muzzle);

  return group;
}

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
let shootTimer = 0;
let canShoot = true;

// ---- Recoil state ----
let recoilPitch = 0;      // 相机垂直后坐（弧度，正=上抬）
let recoilYaw = 0;        // 相机水平后坐（弧度，随机左右）
let weaponKick = 0;       // 武器视觉后坐脉冲 0~1
// 后坐强度参数已迁入武器表（AK.recoilPerShot / recoilYawPerShot / recoilMaxPitch / recoilMaxYaw，§8.0）
const recoilRecover = 3.5;      // 后坐力衰减速率（越大回正越快）——全局手感参数，不 per-weapon

// ---- Layer 1: 移动 inaccuracy（CS:GO 风格散布）----
// spreadPerSpeed / spreadAirMult 已迁入武器表（§8.0）
const SPREAD_RECOVER = 8;        // 急停回零衰减速率，约 0.3s 收敛——运动学参数，与武器无关
const SPREAD_CROSSHAIR_PX = 300; // 准星映射：总散布(rad) × 300 = 四线张开增量(px)——UI 映射，不 per-weapon
const SPREAD_CROSSHAIR_MAX = 60; // 准星最大张开量(px)，极端散布下也不糊住屏幕中心

/**
 * 纯函数：水平移速 + 是否滞空 → inaccuracy 角度（rad）。
 * 口径：AK.spreadPerSpeed × 2.4 = 0.15 rad → 10m 落点散布半径 ≈ 1.5m。
 * 保持无副作用，供离线测试从源码抽取直接求值（.workbuddy/tests/spread-test.js）。
 */
function getInaccuracyAngle(hSpeed, airborne) {
  let a = hSpeed * AK.spreadPerSpeed;
  if (airborne) a *= AK.spreadAirMult;
  return a;
}

let inaccuracy = 0;   // 当前散布角（rad），每帧追赶 getInaccuracyAngle 目标值

// ---- Layer 2: spray pattern ----
// 确定性水平后坐图案已迁入武器表 AK.sprayPattern（单位 = recoilYawPerShot），按连发序号取模循环。
// 首项 0 → 单发点射近似垂直上抬；后续正负交替形成可练习的固定弹道形状。
let sprayIndex = 0;   // 连发序号，后坐完全回正时复位

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
  shootTimer = AK.fireInterval;
  state.currentAmmo--;
  state.shotsFired++;

  // Apply recoil: vertical kick + pattern-driven horizontal (spray pattern, deterministic)
  recoilPitch = Math.min(recoilPitch + AK.recoilPerShot, AK.recoilMaxPitch);
  // M4③：sprayPattern 允许为空数组（霰弹）——空则跳过 yaw 累加（% 0 会得 NaN）
  if (AK.sprayPattern.length > 0) {
    recoilYaw = Math.max(-AK.recoilMaxYaw, Math.min(AK.recoilMaxYaw,
      recoilYaw + AK.sprayPattern[sprayIndex % AK.sprayPattern.length] * AK.recoilYawPerShot));
  }
  sprayIndex++;
  weaponKick = 1;

  // Muzzle flash
  const gunPos = getGunWorldPosition();
  const shootDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

  // 层 1：移动 inaccuracy——在相机朝向上叠加随机锥面偏移（均匀圆盘采样，小偏移不偏中心）
  let spreadDir = shootDir.clone();
  if (inaccuracy > 0) {
    const theta = Math.random() * Math.PI * 2;
    const r = inaccuracy * Math.sqrt(Math.random());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    spreadDir.addScaledVector(right, Math.cos(theta) * r).addScaledVector(up, Math.sin(theta) * r).normalize();
  }

  spawnMuzzleFlash(gunPos.clone().add(spreadDir.clone().multiplyScalar(0.3)), spreadDir);

  // Update ammo UI
  updateAmmoUI();

  // ---- 弹丸循环（M4③）：AK/步枪单丸；霰弹多丸锥面散布（移动端 pelletCountMobile 降档）----
  const pelletCount = state.isMobile && AK.pelletCountMobile !== undefined
    ? AK.pelletCountMobile
    : (AK.pelletCount ?? 1);
  const coneHalf = AK.pelletConeHalf ?? 0;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const camPos = camera.getWorldPosition(new THREE.Vector3());

  const monsterMeshes = [];
  monsters.forEach(m => {
    if (m.userData.dying) return;
    m.traverse(c => { if (c.isMesh) monsterMeshes.push(c); });
  });

  const tracerBudget = AK.tracerCount ?? 1;
  let trailsDrawn = 0;
  let anyHit = false;
  let anyHeadshot = false;

  for (let p = 0; p < pelletCount; p++) {
    const dir = spreadDir.clone();
    if (coneHalf > 0) {
      // 弹丸锥面：均匀圆盘采样（与层 1 散布同款几何，独立于移动 inaccuracy）
      const theta = Math.random() * Math.PI * 2;
      const r = coneHalf * Math.sqrt(Math.random());
      dir.addScaledVector(right, Math.cos(theta) * r).addScaledVector(up, Math.sin(theta) * r).normalize();
    }

    raycaster.set(camPos, dir);
    const intersects = raycaster.intersectObjects(monsterMeshes, false);
    let hitMonster = null;
    if (intersects.length > 0) {
      for (const m of monsters) {
        if (m.getObjectById(intersects[0].object.id)) { hitMonster = m; break; }
      }
    }

    // 穿墙遮挡：每丸独立判定（与单丸时代同源 rayHitObstacleDistance）
    const wallT = rayHitObstacleDistance(camPos.x, camPos.y, camPos.z, dir.x, dir.y, dir.z);
    const blockedByWall = hitMonster !== null && wallT < intersects[0].distance;

    if (hitMonster && !blockedByWall) {
      const hitPoint = intersects[0].point;
      const isHeadshot = intersects[0].object.name === 'head';
      const falloff = falloffMultiplier(intersects[0].distance, AK.damageFalloff);
      if (falloff > 0) {
        anyHit = true;
        // 霰弹 headshotMult=1：打头无加成也不计入爆头统计（无加成意义）
        if (isHeadshot && AK.headshotMult > 1) anyHeadshot = true;
        const amount = AK.damage * (isHeadshot ? AK.headshotMult : 1) * falloff;
        const wasKilled = damageMonster(hitMonster, isHeadshot, amount);

        // 受击白闪（每丸触发，同色重复无害；已死亡不再提亮）
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
        spawnParticles(hitPoint, isHeadshot ? '#ffd700' : '#ffaa00', isHeadshot ? 18 : 12);
      }
      if (trailsDrawn < tracerBudget) { spawnBulletTrail(gunPos, hitPoint); trailsDrawn++; }
    } else {
      // 脱靶 / 被墙挡：拖尾止于最近障碍（无遮挡 40m）
      const trailDist = Math.min(wallT, 40);
      const missPoint = camPos.clone().add(dir.clone().multiplyScalar(trailDist));
      if (Number.isFinite(wallT) && trailsDrawn < tracerBudget) {
        spawnParticles(missPoint, '#9aa5b1', 6);
      }
      if (trailsDrawn < tracerBudget) { spawnBulletTrail(gunPos, missPoint); trailsDrawn++; }
    }
  }

  // ---- 统计口径：一次开火 = 一个单元（M4③ 决策，保护 M0 标定的评级阈值口径）----
  // 任一丸命中 → shotsHit/combo/score 各 +1；爆头计数只对有爆头加成的武器（AK/步枪）
  if (anyHit) {
    state.shotsHit++;
    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    state.score += SCORE_PER_HIT;
    if (anyHeadshot) {
      state.headshots++;
      state.score += SCORE_PER_HEADSHOT;
    }
    showHitMarker(anyHeadshot);
    if (anyHeadshot) playHeadshotSound(); else playHitSound();
  } else {
    state.combo = 0;   // 脱靶打断连击
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

// ============================================
// 切枪框架（M4② §5.4）
// ============================================
const WEAPON_SLOTS = ['ak47', 'shotgun', 'negev'];   // 数字键 1/2/3 与 HUD 槽位顺序
const WEAPON_SWITCH_TIME = 0.4;   // 切枪动画时长（§5.4：无伤害窗口，不能用来取消后摇）

let weaponSwitchT = 0;            // >0 = 切枪动画剩余时间（收枪 0.2s → 换模 → 抬枪 0.2s）
let weaponSwitchPending = null;   // 收枪段结束后要换上的武器 id
let weaponModels = null;          // { ak47, shotgun, negev }：camera 子节点表（init 装配）

/** 玩家拥有的武器（存档 weapons 列表 ∩ 槽位；L3 关内霰弹未解锁即天然不可切 ✓§4） */
function ownedWeapons() {
  return getSave().weapons.filter(w => WEAPON_SLOTS.includes(w));
}

/** 三把枪的第一人称模型显隐切换（模型常驻 camera，切枪只换 visibility） */
function setWeaponModelVisible(id) {
  if (!weaponModels) return;
  for (const key of Object.keys(weaponModels)) {
    weaponModels[key].visible = key === id;
  }
}

/**
 * 切枪（§5.4）：owned 校验 → 打断换弹（cancelReload：已插弹匣留满弹，未插 = 白换）
 * → 0.4s 切枪动画（期间 shootTimer 被顶到 0.4s，天然禁射且不可取消后摇）。
 * 弹药分存：state.weaponAmmo 每枪独立记忆，切走再切回不重置；重开对局才补给。
 */
function switchWeapon(id) {
  if (state.status !== 'playing') return;
  if (id === currentWeaponId || weaponSwitchT > 0) return;
  if (!WEAPON_SLOTS.includes(id)) return;
  if (!ownedWeapons().includes(id)) return;
  if (state.reloading) cancelReload();   // §5.4 切枪打断换弹
  weaponSwitchPending = id;
  weaponSwitchT = WEAPON_SWITCH_TIME;
  shootTimer = Math.max(shootTimer, WEAPON_SWITCH_TIME);   // 切枪期禁射（复用射速节流）
  canShoot = false;
}

/** 切枪动画中点：真正换绑武器参数/模型/弹药镜像（收枪段结束后） */
function applyWeaponSwitch(id) {
  state.weaponAmmo[currentWeaponId] = state.currentAmmo;   // 旧枪弹匣存回
  currentWeaponId = id;
  AK = WEAPONS[id];                                        // 当前武器参数整体换绑（17 处消费点自动跟随）
  state.maxAmmo = AK.magSize;
  state.currentAmmo = state.weaponAmmo[id] ?? AK.magSize;
  state.reloadDuration = AK.reloadTime;
  state.ammoRefilled = false;
  fpsWeapon = weaponModels[id];
  setWeaponModelVisible(id);
  updateAmmoUI();
  renderWeaponSlots();
}

/** 推进切枪动画：收枪下沉 → 中点换绑 → 抬枪复位（姿态偏移由 updateWeaponBob 消费） */
function updateWeaponSwitch(dt) {
  if (weaponSwitchT <= 0) return;
  weaponSwitchT -= dt;
  if (weaponSwitchPending && weaponSwitchT <= WEAPON_SWITCH_TIME / 2) {
    applyWeaponSwitch(weaponSwitchPending);
    weaponSwitchPending = null;
  }
  if (weaponSwitchT <= 0) {
    weaponSwitchT = 0;
    weaponSwitchPending = null;
  }
}

/** HUD 槽位条：1 AK / 2 裂空 / 3 内格夫（owned 亮、未拥有灰、当前高亮） */
function renderWeaponSlots() {
  const owned = ownedWeapons();
  WEAPON_SLOTS.forEach((id, i) => {
    const el = document.getElementById('weapon-slot-' + (i + 1));
    if (!el) return;
    el.classList.toggle('owned', owned.includes(id));
    el.classList.toggle('current', currentWeaponId === id);
  });
}

/** 移动端切枪按钮：循环下一把 owned 武器 */
function cycleWeapon() {
  const owned = ownedWeapons();
  if (owned.length < 2) return;
  const idx = owned.indexOf(currentWeaponId);
  const next = owned[(idx + 1) % owned.length];
  switchWeapon(next);
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
  // 垂直后坐完全回正 = 这一轮连发结束，spray pattern 序号复位，下轮从图案起点开始
  if (Math.abs(recoilPitch) < 0.0001) { recoilPitch = 0; sprayIndex = 0; }
  if (Math.abs(recoilYaw) < 0.0001) recoilYaw = 0;
  if (weaponKick < 0.001) weaponKick = 0;
}

/**
 * 层 1 状态更新：inaccuracy 追赶 getInaccuracyAngle(本帧水平速度, 滞空)。
 * 升快落慢的不对称响应：加速时直接跳到目标（CS:GO 里移动惩罚即时生效），
 * 减速时指数衰减（急停后约 0.3s 才变准，而不是当帧归零）。
 */
function updateInaccuracy(dt) {
  const target = getInaccuracyAngle(locomotion.speed, !isGrounded);
  if (target > inaccuracy) {
    inaccuracy = target;
  } else {
    inaccuracy *= Math.exp(-SPREAD_RECOVER * dt);
    if (inaccuracy < 0.0001) inaccuracy = 0;   // 防止数值残渣累积
  }
}

// 准星四线与中心点：transform 由 JS 每帧驱动（见 updateCrosshairSpread）
const crosshairLineEls = {
  top:    crosshair.querySelector('.crosshair-line.top'),
  bottom: crosshair.querySelector('.crosshair-line.bottom'),
  left:   crosshair.querySelector('.crosshair-line.left'),
  right:  crosshair.querySelector('.crosshair-line.right'),
};
const crosshairDotEl = crosshair.querySelector('.crosshair-dot');
let lastSpreadPx = -1;   // 上次写入 DOM 的值，避免每帧冗余样式重算

/**
 * 准星连续扩散：四线间距每帧映射当前总散布（层 1 inaccuracy + 层 2 后坐），
 * 直观提示「现在开枪飘不飘」。位移方向为向外张开；必须保留各线基础的
 * 居中 translate（top/bottom 是 translateX(-50%)，left/right 是 translateY(-50%)），
 * 否则线会跳位。
 */
function updateCrosshairSpread() {
  const spreadPx = Math.min(SPREAD_CROSSHAIR_MAX,
    (inaccuracy + Math.abs(recoilPitch) + Math.abs(recoilYaw)) * SPREAD_CROSSHAIR_PX);
  if (Math.abs(spreadPx - lastSpreadPx) < 0.1) return;   // 变化过小不写 DOM
  lastSpreadPx = spreadPx;
  const half = spreadPx / 2;
  crosshairLineEls.top.style.transform = `translateX(-50%) translateY(${-half}px)`;
  crosshairLineEls.bottom.style.transform = `translateX(-50%) translateY(${half}px)`;
  crosshairLineEls.left.style.transform = `translateY(-50%) translateX(${-half}px)`;
  crosshairLineEls.right.style.transform = `translateY(-50%) translateX(${half}px)`;
  crosshairDotEl.style.transform = `translate(-50%, -50%) scale(${1 + spreadPx / 40})`;
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

    // 召唤预警期（M5a spawnHold > 0）：怪已落位但不可行动，光柱消失后才激活（§4.1 P2——
    // 「背后补位 → 落地即冲刺」= 无前摇伤害，直接违反 P2）
    if (ud.spawnHold > 0) {
      ud.spawnHold -= dt;
      continue;
    }

    const dist = monster.position.distanceTo(playerPosition);

    const wasAlert = ud.alert;
    ud.alert = dist <= ud.alertZone;

    if (ud.alert) {
      // 面朝玩家。蟹例外：面向自身 heading（转向钝的可见性——身体朝向滞后于玩家方向，
      // 横向滑步时能看到它"甩尾不及"，§5.3 弱点可读 P2）
      if (ud.type === 'crab') {
        monster.rotation.y = ud.crabHeading;
      } else {
        monster.lookAt(playerPosition.x, monster.position.y, playerPosition.z);
      }

      // 攻击状态机（红近战 / 蟹突进 / Boss 三阶段 / 蓝远程）。攻击都要求视线通畅
      // （isPathClear），隔着掩体时野怪只会继续绕行，不会攻击
      if (ud.type === 'red') updateMeleeAttack(monster, ud, dist, dt);
      else if (ud.type === 'crab') updateCrab(monster, ud, dist, dt);   // 移动+扑击全权自驱（§5.3 三段式）
      else if (ud.type === 'boss') updateBoss(monster, ud, dist, dt);   // 移动+技能全权自驱（M5a §5.3，入场/转场期内部自锁）
      else updateRangedAttack(monster, ud, dist, dt);

      // 追逐（匀速，保持距离）。碰撞与正面绕行都在 stepMonsterChase 内部。
      // 门控用 shouldChase（距离 + 视线），不是纯距离 —— 理由见该函数的注释。
      // 红怪挥击期间（windup/strike）锁移动，前冲由状态机自己驱动；
      // 蟹不走 stepMonsterChase（转向钝 + 排斥避障是它的专属弱点设定，§9）；
      // Boss 同为自驱（追逐只在 chase 态，技能/转场期站定，P2 可读）
      const meleeLocked = ud.type === 'red' && ud.attackState !== 'idle';
      const selfDriven = ud.type === 'crab' || ud.type === 'boss';
      if (!meleeLocked && !selfDriven && shouldChase(dist, ud.stopDist, monster.position, playerPosition.x, playerPosition.z)) {
        stepMonsterChase(monster.position, ud, playerPosition.x, playerPosition.z, ud.chaseSpeed, dt);
      }
    } else if (wasAlert) {
      // 刚刚脱离警惕——停在当前位置，并复位攻击姿态（不能带着半截挥击/投掷动作站着）
      if (ud.type === 'red') {
        ud.attackState = 'idle';
        ud.attackT = 0;
        resetMeleePose(ud);
      } else if (ud.type === 'crab') {
        ud.crabState = 'rush';
        ud.crabT = 0;
        resetCrabPose(ud);
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

  // 怪物间软分离：追同一点会挤成一团穿模（每帧一对检查，几帧内化解）
  resolveMonsterSeparations(monsters);

  // 血条扣血缓动（只重绘 animating 的血条，静止零开销）
  updateHealthBarAnimations(monsters, dt);
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
// BLUE_CAST_RANGE（施法射程 = 蓝怪 stopDist）已迁入 js/monsters.js 数值基座（M0.5③），经 import 使用
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
 * 怪物间软分离（M3 补丁）：野怪追同一个点（玩家）且相互无碰撞体，会挤成一团穿模。
 * 逐对圆-圆检查，重叠时沿分离轴各推一半；推出后各自再对障碍解算一次，防止被推进墙里。
 * 濒死怪不参与（死亡动画是放大淡出，尸体可穿）。每帧跑一遍，重叠在几帧内自然化解（软分离，不抖）。
 * 抽成 list 参数的纯函数供 collision-test 离线验收。
 */
function resolveMonsterSeparations(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.userData.dying) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.userData.dying) continue;
      const ra = a.userData.radius ?? MONSTER_RADIUS;
      const rb = b.userData.radius ?? MONSTER_RADIUS;
      const minDist = ra + rb;
      let dx = b.position.x - a.position.x;
      let dz = b.position.z - a.position.z;
      let d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      if (d < 1e-6) {
        // 完全重合：沿 +X 直接摆到 ±minDist/2（沿分离轴的常规推出在 d=0 处无方向可算）
        a.position.x -= minDist / 2;
        b.position.x += minDist / 2;
        resolveObstacleCollisions(a.position, ra);
        resolveObstacleCollisions(b.position, rb);
        continue;
      }
      const push = (minDist - d) / d * 0.5;
      a.position.x -= dx * push;
      a.position.z -= dz * push;
      b.position.x += dx * push;
      b.position.z += dz * push;
      resolveObstacleCollisions(a.position, ra);
      resolveObstacleCollisions(b.position, rb);
    }
  }
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
      damagePlayer(ud.meleeDamage ?? RED_MELEE_DAMAGE);   // per-type：精英红 ×1.5（M3③）
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

// --- 迅捷蟹（§5.3：Z 字突进 → 扑击 → 后跳，三段都有位移预警）---
const CRAB_TURN_RATE = 120 * Math.PI / 180; // 转向角速度上限（rad/s）：转向半径 v/ω ≈ 3.8m——横向滑步能甩掉的几何来源
const CRAB_RUSH_MAX = 0.8;         // 单段突进时长上限（秒）——到点是否后跳由距离决定（见 HOP_RANGE）
const CRAB_HOP_TIME = 0.25;        // 后跳时长（=玩家的脱战窗口；playtest 调整，原 0.3s）
const CRAB_HOP_SPEED = 6.4;        // 后跳速度（0.25s × 6.4 ≈ 1.6m 拉开，跳距不变）
const CRAB_HOP_RANGE = 4;          // 触发后跳的距离门限（m）——只在威胁圈内后跳；
                                   // 中远距离纯突进不后撤（playtest 反馈：远处后退观感怪异）
const CRAB_POUNCE_RANGE = 1.6;     // 进入扑击的距离门限
const CRAB_POUNCE_HIT_RANGE = 1.4; // 扑击首帧判伤距离
const CRAB_POUNCE_WINDUP = 0.3;    // 蓄力前摇（压低身体=位移预警，P2）
const CRAB_POUNCE_TIME = 0.25;     // 扑击时长
const CRAB_POUNCE_SPEED = 10;      // 扑击速度（0.25s × 10 = 2.5m 扑程）
const CRAB_POUNCE_COOLDOWN = 0.8;  // 扑击间隔（§5.3 原 2s；playtest 两轮调整 2→1.2→0.8：贴脸攻速）
const CRAB_LEAN_WINDUP = -0.25;    // 蓄力后坐姿态（rad）
const CRAB_LEAN_LUNGE = 0.2;       // 扑击前倾姿态（rad）
const CRAB_BOUNDS = { x: 25.6, zMin: -45.6, zMax: 11.6 };  // 蟹不出可玩区（半径 0.35 + 余量）

/** 复位蟹姿态（bodyPivot 归零；蟹无手臂引用，扑击动画只动身体俯仰） */
function resetCrabPose(ud) {
  if (ud.bodyPivot) ud.bodyPivot.rotation.x = 0;
}

/**
 * 蟹的移动循环（纯函数，steering-test 抽取做 §9 两条验收）——rush/hop 节奏在此全权驱动：
 *   rush（钝转向突进，单段 CRAB_RUSH_MAX 到点）→ hop（0.3s 后跳拉开 = 玩家节奏窗口）→ rush…
 * ① 转向钝：持独立朝向角 heading，每帧朝玩家 bearing 旋转、clamp ±CRAB_TURN_RATE×dt；
 *    移动沿 heading 而非直视玩家——追横向移动目标自然甩出 Z 字。
 * ② 排斥力避障（§9：绝不套 findDetourCorner 强绕行——那会消掉转向钝弱点）：
 *    对每个障碍 AABB 外扩 CRAB_CONFIG.avoidRadius 内施加线性衰减排斥力
 *    (1 - d/radius) × CRAB_CONFIG.avoidStrength，多障碍矢量叠加进移动方向，无拐角搜索。
 * windup/lunge（扑击两态）不进本函数——由 updateCrab 驱动，扑击发起会打断当前段。
 */
function stepCrabChase(pos, ud, playerX, playerZ, dt) {
  ud.crabT += dt;

  if (ud.crabState === 'hop') {
    // 后跳：沿背向玩家方向直线拉开（方向可预判——这正是窗口的含义）
    const dirX = pos.x - playerX;
    const dirZ = pos.z - playerZ;
    const len = Math.hypot(dirX, dirZ) || 1;
    pos.x += dirX / len * CRAB_HOP_SPEED * dt;
    pos.z += dirZ / len * CRAB_HOP_SPEED * dt;
    resolveObstacleCollisions(pos, ud.radius);
    pos.x = Math.max(-CRAB_BOUNDS.x, Math.min(CRAB_BOUNDS.x, pos.x));
    pos.z = Math.max(CRAB_BOUNDS.zMin, Math.min(CRAB_BOUNDS.zMax, pos.z));
    if (ud.crabT >= CRAB_HOP_TIME) {
      ud.crabState = 'rush';
      ud.crabT = 0;
    }
    return;
  }

  // rush：heading 朝玩家 bearing 旋转（限速）。转向始终允许（贴脸甩头也是行为的一部分），
  // 但推进有 stopDist 门控——蟹没有与玩家的碰撞体，不停步会直接走进玩家相机
  // （越过近裁剪面 → 实机「走近就消失」，2026-09-27 修复）
  const dx = playerX - pos.x;
  const dz = playerZ - pos.z;
  const distNow = Math.hypot(dx, dz);
  let diff = Math.atan2(dx, dz) - ud.crabHeading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxTurn = CRAB_TURN_RATE * dt;
  ud.crabHeading += Math.max(-maxTurn, Math.min(maxTurn, diff));

  if (distNow <= ud.stopDist) return;   // 已贴脸：保持距离，把扑击交给 updateCrab

  // 排斥力叠加（障碍最近点 → 蟹心 方向）
  let ax = 0, az = 0;
  for (const o of solidObstacles) {
    const cx = Math.max(o.minX, Math.min(pos.x, o.maxX));
    const cz = Math.max(o.minZ, Math.min(pos.z, o.maxZ));
    const ox = pos.x - cx;
    const oz = pos.z - cz;
    const d = Math.hypot(ox, oz);
    if (d > CRAB_CONFIG.avoidRadius) continue;
    const str = (1 - d / CRAB_CONFIG.avoidRadius) * CRAB_CONFIG.avoidStrength;
    if (d < 1e-6) { ax += Math.sin(ud.crabHeading + Math.PI); az += Math.cos(ud.crabHeading + Math.PI); continue; }
    ax += (ox / d) * str;
    az += (oz / d) * str;
  }

  // 移动方向 = heading 单位向量 + 排斥合力，归一化后匀速推进
  let mx = Math.sin(ud.crabHeading) + ax;
  let mz = Math.cos(ud.crabHeading) + az;
  const ml = Math.hypot(mx, mz) || 1;
  pos.x += (mx / ml) * ud.chaseSpeed * dt;
  pos.z += (mz / ml) * ud.chaseSpeed * dt;

  resolveObstacleCollisions(pos, ud.radius);
  // 出界钳制（蟹后跳/被挤出可玩区时拉回；边界墙不登记碰撞体）
  pos.x = Math.max(-CRAB_BOUNDS.x, Math.min(CRAB_BOUNDS.x, pos.x));
  pos.z = Math.max(CRAB_BOUNDS.zMin, Math.min(CRAB_BOUNDS.zMax, pos.z));

  // 单段突进到点 → 仅在威胁圈内后跳（中远距离不后撤——playtest 反馈远处后退观感怪异），
  // 重置计时继续突进；近身的后跳节奏窗口由扑击循环提供
  if (ud.crabT >= CRAB_RUSH_MAX) {
    if (distNow <= CRAB_HOP_RANGE) {
      ud.crabState = 'hop';
      ud.crabT = 0;
    } else {
      ud.crabT = 0;   // 远场：继续突进
    }
  }
}

/**
 * 迅捷蟹状态机（§5.3 三段式，全部带位移预警）：
 *   rush/hop 移动循环 → 进扑距 → windup（0.3s 压低蓄力，扑向锁定于结束帧——可侧移躲开）
 *   → lunge（0.25s 扑出 + 首帧判伤）→ hop 拉开 → rush…
 * 扑击只从 rush 发起（hop 是玩家的真窗口，不从中途偷袭）。
 */
function updateCrab(monster, ud, dist, dt) {
  ud.pounceCooldown -= dt;

  if (ud.crabState === 'windup') {
    ud.crabT += dt;
    const t = Math.min(ud.crabT / CRAB_POUNCE_WINDUP, 1);
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = CRAB_LEAN_WINDUP * t;
    if (ud.crabT >= CRAB_POUNCE_WINDUP) {
      ud.crabState = 'lunge';
      ud.crabT = 0;
      ud.meleeHitDone = false;
      // 扑向锁定于前摇结束帧（之后不再跟踪玩家——侧移可躲）
      const dirX = playerPosition.x - monster.position.x;
      const dirZ = playerPosition.z - monster.position.z;
      const len = Math.hypot(dirX, dirZ) || 1;
      ud.lungeX = dirX / len;
      ud.lungeZ = dirZ / len;
      playSwingSound();
    }
    return;
  }

  if (ud.crabState === 'lunge') {
    ud.crabT += dt;
    // 锁定方向扑出，首帧判伤（之后扑程内不重复判）。
    // 扑程不穿越玩家：蟹没有与玩家的碰撞体，贴到 0.7m 为止（否则冲进相机 → 贴脸消失）
    const distNow = Math.hypot(monster.position.x - playerPosition.x, monster.position.z - playerPosition.z);
    const raw = CRAB_POUNCE_SPEED * dt;
    const stepLen = Math.max(0, Math.min(raw, distNow - 0.7));
    monster.position.x += ud.lungeX * stepLen;
    monster.position.z += ud.lungeZ * stepLen;
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = CRAB_LEAN_LUNGE;
    resolveObstacleCollisions(monster.position, ud.radius);

    if (!ud.meleeHitDone) {
      ud.meleeHitDone = true;
      if (dist <= CRAB_POUNCE_HIT_RANGE &&
          isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
        damagePlayer(ud.meleeDamage);
      }
    }

    if (ud.crabT >= CRAB_POUNCE_TIME) {
      ud.crabState = 'hop';   // 扑完立即后跳拉开（§5.3 三段式收尾，扑空也跳）
      ud.crabT = 0;
      ud.pounceCooldown = CRAB_POUNCE_COOLDOWN;
      resetCrabPose(ud);
    }
    return;
  }

  // rush / hop：移动循环由 stepCrabChase 全权驱动
  stepCrabChase(monster.position, ud, playerPosition.x, playerPosition.z, dt);
  // 进扑距 → 扑击（只从 rush 发起，打断当前段；hop 是玩家窗口）
  if (ud.crabState === 'rush' && dist <= CRAB_POUNCE_RANGE && ud.pounceCooldown <= 0 &&
      isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
    ud.crabState = 'windup';
    ud.crabT = 0;
  }
}

// ============================================
// BOSS 主宰（M5a §5.3：三阶段机制怪，L7 专属）
// ============================================
// 数值基座在 MONSTER_SPECS.boss（js/monsters.js）；行为参数在 L7 行 boss 字段
// （js/config/levels.js，[PLACEHOLDER]+推导 ⚗️ M6 收口）。阶段判定走配置层纯函数
// bossPhaseFor（boss-test 门禁共用）。
// 状态机：entrance（光柱入场，不可行动不可受击）→ chase（追击 + 技能发起）
//   → slamWindup/slamStrike（近战拍击，红怪同款放大）/ chant→volley（法球三连，P2 起）
//   → transition（破阶段：无敌+吼叫+震屏+玩家回血）。
// 递进召唤（M5b+ 用户点单）：全阶段每 15s 一波，P1 蟹×3 → P2 +红蓝 → P3 +精英轮换，
// 同场按类别封顶（蟹6/红蓝4/精英2）；Boss 关 adds 不走补位队列（§4.1）。

let bossMonster = null;   // 当前对局 Boss 引用；非 Boss 关恒 null（HUD 血条/探针按此判空）

/** Boss 是否在场且未进入死亡（HUD 血条显示的判据）。 */
function bossActive() {
  return !!(bossMonster && !bossMonster.userData.dying);
}

// --- Boss 姿态/演出常量（设计值，⚗️ playtest 观察清单）---
const BOSS_ARM_LIFT = -2.2;    // 拍击前摇右臂高举（红怪 -1.2 的放大版）
const BOSS_ARM_SLAM = 0.35;    // 拍击 strike 段的下劈收角（高举 → 扫过垂直位，招式读得完整）
const BOSS_LEAN = 0.15;        // 拍击前摇身体前倾（rad）
const BOSS_ROAR_ARM = -2.6;    // 转场吼叫双臂高举
const BOSS_ROAR_LEAN = -0.12;  // 吼叫微微后仰（rad）
const BOSS_GEM_GLOW = 6;       // 吟唱/转场宝石峰值亮度（蓝怪 5 放大——更大体型的预警可读性）
const BOSS_ROAR_DURATION = 1.2;   // 默认吼叫时长（死亡吼 2.0）
const BOSS_PROJ_COLOR = '#ff4655'; // Boss 法球弹色（猩红，对齐游戏强调色与 Boss 宝石）

/** 复位 Boss 姿态（身体俯仰/双臂/宝石发光归零）——各状态进出时调用。 */
function resetBossPose(ud) {
  if (ud.bodyPivot) ud.bodyPivot.rotation.x = 0;
  if (ud.armL) ud.armL.rotation.x = 0;
  if (ud.armR) ud.armR.rotation.x = 0;
  if (ud.gem) ud.gem.material.emissiveIntensity = 2.5;
}

/**
 * 生成 Boss（startGame 消费 L7 行 boss 字段；非 Boss 关空操作）。
 * 不吃 §2 全局血池校准 k（§2 适用范围条款）——mul 恒 1；落位与光柱时长来自 boss.entrance。
 */
function spawnBoss(lv) {
  bossMonster = null;
  if (!lv.boss) return;
  const cfg = lv.boss;
  const ex = cfg.entrance.x;
  const ez = cfg.entrance.z;

  const boss = createMonster('boss', { hp: 1, spd: 1 });
  boss.position.set(ex, 0, ez);
  boss.userData = {
    ...baseMonsterUserData(boss, monsterIdSeq++, ex, ez),
    alert: true,          // 入场即警戒（alertZone 放大到全图，Boss 战全程激活）
    alertZone: 9999,
    // ---- Boss 状态机字段 ----
    bossState: 'entrance',
    bossT: 0,
    phase: 1,
    invulnerable: true,   // 入场演出期不可受击（与转场同款语义，damageMonster 早退）
    meleeCooldown: 0,
    castCooldown: 0,
    castQueue: 0,
    castTimer: 0,
    summonTimer: cfg.summon.firstDelay,
    eliteFlip: false,     // P3 精英轮换游标（bossNextEliteType 翻转，首只精英红）
    // 死亡演出覆写（updateDeathAnimation 泛型消费）：更长更克制，不学小怪翻倍膨胀
    deathDuration: 1.8,
    deathScaleTo: 1.2,
  };
  drawHealthBar(boss.userData.healthBar, 1);
  scene.add(boss);
  monsters.push(boss);
  bossMonster = boss;

  // 入场光柱（吼叫与震屏在入场结束帧，见 updateBoss——光柱先立起来再吼，节奏感）
  spawnTelegraph(ex, ez, { radius: 2.2, height: 9, color: '#ffd700', duration: cfg.entrance.duration });
}

/**
 * 破阶段转场（§5.3）：2s 无敌 + 吼叫震屏 + 玩家回 30 HP。
 * 无敌走 damageMonster 早退；回血是 Boss 独有机制（「主宰的精华被击碎后释放生命能量」，
 * 不扩展到其他关卡）；转场期间玩家输入不受限（§5.3「转场期间输入」条款）。
 * P3 进入时重置召唤计时（firstDelay 从转场结束起算——转场是喘息窗口）。
 */
function startBossTransition(ud, cfg, phase) {
  ud.phase = phase;
  ud.bossState = 'transition';
  ud.bossT = 0;
  ud.invulnerable = true;
  resetBossPose(ud);
  playBossRoar();
  triggerShake(cfg.transition.shakeAmp, cfg.transition.shakeTime);
  state.playerHealth = Math.min(PLAYER_MAX_HEALTH, state.playerHealth + cfg.transition.heal);
  updateHealthUI();
  ud.summonTimer = cfg.summon.firstDelay;   // 每次破阶段后 2.5s 出新配方波（转场是喘息窗口）
}

/**
 * 递进召唤波（M5b+ 用户点单）：从 P1 开始每 15s 一波（转场后 2.5s 首波），内容随阶段递进
 * ——P1 蟹×3 → P2 +红蓝 → P3 +精英（'elite' 伪类型落地为 eliteRed/eliteBlue 交替）。
 * 同场按类别封顶（蟹6/红蓝4/精英2，bossCanSummon 严格小于口径）：达上限的类别本波跳过，
 * 波次计时照常重置。落位/光柱走 spawnReinforcementMonster（与补位队列共用）。
 */
function bossSummonWave(ud, cfg) {
  const wave = cfg.summon.waves[ud.phase] || [];
  // 类别存活统计（含 spawnHold 期——已落位即占封顶名额）
  const alive = { crab: 0, humanoid: 0, elite: 0 };
  for (const m of monsters) {
    if (m.userData.dying || m.userData.type === 'boss') continue;
    alive[bossSummonCategory(m.userData.type)]++;
  }
  for (const entry of wave) {
    const cat = bossSummonCategory(entry.type);
    for (let n = 0; n < entry.count; n++) {
      if (!bossCanSummon(cat, alive, cfg.summon.caps)) break;   // 封顶：该类剩余名额跳过
      const type = entry.type === 'elite' ? bossNextEliteType(ud) : entry.type;
      spawnReinforcementMonster(type, { hp: HP_CALIB_MUL, spd: 1 }, cfg.summon.telegraph, cfg.summon.minDist);
      alive[cat]++;
    }
  }
  playSummonWarnSound();
}

/** P3 精英轮换：交替给精英红 / 精英蓝（ud.eliteFlip 翻转，首只精英红）。 */
function bossNextEliteType(ud) {
  ud.eliteFlip = !ud.eliteFlip;
  return ud.eliteFlip ? 'eliteRed' : 'eliteBlue';
}

/**
 * Boss 状态机（updateMonsters 分发入口；移动全权自驱——追逐只在 chase 态，
 * 技能/转场期站定，动作可读 P2）。阶段技能优先级：近战 > 法球 > 召唤。
 */
function updateBoss(monster, ud, dist, dt) {
  const cfg = currentLevel().boss;
  if (!cfg) return;
  ud.bossT += dt;
  // 逐阶段追速（M5b+ 用户点单凶猛档）：P1 3.2 → P2 4.4 → P3 5.6，配置驱动；
  // 疾跑 7.2 仍可脱战（§5.1「疾跑必能脱战」承诺不破）
  ud.chaseSpeed = cfg.chaseSpeeds[ud.phase - 1] ?? ud.chaseSpeed;

  // ---- 入场演出：光柱期不可行动不可受击，结束帧吼叫激活（§5.3）----
  if (ud.bossState === 'entrance') {
    if (ud.bossT >= cfg.entrance.duration) {
      ud.bossState = 'chase';
      ud.bossT = 0;
      ud.invulnerable = false;
      playBossRoar();
      triggerShake(cfg.transition.shakeAmp, cfg.transition.shakeTime);
    }
    return;
  }

  // ---- 转场：吼叫姿态（双臂高举+宝石全亮）+ 无敌倒计时 ----
  if (ud.bossState === 'transition') {
    const t = Math.min(ud.bossT / cfg.transition.invuln, 1);
    if (ud.armL) ud.armL.rotation.x = BOSS_ROAR_ARM * t;
    if (ud.armR) ud.armR.rotation.x = BOSS_ROAR_ARM * t;
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = BOSS_ROAR_LEAN * t;
    if (ud.gem) ud.gem.material.emissiveIntensity = 2.5 + (BOSS_GEM_GLOW - 2.5) * t;
    if (ud.bossT >= cfg.transition.invuln) {
      ud.bossState = 'chase';
      ud.bossT = 0;
      ud.invulnerable = false;
      resetBossPose(ud);
    }
    return;
  }

  // ---- 破阶段检测：血量跨阈值即转场（打断进行中的技能——破阶段瞬间压力归零，可读）----
  const phase = bossPhaseFor(ud.health / ud.maxHealth, cfg.phases);
  if (phase > ud.phase) {
    startBossTransition(ud, cfg, phase);
    return;
  }

  // ---- 近战拍击：windup（抬臂前摇）→ strike（前冲+首帧判伤）——红怪同款放大 ----
  if (ud.bossState === 'slamWindup') {
    const t = Math.min(ud.bossT / cfg.melee.windup, 1);
    if (ud.armR) ud.armR.rotation.x = BOSS_ARM_LIFT * t;
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = BOSS_LEAN * t;
    if (ud.bossT >= cfg.melee.windup) {
      ud.bossState = 'slamStrike';
      ud.bossT = 0;
      ud.meleeHitDone = false;
      playSwingSound(0.45);   // 降调破空声（大质量挥击）
    }
    return;
  }
  if (ud.bossState === 'slamStrike') {
    // 下劈：右臂从高举位扫过垂直位（windup 抬臂的回收，前摇/下劈合成完整一击）
    const swingT = Math.min(ud.bossT / cfg.melee.strike, 1);
    if (ud.armR) ud.armR.rotation.x = BOSS_ARM_LIFT * (1 - swingT) + BOSS_ARM_SLAM * swingT;
    const dirX = playerPosition.x - monster.position.x;
    const dirZ = playerPosition.z - monster.position.z;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-6) {
      const nx = dirX / len;
      const nz = dirZ / len;
      monster.position.x += nx * cfg.melee.lungeSpeed * dt;
      monster.position.z += nz * cfg.melee.lungeSpeed * dt;
      resolveObstacleCollisions(monster.position, ud.radius);
    }
    if (!ud.meleeHitDone) {
      ud.meleeHitDone = true;
      if (dist <= cfg.melee.hitRange &&
          isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
        damagePlayer(ud.meleeDamage);
      }
    }
    if (ud.bossT >= cfg.melee.strike) {
      ud.bossState = 'chase';
      ud.bossT = 0;
      ud.meleeCooldown = cfg.melee.cooldown;
      resetBossPose(ud);
    }
    return;
  }

  // ---- 法球三连：chant（0.8s 站定+宝石渐亮预警）→ volley（逐发瞄玩家当前位置，
  //      0.22s 间隔——瞄准可被走位打破，跑动就是解法，P2）----
  if (ud.bossState === 'chant') {
    const t = Math.min(ud.bossT / cfg.orb.chant, 1);
    if (ud.bodyPivot) ud.bodyPivot.rotation.x = BLUE_CAST_LEAN_BACK * t;
    if (ud.armL) ud.armL.rotation.x = BLUE_CAST_ARM_LIFT * t;
    if (ud.armR) ud.armR.rotation.x = BLUE_CAST_ARM_LIFT * t;
    if (ud.gem) ud.gem.material.emissiveIntensity = 2.5 + (BOSS_GEM_GLOW - 2.5) * t;
    if (ud.bossT >= cfg.orb.chant) {
      ud.bossState = 'volley';
      ud.bossT = 0;
      ud.castQueue = cfg.orb.count;
      ud.castTimer = 0;
    }
    return;
  }
  if (ud.bossState === 'volley') {
    ud.castTimer -= dt;
    if (ud.castQueue > 0 && ud.castTimer <= 0) {
      spawnMonsterProjectile(monster, {
        speed: cfg.orb.speed,
        radius: cfg.orb.radius,
        color: BOSS_PROJ_COLOR,
        glow: '#ff2233',
      });
      ud.castQueue--;
      ud.castTimer = cfg.orb.interval;
    }
    if (ud.castQueue <= 0) {
      ud.bossState = 'chase';
      ud.bossT = 0;
      ud.castCooldown = cfg.orb.cooldown;
      resetBossPose(ud);
    }
    return;
  }

  // ---- chase：追击 + 技能发起 ----
  ud.meleeCooldown -= dt;
  ud.castCooldown -= dt;
  ud.summonTimer -= dt;   // M5b+：全阶段召唤（P1 蟹 → P2 +红蓝 → P3 +精英），转场期不倒计时

  if (shouldChase(dist, ud.stopDist, monster.position, playerPosition.x, playerPosition.z)) {
    stepMonsterChase(monster.position, ud, playerPosition.x, playerPosition.z, ud.chaseSpeed, dt);
  }

  if (dist <= cfg.melee.range && ud.meleeCooldown <= 0 &&
      isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
    ud.bossState = 'slamWindup';
    ud.bossT = 0;
    return;
  }
  if (ud.phase >= 2 && dist <= cfg.orb.range && ud.castCooldown <= 0 &&
      isPathClear(monster.position.x, monster.position.z, playerPosition.x, playerPosition.z)) {
    ud.bossState = 'chant';
    ud.bossT = 0;
    return;
  }
  if (ud.summonTimer <= 0) {
    bossSummonWave(ud, cfg);
    ud.summonTimer = cfg.summon.interval;   // 跳波（类别封顶）也重置——节奏稳定可预期
  }
}

// ============================================
// UI HELPERS
// ============================================
function updateUI() {
  // Update monster count (separate elements)
  // 存活数：已判定死亡（正在播死亡动画）的野怪不再计入。
  // 精英计入同族计数（猩红/蔚蓝），蟹单列（M3③）。
  // 补位队列按类型计入（M5b §4.1「向玩家坦诚总账」——玩家看到的剩余 = 场上 + 队列）
  const queued = (types) => spawnQueue.filter(q => types.includes(q.type)).length;
  state.redAlive = monsters.filter(m => (m.userData.type === 'red' || m.userData.type === 'eliteRed') && !m.userData.dying).length
    + queued(['red', 'eliteRed']);
  state.blueAlive = monsters.filter(m => (m.userData.type === 'blue' || m.userData.type === 'eliteBlue') && !m.userData.dying).length
    + queued(['blue', 'eliteBlue']);
  state.crabAlive = monsters.filter(m => m.userData.type === 'crab' && !m.userData.dying).length
    + queued(['crab']);

  const redEl = document.getElementById('monster-count-red');
  const blueEl = document.getElementById('monster-count-blue');
  const crabEl = document.getElementById('monster-count-crab');
  if (redEl) redEl.textContent = state.redAlive;
  if (blueEl) blueEl.textContent = state.blueAlive;
  if (crabEl) crabEl.textContent = state.crabAlive;

  // Alert indicator
  const alertEl = document.getElementById('alert-indicator');
  if (alertEl) {
    const anyAlert = monsters.some(m => m.userData.alert && !m.userData.dying);
    alertEl.classList.toggle('hidden', !anyAlert);
  }

  // Boss 血条（M5a §9）：仅 Boss 在场时显示；转场期整条闪烁（阶段刻度 70%/40% 静态常显）。
  // 放在 updateUI 每帧驱动——扣血平滑过渡走 CSS transition，转场结束自动摘 blink。
  if (bossBarEl) {
    const show = bossActive() && state.status === 'playing';
    bossBarEl.classList.toggle('hidden', !show);
    if (show) {
      const bud = bossMonster.userData;
      if (bossFillEl) bossFillEl.style.width = (bud.health / bud.maxHealth * 100) + '%';
      bossBarEl.classList.toggle('blink', bud.bossState === 'transition');
    }
  }
}

function updateAmmoUI() {
  ammoCurrentEl.textContent = state.currentAmmo;
  if (state.currentAmmo <= 5) {
    ammoCurrentEl.classList.add('low');
  } else {
    ammoCurrentEl.classList.remove('low');
  }
  // M4②：弹匣容量与武器名随当前武器（此前 #ammo-max 是静态文本、从不更新）
  const maxEl = document.getElementById('ammo-max');
  const nameEl = document.getElementById('weapon-name');
  if (maxEl) maxEl.textContent = state.maxAmmo;
  if (nameEl) nameEl.textContent = AK.name;
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
// （M5a 例外：Boss 转场回血 30 是 §5.3 的 Boss 独有机制，走 startBossTransition。）
let shakeT = 0;              // 当前抖动剩余时长（updateCamera 消费，update 递减）
let shakeDur = HURT_SHAKE_TIME;   // 本次抖动的时长基准（k = shakeT/shakeDur 线性衰减）
let shakeAmp = HURT_SHAKE_AMP;    // 本次抖动的幅度（米）
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

/**
 * 通用震屏触发器（M5a §11 震屏解耦：原 startCameraShake 无参硬编码受击值）。
 * @param {number} intensity 抖动幅度（米）
 * @param {number} duration 衰减时长（秒）
 * 叠加规则：更强震动（或当前无震动）时接管幅度/时长基准；弱震动不覆盖进行中的
 * 强震动；shakeT 取 max——强震进行中来的弱震既不改基准也不缩短剩余时间。
 */
function triggerShake(intensity, duration) {
  if (intensity >= shakeAmp || shakeT <= 0) {
    shakeAmp = intensity;
    shakeDur = duration;
  }
  shakeT = Math.max(shakeT, duration);
}

/** 当前关配置行（§4）。currentLevelId 越界回退 L1 行（防御；L1 倍率全 1.0 无行为差异）。 */
function currentLevel() {
  return LEVELS[Math.min(Math.max(state.currentLevelId, 1), LEVELS.length) - 1];
}

/**
 * 对玩家造成伤害（红怪近战 / 蓝怪魔法弹共用入口）。
 * 触发受击反馈三件套：红闪 + 闷响 + 相机抖动；血量归零 → 本局结束。
 * 伤害 × 本关 dmgMul（§5.1，作用于所有怪种）——只改「被打死耗时」，
 * 不改「击杀耗时」（血量校准走 HP_CALIB_MUL，§2 注意条款）。
 */
function damagePlayer(amount) {
  if (state.status !== 'playing') return;
  state.playerHealth = Math.max(0, state.playerHealth - amount * currentLevel().dmgMul);
  updateHealthUI();
  flashDamage();
  playHurtSound();
  triggerShake(HURT_SHAKE_AMP, HURT_SHAKE_TIME);
  if (state.playerHealth <= 0) {
    endGame('death');
  }
}

// ============================================
// GAME STATE MANAGEMENT
// ============================================
// gradeFor（§6 S/A/B/F）在 js/config/levels.js（M1⑥ 迁入配置层：纯函数可被
// node 门禁直接 import，避免动态求值）。本文件经 import 使用。

function startGame(levelId) {
  initAudio();

  // 关卡解析：无参 = 重进当前关（重开 / 键盘开局）；越界回退 L1（防御）
  const lv = LEVELS[Math.min(Math.max(levelId || state.currentLevelId, 1), LEVELS.length) - 1];
  state.currentLevelId = lv.id;

  state.status = 'playing';
  state.levelStartTime = performance.now();   // §6 评级时间门基准
  // M4② 武器补给重置：重开对局 = 全部 owned 武器满弹；当前枪不 owned（防御）则回 ak47
  state.weaponAmmo = {};
  for (const w of ownedWeapons()) state.weaponAmmo[w] = WEAPONS[w].magSize;
  if (!ownedWeapons().includes(currentWeaponId)) {
    currentWeaponId = 'ak47';
    AK = WEAPONS.ak47;
    fpsWeapon = weaponModels.ak47;
    setWeaponModelVisible('ak47');
  }
  state.maxAmmo = AK.magSize;
  state.currentAmmo = state.weaponAmmo[currentWeaponId] ?? AK.magSize;
  state.reloadDuration = AK.reloadTime;
  state.reloading = false;
  state.reloadTimer = 0;
  state.ammoRefilled = false;
  weaponSwitchT = 0;
  weaponSwitchPending = null;
  renderWeaponSlots();
  state.redAlive = 0;
  state.blueAlive = 0;
  state.crabAlive = 0;
  state.playerHealth = PLAYER_MAX_HEALTH;
  // 结算统计复位
  state.kills = 0;
  state.headshots = 0;
  state.shotsFired = 0;
  state.shotsHit = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.score = 0;
  shootTimer = 0;
  canShoot = true;
  recoilPitch = 0;
  recoilYaw = 0;
  weaponKick = 0;
  inaccuracy = 0;    // 散布状态必须复位，否则重开局继承上一局的移动惩罚
  sprayIndex = 0;
  // 受击反馈复位：否则重开局会带着上一局的抖动/红闪残渣
  shakeT = 0;
  shakeDur = HURT_SHAKE_TIME;
  shakeAmp = HURT_SHAKE_AMP;
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
  // 生成预警光柱与怪物同级的清理（上一局残留的光柱会挂在原地到超时）
  clearTelegraphs();
  // 清掉上一局残留的魔法弹（否则重开局瞬间会被飞了一半的弹打中）
  monsterProjectiles.forEach(p => disposeProjectile(p));
  monsterProjectiles.length = 0;
  // 同理清空曳光弹：飞行中的光束可存续 ~0.6s，重开瞬间会挂着上一局的弹道
  bulletTrails.forEach(t => {
    scene.remove(t);
    t.geometry.dispose();
    t.material.dispose();
  });
  bulletTrails.length = 0;
  // 场地按关卡布局重建（§5.2 布局即数据；先重建再刷怪）
  applyLayout(lv.layout);
  // 关卡组成刷怪：§4 spawns × §5.1 关卡倍率 × §2 全局血池校准 k（仅 L1-L6 吃 k）；
  // maxAlive 消费 §4.1 同场上限——超编进 FIFO 补位队列（M5b）
  spawnMonsters(lv.spawns, { hp: lv.hpMul * HP_CALIB_MUL, spd: lv.spdMul }, lv.maxAlive);
  // Boss 关（L7）：Boss 不入 spawns，由 boss 字段单独生成（不吃 k，§2 适用范围条款）
  spawnBoss(lv);

  // Update UI
  updateUI();
  updateAmmoUI();
  updateHealthUI();

  // Show HUD, hide start screen
  startScreen.classList.add('hidden');
  levelSelectScreen.classList.add('hidden');   // 选关屏可能开着（键盘开局路径），必须一并收起
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

function endGame(reason) {
  if (state.status === 'ended') return;   // 幂等守卫：同帧「阵亡 + 全灭」双触发只结算一次
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

  // 两种结局区分：胜利 / 阵亡。'time' 死分支已随关卡系统移除（§8.1）
  const dead = reason === 'death';
  const victory = reason === 'victory';
  const lv = currentLevel();
  const elapsedSec = (performance.now() - state.levelStartTime) / 1000;
  const grade = gradeFor({
    died: dead,
    shotsFired: state.shotsFired,
    shotsHit: state.shotsHit,
    headshots: state.headshots,
    elapsedSec,
  }, lv);

  const titleEl = document.getElementById('end-title');
  if (titleEl) titleEl.textContent = dead ? '你已阵亡' : ('通关 · ' + lv.name);

  // 结算数据：全部来自本局真实统计
  const pct = (num, den) => den > 0 ? Math.round(num / den * 100) + '%' : '0%';
  document.getElementById('end-score').textContent = state.score;
  document.getElementById('end-kills').textContent    = state.kills;
  document.getElementById('end-headshots').textContent = pct(state.headshots, state.shotsHit);  // 爆头率 = 爆头命中 / 总命中
  document.getElementById('end-accuracy').textContent  = pct(state.shotsHit, state.shotsFired); // 命中率 = 命中 / 开枪
  document.getElementById('end-combo').textContent     = state.maxCombo;

  recordCalibSample(reason);   // M0 标定：每局真实结束后累积一条原始计数样本（函数声明已提升，此处可调）

  document.getElementById('grade-letter').textContent = grade;

  // §7 写入时机：仅过关结算写盘（阵亡不写盘）。reward.weapon 授予走同一事务（§7「发武器与
  // unlock 同事务写入」）；下一局 startGame 的 renderWeaponSlots 会亮起新槽位。
  const nextBtn = document.getElementById('next-btn');
  if (victory) {
    applyLevelResult(lv.id, {
      grade,
      score: state.score,
      combo: state.maxCombo,
      weapons: lv.reward && lv.reward.weapon ? [lv.reward.weapon] : undefined,
    });
    updateSaveBadge();   // 写降级可能在此刻发生，角标即时反映
    if (nextBtn) nextBtn.classList.toggle('hidden', lv.id >= LEVELS.length);
  } else if (nextBtn) {
    nextBtn.classList.add('hidden');
  }
}

function restartGame() {
  endScreen.classList.add('hidden');
  startGame(state.currentLevelId);   // 重开 = 重进当前关，配置重读（§9 关卡×暂停/重开）
}

// ============================================
// LEVEL SELECT UI（M1⑤ §7 选关 / 继续游戏 / 放弃本关 / 存档角标）
// ============================================

/** 主按钮目标关 = 存档 unlocked 封顶表长（无进度 = L1；全通关后停在最后一关）。 */
function continueLevelId() {
  return Math.min(getSave().unlocked, LEVELS.length);
}

/** 开始屏主按钮文案随进度刷新（readSave / 过关 / 返回时调用）。 */
function updateStartButton() {
  const el = document.getElementById('start-btn-text');
  if (el) el.textContent = '继续游戏 · L' + continueLevelId();
}

function showLevelSelect() {
  renderLevelCards();
  startScreen.classList.add('hidden');
  levelSelectScreen.classList.remove('hidden');
}

function backToStart() {
  levelSelectScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  updateStartButton();
}

/** 选关卡片网格：编号/名称/最佳评级徽章/最佳分数；锁定卡置灰 + 🔒（§7）。 */
function renderLevelCards() {
  const save = getSave();
  levelGrid.innerHTML = '';
  for (const lv of LEVELS) {
    const rec = save.levels[String(lv.id)];
    const locked = lv.id > save.unlocked;
    const card = document.createElement('button');
    card.className = 'level-card' + (locked ? ' locked' : '');
    card.innerHTML =
      '<span class="level-num">L' + lv.id + '</span>' +
      '<span class="level-name">' + lv.name + '</span>' +
      (locked
        ? '<span class="level-lock">🔒 通关上一关解锁</span>'
        : '<span class="level-grade">' + (rec && rec.bestGrade ? rec.bestGrade : '—') + '</span>' +
          '<span class="level-score">最佳 ' + (rec && rec.bestScore ? rec.bestScore : 0) + '</span>');
    if (!locked) {
      card.addEventListener('click', function () {
        levelSelectScreen.classList.add('hidden');
        startGame(lv.id);
      });
    }
    levelGrid.appendChild(card);
  }
}

/** 存档状态角标（§7）：已重置 / 写降级「进度不保留」。 */
function updateSaveBadge() {
  const meta = getSaveMeta();
  if (meta.reset) {
    saveBadge.textContent = '存档已重置';
    saveBadge.classList.remove('hidden');
  } else if (meta.memoryMode) {
    saveBadge.textContent = '存档不可用，进度不保留';
    saveBadge.classList.remove('hidden');
  } else {
    saveBadge.classList.add('hidden');
  }
}

/** 暂停屏「放弃本关」：清场回选关，进度不写盘（§7）。 */
function abandonLevel() {
  if (state.status !== 'paused') return;
  state.status = 'menu';
  pausedInd.classList.add('hidden');
  hud.classList.add('hidden');
  mobileCtrl.classList.add('hidden');
  cancelReload();
  // 清场回到菜单观感（与 startGame 同级的清理，但不进入对局）
  monsters.forEach(m => scene.remove(m));
  bossMonster = null;         // Boss 引用随清场作废（HUD 血条由 updateUI 判空隐藏）
  clearTelegraphs();
  monsterProjectiles.forEach(p => disposeProjectile(p));
  monsterProjectiles.length = 0;
  bulletTrails.forEach(t => {
    scene.remove(t);
    t.geometry.dispose();
    t.material.dispose();
  });
  bulletTrails.length = 0;
  applyLayout('default');   // 菜单背景回默认布局（§5.2）
  spawnMonsters(MENU_COMPOSITION);
  // 相机回菜单机位（updateCamera 在 menu 态不跑，停留在对局位会穿模）
  camera.position.set(0, 6, 8);
  camera.lookAt(0, 1.5, 0);
  showLevelSelect();
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
    updateWeaponSwitch(cappedDT);   // M4② 切枪动画（推进+中点换绑）
    updateReload(cappedDT);
    updateMovement(cappedDT);
    updateRecoil(cappedDT);
    updateInaccuracy(cappedDT);   // 依赖本帧 updateMovement 后的 locomotion.speed/isGrounded
    updateCrosshairSpread();
    updateMonsters(cappedDT);
    // 胜利判定：死亡动画播完的野怪会从 monsters 移除，数组清空即全歼；
    // 补位队列（M5b §4.1）必须一并清空——否则场上瞬时清空会被误判通关
    if (monsters.length === 0 && spawnQueue.length === 0) {
      endGame('victory');
    }
    updateParticles(cappedDT);
    updateBulletTrails(cappedDT);
    updateMonsterProjectiles(cappedDT);
    updateTelegraphs(cappedDT);   // M5a：Boss 入场/召唤蟹落位的预警光柱
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
  applyLayout('default');   // 菜单背景障碍组（M2②：障碍随布局重建，基础层单例）

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

  // ---- M4② 新枪程序化低模（§5.4：零外部素材）----
  // 三模型常驻 camera、切枪只换 visibility（各自带 basePosition 快照，bob/切枪姿态按当前模型消费）
  const shotgunModel = createShotgunModel();
  shotgunModel.position.set(0.22, -0.2, -0.5);
  shotgunModel.rotation.set(0, -0.08, 0);
  shotgunModel.userData.basePosition = shotgunModel.position.clone();
  shotgunModel.userData.baseRotation = shotgunModel.rotation.clone();
  camera.add(shotgunModel);

  const negevModel = createNegevModel();
  negevModel.position.set(0.22, -0.2, -0.5);
  negevModel.rotation.set(0, -0.08, 0);
  negevModel.userData.basePosition = negevModel.position.clone();
  negevModel.userData.baseRotation = negevModel.rotation.clone();
  camera.add(negevModel);

  weaponModels = { ak47: fpsWeapon, shotgun: shotgunModel, negev: negevModel };
  setWeaponModelVisible(currentWeaponId);
  console.log('  Camera children:', camera.children.length);

  // Add weapon illumination light to camera
  const weaponLight = new THREE.PointLight('#ffffff', 1.5, 3);
  weaponLight.position.set(0.2, 0.3, 0);
  camera.add(weaponLight);

  // Create targets
  // Spawn menu backdrop monsters（观感用，组成见 MENU_COMPOSITION）
  spawnMonsters(MENU_COMPOSITION);

  // Button handlers
  document.getElementById('start-btn').addEventListener('click', function () { startGame(continueLevelId()); });
  document.getElementById('restart-btn').addEventListener('click', restartGame);
  document.getElementById('next-btn').addEventListener('click', function () {
    endScreen.classList.add('hidden');
    startGame(state.currentLevelId + 1);   // 结算屏「下一关」直进（§7 选关 UI）
  });
  document.getElementById('select-btn').addEventListener('click', showLevelSelect);
  document.getElementById('select-back-btn').addEventListener('click', backToStart);
  document.getElementById('abandon-btn').addEventListener('click', abandonLevel);

  // Keyboard start - allow spacebar or enter to start
  window.addEventListener('keydown', function startKeyHandler(e) {
    if (state.status === 'menu' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      startGame(continueLevelId());   // 键盘开局 = 主按钮同款「继续游戏」
    }
    if (state.status === 'ended' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      restartGame();
    }
  });

  // 存档层初始化：坏档备份重置 / 内存降级在此发生（§7）；另一标签页写盘合并后刷新 UI
  readSave();
  updateStartButton();
  updateSaveBadge();
  onSaveMerged(function () {
    updateStartButton();
    updateSaveBadge();
    if (!levelSelectScreen.classList.contains('hidden')) renderLevelCards();
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
  console.log('%c Click "继续游戏" or press Enter to start',
    'color: #ece8e1;');
}

// ============================================
// M0 标定采样器（纯被动记录，不参与任何游戏逻辑）
// ============================================
// 累积每局的原始计数（开枪/命中/爆头），供 §12「命中率/爆头率标定」跨局按原始计数
// 池化求值。M0.5④：存储与池化统计已迁入 js/save.js（§7 实现载体），此处只做
// 「从 state 取数 → 推给存储层」的胶水。
/** 一局真实结束（victory/death）时记录一条样本；不可达的 'time' 分支不计。
 *  M5b：补 elapsedSec（§6 S 档时间标定埋点）——parTime P75 收紧待 M6 用此数据。 */
function recordCalibSample(reason) {
  if (reason !== 'victory' && reason !== 'death') return;
  pushCalibSample({
    ts: Date.now(),
    result: reason,
    shotsFired: state.shotsFired,
    shotsHit: state.shotsHit,
    headshots: state.headshots,
    elapsedSec: (performance.now() - state.levelStartTime) / 1000,
  });
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
  playerHealth: state.playerHealth,   // M5a：Boss 转场回血探针断言用
  // M0 标定用统计（口径与结算屏 endGame 一致）
  accuracy: state.shotsFired > 0 ? state.shotsHit / state.shotsFired : 0,   // 命中率 = 命中 / 开枪
  headshotRate: state.shotsHit > 0 ? state.headshots / state.shotsHit : 0,  // 爆头率 = 爆头命中 / 总命中
  footstepLog: footstepLog.slice(),
  footstepCount,   // 单调递增，不受 FOOTSTEP_LOG_MAX 截断影响
  obstacleCount: solidObstacles.length,   // 已登记的实体障碍数（碰撞体与几何体同步）
  layout: currentLayoutName,              // 当前布局预设名（M2② probe 断言用）
  spawnQueue: spawnQueue.map(q => q.type), // M5b：补位队列 FIFO（§4.1 探针断言用）
  // 野怪位置与绕行状态，供自动化验证「不穿墙 / 不卡死」
  monsters: monsters.filter(m => !m.userData.dying).map(m => ({
    id: m.userData.id,
    type: m.userData.type,   // M3⑤：L4 蟹 / L5 精英的探针断言用
    x: m.position.x,
    z: m.position.z,
    alert: !!m.userData.alert,
    avoidSide: m.userData.avoidSide || 0,
    // M5a：攻击状态机字段（红 windup/strike、蓝 casting/recoil、蟹 windup/lunge）
    // ——探针按状态定时刻冻结截图用（前摇 0.35s 盲拍抓不到）
    attackState: m.userData.attackState || null,
    castState: m.userData.castState || null,
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
// ---- M0 标定探针接口（实现在 js/save.js，探针直调真实实现，避免测试与实现漂移）----
window.__SNAPSHOT__.calibSamples = getCalibSamples;
window.__SNAPSHOT__.calibClear = clearCalibSamples;
window.__SNAPSHOT__.calibSummary = calibSummary;
// ---- M1 关卡系统探针接口（§8.1：.loadLevel/.saveRead/.unlockAll/.gradeFor，探针逐关自动验收）----
window.__SNAPSHOT__.loadLevel = function (n) { startGame(n); };
window.__SNAPSHOT__.saveRead  = function () { return { save: getSave(), meta: getSaveMeta() }; };
window.__SNAPSHOT__.unlockAll = function () { unlockAll(); return getSave(); };
window.__SNAPSHOT__.gradeFor  = gradeFor;
// ---- M4 武器探针接口：切枪/授予链路验收 ----
window.__SNAPSHOT__.weapons = function () {
  return { current: currentWeaponId, owned: ownedWeapons(), ammo: { ...state.weaponAmmo } };
};
window.__SNAPSHOT__.switchWeapon = switchWeapon;
// ---- M5a Boss 探针接口：状态快照 / 定量扣血 / 玩家血量直写（验证转场回血 30）----
// 仅挂调试面（正常游玩不可达）。bossDamage 走真实 damageMonster——转场无敌期扣不动血，
// 探针须等待无敌结束再扣（这正是 §5.3 转场机制的行为验收）。
window.__SNAPSHOT__.boss = function () {
  const b = bossMonster;
  if (!b || b.userData.dying || !monsters.includes(b)) return null;
  const ud = b.userData;
  // 召唤物按封顶类别拆分（M5b+ 递进召唤；spawnHold 期计入——已落位即占名额）
  const adds = { crab: 0, humanoid: 0, elite: 0 };
  for (const m of monsters) {
    if (m.userData.dying || m.userData.type === 'boss') continue;
    adds[bossSummonCategory(m.userData.type)]++;
  }
  return {
    hp: ud.health,
    maxHealth: ud.maxHealth,
    phase: ud.phase,
    state: ud.bossState,
    invuln: !!ud.invulnerable,
    chaseSpeed: ud.chaseSpeed,
    adds: { ...adds, total: adds.crab + adds.humanoid + adds.elite },
  };
};
window.__SNAPSHOT__.bossDamage = function (n) {
  return bossMonster ? damageMonster(bossMonster, false, n) : false;
};
window.__SNAPSHOT__.setPlayerHealth = function (n) {
  state.playerHealth = Math.max(0, Math.min(PLAYER_MAX_HEALTH, n));
  updateHealthUI();
  return state.playerHealth;
};
// Boss 传送（截图/近景验证用；正常游玩不可达）
window.__SNAPSHOT__.teleportBoss = function (x, z) {
  if (!bossMonster) return false;
  bossMonster.position.set(x, 0, z);
  return true;
};
// 定量打伤第 idx 只存活怪（M5b 补位节奏验证用；正常游玩不可达）
window.__SNAPSHOT__.hurtMonster = function (idx, n) {
  const alive = monsters.filter(m => !m.userData.dying);
  return (idx >= 0 && idx < alive.length) ? damageMonster(alive[idx], false, n) : false;
};
// 清掉 Boss 全部召唤物、保留本体（M5b+ 探针长窗口保命用；正常游玩不可达）
window.__SNAPSHOT__.clearAdds = function () {
  const adds = monsters.filter(m => m.userData.type !== 'boss' && !m.userData.dying);
  adds.forEach(m => damageMonster(m, false, 99999));
  return adds.length;
};
// 调试专用击杀钩子：§8.1「探针脚本逐关自动验收」需要探针能主动打完一局；
// 只挂在本调试面下（正常游玩不可达）。逐轮头击直至清场（红 225HP 需 4 轮）。
window.__SNAPSHOT__.cheatKillAll = function () {
  spawnQueue.length = 0;   // 调试面语义 = 清场：队列一并作废，否则补位会让探针胜利路径打不完
  let guard = 20;
  while (monsters.some(m => !m.userData.dying) && guard-- > 0) {
    for (const m of monsters.filter(x => !x.userData.dying)) damageMonster(m, true);
  }
  return monsters.length;
};

// Boot
init();
