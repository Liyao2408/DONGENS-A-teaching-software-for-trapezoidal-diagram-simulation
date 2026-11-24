/* 预加载：把窗口控制暴露给页面（contextIsolation 下的安全桥） */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tiaWin', {
  isDesktop: true,
  min: function () { ipcRenderer.send('win-min'); },
  max: function () { ipcRenderer.send('win-max'); },
  close: function () { ipcRenderer.send('win-close'); }
});
