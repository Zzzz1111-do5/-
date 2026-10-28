// 商店素材（Steam、TapTap）：用 Playwright 开游戏，固定种子推演一局，拍实机截图和不带界面的宣传底图，合成各尺寸的胶囊图、封面、库图，再录一段实机视频
// 用法：NODE_PATH=$(npm root -g) node tools/store_assets.js [输出目录，默认 store/] [步骤，默认 ui,battle,compose,video]
//   需要 Playwright（全局安装即可）和 ffmpeg（录视频）；没有显卡的机器上软件渲染，全部跑完约一小时，视频占大半
//   输出：screens/ 实机截图（1920×1080，两个商店共用）、steam/、taptap/；art/ 无界面底图与 video/ 视频不进仓库（太大，compose 要先跑 battle 生成 art/）
//   商店图标（TapTap 512 / 1024、Steam 社区图标与客户端图标）由 tools/make_icons.py 生成
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'store'));
const STEPS = (process.argv[3] || 'ui,battle,compose,video').split(',');
const SEED = 464956244, T0 = 390, T = 520;   // 挑过的地图（中段滩头背后有城镇、树林和河口）；T0 登陆部队正冲上滩头（近景与视频），T 登陆场已建立
const LAUNCH = { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] };
const dir = d => { const p = path.join(OUT, d); fs.mkdirSync(p, { recursive: true }); return p; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 开一页游戏：随机数固定（同一份代码每次推演结果一样）、不放开场转场、闯关进度设成打过前三关
async function boot(b, w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => console.warn('页面错误：', e.message));
  await p.addInitScript(() => {
    let s = 20261028;
    Math.random = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    window.__seed = v => { s = v; };   // 开局、开战前各重置一次：等待时页面一直在画，画面用掉多少随机数跟机器快慢有关
    window.__rng = () => s;   // 读出当前状态（宣传片把推演和画面的随机数分开：画画用掉的随机数不影响战局）
    try { localStorage.clear(); localStorage.setItem('bh-settings', JSON.stringify({ intro: false })); localStorage.setItem('bh-levels', JSON.stringify({ done: [1, 2, 3] })); } catch (e) { /* 只影响取景 */ }
  });
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForFunction(() => typeof MENU === 'object' && MENU.open, null, { timeout: 90000 });
  await sleep(3000);
  await p.addStyleTag({ content: '#pauseBand, #buildTag { display: none !important; }' });   // 截图里不要「PAUSED」
  // 软件渲染一帧要一秒左右，游戏会以为设备跟不上而关掉移轴景深；按显卡机器上的样子拍（main.js 的 ema 是平均帧间隔）
  await p.evaluate(() => HOOK.frame.push(() => { ema = 1 / 60; }));
  return p;
}
const shot = (p, file, q = 88) => p.screenshot({ path: file, ...(file.endsWith('.jpg') ? { type: 'jpeg', quality: q } : {}) });

// 镜头：看向 (tx, ty)，距离 d，方位 yaw（从海上看向陆地约 −1.25），俯角 pitch（负数朝下）
async function look(p, tx, ty, d, yaw, pitch, wait = 3500) {
  await p.evaluate(([tx, ty, d, yaw, pitch]) => {
    V3.tin = null; const cp = Math.cos(pitch);
    Object.assign(V3.fc, { x: tx - Math.cos(yaw) * cp * d, y: ty - Math.sin(yaw) * cp * d, z: v3Ht(tx, ty) - Math.sin(pitch) * d, yaw, pitch, yawT: yaw, pitchT: pitch, cx: null, cy: null });
  }, [tx, ty, d, yaw, pitch]);
  await sleep(wait);
}
// 无界面：藏起全部面板与 3D 上的文字标注，只剩画面
async function clean(p, on) {
  await p.evaluate(on => {
    if (on && !window.__v3o) { window.__v3o = v3Overlay; window.v3Overlay = () => {}; }
    if (!on && window.__v3o) { window.v3Overlay = window.__v3o; window.__v3o = null; }
    let st = document.getElementById('shotClean');
    if (on && !st) { st = document.createElement('style'); st.id = 'shotClean'; st.textContent = 'body > :not(#stage):not(script):not(style), #stage > :not(#cv) { visibility: hidden !important; }'; document.head.appendChild(st); }
    if (!on && st) st.remove();
  }, on);
}

