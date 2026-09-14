// CDP 实机回归：行走三档速度 / 脚步 / 暂停不推进 / 无异常
// 必备配置：触摸模拟 + Page.reload + 禁用 overscroll 返回手势（见 CONTRIBUTING.md）
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9340;
const PROFILE = path.join(require('os').tmpdir(), 'cdp-walkreg');
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
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation',
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
  let id = 0; const pending = new Map(); const events = [];
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method) events.push(m);
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.reload');
  await sleep(7000);

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r && r.result ? r.result.value : null;
  };
  const snap = () => evalJS('JSON.stringify(window.__SNAPSHOT__())').then(v => v ? JSON.parse(v) : null);

  const booted = await evalJS('!!(window.__GAME_BOOTED__ && window.__SNAPSHOT__)');
  ok(booted, '游戏启动且快照可用');
  if (!booted) { ws.close(); chrome.kill(); process.exit(1); }
  await evalJS('document.getElementById("start-btn").click()');
  await sleep(800);

  const geoExpr = ['(function(){',
    '  var b = document.getElementById("joystick-base").getBoundingClientRect();',
    '  return JSON.stringify({jx: b.left + b.width/2, jy: b.top + b.height/2, jr: b.width/2 - 24});',
    '})()'].join('\n');
  const geo = JSON.parse(await evalJS(geoExpr));
  let pts = [];
  const touch = (t) => send('Input.dispatchTouchEvent', { type: t, touchPoints: pts });

  console.log('\n=== 三档速度 ===');
  pts = [{ x: geo.jx, y: geo.jy - geo.jr * 0.5, id: 1 }];
  await touch('touchStart'); await sleep(1000);
  let s = await snap();
  ok(Math.abs(s.speed - 2.1) < 0.05, '半推杆 = 2.1', s.speed);
  const p0 = await snap(); const t0 = Date.now();
  await sleep(1500);
  const p1 = await snap();
  const measured = Math.hypot(p1.playerX - p0.playerX, p1.playerZ - p0.playerZ) / ((Date.now() - t0) / 1000);
  ok(Math.abs(measured - 2.1) < 0.25, '位移法实测 ≈ 2.1（双重缩放会得 1.05）', measured.toFixed(3));

  pts = [{ x: geo.jx, y: geo.jy - geo.jr, id: 1 }];
  await touch('touchMove'); await sleep(1200);
  s = await snap();
  ok(Math.abs(s.speed - 7.2) < 0.1, '满推杆 = 7.2', s.speed);

  console.log('\n=== 步频与脚步同步 ===');
  await sleep(1000);
  const c0 = (await snap()).footstepCount;
  await sleep(4000);
  const sp = await snap();
  const rate = (sp.footstepCount - c0) / 4.0;
  ok(Math.abs(rate - 4.16) < 0.5, '疾跑步频 ≈ 4.16 步/秒', rate.toFixed(2));
  ok(Math.abs(rate - sp.stepRate) < 0.35, '实测步频与 stepRate 预测一致（脚不打滑）',
     rate.toFixed(2) + ' vs ' + sp.stepRate.toFixed(2));
  let worst = 0;
  for (const e of sp.footstepLog) worst = Math.max(worst, Math.abs(Math.cos(2 * e.phase) - 1));
  ok(worst < 1e-9, '每次落脚都落在摆动最低点', worst);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts });
  await sleep(600);

  console.log('\n=== 暂停不推进 ===');
  await evalJS('window.__SNAPSHOT__.pause()');
  await sleep(300);
  const a1 = await snap(); await sleep(700); const a2 = await snap();
  ok(a1.status === 'paused', '状态为 paused', a1.status);
  ok(a1.swayPhase === a2.swayPhase && a1.camY === a2.camY, '暂停期间相位与相机完全不动');
  await evalJS('window.__SNAPSHOT__.resume()');
  await sleep(400);
  ok((await snap()).status === 'playing', '恢复正常');

  console.log('\n=== 异常 ===');
  const ex = events.filter(e => e.method === 'Runtime.exceptionThrown');
  const ce = events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
  ok(ex.length === 0, '运行时异常 0', ex.length);
  ex.forEach(e => console.log('     ' + ((e.params.exceptionDetails.exception || {}).description || '').split('\n')[0]));
  ok(ce.length === 0, 'console.error 0', ce.length);

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('PROBE ERROR:', e.stack || e.message); process.exit(1); });
