'use strict';
// 暗剑电脑版（Steam）外壳：Electron 开一个窗口装游戏网页（app/ 是 tools/build_www.mjs --app 生成的商店版网页）
//   全屏与窗口位置存在用户数据目录的 window.json，下次照此打开；F11、Alt+Enter 切全屏（游戏设置里也能切）
//   从 Steam 启动时接上 Steamworks（steamworks.js）：Shift+Tab 的 Steam 游戏内界面；没装上或没开 Steam 时照常运行
const { app, BrowserWindow, ipcMain, Menu, shell, screen, powerSaveBlocker } = require('electron');
const fs = require('fs'), path = require('path');

// Steam 启动游戏时会设 SteamAppId 环境变量；自己测试时在可执行文件旁放一个 steam_appid.txt（只写 App ID）
if (process.env.SteamAppId || process.env.SteamGameId || fs.existsSync(path.join(path.dirname(process.execPath), 'steam_appid.txt'))) {
  try {
    const sw = require('steamworks.js');
    sw.init();
    sw.electronEnableSteamOverlay();   // 覆盖层要画进游戏窗口：GPU 放进主进程、每帧重绘
  } catch (e) { console.warn('Steamworks 没有接上：', e && e.message); }
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // 开始界面的音乐不必等第一次点击
app.commandLine.appendSwitch('ignore-gpu-blocklist');   // 有的旧显卡在 Chromium 黑名单里，WebGL 会退回软件渲染，3D 沙盘慢得没法玩
app.commandLine.appendSwitch('force_high_performance_gpu');   // 双显卡笔记本用独显

// 关掉拼写检查、清空词典语言：不然 Chromium 一启动就去谷歌下载拼写词典——游戏应该完全不联网（隐私政策这么写的）
app.on('session-created', s => { s.setSpellCheckerEnabled(false); s.setSpellCheckerLanguages([]); });

const STATE = path.join(app.getPath('userData'), 'window.json');
let win = null, normal = null, awake = -1;
function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(STATE, JSON.stringify({ fullscreen: win.isFullScreen(), maximized: win.isMaximized(), bounds: normal })); } catch (e) { /* 存不了下次用默认 */ }
}
// 熄屏：游戏窗口在前台时不让显示器自己熄掉
function keepAwake(on) {
  if (on && awake < 0) awake = powerSaveBlocker.start('prevent-display-sleep');
  else if (!on && awake >= 0) { powerSaveBlocker.stop(awake); awake = -1; }
}

function createWindow() {
  const st = loadState(), b = st.bounds, wa = screen.getPrimaryDisplay().workArea;
  // 存的位置在已经拔掉的显示器上就不用；第一次打开：主屏的九成大小、16:9
  const seen = b && screen.getAllDisplays().some(d => { const a = d.workArea; return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 40 && b.y + b.height > a.y + 40; });
  const w = Math.min(1600, Math.round(wa.width * .9)), h = Math.min(Math.round(w * 9 / 16), Math.round(wa.height * .9));
  normal = seen ? b : { x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h };
  win = new BrowserWindow({
    ...normal, minWidth: 960, minHeight: 540, fullscreen: st.fullscreen !== false,
    show: false, backgroundColor: '#020704', title: '暗剑 Darksword', icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged }
  });
  win.once('ready-to-show', () => { if (st.maximized && !win.isFullScreen()) win.maximize(); win.show(); });
  const track = () => { if (!win.isFullScreen() && !win.isMaximized() && !win.isMinimized()) normal = win.getBounds(); };
  win.on('resize', track); win.on('move', track);
  const fsTell = () => { if (!win.isDestroyed()) win.webContents.send('ds:fs', win.isFullScreen()); saveState(); };
  win.on('enter-full-screen', fsTell); win.on('leave-full-screen', fsTell);
  win.on('close', saveState);
  win.on('focus', () => keepAwake(true)); win.on('blur', () => keepAwake(false));
  const wc = win.webContents;
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11' || (i.key === 'Enter' && i.alt)) { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    else if (i.key === 'F12' && !app.isPackaged) wc.toggleDevTools();
  });
  // 只显示游戏自己的页面：外部链接（协议页里的反馈地址）交给系统浏览器
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  wc.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit' && !win.isDestroyed()) wc.reload(); });   // 页面崩了（显存不够之类）重新打开，不留一块黑屏
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

ipcMain.on('ds:quit', () => app.quit());
ipcMain.on('ds:fs', (e, on) => { if (win && !win.isDestroyed()) win.setFullScreen(!!on); });
ipcMain.on('ds:fs?', e => { e.returnValue = !!(win && !win.isDestroyed() && win.isFullScreen()); });

if (!app.requestSingleInstanceLock()) app.quit();   // 已经开着一个：把那个窗口叫到前面，自己退出
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    // 不要菜单栏（Alt 键也不唤出）；macOS 留应用菜单（Cmd+Q）和编辑菜单（输入框里复制粘贴）
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());   // 游戏：关了窗口就退出（macOS 也是）
}