// 界面截图：闯关列表、闯关部署（AI 帮我部署）、兵力图鉴
async function stepUi(b) {
  const S = dir('screens'), p = await boot(b, 1920, 1080);
  await p.evaluate(() => mnAct('pve')); await sleep(1500);
  await shot(p, path.join(S, '05-campaign.jpg'));
  await p.evaluate(() => { lvClose(); lvStart(4); }); await sleep(2500);
  await p.evaluate(() => { const a = document.querySelector('#sbxPanel [data-act="ai"]'); if (a) a.click(); }); await sleep(2500);
  const c = await p.evaluate(() => { const sh = S.ships.filter(s => s.side !== 'e'), x = sh.length ? sh.reduce((a, s) => a + s.x, 0) / sh.length : W / 2, y = sh.length ? sh.reduce((a, s) => a + s.y, 0) / sh.length : H / 2; return [x, (y + coastAt(x)) / 2]; });
  await look(p, c[0], c[1], 2400, -1.5708, -0.9, 4500);   // 部署好的舰队与对岸滩头都在画面里
  await shot(p, path.join(S, '06-deploy.jpg'));
  await p.evaluate(() => { showMenu(); mnAct('cdx'); }); await sleep(2000);
  await p.evaluate(() => { const it = [...document.querySelectorAll('#cdx .cdx-card, #cdx [data-id]')].find(e => /ZTD-05|两栖突击车/.test(e.textContent)); if (it) it.click(); }); await sleep(800);
  await shot(p, path.join(S, '07-codex.jpg'));
  await p.close();
}

// 闯关「困难」开局（固定地图），攻守双方都交给 AI，推演 t 秒；返回取景点：登陆部队最密的一团、舰队、航母
async function battle(p, t) {
  await p.evaluate(SEED => { __seed(7); const ng = newGame; window.newGame = (s, l, o) => ng(SEED, l, o); try { startPvE('hard'); } finally { window.newGame = ng; } }, SEED);
  await sleep(500);
  await p.evaluate(() => { if (!$('brief').hidden) $('btnBrief').click(); }); await sleep(800);
  await p.evaluate(() => {
    __seed(11); startBattle(); S.paused = true; S.dd.auto = true; if (S.cv) S.cv.auto = true;
    for (const u of S.units) if (u.side === 'p') u.auto = true; for (const s of S.ships) s.auto = true; for (const v of S.veh || []) v.auto = true;
  });
  return advance(p, t);
}
// 接着推演到第 t 秒，返回取景点（seed：先把随机数重置，拍过照再接着推演也能每次一样）
function advance(p, t, seed) {
  return p.evaluate(([t, seed]) => {
    if (seed) __seed(seed);
    while (S.t < t && !S.over) step(1 / 30);
    const avg = A => A.length ? [A.reduce((a, q) => a + q.x, 0) / A.length, A.reduce((a, q) => a + q.y, 0) / A.length] : null;
    // 登陆部队最密的一团：数每个单位 240 以内有几个自己人，取最多的那个周围的平均位置（平均全部会落在两团之间的空地上）
    const V = (S.veh || []).filter(v => v.side === 'p' && !v.dead && isLand(v.x, v.y)), U = [...V, ...S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y))];
    const dense = (A, r) => { const near = q => A.filter(o => dist(o.x, o.y, q.x, q.y) < r), b = A.reduce((a, q) => !a || near(q).length > near(a).length ? q : a, null); return b ? [avg(near(b)), near(b).length] : [null, 0]; };
    const sh = S.ships.filter(s => !s.dead), fl = avg(sh), cv = S.cv && !S.cv.dead ? [S.cv.x, S.cv.y] : fl, [land, n] = dense(U, 240), [arm, na] = dense(V, 300);
    return { seed: S.seed, t: S.t | 0, land: land || fl, n, armor: na >= 3 ? arm : land || fl, fleet: fl, cv, W, H };   // armor：登陆车辆最密处（拍滩头近景）
  }, [t, seed]);
}

