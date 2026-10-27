'use strict';
// 渲染（一）：画布、镜头变换、集结线与海滩标注；地形底图由 terrain.js 的 WebGL 画（首次用到时才建），整帧画完过黑绿着色器（look.js）
const R = { cv: null, ctx: null, dpr: 1, s: 1, ox: 0, oy: 0, shx: 0, shy: 0, fog: null, dprCap: 0, zr: 1, fig: false, view: null, lowCap: false };
const px = n => n / R.s;
const _rgb = {};
function rgba(hex, a) {
  const c = _rgb[hex] || (_rgb[hex] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(','));
  return `rgba(${c},${a})`;
}
const font = n => `${px(n)}px "IBM Plex Mono", "Noto Sans SC", monospace`;
// 字符集：背景数码雨、文字乱码过渡、爆炸与通讯的字符特效共用
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂ';
const SYMS = '=+-*:.<>|¦_"!#$%&()[]{}~^/Z@;?';
const GLYPHS = KANA.slice(0, 56) + '0123456789' + SYMS.slice(0, 30);
const toWorld = (sx, sy) => typeof V3 === 'object' && V3.on && !V3.drawing ? v3Pick(sx, sy) : ({ x: (sx - R.ox) / R.s, y: (sy - R.oy) / R.s });   // 3D 立体地图：视线与地形求交（view3d.js）
const worldTf = g => g.setTransform(R.dpr * R.s, 0, 0, R.dpr * R.s, R.dpr * R.ox, R.dpr * R.oy);

