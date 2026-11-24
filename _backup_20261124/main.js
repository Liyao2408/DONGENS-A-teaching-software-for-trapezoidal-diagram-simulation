/* DONGENS Electron 外壳：无边框窗口（圆角），加载本地 index.html */
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

// 启动提速 + 稳定性：跳过 GPU 子进程初始化。
// 本应用是 DOM/SVG 界面，软渲染完全足够；避免个别环境下 GPU 子进程启动失败
// 导致整个应用直接退出的问题（实测某些机器/杀毒软件环境下会 FATAL）。
app.disableHardwareAcceleration();

var win = null;

// 单实例：重复启动时聚焦已有窗口并退出（避免多实例争抢 GPU 缓存导致互相崩溃，
// 也避免用户双击时感觉"启动慢"——第二次点击应立即唤起已开的窗口）
var gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(function () {
    // 去掉默认菜单（Alt 键可临时唤出）
    Menu.setApplicationMenu(null);
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    title: 'DONGENS DSI Platform 仿真教学版',
    backgroundColor: '#2b3a4a',
    // 去掉系统标题栏，由页面内 .titlebar（自带 ─ ☐ ✕）充当标题栏（对齐真实 TIA）
    frame: false,
    // Win11 下无边框窗口默认是直角，交给 DWM 画圆角
    roundedCorners: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 启动提速：不需要拼写检查（否则会加载词典、扫描页面文本）
      spellcheck: false
    }
  });

  // 页面内标题栏按钮 -> 窗口控制
  ipcMain.on('win-min', function () { if (win) win.minimize(); });
  ipcMain.on('win-max', function () {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on('win-close', function () { if (win) win.close(); });

  // 内容就绪后再显示，避免白屏闪烁
  win.once('ready-to-show', function () { win.show(); });

  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // 页面要求新开窗口时，一律在系统浏览器里打开（不创建新 Electron 窗口）
  win.webContents.setWindowOpenHandler(function (details) {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