// 推演一局，然后拍实机截图与宣传底图
async function stepBattle(b) {
  const S = dir('screens'), A = dir('art'), p = await boot(b, 1920, 1080);
  const p0 = await battle(p, T0);
  await look(p, p0.armor[0], p0.armor[1], 340, -1.25, -0.36); await shot(p, path.join(S, '01-beach.jpg'));
  const pos = await advance(p, T, 13);
  console.log('推演到', pos.t, '秒，地图', pos.seed, '，取景处', pos.n, '个单位');
  const L = pos.land;
  await look(p, L[0], L[1], 700, -1.05, -0.55); await shot(p, path.join(S, '02-front.jpg'));
  await look(p, pos.W / 2, pos.H / 2, 9000, -1.5708, -0.95, 5000); await shot(p, path.join(S, '03-table.jpg'));
  await look(p, pos.cv[0], pos.cv[1], 520, -1.9, -0.3); await shot(p, path.join(S, '04-fleet.jpg'));
  // 宣传底图：滩头放几团爆炸，低机位从海上看过去；宽幅、竖幅、3:2、超宽（库背景）各拍一张
  await clean(p, true);
  // 登陆场上落几发炮弹，对面守军工事挨几发：滩头正在交火
  const boom = () => p.evaluate(L => {
    const E = (S.enemies || []).filter(e => !e.dead && dist(e.x, e.y, L[0], L[1]) < 700).slice(0, 4).map(e => [e.x, e.y, 22]);
    for (const [x, y, r] of [[L[0] - 70, L[1] + 30, 28], [L[0] + 60, L[1] - 50, 24], [L[0] + 5, L[1] + 80, 20], ...E]) S.fx.push({ kind: 'boom', x, y, r, life: .05, max: 1.2, side: 'e' });
  }, L);
  for (const [nm, w, h, d, yaw, pitch] of [['wide', 1920, 1080, 500, -1.22, -0.28], ['tall', 1080, 1350, 540, -1.22, -0.32], ['photo', 1920, 1280, 500, -1.22, -0.29], ['hero', 3840, 1240, 680, -1.28, -0.24]]) {
    await p.setViewportSize({ width: w, height: h });
    await look(p, L[0], L[1], d, yaw, pitch, 2500); await boom(); await sleep(2500);
    await shot(p, path.join(A, nm + '.png'));
  }
  await p.close();
}

