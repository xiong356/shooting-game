const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = 3000;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url;
  file = path.join(ROOT, file);
  const ext = path.extname(file).toLowerCase();

  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found: ' + req.url);
  }
});

// 端口被占用（很可能上次双击的服务器还在运行）→ 直接打开已有服务器并退出
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log('端口 ' + PORT + ' 已被占用，检测到服务器可能已在运行。');
    console.log('直接打开已有游戏服务器...');
    openBrowser(PORT);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log('游戏服务器已启动: http://' + HOST + ':' + PORT);
  console.log('按 Ctrl+C 停止服务器。');
  // 等服务器完全就绪后自动打开浏览器
  setTimeout(() => openBrowser(PORT), 800);
});

let browserOpened = false;

/** 调用系统默认浏览器打开游戏页面（兼容 Win / macOS / Linux） */
function openBrowser(port) {
  if (browserOpened) return;
  browserOpened = true;
  const url = 'http://' + HOST + ':' + port;
  const cmd = process.platform === 'win32'
    ? 'start "" "' + url + '"'
    : process.platform === 'darwin'
      ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
  exec(cmd, (execErr) => {
    if (execErr) console.log('浏览器未自动打开，请手动访问: ' + url);
  });
}
