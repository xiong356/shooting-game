# Errors

Command failures and integration errors.

---

## [ERR-20260807-001] start_bat_chinese_encoding

**Logged**: 2026-08-07T23:40:00+08:00
**Priority**: critical
**Status**: resolved
**Area**: config

### Summary
start.bat 双击后不启动游戏。根因：bat 文件用 UTF-8（无 BOM）写入中文内容，但 Windows cmd 默认用 GBK 代码页解析 .bat 文件，`chcp 65001` 对已读入行解析不可靠，导致中文行被当作命令执行、`if (...)` 块被破坏，`node server.js` 根本没执行。

### Error
```
'娴忚�堝櫒灏嗚嚜鍔ㄦ墦寮€娓告垙椤甸潰' 不是内部或外部命令
'f' 不是内部或外部命令
'end' 不是内部或外部命令
=== port === NO SERVER
```

### Context
- start.bat 含中文提示（title/echo），保存为 UTF-8 无 BOM
- cmd.exe 解析 .bat 时默认使用系统代码页 (GBK, cp936)
- 之前已踩过 UTF-8 BOM 的坑，这次是无 BOM 中文也一样有坑

### Suggested Fix
bat 文件内容必须使用**纯 ASCII 英文**，彻底规避 cmd 编码解析问题。中文提示可以放在 server.js 的 node 输出（UTF-8 文件 + node 内部处理无碍）。

### Metadata
- Reproducible: yes
- Related Files: start.bat, server.js
- See Also: (之前 start.bat 的 UTF-8 BOM 问题)

### Resolution
- **Resolved**: 2026-08-07T23:40:00+08:00
- **Notes**: 重写 start.bat 为纯 ASCII 英文。测试通过：服务器启动、端口监听、HTTP 200、浏览器 start 命令执行成功。

---

## [ERR-20260913-001] 双击 index.html 点击「进入训练」完全无反应

### Status
RESOLVED

### Symptom
用户直接双击 `index.html`（`file://` 协议）打开页面，点击「进入训练」按钮毫无反应，且页面不报任何错。
用 CDP 探针实测：点击前后 DOM 状态完全一致（`start-screen` 未隐藏、`hud` 仍 hidden、canvas 仍是 300px 默认尺寸）。

### Root Cause
`<script type="module" src="js/game.js">` 在 `file://` 协议下被浏览器 CORS 策略拦截：
```
Access to script at 'file:///.../js/game.js' from origin 'null' has been blocked by CORS policy:
Cross origin requests are only supported for protocol schemes: chrome, chrome-extension,
chrome-untrusted, data, http, https, isolated-app.
Failed to load resource: net::ERR_FAILED
```
game.js 一行都没有执行 → `init()` 未运行 → `start-btn` 的 click 监听器从未挂上 → 点击静默失效。
同样的限制还会让 `fetch`/XHR 加载 `assets/*.glb` 失败。

### Suggested Fix
1. 根本解法：必须通过 HTTP 访问（项目已提供 `start.bat` + `server.js`）。
2. 体验解法：不能让用户面对「点了没反应的死页面」，要显式检测并给出可执行指引。

### Fix Applied
`index.html` 内置「启动守卫」：`game.js` 模块顶部设 `window.__GAME_BOOTED__ = true`；
内联经典脚本每 1.5s 轮询一次共 4 次，若仍未置位则显示 `#boot-guard` 遮罩，明确告知原因并指引改用 `start.bat`。

### Verification
CDP 实测两场景：

| 场景 | startScreen hidden | hud hidden | bootGuard shown |
|---|---|---|---|
| `http://127.0.0.1:3000` | true ✅ | false ✅ | false |
| `file:///D:/.../index.html` | false | true | **true ✅** |

### Metadata
- Reproducible: yes
- Related Files: index.html, js/game.js, css/styles.css
- See Also: 用户此前问过的「为何浏览器直接打开页面无法正常显示」

---

## [ERR-20260913-002] ak47_2.glb 文件损坏导致枪模加载失败

### Status
RESOLVED（已加兜底，但高模文件本身仍缺失）

### Symptom
控制台：`AK-47 failed, fallback: Invalid typed array length: 187926`，FPS 视角看不到枪模，退回几何体拼凑枪。

### Root Cause
GLB 文件被截断：
```
实际大小 = 2056192 bytes
GLB 头声明 = 5068520 bytes   →  缺 3012328 bytes（约 2.9MB，BIN chunk 数据不完整）
```
典型的下载中断残留。GLTFLoader 解析 BIN chunk 时长度对不上，抛类型化数组错误。

### Fix Applied
新增 `loadFirstAvailableModel(paths)`：按顺序尝试 `assets/ak47_2.glb` → `assets/ak47.glb`，
并校验模型确实含网格（`isMesh` 计数为 0 视为失败）。`ak47.glb`（47684 bytes / 29 meshes）完整可用。

### Verification
控制台输出：
```
枪模不可用 assets/ak47_2.glb — Invalid typed array length: 187926
枪模就绪 assets/ak47.glb (meshes: 29)
FPS AK-47 center:(...) size:(0.046, 0.143, 0.600) ✓
```
截图证实 FPS 视角中枪模正常显示。

### Remaining
高模 `ak47_2.glb` 无法自行恢复，如需精细外观须重新下载完整的 AK-47 GLB。

### Metadata
- Reproducible: yes
- Related Files: assets/ak47_2.glb, assets/ak47.glb, js/game.js

---
