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
  const revBefore = afterReload.revision;
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