// 合成：底图 + 标志（暗剑 / DARKSWORD，游戏开始界面的字体与辉光）。Steam 胶囊图上只许有游戏名，不加别的字
const FONT = f => 'file://' + path.join(ROOT, 'fonts', f);
const LOGO_CSS = `
@font-face { font-family: "Noto Sans SC"; font-weight: 700; src: url(${FONT('NotoSansSC-Bold.woff2')}) format("woff2"); }
@font-face { font-family: "Noto Sans SC"; font-weight: 400; src: url(${FONT('NotoSansSC-Regular.woff2')}) format("woff2"); }
@font-face { font-family: "Silkscreen"; src: url(${FONT('Silkscreen-Regular.woff2')}) format("woff2"); }
html, body { margin: 0; overflow: hidden; }
.bg { position: absolute; inset: 0; background-size: cover; filter: brightness(1.28) contrast(1.06) saturate(1.12); }   /* 缩成商店里的小图时暗部会糊成一片，提亮一点 */
.shade { position: absolute; inset: 0; }
.logo { position: absolute; display: flex; flex-direction: column; color: #3dff8a; }
.logo h1 { margin: 0; font: 700 1em/1 "Noto Sans SC"; letter-spacing: .14em; margin-right: -.14em; text-shadow: 0 0 .22em rgba(61, 255, 138, .6), 0 0 .03em rgba(216, 255, 232, .9); }
.logo .en { font: .2em "Silkscreen"; letter-spacing: .62em; margin-right: -.62em; color: rgba(214, 255, 228, .88); margin-top: .35em; text-shadow: 0 0 .5em rgba(61, 255, 138, .5); }
.logo .rule { height: .02em; min-height: 1px; margin-top: .3em; background: linear-gradient(90deg, rgba(61, 255, 138, 0), #3dff8a, rgba(61, 255, 138, 0)); box-shadow: 0 0 .1em #3dff8a; }
.logo .sub { font: 400 .13em "Noto Sans SC"; letter-spacing: .5em; margin-right: -.5em; color: rgba(214, 255, 228, .85); margin-top: .9em; }
.logo.l { align-items: flex-start; } .logo.l .rule { background: linear-gradient(90deg, #3dff8a, rgba(61, 255, 138, 0)); }
.logo.c { align-items: center; text-align: center; }`;
// [文件, 宽, 高, 底图, 底图位置, 标志：[对齐（l 左 / c 中）, 字号（相对高或宽）, 横向位置, 纵向中心] 或 null, 压暗方式, 副标题]
const COMPOSE = [
  ['steam/header_capsule.jpg', 920, 430, 'wide', '50% 45%', ['l', .3, .07, .5], 'left'],
  ['steam/small_capsule.jpg', 462, 174, 'wide', '50% 45%', ['c', .46, .5, .5], 'full'],
  ['steam/main_capsule.jpg', 1232, 706, 'wide', '50% 45%', ['l', .25, .07, .5], 'left'],
  ['steam/vertical_capsule.jpg', 748, 896, 'tall', '50% 50%', ['c', .3, .5, .2], 'top'],
  ['steam/library_capsule.jpg', 600, 900, 'tall', '50% 50%', ['c', .3, .5, .2], 'top'],
  ['steam/library_header.jpg', 920, 430, 'wide', '50% 45%', ['l', .3, .07, .5], 'left'],
  ['steam/library_hero.jpg', 3840, 1240, 'hero', '50% 50%', null, 'none'],
  ['steam/library_logo.png', 1280, 720, null, '', ['c', .62, .5, .5], 'none'],
  ['steam/page_background.jpg', 1438, 810, 'wide', '50% 45%', null, 'page'],
  ['taptap/promo_1920x1080.jpg', 1920, 1080, 'wide', '50% 45%', ['l', .22, .07, .5], 'left', '两栖登陆作战 · 兵推沙盘'],
  ['taptap/featured_1920x1280.jpg', 1920, 1280, 'photo', '50% 45%', ['l', .2, .07, .5], 'left', '两栖登陆作战 · 兵推沙盘'],
  ['taptap/cover_460x215.jpg', 460, 215, 'wide', '50% 45%', ['l', .3, .07, .5], 'left'],
  ['taptap/cover_600x900.jpg', 600, 900, 'tall', '50% 50%', ['c', .3, .5, .2], 'top'],
  ['taptap/logo_1280.png', 1280, 720, null, '', ['c', .62, .5, .5], 'none'],
  ['taptap/wallpaper_3840x1240.jpg', 3840, 1240, 'hero', '50% 50%', null, 'none'],
  ['taptap/nologo_1920x1080.jpg', 1920, 1080, 'wide', '50% 45%', null, 'none'],
  ['taptap/nologo_720x1080.jpg', 720, 1080, 'tall', '50% 50%', null, 'none']
];
const SHADE = {
  none: '', full: 'background: rgba(2, 7, 4, .45);',
  left: 'background: linear-gradient(90deg, rgba(2, 7, 4, .86) 0%, rgba(2, 7, 4, .55) 38%, rgba(2, 7, 4, 0) 70%);',
  top: 'background: linear-gradient(180deg, rgba(2, 7, 4, .85) 0%, rgba(2, 7, 4, .45) 32%, rgba(2, 7, 4, 0) 52%);',
  page: 'background: radial-gradient(ellipse at 50% 40%, rgba(2, 7, 4, .35), rgba(2, 7, 4, .9) 75%);'
};
async function stepCompose(b) {
  const p = await b.newPage();
  for (const [file, w, h, art, at, logo, shade, sub] of COMPOSE) {
    const out = path.join(OUT, file); fs.mkdirSync(path.dirname(out), { recursive: true });
    const fs_ = logo ? Math.round(logo[1] * (w / h > 1.2 ? h : w)) : 0;
    const pos = logo ? `left: ${logo[0] === 'c' ? logo[2] * 100 + '%' : logo[2] * w + 'px'}; top: ${logo[3] * 100}%; transform: translate(${logo[0] === 'c' ? '-50%' : '0'}, -50%);` : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${LOGO_CSS}</style></head><body style="width:${w}px;height:${h}px;background:${art ? '#020704' : 'transparent'}">
      ${art ? `<div class="bg" style="background-image:url('file://${path.join(OUT, 'art', art + '.png')}');background-position:${at}"></div>` : ''}
      <div class="shade" style="${SHADE[shade]}"></div>
      ${logo ? `<div class="logo ${logo[0]}" style="font-size:${fs_}px;${pos}"><h1>暗剑</h1><div class="en">DARKSWORD</div><div class="rule"></div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>` : ''}
    </body></html>`;
    const tmp = path.join(OUT, '.compose.html'); fs.writeFileSync(tmp, html);
    await p.setViewportSize({ width: w, height: h });
    await p.goto('file://' + tmp); await p.evaluate(() => document.fonts.ready); await sleep(200);
    await p.screenshot({ path: out, omitBackground: !art, ...(out.endsWith('.jpg') ? { type: 'jpeg', quality: 90 } : {}) });
    fs.rmSync(tmp);
  }
  await p.close();
}

// 实机视频（TapTap 上架要一段 15 秒以上的实机录像；Steam 预告片也能用）：关掉页面自己的动画循环、时钟由这里推进，
// 一帧推演一帧画面截一张图，ffmpeg 合成 30 帧 / 秒的 MP4。从登陆部队冲上滩头时录起，镜头三段：沙盘全景推近 → 滩头环绕 → 从海上低空看登陆场
async function stepVideo(b) {
  const V = dir('video'), F = path.join(V, '.frames'); fs.rmSync(F, { recursive: true, force: true }); fs.mkdirSync(F, { recursive: true });
  const p = await boot(b, 1920, 1080);
  const pos = await battle(p, T0);
  // 接管动画循环：之后每一帧由 Node 这边推进（已经排上的那一帧还会跑一次，等它跑完再接管时钟）
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await sleep(2500);
  await p.evaluate(() => { window.__vt = lastT; performance.now = () => window.__vt; ema = 1 / 60; S.paused = false; S.speed = 2; });
  const L = pos.land, N = 30 * 30, ease = u => u * u * (3 - 2 * u), mix = (a, b, u) => a + (b - a) * u;
  // 每段：起止的 [目标 x, y, 距离, 方位, 俯角]
  const SEG = [
    [0, 8, [pos.W / 2, pos.H / 2, 9500, -1.5708, -1.0], [L[0], L[1] - 200, 3200, -1.45, -0.8]],
    [8, 20, [L[0], L[1], 900, -1.6, -0.5], [L[0], L[1], 520, -0.95, -0.38]],
    [20, 30, [L[0] - 80, L[1] + 700, 420, -1.3, -0.22], [L[0], L[1] + 120, 380, -1.2, -0.3]]
  ];
  for (let i = 0; i < N; i++) {
    const t = i / 30, sg = SEG.find(s => t < s[1]) || SEG[SEG.length - 1], u = ease(Math.min(1, (t - sg[0]) / (sg[1] - sg[0])));
    const [tx, ty, d, yaw, pitch] = sg[2].map((v, k) => mix(v, sg[3][k], u));
    await p.evaluate(([tx, ty, d, yaw, pitch]) => {
      V3.tin = null; const cp = Math.cos(pitch);
      Object.assign(V3.fc, { x: tx - Math.cos(yaw) * cp * d, y: ty - Math.sin(yaw) * cp * d, z: v3Ht(tx, ty) - Math.sin(pitch) * d, yaw, pitch, yawT: yaw, pitchT: pitch, cx: null, cy: null });
      window.__vt += 1000 / 30; frame(window.__vt);
    }, [tx, ty, d, yaw, pitch]);
    await p.screenshot({ path: path.join(F, String(i).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 92 });
    if (i % 60 === 0) console.log('视频', i, '/', N);
  }
  await p.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(F, '%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(V, 'gameplay_1080p.mp4')]);
  fs.rmSync(F, { recursive: true, force: true });
}

module.exports = { ROOT, SEED, LAUNCH, sleep, boot, battle, advance, look, clean };   // tools/trailer.js 共用
if (require.main === module) (async () => {
  const b = await chromium.launch(LAUNCH);
  try {
    if (STEPS.includes('ui')) { console.log('界面截图…'); await stepUi(b); }
    if (STEPS.includes('battle')) { console.log('推演与实机截图…'); await stepBattle(b); }
    if (STEPS.includes('compose')) { console.log('合成胶囊图、封面…'); await stepCompose(b); }
    if (STEPS.includes('video')) { console.log('录实机视频…'); await stepVideo(b); }
  } finally { await b.close(); }
  console.log('素材已生成：', OUT);
})().catch(e => { console.error(e); process.exit(1); });
