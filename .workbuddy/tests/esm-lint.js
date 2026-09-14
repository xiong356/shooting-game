// 可靠的 ESM 语法门禁
// 为什么需要它：node --check 对 .js 文件按 CommonJS 解析，会漏掉 ESM 的语法错误
// （实测：同一份含多余右括号的文件，.mjs 退出码 1，.js 退出码 0）
//
// 位置说明：本脚本原先放在系统 Temp 目录，2026-09-14 被 Windows 清理掉过一次，
// 故移入项目内 .workbuddy/tests/ 以免再次丢失。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');   // 从脚本自身位置推导，避免硬编码路径写错
const TMP = path.join(__dirname, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['js/game.js'];
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
