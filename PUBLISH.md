# 发布指南

本文说明如何把 DONGENS 发布到 GitHub，以及打包成桌面程序（exe）。

---

## 一、发布前准备

### 1. 生成 dist

```bash
node build-dist.js
```

生成 `dist/` 目录，包含：

| 文件 | 说明 |
|---|---|
| `index.html` + `css/` + `js/` | 标准网页版（14 个文件，约 330 KB） |
| `index-standalone.html` | **单文件版**（312 KB），所有 JS/CSS 内联，双击即用 |
| `README.md` / `start.bat` | 说明与启动脚本 |

`dist/` 里**不包含**测试文件、`node_modules`，可以直接上传。

### 2. 检查清单

```bash
# 全部测试通过再发布
npm run test:all
```

预期输出：

```
engine   : 36/36
instr    : 53/53
portal   : 11/11
tree     : 9/9
labels   : 14/14
ui       : 21/21
pointer  : 8/8
features : 11/11
```

---

## 二、发布到 GitHub Pages（推荐，最简单）

### 步骤

1. 在 GitHub 新建仓库，例如 `dongens-n26`

2. 在项目根目录初始化并推送：

```bash
cd dongens-n26
git init
git add .
git commit -m "feat: DSI Platform 仿真教学版 v1.0"

git branch -M main
git remote add origin https://github.com/<你的用户名>/dongens-n26.git
git push -u origin main
```

3. 打开仓库 → **Settings** → 左侧 **Pages**

4. Source 选择 **Deploy from a branch**
   - Branch: `main`
   - Folder: `/ (root)`

5. 点 **Save**，等约 1 分钟

6. 访问：`https://<你的用户名>.github.io/dongens-n26/`

> 因为 `index.html` 在根目录，直接就能打开。
> 如果只想发布构建产物，把 Pages 的 Folder 改成 `/dist` 也行。

### 注意事项

- **不要提交 `node_modules/`** —— `.gitignore` 已经排除
- 仓库体积很小（约 700 KB），远低于 GitHub 限制
- 项目用 localStorage 存数据，**在 GitHub Pages 上可以正常工作**（同域名下持久）
- GitHub Pages 是 HTTPS，localStorage 可用

---

## 三、发布成 exe（三种方案）

### 方案 A：Electron 打包（体积大但最稳，推荐给最终用户）

**优点**：就是真正的桌面程序，双击即开，有窗口图标
**缺点**：打包后约 150–200 MB（Electron 运行时本身就大）

```bash
npm install --save-dev electron electron-builder
```

创建 `main.js`：

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 1000,
    title: 'DSI Platform 仿真教学版',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'dist/index.html'));
}

app.whenReady().then(function () {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
```

`package.json` 里加：

```json
{
  "main": "main.js",
  "build": {
    "appId": "com.yourname.dongensn26",
    "productName": "DONGENS",
    "files": ["main.js", "dist/**/*"],
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

打包：

```bash
npx electron-builder --win
```

产物在 `release/` 里，是一个安装包 `.exe`。

---

### 方案 B：把网页包成本地服务 + 浏览器启动（体积小）

**优点**：只有几 MB，本质还是网页但体验接近桌面
**缺点**：会弹出一个浏览器窗口（可以做成无地址栏的 app 模式）

```bash
npm install --save-dev pkg
```

创建 `server.js`：

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, 'dist');
const PORT = 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', function () {
  const url = 'http://127.0.0.1:' + PORT + '/index.html';
  // 用 Chrome/Edge 的 app 模式打开，像独立窗口
  exec('start msedge --app=' + url, function () { });
  console.log('DONGENS 已启动：' + url);
});
```

打包成单个 exe：

```bash
npx pkg server.js --targets node18-win-x64 --output DONGENS.exe
```

然后要把 `dist/` 目录和 `DONGENS.exe` 放在一起分发（用压缩包）。

> 注意：`pkg` 打包后 `__dirname` 指向 exe 所在目录，所以 `dist` 要和 exe 同级。

---

### 方案 C：只发单文件 HTML（体积最小，零安装）

**优点**：312 KB，双击就能用，发给同学只需一个文件
**缺点**：不是 exe，图标是浏览器图标

直接分发 `dist/index-standalone.html`，改个名比如 `DONGENS.html` 即可。

想让它更像桌面程序，可以配一个 `.bat`：

```bat
@echo off
start "" msedge --app="%~dp0DONGENS.html" --window-size=1680,1000
```

---

## 四、三种方案对比

| | 体积 | 双击即用 | 有独立图标 | 数据持久化 |
|---|---|---|---|---|
| **GitHub Pages** | 0（在线） | 需要浏览器 | 否 | ✅ 同域名持久 |
| **单文件 HTML** | 312 KB | ✅ | 否 | ✅ file:// 下可用 |
| **方案 B 本地服务** | ~40 MB | ✅ | ✅ | ✅ |
| **方案 A Electron** | ~180 MB | ✅ | ✅ | ✅ |

**建议**：
- 发给同学试用 → **单文件 HTML**
- 正式发布收集反馈 → **GitHub Pages**
- 作为长期工具常驻电脑 → **方案 A Electron**

---

## 五、版本发布（GitHub Release）

```bash
git tag -a v1.0.0 -m "首个版本"
git push origin v1.0.0
```

然后在 GitHub 仓库 → **Releases** → **Draft a new release**
- 选择刚才的 tag
- 上传打包好的 `DONGENS-exe.zip` 或 `DONGENS.html`
- 写更新说明

---

## 六、许可证建议

项目当前是 MIT。如果想：

- **完全开放** → 保持 MIT
- **要求署名 + 开源衍生** → 改 GPL-3.0
- **仅个人学习，禁止商用** → 用 CC BY-NC-SA 4.0（注意：这不是软件许可证，严格说不如用 PolyForm Noncommercial）

> 提醒：本项目是**教学用仿真器**，不含任何第三方厂商代码或资源，图标和界面均为独立绘制。
> 项目名统一为 **Dongens Semi Integrated N26（DSI Platform）**，仓库名建议用 `dongens-n26`。

---

## 七、发布后建议补充的内容

1. **截图** —— README 里放 3–4 张（门户、LAD 编辑、在线监视、指令面板）
2. **演示 GIF** —— 用 ScreenToGif 录一段"编译→下载→监视→输入置位"的流程，最能说明问题
3. **在线 Demo 链接** —— GitHub Pages 地址放在 README 顶部
4. **功能对照表** —— 已经写在 README 里，保持更新
5. **已知限制** —— 明确写出"不做真实硬件通讯"，避免误解
