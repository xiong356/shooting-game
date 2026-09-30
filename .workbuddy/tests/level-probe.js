// CDP 实机验收：M1 关卡系统端到端（§8.1「探针脚本逐关自动验收」）
// 覆盖：组成刷怪 → 胜利结算（评级/写盘/解锁/下一关按钮）→ 刷新持久化 → 阵亡不写盘。
// 用无头 Chrome：rAF 在无头模式下恒触发（IAB/被遮挡窗口会节流，游戏循环停摆）。
// 前置：server.js 已在 3000 端口运行。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 9339;
const PROFILE = path.join(require('os').tmpdir(), 'cdp-level');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

(async () => {
  // chrome 路径字面量内联（monster-probe 同款启动参数）
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', 'http://127.0.0.1:3000/',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find(t => t.type === 'page' && /3000/.test(t.url));
      if (target && target.webSocketDebuggerUrl) break;
    } catch (e) {}
    await sleep(500);
  }
  if (!target) { console.log('FATAL: no target'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  });
  await new Promise(r => ws.addEventListener('open', r));

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.reload');
  await sleep(7000);   // 等 ES Module + three.js CDN + 初始化

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || '') };
    return r && r.result ? r.result.value : null;
  };
  const snap = () => evalJS('JSON.stringify(window.__SNAPSHOT__())').then(s => s ? JSON.parse(s) : null);

  // ---- 0. 启动 ----
  const booted = await evalJS('window.__GAME_BOOTED__ === true');
  ok(booted === true, '游戏启动（__GAME_BOOTED__）');

  // 探针可重复：清掉 profile 残留的存档（cdp-level 目录跨次运行复用），重载后从零开始
  await evalJS("localStorage.removeItem('wk.pve.save.v1'); localStorage.removeItem('wk.pve.save.v1.backup')");
  await send('Page.reload');
  await sleep(7000);

  // ---- 1. L1 组成刷怪（红×4）----
  await evalJS('window.__SNAPSHOT__.loadLevel(1)');
  await sleep(800);
  const lv1 = await snap();
  ok(lv1 && lv1.status === 'playing' && lv1.monsters.length === 4, 'L1 刷怪 = 4 只（红×4）', lv1 && lv1.monsters.length);

  // ---- 2. 胜利结算：清场 → 评级 B（探针零开枪，命中率 0 → 保底 B）→ 写盘 → 解锁 L2 ----
  await evalJS('window.__SNAPSHOT__.cheatKillAll()');
  await sleep(3000);   // 死亡动画 0.9s × 清场 → victory 判定 → 结算
  const victoryUI = await evalJS(`JSON.stringify((() => {
    const q = (id) => document.getElementById(id);
    return {
      status: window.__SNAPSHOT__().status,
      endVisible: !q('end-screen').classList.contains('hidden'),
      title: q('end-title').textContent,
      grade: q('grade-letter').textContent,
      nextVisible: !q('next-btn').classList.contains('hidden'),
      save: window.__SNAPSHOT__.saveRead().save,
    };
  })())`).then(s => JSON.parse(s));
  ok(victoryUI.status === 'ended' && victoryUI.endVisible, '胜利 → 结算屏出现', victoryUI);
  ok(victoryUI.title === '通关 · 峡谷初见', '标题含关卡名', victoryUI.title);
  ok(victoryUI.grade === 'B', '零开枪胜利 = 保底 B（gradeFor 接线）', victoryUI.grade);
  ok(victoryUI.nextVisible === true, '下一关按钮出现（L1 < 表长）', victoryUI.nextVisible);
  const lv1rec = victoryUI.save && victoryUI.save.levels['1'];
  ok(!!lv1rec && lv1rec.bestGrade === 'B' && lv1rec.clears === 1, '过关写盘：L1 记录 B/clears1', victoryUI.save.levels);
  ok(victoryUI.save.unlocked === 2, 'L1 通关 → 解锁 L2', victoryUI.save.unlocked);

  // ---- 3. 刷新持久化 ----
  await send('Page.reload');
  await sleep(7000);
  const afterReload = await evalJS('JSON.stringify(window.__SNAPSHOT__.saveRead().save)').then(s => JSON.parse(s));
  ok(afterReload.unlocked === 2 && afterReload.levels['1'], '刷新后进度仍在（localStorage 持久化）', afterReload);

  // ---- 3b. 场地重建：切关障碍数变化 + 清场无残留（§9「场地重建×碰撞」风险行）----
  await evalJS('window.__SNAPSHOT__.loadLevel(3)');
  await sleep(500);
  const l3 = await evalJS(`JSON.stringify({ layout: window.__SNAPSHOT__().layout, count: window.__SNAPSHOT__().obstacleCount, obs: window.__SNAPSHOT__.obstacles() })`).then(s => JSON.parse(s));
  ok(l3.layout === 'variantA' && l3.count === 11, 'L3 切 variantA：11 障碍', { layout: l3.layout, count: l3.count });
  ok(l3.obs.some(o => (o.maxX - o.minX) > 12 && (o.maxZ - o.minZ) < 0.5), 'variantA 含 12.7m 横隔断 AABB');
  await evalJS('window.__SNAPSHOT__.loadLevel(5)');
  await sleep(500);
  const l5 = await evalJS(`JSON.stringify({ layout: window.__SNAPSHOT__().layout, count: window.__SNAPSHOT__().obstacleCount, obs: window.__SNAPSHOT__.obstacles() })`).then(s => JSON.parse(s));
  ok(l5.layout === 'variantB' && l5.count === 6 && l5.obs.every(o => (o.maxX - o.minX) < 1.3 && (o.maxZ - o.minZ) < 1.3), 'L5 切 variantB：6 柱无隔断', { layout: l5.layout, count: l5.count });
  await evalJS('window.__SNAPSHOT__.loadLevel(1)');
  await sleep(500);
  const l1b = await evalJS(`JSON.stringify({ layout: window.__SNAPSHOT__().layout, count: window.__SNAPSHOT__().obstacleCount })`).then(s => JSON.parse(s));
  ok(l1b.layout === 'default' && l1b.count === 9, '回 L1 = 9（清场无残留，旧碰撞盒不成隐形墙）', l1b);

  // ---- 3c. M3 真身怪种：L4 含蟹 / L5 含精英（__SNAPSHOT__ monsters.type）----
  await evalJS('window.__SNAPSHOT__.loadLevel(4)');
  await sleep(500);
  const l4 = await evalJS(`JSON.stringify(window.__SNAPSHOT__().monsters.map(m => m.type))`).then(s => JSON.parse(s));
  ok(l4.length === 8, 'L4 开局同场 8（9 只超编 → 同场上限，M5b §4.1）', l4.length);
  ok(l4.filter(t => t === 'crab').length === 4, 'L4 含 4 只迅捷蟹', l4);
  await evalJS('window.__SNAPSHOT__.loadLevel(5)');
  await sleep(500);
  const l5m = await evalJS(`JSON.stringify(window.__SNAPSHOT__().monsters.map(m => m.type))`).then(s => JSON.parse(s));
  ok(l5m.length === 7, 'L5 刷怪总数 7（精英红1+红3+蓝3）', l5m.length);
  ok(l5m.filter(t => t === 'eliteRed').length === 1, 'L5 含 1 只精英红', l5m);

  // ---- 3d. M4 武器授予与切枪链路 ----
  await evalJS('window.__SNAPSHOT__.loadLevel(3)');
  await sleep(500);
  await evalJS('window.__SNAPSHOT__.cheatKillAll()');
  await sleep(3000);   // 结算写盘（applyLevelResult 同事务发枪）
  const weaponsState = await evalJS('JSON.stringify(window.__SNAPSHOT__.weapons())').then(s => JSON.parse(s));
  ok(weaponsState.owned.includes('shotgun'), 'L3 通关 → 存档同事务授予霰弹枪（§7）', weaponsState.owned);
  await evalJS('window.__SNAPSHOT__.loadLevel(4)');   // 回 playing 态才能切枪
  await sleep(500);
  await evalJS('window.__SNAPSHOT__.switchWeapon("shotgun")');
  await sleep(700);   // 0.4s 切枪动画
  const afterSwitch = await evalJS('JSON.stringify({ current: window.__SNAPSHOT__.weapons().current, ammo: window.__SNAPSHOT__().currentAmmo })').then(s => JSON.parse(s));
  ok(afterSwitch.current === 'shotgun' && afterSwitch.ammo === 6, '切霰弹 → 武器名/弹匣 6', afterSwitch);
  await evalJS('window.__SNAPSHOT__.switchWeapon("ak47")');
  await sleep(700);
  const backAk = await evalJS('JSON.stringify({ current: window.__SNAPSHOT__.weapons().current, ammo: window.__SNAPSHOT__().currentAmmo })').then(s => JSON.parse(s));
  ok(backAk.current === 'ak47' && backAk.ammo === 30, '切回 AK → 30 发（弹药分存记忆）', backAk);

  // ---- 3e. M5a Boss 三阶段：L7 入场/转场回血/召唤/胜利链路（§5.3）----
  // 节奏设计：Boss 出生点距玩家 42m，chaseSpeed 3.2 → 探针窗口内Boss够不到玩家；
  // 召唤蟹 8m/s 会在 ~2s 后咬人，故 P3 断言后立即击杀 Boss 并清场（setPlayerHealth(100) 兜底）。
  await evalJS('window.__SNAPSHOT__.loadLevel(7)');
  await sleep(800);
  const l7mon = await evalJS('JSON.stringify(window.__SNAPSHOT__().monsters.map(m => m.type))').then(s => JSON.parse(s));
  ok(l7mon.length === 1 && l7mon[0] === 'boss', 'L7 只刷 Boss（spawns 空，boss 字段承载）', l7mon);
  const boss0 = await evalJS('JSON.stringify(window.__SNAPSHOT__.boss())').then(s => JSON.parse(s));
  ok(boss0 && boss0.maxHealth === 6000, 'Boss 6000 HP（不吃 k，§2 适用范围条款）', boss0);
  ok(boss0.state === 'entrance' && boss0.invuln === true, '入场演出期：entrance 态 + 不可受击（§5.3）', boss0);

  await sleep(1500);   // 入场光柱 1.5s
  const bossIn = await evalJS('JSON.stringify(window.__SNAPSHOT__.boss())').then(s => JSON.parse(s));
  ok(bossIn.state === 'chase' && bossIn.invuln === false, '入场结束 → chase 态 + 可受击', bossIn);

  // P1 → P2 转场：扣到 69%（4140/6000），玩家 20 血 + 转场回血 30 → 50
  await evalJS('window.__SNAPSHOT__.setPlayerHealth(20)');
  await evalJS('window.__SNAPSHOT__.bossDamage(6000 - 4140)');
  await sleep(300);
  const bossT2 = await evalJS('JSON.stringify(window.__SNAPSHOT__.boss())').then(s => JSON.parse(s));
  const hpT2 = await evalJS('window.__SNAPSHOT__().playerHealth');
  ok(bossT2.phase === 2 && bossT2.invuln === true, '69% → P2 转场 + 2s 无敌', bossT2);
  ok(hpT2 === 50, '转场回血 +30（20 → 50，§5.3 ⚗️ heal 30）', hpT2);

  await sleep(2200);   // 转场 2s 播完
  const bossC2 = await evalJS('JSON.stringify(window.__SNAPSHOT__.boss())').then(s => JSON.parse(s));
  ok(bossC2.state === 'chase' && bossC2.invuln === false, '转场结束 → chase + 可受击', bossC2);

  // P2 → P3 转场 + 召唤：扣到恰好 40% → phase 3；转场 2s + firstDelay 2.5s 后 3 蟹落位
  await evalJS('window.__SNAPSHOT__.setPlayerHealth(100)');   // 蟹很快贴脸，回满防探针中途团灭
  await evalJS('window.__SNAPSHOT__.bossDamage(4140 - 2400)');
  await sleep(300);
  const bossT3 = await evalJS('JSON.stringify(window.__SNAPSHOT__.boss())').then(s => JSON.parse(s));
  ok(bossT3.phase === 3 && bossT3.invuln === true, '40% → P3 转场', bossT3);
  await sleep(5300);   // 转场 2s + firstDelay 2.5s + 落位余量
  const bossS3 = await evalJS('JSON.stringify(window.__SNAPSHOT__.boss())').then(s => JSON.parse(s));
  ok(bossS3 && bossS3.adds === 3, 'P3 召唤 3 只迅捷蟹（firstDelay 后首波，§5.3）', bossS3);

  // 击杀 Boss → 蟹残留不结算（清 adds 是设计的一部分）；清场 → victory + unlocked 7
  await evalJS('window.__SNAPSHOT__.bossDamage(6000)');
  await sleep(2500);   // Boss 死亡动画 1.8s 播完移除
  const afterBossDeath = await evalJS('JSON.stringify({ s: window.__SNAPSHOT__().status, b: window.__SNAPSHOT__.boss() })').then(s => JSON.parse(s));
  ok(afterBossDeath.s === 'playing' && afterBossDeath.b === null, 'Boss 死 + 蟹在场 → 不结算，boss() 为 null', afterBossDeath);
  await evalJS('window.__SNAPSHOT__.cheatKillAll()');
  await sleep(3000);
  const l7victory = await evalJS(`JSON.stringify((() => {
    const q = (id) => document.getElementById(id);
    return {
      status: window.__SNAPSHOT__().status,
      title: q('end-title').textContent,
      nextVisible: !q('next-btn').classList.contains('hidden'),
      bossBarHidden: q('boss-bar').classList.contains('hidden'),
      save: window.__SNAPSHOT__.saveRead().save,
    };
  })())`).then(s => JSON.parse(s));
  ok(l7victory.status === 'ended' && l7victory.title === '通关 · 主宰降临', 'L7 通关结算', l7victory);
  ok(l7victory.nextVisible === false, 'L7 为最后一关：不显示下一关按钮', l7victory.nextVisible);
  ok(l7victory.bossBarHidden === true, '结算后 Boss 血条隐藏', l7victory.bossBarHidden);
  ok(l7victory.save.unlocked === 7, 'L7 通关 → unlocked 7（§7 封顶）', l7victory.save.unlocked);

  // ---- 3f. M5b 补位队列：L6 同场上限 + FIFO 补位节奏（§4.1）----
  // 节奏：死亡动画 0.9s 播完（removeMonster）才出队 → 补位怪携 1s spawnHold 入场。
  await evalJS('window.__SNAPSHOT__.loadLevel(6)');
  await sleep(800);
  const l6q = await evalJS('JSON.stringify({ alive: window.__SNAPSHOT__().monsters.length, queue: window.__SNAPSHOT__().spawnQueue })').then(s => JSON.parse(s));
  ok(l6q.alive === 8, 'L6 开局同场 8（11 只超编 → 同场上限，§4.1）', l6q.alive);
  ok(JSON.stringify(l6q.queue) === '["crab","crab","crab"]', 'FIFO 队列 = 蟹×3（splitSpawns 切分）', l6q.queue);

  // 杀 1 只（首只 = 精英红）：死亡动画期间 dying 占位不触发补位（§9 风险行）
  await evalJS('window.__SNAPSHOT__.hurtMonster(0, 99999)');
  await sleep(200);
  const l6dying = await evalJS('JSON.stringify({ alive: window.__SNAPSHOT__().monsters.length, queue: window.__SNAPSHOT__().spawnQueue, red: document.getElementById("monster-count-red").textContent })').then(s => JSON.parse(s));
  ok(l6dying.queue.length === 3, '死亡动画期间队列不减（removeMonster 才补位）', l6dying.queue);
  ok(l6dying.alive === 7 && l6dying.red === '3', 'dying 不计入存活数，HUD = 场上 + 队列（坦诚总账）', l6dying);

  await sleep(1200);   // 死亡动画 0.9s + 补位落位余量
  const l6refill = await evalJS('JSON.stringify({ alive: window.__SNAPSHOT__().monsters.length, queue: window.__SNAPSHOT__().spawnQueue, crab: document.getElementById("monster-count-crab").textContent })').then(s => JSON.parse(s));
  ok(l6refill.queue.length === 2, '动画播完 → 出队 1 只（队列 3 → 2）', l6refill.queue);
  ok(l6refill.alive === 8, '同场回到 8（补位怪含 1s spawnHold 光柱期）', l6refill.alive);
  ok(l6refill.crab === '3', '蟹计数 = 场上 1（补位蟹 hold 期）+ 队列 2（坦诚总账）', l6refill.crab);

  // 清场：cheatKillAll 连队列一并作废（调试面语义）→ victory 且队列 0
  await evalJS('window.__SNAPSHOT__.cheatKillAll()');
  await sleep(3000);
  const l6v = await evalJS(`JSON.stringify((() => {
    const q = (id) => document.getElementById(id);
    return {
      status: window.__SNAPSHOT__().status,
      title: q('end-title').textContent,
      queue: window.__SNAPSHOT__().spawnQueue,
      save: window.__SNAPSHOT__.saveRead().save,
    };
  })())`).then(s => JSON.parse(s));
  ok(l6v.status === 'ended' && l6v.title === '通关 · 风暴前夕', 'L6 通关结算（队列不影响胜利判定）', l6v);
  ok(l6v.queue.length === 0, '结算时队列已清空', l6v.queue);
  ok(l6v.save.unlocked === 7, 'L6 通关 → 解锁 L7', l6v.save.unlocked);

  // ---- 4. 阵亡路径：L2 挂机等死 → F + 不写盘 ----
  let engaged = false;
  for (let i = 0; i < 10; i++) {
    await evalJS('window.__SNAPSHOT__.loadLevel(2)');
    await sleep(600);
    const s = await snap();
    if (s && s.monsters.length) {
      const minDist = Math.min(...s.monsters.map(m => Math.hypot(m.x - s.playerX, m.z - s.playerZ)));
      if (minDist < 15) { engaged = true; break; }
    }
  }
  ok(engaged, 'L2 有怪刷进警戒区（挂机可被击杀）');
  const revBefore = (await evalJS('JSON.stringify(window.__SNAPSHOT__.saveRead().save)').then(s => JSON.parse(s))).revision;   // 阵亡前基准（含 3d 授予写盘）
  for (let i = 0; i < 25; i++) {
    await sleep(3000);
    const s = await snap();
    if (s && s.status === 'ended') break;
  }
  const deathUI = await evalJS(`JSON.stringify((() => {
    const q = (id) => document.getElementById(id);
    return {
      status: window.__SNAPSHOT__().status,
      title: q('end-title').textContent,
      grade: q('grade-letter').textContent,
      nextHidden: q('next-btn').classList.contains('hidden'),
      save: window.__SNAPSHOT__.saveRead().save,
    };
  })())`).then(s => JSON.parse(s));
  ok(deathUI.status === 'ended' && deathUI.grade === 'F' && deathUI.title === '你已阵亡', '阵亡 → F 结算', deathUI);
  ok(deathUI.nextHidden === true, '阵亡不出现下一关按钮', deathUI.nextHidden);
  ok(!deathUI.save.levels['2'] && deathUI.save.revision === revBefore, '阵亡不写盘（§7）', deathUI.save);

  // ---- 5. 移动端选关卡片两列（§7）----
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: true });
  await send('Page.reload');
  await sleep(6000);
  const cols = await evalJS(`(async () => {
    document.getElementById('select-btn').click();
    await new Promise(r => setTimeout(r, 200));
    return getComputedStyle(document.getElementById('level-grid')).gridTemplateColumns.split(' ').length;
  })()`);
  ok(cols === 2, '移动端选关卡片两列（§7）', cols);

  console.log('');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close();
  chrome.kill();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(1); });
