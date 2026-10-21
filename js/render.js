'use strict';
// 渲染（一）：画布、镜头变换、辉光、海岸线/网格/海滩标注、无 WebGL 时的像素地形
const R = { cv: null, ctx: null, dpr: 1, s: 1, ox: 0, oy: 0, b1: null, b2: null, pix: null, fog: null, dprCap: 0, rain: .25, zr: 1, fig: false, view: null, lowCap: false };
const px = n => n / R.s;
const _rgb = {};
function rgba(hex, a) {
  const c = _rgb[hex] || (_rgb[hex] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(','));
  return `rgba(${c},${a})`;
}
const font = n => `${px(n)}px "IBM Plex Mono", "Noto Sans SC", monospace`;
const toWorld = (sx, sy) => ({ x: (sx - R.ox) / R.s, y: (sy - R.oy) / R.s });
const worldTf = g => g.setTransform(R.dpr * R.s, 0, 0, R.dpr * R.s, R.dpr * R.ox, R.dpr * R.oy);

function initRender(cv) {
  R.cv = cv; R.ctx = cv.getContext('2d');
  for (const k of ['b1', 'b2', 'fog']) R[k] = document.createElement('canvas');
  R.fog.width = GW; R.fog.height = GH;
  try { const v = localStorage.getItem('bh-rain'); if (v != null) R.rain = +v; } catch (e) { /* 存储不可用时用默认值 */ }
  if (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low') { R.dprCap = 1; R.lowCap = true; }
  mxInit();
  resize();
}

function resize() {
  const box = R.cv.parentElement.getBoundingClientRect();
  R.dpr = Math.min(R.dprCap || 2, window.devicePixelRatio || 1);
  R.cv.width = Math.max(1, Math.round(box.width * R.dpr));
  R.cv.height = Math.max(1, Math.round(box.height * R.dpr));
  camFit(box.width, box.height);
  R.b1.width = Math.ceil(R.cv.width / 4); R.b1.height = Math.ceil(R.cv.height / 4);
  R.b2.width = Math.ceil(R.cv.width / 12); R.b2.height = Math.ceil(R.cv.height / 12);
  if (MX.ok) mxResize();
}

// 降级：世界分辨率的像素地形
function buildPixel() {
  const c = R.pix || (R.pix = document.createElement('canvas')), g = c.getContext('2d');
  c.width = W / 2; c.height = H / 2;
  g.setTransform(.5, 0, 0, .5, 0, 0);
  g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < GW * GH; i++) {
    const t = TER.type[i];
    if (t === T.DEEP) continue;
    const a = t === T.SHOAL ? .08 : t === T.REEF ? .5 : .1 + TER.elev[i] * .45 + (t === T.ROAD || t === T.BRIDGE ? .3 : 0);
    g.fillStyle = rgba(t === T.REEF ? COL.enemy : t === T.RIVER || t === T.SHOAL || t === T.MARSH || t === T.FORD ? COL.intel : COL.g, a);
    g.fillRect((i % GW) * CELL + 1, Math.floor(i / GW) * CELL + 1, CELL - 2, CELL - 2);
  }
  R.pixSeed = TER.seed;
}

function drawPixelFallback(ctx) {
  if (R.pixSeed !== TER.seed) buildPixel();
  ctx.drawImage(R.pix, 0, 0, W, H);
  const g = R.fog.getContext('2d'), img = g.createImageData(GW, GH);
  for (let i = 0; i < GW * GH; i++) { img.data[i * 4 + 3] = FOGB[i] ? 0 : 140; }
  g.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(R.fog, 0, 0, W, H);
}

function drawMarks(ctx) {
  ctx.beginPath();
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, coastAt(x));
  ctx.strokeStyle = rgba(COL.g, .45); ctx.lineWidth = px(1); ctx.stroke();
  ctx.strokeStyle = rgba(COL.g, .06);
  ctx.beginPath();
  for (let k = 0; k <= 16; k++) { ctx.moveTo(k * 100, 0); ctx.lineTo(k * 100, H); }
  for (let k = 0; k <= 10; k++) { ctx.moveTo(0, k * 100); ctx.lineTo(W, k * 100); }
  ctx.stroke();
  ctx.setLineDash([px(6), px(6)]); ctx.strokeStyle = rgba(COL.g, .25);
  ctx.beginPath(); ctx.moveTo(0, STAGING_Y); ctx.lineTo(W, STAGING_Y); ctx.stroke(); ctx.setLineDash([]);
  for (const b of TER.beaches) {   // 可登陆海滩：海面上的括线标记
    const y = coastAt(b.cx) + 64;
    ctx.strokeStyle = rgba(COL.g, .35); ctx.lineWidth = px(1);
    ctx.beginPath(); ctx.moveTo(b.x0, y - 6); ctx.lineTo(b.x0, y); ctx.lineTo(b.x1, y); ctx.lineTo(b.x1, y - 6); ctx.stroke();
  }
}

