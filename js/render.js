'use strict';
// 渲染（一）：画布、像素地形、视野点亮、辉光
const R = { cv: null, ctx: null, dpr: 1, s: 1, ox: 0, oy: 0, terr: null, fog: null, b1: null, b2: null };
const px = n => n / R.s;
const _rgb = {};
function rgba(hex, a) {
  const c = _rgb[hex] || (_rgb[hex] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(','));
  return `rgba(${c},${a})`;
}
const font = n => `${px(n)}px "IBM Plex Mono", "Noto Sans SC", monospace`;
const toWorld = (cx, cy) => ({ x: (cx - R.ox) / R.s, y: (cy - R.oy) / R.s });

function initRender(cv) {
  R.cv = cv; R.ctx = cv.getContext('2d');
  for (const k of ['terr', 'fog', 'b1', 'b2']) R[k] = document.createElement('canvas');
  resize();
}

function resize() {
  const box = R.cv.parentElement.getBoundingClientRect();
  R.dpr = Math.min(2, window.devicePixelRatio || 1);
  R.cv.width = Math.max(1, Math.round(box.width * R.dpr));
  R.cv.height = Math.max(1, Math.round(box.height * R.dpr));
  R.s = Math.min(box.width / W, box.height / H) || 1;
  R.ox = (box.width - W * R.s) / 2; R.oy = (box.height - H * R.s) / 2;
  R.fog.width = Math.ceil(R.cv.width / 2); R.fog.height = Math.ceil(R.cv.height / 2);
  R.b1.width = Math.ceil(R.cv.width / 4); R.b1.height = Math.ceil(R.cv.height / 4);
  R.b2.width = Math.ceil(R.cv.width / 12); R.b2.height = Math.ceil(R.cv.height / 12);
  buildTerrainLayer();
}

const worldTf = (g, k = 1) => g.setTransform(R.dpr * R.s * k, 0, 0, R.dpr * R.s * k, R.dpr * R.ox * k, R.dpr * R.oy * k);

// 静态地形：像素方块 + 等高亮度，参照 GitHub 像素风
function buildTerrainLayer() {
  const c = R.terr, g = c.getContext('2d');
  c.width = R.cv.width; c.height = R.cv.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = COL.bg; g.fillRect(0, 0, c.width, c.height);
  worldTf(g);
  const hr = rng(TER.seed + 7);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, t = TER.type[i], x = gx * CELL, y = gy * CELL, j = hr();
    if (t === T.SEA) {
      const depth = clamp((y - coastAt(x + 5)) / 380, 0, 1);
      if ((gx + gy) % 2) continue;
      g.fillStyle = rgba(COL.g, .05 + (1 - depth) * .12 + j * .04);
      g.fillRect(x + 4, y + 4, 2, 2);
      continue;
    }
    const e = TER.elev[i], band = Math.floor(e * 5);
    let a = .06 + band * .05 + j * .04;
    if (t === T.BEACH) a = .34 + j * .1;
    if (t === T.HILL) a += .08;
    g.fillStyle = rgba(COL.g, a);
    if (t === T.TOWN) {
      g.strokeStyle = rgba(COL.g, .55); g.lineWidth = 1.2;
      g.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
      g.fillRect(x + 4, y + 4, 2, 2);
    } else if (t === T.FOREST) {
      g.fillStyle = rgba(COL.g, a * .6); g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      g.fillStyle = rgba(COL.g, a + .22);
      g.fillRect(x + 2, y + 2, 2.4, 2.4); g.fillRect(x + 6, y + 5.5, 2.4, 2.4);
    } else g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    // 等高线：与下方/右方等高带不同时描边
    const r2 = TER.elev[i + 1] || 0, d2 = gy < GH - 1 ? TER.elev[i + GW] : 0;
    if (t !== T.BEACH && band > 0 && (Math.floor(r2 * 5) !== band || Math.floor(d2 * 5) !== band)) {
      g.fillStyle = rgba(COL.g, .5);
      g.fillRect(x + 1, y + 1, CELL - 2, 1.6);
    }
  }
  // 海岸线
  g.beginPath();
  for (let x = 0; x <= W; x += 4) g.lineTo(x, coastAt(x));
  g.strokeStyle = rgba(COL.g, .75); g.lineWidth = 1.4; g.stroke();
  // 沙盘网格与坐标
  g.strokeStyle = rgba(COL.g, .07); g.lineWidth = 1;
  g.font = '10px "IBM Plex Mono", monospace'; g.fillStyle = rgba(COL.g, .45);
  for (let k = 0; k <= 12; k++) { g.beginPath(); g.moveTo(k * 100, 0); g.lineTo(k * 100, H); g.stroke(); if (k < 12) g.fillText('ABCDEFGHIJKL'[k], k * 100 + 4, 12); }
  for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(0, k * 100); g.lineTo(W, k * 100); g.stroke(); if (k > 0 && k < 8) g.fillText(String(k + 1), 4, k * 100 + 12); }
  // 集结海域
  g.setLineDash([6, 6]); g.strokeStyle = rgba(COL.g, .3);
  g.beginPath(); g.moveTo(0, STAGING_Y); g.lineTo(W, STAGING_Y); g.stroke(); g.setLineDash([]);
  g.fillStyle = rgba(COL.g, .7); g.fillText('集结海域 · 我方', 16, STAGING_Y + 16);
  g.fillStyle = rgba(COL.enemy, .65); g.fillText('敌占区 · 部署不明', 16, 28);
  g.strokeStyle = rgba(COL.g, .35); g.lineWidth = 1.5; g.strokeRect(.75, .75, W - 1.5, H - 1.5);
}

// 视野之外压暗；通讯兵 / 侦察 / 舰船所在处“点亮”
function drawFog() {
  const f = R.fog, g = f.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, f.width, f.height);
  g.fillStyle = 'rgba(0,3,1,0.55)'; g.fillRect(0, 0, f.width, f.height);
  worldTf(g, .5);
  g.globalCompositeOperation = 'destination-out';
  for (const c of VIS) {
    const gr = g.createRadialGradient(c.x, c.y, c.r * .6, c.x, c.y, c.r);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, c.r, 0, 7); g.fill();
  }
  R.ctx.drawImage(f, 0, 0, R.cv.width, R.cv.height);
}

function bloom() {
  const { ctx, cv, b1, b2 } = R, g1 = b1.getContext('2d'), g2 = b2.getContext('2d');
  g1.imageSmoothingQuality = g2.imageSmoothingQuality = 'high';
  g1.globalCompositeOperation = 'copy'; g1.drawImage(cv, 0, 0, b1.width, b1.height);
  g2.globalCompositeOperation = 'copy'; g2.drawImage(b1, 0, 0, b2.width, b2.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = .38; ctx.drawImage(b1, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = .4; ctx.drawImage(b2, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

function shape(ctx, x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i * Math.PI * 2 / n;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function draw(now) {
  const { ctx } = R, time = now / 1000;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(R.terr, 0, 0);
  drawFog();
  worldTf(ctx);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawVisionRings(time); drawLines(time); drawObjectives(time); drawEnemies(time);
  drawSquads(time); drawShips(time); drawDestroyer(time); drawShells(time);
  drawTracers(); drawPlanes(time); drawFx(); drawTool(time);
  bloom();
  worldTf(ctx);
  drawLabels(time);
}
