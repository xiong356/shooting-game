const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
  const opts = { stdio: 'ignore', detached: true };
  const onError = () => console.log('浏览器未自动打开，请手动访问: ' + url);
  // 一律参数数组直启进程：URL 作为独立参数传递，不经 shell 解析，无命令注入面。
  // （此前 exec('start "" "' + url + '"') 拼接 shell 命令串，被 Mimosa L3 判为命令注入模式。
  //   win32 用 rundll32 FileProtocolHandler 打开默认浏览器，避开 cmd /c start 的 shell 语义。）
  if (process.platform === 'win32') {
    spawn('rundll32', ['url.dll,FileProtocolHandler', url], opts).on('error', onError).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], opts).on('error', onError).unref();
  } else {
    spawn('xdg-open', [url], opts).on('error', onError).unref();
  }
}