function initRender(cv) {
  R.cv = cv; R.ctx = cv.getContext('2d');
  R.fog = document.createElement('canvas');
  R.fog.width = GW; R.fog.height = GH;
  if (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low') { R.dprCap = 1; R.lowCap = true; }
  resize();
}

function resize() {
  const box = R.cv.parentElement.getBoundingClientRect();
  R.dpr = Math.min(R.dprCap || 2, window.devicePixelRatio || 1);
  R.cv.width = Math.max(1, Math.round(box.width * R.dpr));
  R.cv.height = Math.max(1, Math.round(box.height * R.dpr));
  camFit(box.width, box.height);
  if (TRX.ok) trxResize();
}

// 海岸、网格都在地形里，这里只画集结线与登陆海滩括线
function drawMarks(ctx) {
  ctx.lineWidth = px(1); ctx.setLineDash([px(6), px(6)]); ctx.strokeStyle = 'rgba(235,242,248,.2)';
  ctx.beginPath(); ctx.moveTo(0, STAGING_Y); ctx.lineTo(W, STAGING_Y); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(235,242,248,.4)';
  for (const b of TER.beaches) { const y = coastAt(b.cx) + 64; ctx.beginPath(); ctx.moveTo(b.x0, y - 6); ctx.lineTo(b.x0, y); ctx.lineTo(b.x1, y); ctx.lineTo(b.x1, y - 6); ctx.stroke(); }
}

function shape(ctx, x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}

// 每帧的细节档：zr 相对全图的倍数；fig 画出单兵小人（每格 ≥10px，桌面约 2.5 倍全图起；更远画楔形三点）；view 可视范围（剔除屏外对象）
function lodUpdate() {
  R.zr = CAM.z / CAM.fit; R.fig = R.s >= 1; R.view = viewRect();
}
const inView = (x, y, m = 0) => { const v = R.view; return !v || (x > v[0] - m && x < v[2] + m && y > v[1] - m && y < v[3] + m); };
// 鼠标悬停（世界半径 r，至少 14 屏幕像素）：范围圈等只在悬停或选中时显示
const hoverNear = (x, y, r) => !!(typeof U === 'object' && U.mouse && dist(U.mouse.x, U.mouse.y, x, y) < Math.max(r, px(14)));

// 观察视野（沙盒观战）：只换画面所用的可见格，推演与 AI 仍按各自真实视野
// R.eye：null / 'p' 攻方视野 · 'e' 守方视野 · 'both' 双方视野（任一方看得见即显示）· 'all' 全图
const PV_KEEP = new Uint8Array(GW * GH);
function viewBegin() {
  const v = R.eye;
  if (!v || v === 'p' || !S || S.mode !== 'sandbox') return false;
  PV_KEEP.set(PV);
  if (v === 'all') PV.fill(1); else if (v === 'e') PV.set(EV); else for (let i = 0; i < PV.length; i++) PV[i] |= EV[i];
  return true;
}
function viewEnd(on) { if (on) PV.set(PV_KEEP); }
function draw(now) {
  const on = viewBegin();
  try { if (!(typeof V3 === 'object' && (V3.on || v3Att()) && !V3.drawing && v3Can() && v3Draw(now))) drawScene(now); } finally { viewEnd(on); }   // 3D 立体地图（view3d.js）在屏外按俯视画好再贴到地形上
}
function drawScene(now) {
  const { ctx } = R, time = now / 1000;
  // 附近大爆炸：短暂震动与闪白（震动幅度按屏幕像素封顶，设置可关闭）
  let k = 0;
  for (const f of S.fx) if ((f.kind === 'boom' || f.kind === 'b2') && f.life < .25 && inVision(f.x, f.y)) k += (f.kind === 'b2' ? f.r / 60 : f.r / 30) * (1 - f.life / .25);   // B-2 重磅炸弹震得更厉害
  const ox = R.ox, oy = R.oy, shake = !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.shake === false);
  if (shake && k > 0) { const a = Math.min(k, 2.5) * 1.4 * Math.min(R.s, CAM.fit * 3), d = R.dpr || 1; R.ox += Math.round(gauss() * a * d) / d; R.oy += Math.round(gauss() * a * d) / d; }
  R.shx = R.ox - ox; R.shy = R.oy - oy;   // 这一帧的震动偏移（取整到设备像素）：地形缓存按不带震动的镜头存，震动时整像素平移着读（terrain.js）
  lodUpdate();
  fogBytes();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const flash = Math.min(1, k * .5) * (shake ? 1 : .4);
  const mx3 = typeof V3 === 'object' && V3.drawing && typeof v3Mx === 'function' && v3Mx();   // 3D 数码风：地面由 3D 着色器画，贴图只要单位、标号这些（底色黑）
  if (mx3) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, R.cv.width, R.cv.height); worldTf(ctx); }
  else {
    if (!TRX.tried) { trxInit(); if (TRX.ok) trxResize(); }
    if (TRX.ok && (TRX.cv.width !== R.cv.width || TRX.cv.height !== R.cv.height)) trxResize();   // 3D 地图的屏外俯视画布与屏幕大小不同
    if (TRX.ok) { trxDraw(time, flash); ctx.drawImage(TRX.cv, 0, 0); }
    else { ctx.fillStyle = '#05101a'; ctx.fillRect(0, 0, R.cv.width, R.cv.height); worldTf(ctx); trxFallback(ctx); }
  }
  worldTf(ctx);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  indexUnits();
  const opt = name => { const f = globalThis[name] || window[name]; if (typeof f === 'function') f(time); };
  runHook('drawGround', time); drawMarks(ctx); drawCraters(); if (!mx3) drawBuildings(); drawForts(time); drawSmoke(time); drawLines(time); opt('drawSupplyNet'); drawStructures(time); opt('drawBlown'); runHook('drawUnder', time);
  drawEnemies(time); opt('drawArmor');
  ctx.globalAlpha = R.zr > 2.5 ? .55 : .75; opt('drawAutoRoutes'); ctx.globalAlpha = 1;   // 自动驾驶路线压暗，避免满屏虚线
  drawTeams(time); opt('drawCarrier'); drawShips(time); drawDD(time); runHook('drawOver', time); drawPlans(time);
  if (!R.fx3d) { drawShells(time); drawTracers(); }   // 3D 时弹道立体画（v3fx.js）
  drawPlanes(time); drawFx(); drawTool(time); drawFormPreview();
  worldTf(ctx);
  drawBanners(time); drawShipMarks(); drawPings(time); runHook('drawTop', time);
  R.ox = ox; R.oy = oy; R.shx = R.shy = 0;
  lkPost();   // 黑绿画面：整帧过着色器（look.js）
}

// 低画质：限制为 1 倍像素密度
if (typeof onSettings === 'function') onSettings((key, v, st) => {
  if (!R.cv || (key && key !== 'quality')) return;
  const cap = st && st.quality === 'low' ? 1 : 0;
  if (cap !== R.dprCap && (cap || R.lowCap)) { R.dprCap = cap; R.lowCap = !!cap; resize(); }
});