// 辉光：全图时强、近看时弱（近看是安静的战术地图），乘以设置里的辉光强度；低画质不做
function bloomK() {
  const st = typeof SETTINGS === 'object' && SETTINGS ? SETTINGS : null;
  if (st && st.quality === 'low') return 0;
  const b = st && isFinite(st.bloom) ? st.bloom / .7 : 1;
  return b * lerp(1, .22, smooth(1.4, 6, CAM.z / CAM.fit));
}

function bloom() {
  const k = bloomK();
  if (k < .02) return;
  const { ctx, cv, b1, b2 } = R, g1 = b1.getContext('2d'), g2 = b2.getContext('2d'), wide = .4 * k * (1 - smooth(1.6, 3, R.zr));   // 大范围光晕只在接近全图时保留
  g1.imageSmoothingQuality = g2.imageSmoothingQuality = 'high';
  g1.globalCompositeOperation = 'copy'; g1.drawImage(cv, 0, 0, b1.width, b1.height);
  if (wide > .02) { g2.globalCompositeOperation = 'copy'; g2.drawImage(b1, 0, 0, b2.width, b2.height); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, .42 * k); ctx.drawImage(b1, 0, 0, cv.width, cv.height);
  if (wide > .02) { ctx.globalAlpha = Math.min(1, wide); ctx.drawImage(b2, 0, 0, cv.width, cv.height); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

function shape(ctx, x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}

// 每帧的细节档：zr 相对全图的倍数；fig 画出单兵小人（小人约 7px 以上才画，否则画楔形三点）；view 可视范围（剔除屏外对象）
function lodUpdate() {
  R.zr = CAM.z / CAM.fit; R.fig = R.s >= 1.45; R.view = viewRect();
}
const inView = (x, y, m = 0) => { const v = R.view; return !v || (x > v[0] - m && x < v[2] + m && y > v[1] - m && y < v[3] + m); };
// 鼠标悬停（世界半径 r，至少 14 屏幕像素）：范围圈等只在悬停或选中时显示
const hoverNear = (x, y, r) => !!(typeof U === 'object' && U.mouse && dist(U.mouse.x, U.mouse.y, x, y) < Math.max(r, px(14)));

function draw(now) {
  const { ctx } = R, time = now / 1000;
  // 附近大爆炸：短暂震动与闪白（震动幅度按屏幕像素封顶，设置可关闭）
  let k = 0;
  for (const f of S.fx) if (f.kind === 'boom' && f.life < .25 && inVision(f.x, f.y)) k += f.r / 30 * (1 - f.life / .25);
  const ox = R.ox, oy = R.oy, shake = !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.shake === false);
  if (shake && k > 0) { const a = Math.min(k, 2.5) * 1.4 * Math.min(R.s, CAM.fit * 3); R.ox += gauss() * a; R.oy += gauss() * a; }
  lodUpdate();
  fogBytes();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  if (MX.ok) { mxDraw(time, Math.min(1, k * .5) * (shake ? 1 : .4)); ctx.drawImage(MX.cv, 0, 0); }
  else { ctx.fillStyle = '#010402'; ctx.fillRect(0, 0, R.cv.width, R.cv.height); worldTf(ctx); drawPixelFallback(ctx); }
  worldTf(ctx);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  indexUnits();
  const opt = name => { const f = globalThis[name] || window[name]; if (typeof f === 'function') f(time); };
  drawMarks(ctx); drawCraters(); drawBuildings(); drawForts(time); drawSmoke(time); drawLines(time); opt('drawSupplyNet'); drawStructures(time); opt('drawBlown'); runHook('drawUnder', time);
  drawEnemies(time); opt('drawArmor');
  ctx.globalAlpha = R.zr > 2.5 ? .55 : .75; opt('drawAutoRoutes'); ctx.globalAlpha = 1;   // 自动驾驶路线压暗，避免满屏虚线
  drawTeams(time); opt('drawCarrier'); drawShips(time); drawDD(time); runHook('drawOver', time); drawPlans(time);
  drawShells(time); drawTracers(); drawPlanes(time); drawFx(); drawTool(time); drawFormPreview();
  bloom();
  worldTf(ctx);
  drawBanners(time); drawShipMarks(); drawPings(time); runHook('drawTop', time);
  R.ox = ox; R.oy = oy;
}

// 低画质：限制为 1 倍像素密度（辉光在 bloomK 中关闭）
if (typeof onSettings === 'function') onSettings((key, v, st) => {
  if (!R.cv || (key && key !== 'quality')) return;
  const cap = st && st.quality === 'low' ? 1 : 0;
  if (cap !== R.dprCap && (cap || R.lowCap)) { R.dprCap = cap; R.lowCap = !!cap; resize(); }
});
