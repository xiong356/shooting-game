// 可靠的 ESM 语法门禁 + 配置层静态规则
// 为什么需要它：node --check 对 .js 文件按 CommonJS 解析，会漏掉 ESM 的语法错误
// （实测：同一份含多余右括号的文件，.mjs 退出码 1，.js 退出码 0）
//
// 位置说明：本脚本原先放在系统 Temp 目录，2026-09-14 被 Windows 清理掉过一次，
// 故移入项目内 .workbuddy/tests/ 以免再次丢失。
//
// M0.5⑥ 扩展（§8.0 / §8.1）：
//   ① 默认目标扩为全部 js 模块（可命令行传参覆盖）；
//   ② 规则「所有武器必须有 sprayPattern 字段（可为空数组，不可为 null/undefined）」；
//   ③ 规则「LEVELS 逐行过 validateLevels schema 校验」（校验器真身在 js/config/levels.js，
//      此处 import 真实实现，不复制规则——避免门禁与实现漂移）。
// ② 依赖把 .mjs 副本 import 回 node 求值：配置层文件（weapons/levels）是纯数据+纯函数，
// 无裸模块说明符与 DOM 依赖，可安全 import；game.js/monsters.js/save.js 则只做语法检查。
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');   // 从脚本自身位置推导，避免硬编码路径写错
const TMP = path.join(__dirname, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

const targets = process.argv.slice(2).length ? process.argv.slice(2) : [
  'js/game.js',
  'js/monsters.js',
  'js/save.js',
  'js/config/weapons.js',
  'js/config/levels.js',
];
let failed = 0;

for (const rel of targets) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.log('文件不存在: ' + rel);
    failed++;
    continue;
  }

  const dst = path.join(TMP, path.basename(rel).replace(/\.js$/, '') + '.mjs');
  fs.copyFileSync(src, dst);

  try {
    execFileSync(process.execPath, ['--check', dst], { stdio: 'pipe' });
    console.log('[OK] ' + rel + '  ESM 语法通过');
  } catch (e) {
    failed++;
    const out = (e.stderr || e.stdout || Buffer.from('')).toString().split('\n');
    console.log('[FAIL] ' + rel + '  ESM 语法错误:');
    out.filter(l => l.trim()).slice(0, 8).forEach(l => console.log('     ' + l));
  }
}

async function main() {
  // ---- 规则②：所有武器必须有 sprayPattern 字段（§8.0 M0.5 迁移完成条款）----
  try {
    const mod = await import(pathToFileURL(path.join(TMP, 'weapons.mjs')).href);
    const W = mod.WEAPONS;
    const ids = W ? Object.keys(W) : [];
    if (!W || ids.length === 0) {
      console.log('[FAIL] WEAPONS 表缺失或为空');
      failed++;
    } else {
      let bad = 0;
      for (const id of ids) {
        if (!Array.isArray(W[id].sprayPattern)) {
          console.log('[FAIL] 武器 ' + id + ' 缺 sprayPattern 字段（可为空数组，不可为 null/undefined）');
          bad++;
        }
      }
      if (!bad) console.log('[OK] sprayPattern 字段检查: ' + ids.length + ' 把武器全部通过');
      failed += bad;
    }
  } catch (e) {
    console.log('[FAIL] 无法 import weapons.js 求值: ' + e.message);
    failed++;
  }

  // ---- 规则③：LEVELS schema 校验（§8.1，校验器真身在 js/config/levels.js）----
  try {
    const mod = await import(pathToFileURL(path.join(TMP, 'levels.mjs')).href);
    const errs = mod.validateLevels(mod.LEVELS);
    if (errs.length) {
      errs.forEach(x => console.log('[FAIL] LEVELS schema: ' + x));
      failed += errs.length;
    } else {
      console.log('[OK] LEVELS schema 校验: ' + mod.LEVELS.length + ' 关通过（M1 前空表合法）');
    }
  } catch (e) {
    console.log('[FAIL] 无法 import levels.js 求值: ' + e.message);
    failed++;
  }

  // 顺带检查 HTML 里引用的 id 是否都在 JS 里能找到对应 getElementById（防错别字）
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const queried = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const missing = [...new Set(queried)].filter(id => !ids.includes(id));
  console.log('');
  console.log('--- HTML / JS 元素 id 交叉校验 ---');
  console.log('  HTML 定义 id: ' + ids.length + ' 个，JS 查询: ' + [...new Set(queried)].length + ' 个');
  if (missing.length) {
    console.log('  [FAIL] JS 查询了 HTML 中不存在的 id: ' + missing.join(', '));
    failed++;
  } else {
    console.log('  [OK] 全部匹配');
  }

  process.exit(failed ? 1 : 0);
}

main();
