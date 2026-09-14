// CDP 实机验证：野怪不穿墙 + 正面被挡会绕行（不会永久卡死）
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const PROFILE = path.join(require('os').tmpdir(), 'cdp-monster');
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
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r && r.result ? r.result.value : null;
  };
  const snap = () => evalJS('JSON.stringify(window.__SNAPSHOT__())').then(s => s ? JSON.parse(s) : null);

  const booted = await evalJS('!!(window.__GAME_BOOTED__ && window.__SNAPSHOT__)');
  ok(booted, '游戏已启动且快照可用');
  if (!booted) { ws.close(); chrome.kill(); process.exit(1); }

  await evalJS('document.getElementById("start-btn").click()');
  await sleep(800);

  const obs = JSON.parse(await evalJS('JSON.stringify(window.__SNAPSHOT__.obstacles())'));
  ok(obs.length === 9, '9 个实体障碍', obs.length);

  const geoExpr = [
    '(function(){',
    '  var b = document.getElementById("joystick-base").getBoundingClientRect();',
    '  return JSON.stringify({jx: b.left + b.width/2, jy: b.top + b.height/2, jr: b.width/2 - 24});',
    '})()',
  ].join('\n');
  const geo = JSON.parse(await evalJS(geoExpr));

  // 玩家一路向前，被 (0,-35) 的柱子挡在 z=-34.0 后站定
  // 停在场中央偏后：野怪生成在 x[-24,24] z[-44,10] 均匀分布，
  // 停到 z=-34 那种场地深处会导致观察期内根本没有野怪进入警戒区，采样无效。
  const fwd = [{ x: geo.jx, y: geo.jy - geo.jr, id: 1 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fwd });
  await sleep(3200);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: fwd });
  await sleep(500);
  let s = await snap();
  ok(s.playerZ < -12 && s.playerZ > -30, '玩家已跑到中场并停下', s.playerZ.toFixed(3));

  // 疾跑会把野怪甩掉（玩家 7.2 / 野怪 2.5，拉开 12 就脱离警戒区停下），
  // 所以停车后要主动朝最近的一只走过去触发警戒，否则观察期内可能一只都不动，采样无效。
  // 相机水平角全程为 0：world(dirX, dirZ) 对应 joystick(x=dirX, y=dirZ)。
  for (let attempt = 0; attempt < 25; attempt++) {
    const st = await snap();
    let nearest = null, nd = Infinity;
    for (const m of st.monsters) {
      const d = Math.hypot(m.x - st.playerX, m.z - st.playerZ);
      if (d < nd) { nd = d; nearest = m; }
    }
    if (!nearest || nd <= 9) break;
    const ux = (nearest.x - st.playerX) / nd;
    const uz = (nearest.z - st.playerZ) / nd;
    const pts2 = [{ x: geo.jx + ux * geo.jr * 0.55, y: geo.jy + uz * geo.jr * 0.55, id: 1 }];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts2 });
    await sleep(400);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts2 });
    await sleep(120);
  }
  await sleep(400);
  s = await snap();
  {
    let nd2 = Infinity;
    for (const m of s.monsters) {
      nd2 = Math.min(nd2, Math.hypot(m.x - s.playerX, m.z - s.playerZ));
    }
    console.log('  接近完成后，最近野怪距离 ' + nd2.toFixed(2) + 'm（警戒区 12）');
  }

  console.log('\n=== 观察 20 秒：野怪从各方向聚拢 ===');
  const MONSTER_RADIUS = 0.65;
  const SAMPLES = 100;   // 30 秒
  let insideCount = 0, worstPenetration = 0, everAlerted = new Set();
  const minDist = new Map();   // id -> 与玩家的最近距离
  let sawAvoid = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const st = await snap();
    for (const m of st.monsters) {
      if (m.alert) everAlerted.add(m.id);
      if (m.avoidSide) sawAvoid++;
      const d = Math.hypot(m.x - st.playerX, m.z - st.playerZ);
      minDist.set(m.id, Math.min(minDist.get(m.id) === undefined ? Infinity : minDist.get(m.id), d));
      // 是否嵌进任何障碍（留 1e-6 容差）
      for (const o of obs) {
        const cx = Math.max(o.minX, Math.min(m.x, o.maxX));
        const cz = Math.max(o.minZ, Math.min(m.z, o.maxZ));
        const dd = Math.hypot(m.x - cx, m.z - cz);
        if (dd < MONSTER_RADIUS - 1e-6) {
          insideCount++;
          worstPenetration = Math.max(worstPenetration, MONSTER_RADIUS - dd);
        }
      }
    }
    await sleep(300);
  }

  s = await snap();
  console.log('  最终：' + s.monsters.length + ' 只存活野怪，曾进入警戒的 ' + everAlerted.size + ' 只');
  console.log('  曾观测到绕行侧被选定的采样次数: ' + sawAvoid);

  console.log('\n=== 断言 ===');
  ok(insideCount === 0, '【核心】20 秒内没有任何野怪嵌进障碍物', insideCount + ' 次，最深 ' + worstPenetration.toFixed(4) + 'm');

  // 曾警戒的野怪最终都必须到达玩家身边（否则就是被柱子永久卡住了）
  let notReached = [];
  for (const mid of everAlerted) {
    const d = minDist.get(mid);
    if (!(d <= 1.8 + 1.2)) notReached.push('#' + mid + ' 最近 ' + (d === undefined ? '?' : d.toFixed(2)));
  }
  ok(everAlerted.size >= 1, '观察期内至少有野怪进入警戒区（样本有效）', everAlerted.size);
  ok(notReached.length === 0, '每只曾警戒的野怪都追到了玩家身边（无永久卡死）', notReached.join(' | '));

  const exceptions = events.filter(e => e.method === 'Runtime.exceptionThrown');
  ok(exceptions.length === 0, '运行时异常 0', exceptions.length);
  exceptions.forEach(e => console.log('     ' + ((e.params.exceptionDetails.exception || {}).description || '').split('\n')[0]));
  const cerr = events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
  ok(cerr.length === 0, 'console.error 0', cerr.length);

  if (process.env.SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      fs.writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64'));
      console.log('\nSHOT -> ' + process.env.SHOT);
    }
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('PROBE ERROR:', e.stack || e.message); process.exit(1); });
