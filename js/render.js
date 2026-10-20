'use strict';
// 渲染（一）：画布、镜头变换、辉光、海岸线/网格/海滩标注、无 WebGL 时的像素地形
const R = { cv: null, ctx: null, dpr: 1, s: 1, ox: 0, oy: 0, b1: null, b2: null, pix: null, fog: null, dprCap: 0, rain: .25 };
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

function bloom() {
  const { ctx, cv, b1, b2 } = R, g1 = b1.getContext('2d'), g2 = b2.getContext('2d');
  g1.imageSmoothingQuality = g2.imageSmoothingQuality = 'high';
  g1.globalCompositeOperation = 'copy'; g1.drawImage(cv, 0, 0, b1.width, b1.height);
  g2.globalCompositeOperation = 'copy'; g2.drawImage(b1, 0, 0, b2.width, b2.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = .42; ctx.drawImage(b1, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = .4; ctx.drawImage(b2, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

function shape(ctx, x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}

function draw(now) {
  const { ctx } = R, time = now / 1000;
  // 附近大爆炸：短暂震动与闪白
  let k = 0;
  for (const f of S.fx) if (f.kind === 'boom' && f.life < .25 && inVision(f.x, f.y)) k += f.r / 30 * (1 - f.life / .25);
  const ox = R.ox, oy = R.oy;
  R.ox += gauss() * k * 1.4 * R.s; R.oy += gauss() * k * 1.4 * R.s;
  fogBytes();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  if (MX.ok) { mxDraw(time, Math.min(1, k * .5)); ctx.drawImage(MX.cv, 0, 0); }
  else { ctx.fillStyle = '#010402'; ctx.fillRect(0, 0, R.cv.width, R.cv.height); worldTf(ctx); drawPixelFallback(ctx); }
  worldTf(ctx);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  indexUnits();
  const opt = name => { const f = globalThis[name] || window[name]; if (typeof f === 'function') f(time); };
  drawMarks(ctx); drawCraters(); drawBuildings(); drawForts(time); drawSmoke(time); drawLines(time); opt('drawSupplyNet'); drawStructures(time); opt('drawBlown');
  drawEnemies(time); opt('drawArmor'); opt('drawAutoRoutes'); drawTeams(time); opt('drawCarrier'); drawShips(time); drawDD(time); drawPlans(time);
  drawShells(time); drawTracers(); drawPlanes(time); drawFx(); drawTool(time); drawFormPreview();
  bloom();
  worldTf(ctx);
  drawBanners(time); drawShipMarks(); drawPings(time);
  R.ox = ox; R.oy = oy;
}
