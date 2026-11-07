'use strict';
// 电脑版外壳给游戏网页的接口 window.dsDesktop（js/platform.js 用）：退出、全屏；网页本身碰不到 Node 与 Electron
const { contextBridge, ipcRenderer } = require('electron');
let fs = ipcRenderer.sendSync('ds:fs?');
const fns = [];
ipcRenderer.on('ds:fs', (e, on) => { fs = !!on; for (const f of fns) { try { f(fs); } catch (err) { console.error(err); } } });
contextBridge.exposeInMainWorld('dsDesktop', {
  quit: () => ipcRenderer.send('ds:quit'),
  fullscreen: () => fs,
  setFullscreen: on => ipcRenderer.send('ds:fs', !!on),
  onFullscreen: f => { if (typeof f === 'function') fns.push(f); }
});
