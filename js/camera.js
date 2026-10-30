'use strict';
// 镜头：缩放、平移、坐标换算、小地图
const CAM = { x: W / 2, y: STAGING_Y + 120, z: 1, vw: 1, vh: 1, fit: 1 };

function camFit(vw, vh) {
  const first = CAM.vw === 1;
  CAM.vw = vw; CAM.vh = vh;
  CAM.fit = Math.min(vw / W, vh / H);
  if (first) CAM.z = CAM.fit * 2.2;
  camClamp();
}

function camClamp() {
  CAM.z = clamp(CAM.z, CAM.fit, Math.max(CAM.fit * 12, 4));   // 小屏（手机）全图很小，放大上限至少到每单位 4px，能看清单兵
  // 下方多留出底部面板的高度，航母不会被面板挡住
  // padL：左侧被浮层（沙盒编辑面板）遮住的像素宽，允许向左多卷出这么多，地图西端可移到面板右侧
  const hw = CAM.vw / 2 / CAM.z, hh = CAM.vh / 2 / CAM.z, bot = 190 / CAM.z, pl = (CAM.padL || 0) / CAM.z;
  CAM.x = W + pl <= 2 * hw ? (W - pl) / 2 : clamp(CAM.x, hw - pl, W - hw);
  CAM.y = H + bot <= 2 * hh ? (H + bot) / 2 : clamp(CAM.y, hh, H + bot - hh);
  R.s = CAM.z;
  R.ox = CAM.vw / 2 - CAM.x * CAM.z;
  R.oy = CAM.vh / 2 - CAM.y * CAM.z;
}

function camZoomAt(sx, sy, k) {
  if (typeof V3 === 'object' && V3.on && !(typeof V3O === 'object' && V3O.on) && typeof v3Dolly === 'function') { v3Dolly(sx, sy, k); return; }   // 3D 自由镜头：朝鼠标指着的地方推近 / 拉远
  const before = toWorld(sx, sy);
  CAM.z *= k;
  camClamp();
  const after = toWorld(sx, sy);
  CAM.x += before.x - after.x; CAM.y += before.y - after.y;
  camClamp();
}

function camPan(dx, dy) { if (typeof V3 === 'object' && V3.on) { v3Pan(dx, dy); return; } CAM.x -= dx / CAM.z; CAM.y -= dy / CAM.z; camClamp(); }   // 3D：按镜头转向换算
function camCenter(x, y) { CAM.x = x; CAM.y = y; camClamp(); }

// 方向键平移（每帧调用）
const KEYS = new Set();
function camKeys(dt) {
  const v = 700 * dt / CAM.z * CAM.fit;
  if (typeof V3 === 'object' && V3.on) {   // 3D 自由镜头：W / ↑ 沿视线往前飞（抬头往上、低头往下）、S / ↓ 往后，A D / ← → 左右平移
    const fw = (KEYS.has('ArrowUp') ? 1 : 0) - (KEYS.has('ArrowDown') ? 1 : 0), rt = (KEYS.has('ArrowRight') ? 1 : 0) - (KEYS.has('ArrowLeft') ? 1 : 0);
    if ((fw || rt) && typeof v3Fly === 'function') v3Fly(fw, rt, dt * (KEYS.has('Shift') ? 3 : 1));
    return;
  }
  if (KEYS.has('ArrowLeft')) CAM.x -= v;
  if (KEYS.has('ArrowRight')) CAM.x += v;
  if (KEYS.has('ArrowUp')) CAM.y -= v;
  if (KEYS.has('ArrowDown')) CAM.y += v;
  if (KEYS.size) camClamp();
}

// —— 小地图：地形底图预渲染一次，动态层每 200ms 重画 ——
const MM = { cv: null, base: null, k: 1 };
const MM_COL = ['#03140c', '#0a3326', '#7a1f33', '#5fae7a', '#3e6b52', '#9be3b5', '#103d24', '#0d5a2e', '#1b7a42', '#3bb56a',
  '#11433d', '#1d6f8a', '#e6fff0', '#7fe0a4', '#57c987', '#2a8fa8'];

function mmInit(cv) {
  MM.cv = cv; MM.real = realLook() && !(typeof greenLook === 'function' && greenLook());   // 黑绿画面的小地图用数码矩阵的配色
  const w = cv.clientWidth || 268;
  cv.width = Math.round(w * (window.devicePixelRatio || 1)); cv.height = Math.round(cv.width * H / W);
  MM.k = cv.width / W;
  MM.base = document.createElement('canvas');
  MM.base.width = GW; MM.base.height = GH;
  const g = MM.base.getContext('2d'), img = g.createImageData(GW, GH);
  for (let i = 0; i < GW * GH; i++) {
    const t = TER.type[i];
    if (MM.real) {   // 写实：与地形同一套底色，海按离岸距离加深
      const c = TRX_FLAT[t], e = isWater(t) ? 1 - clamp((cellCY(i) - coastAt(cellCX(i))) / 900, 0, .6) : .8 + TER.elev[i] * .4;
      for (let j = 0; j < 3; j++) img.data[i * 4 + j] = c[j] * e;
    } else {
      const c = MM_COL[t], e = isWater(t) ? 1 : .55 + TER.elev[i] * .6;
      img.data[i * 4] = parseInt(c.slice(1, 3), 16) * e; img.data[i * 4 + 1] = parseInt(c.slice(3, 5), 16) * e;
      img.data[i * 4 + 2] = parseInt(c.slice(5, 7), 16) * e;
    }
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  MM.seed = TER.seed;
}

function mmDraw() {
  const on = typeof viewBegin === 'function' && viewBegin();
  try { mmDraw1(); } finally { if (on) viewEnd(on); }
}
function mmDraw1() {
  if (!MM.cv) return;
  if (MM.seed !== TER.seed || MM.real !== (realLook() && !(typeof greenLook === 'function' && greenLook()))) mmInit(MM.cv);
  const g = MM.cv.getContext('2d'), k = MM.k, dot = (x, y, r, c) => { g.fillStyle = c; g.fillRect(x * k - r, y * k - r, r * 2, r * 2); };
  g.imageSmoothingEnabled = MM.real;
  g.drawImage(MM.base, 0, 0, MM.cv.width, MM.cv.height);
  // 视野外压暗：每 2×2 格取一个像素拼成小图，一次贴上（原来逐块 fillRect，开局大半张图没侦察时每次上万个）
  const fw = Math.ceil(GW / 2), fh = Math.ceil(GH / 2), D = typeof CVL_DISP === 'object' ? CVL_DISP : null;
  if (!MM.fog) { MM.fog = document.createElement('canvas'); MM.fog.width = fw; MM.fog.height = fh; MM.fogImg = MM.fog.getContext('2d').createImageData(fw, fh); }
  const fd = MM.fogImg.data, fc = MM.real ? [8, 12, 18, 128] : [0, 4, 2, 115];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const i = y * 2 * GW + x * 2, o = (y * fw + x) * 4;
    fd[o] = fc[0]; fd[o + 1] = fc[1]; fd[o + 2] = fc[2]; fd[o + 3] = !PV[i] && !(D && D[i]) ? fc[3] : 0;
  }
  MM.fog.getContext('2d').putImageData(MM.fogImg, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(MM.fog, 0, 0, fw * 2 * CELL * k, fh * 2 * CELL * k); g.imageSmoothingEnabled = MM.real;
  const u = Math.max(1.5, k * 6);
  for (const p of S.points) { g.strokeStyle = p.owner === 'p' ? COL.g : COL.enemy; g.lineWidth = 1.5; g.strokeRect(p.x * k - u * 1.4, p.y * k - u * 1.4, u * 2.8, u * 2.8); }
  for (const e of S.enemies) if (e.kx != null && !e.dead) dot(e.kx, e.ky, u * .7, COL.enemy);
  for (const q of S.teams) if (q.side === 'e' ? PV[ci(q.x, q.y)] : true) dot(q.x, q.y, u * .5, q.side === 'p' ? COL.g : COL.enemy);
  for (const s of S.ships) if (alive(s)) dot(s.x, s.y, u * .8, s.state === 'beached' ? COL.gMid : COL.g);
  if (S.dd.state !== 'sunk') dot(S.dd.x, S.dd.y, u, S.dd.state === 'repair' ? COL.amber : COL.intel);
  for (const c of [S.cv, ...(S.cvx || [])]) if (c) dot(c.x, c.y, u * 1.3, c.hp > 0 ? COL.intel : COL.amber);
  for (const p of S.planes) if (!p.dead) dot(p.x, p.y, u * .5, COL.intel);
  g.strokeStyle = COL.sel; g.lineWidth = 1.5;
  if (typeof V3 === 'object' && V3.on && V3.cam) {   // 3D 立体地图：画面四角的视线落点围成的梯形
    g.beginPath();
    for (const [sx, sy] of [[0, CAM.vh * .08], [CAM.vw, CAM.vh * .08], [CAM.vw, CAM.vh], [0, CAM.vh]]) { const p = toWorld(sx, sy); g.lineTo(clamp(p.x, 0, W) * k, clamp(p.y, 0, H) * k); }
    g.closePath(); g.stroke();
  } else {
    const v0 = toWorld(0, 0), v1 = toWorld(CAM.vw, CAM.vh);
    g.strokeRect(v0.x * k, v0.y * k, (v1.x - v0.x) * k, (v1.y - v0.y) * k);
  }
}

function mmBind(cv) {
  const go = e => { const r = cv.getBoundingClientRect(); camCenter((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H); };
  cv.addEventListener('pointerdown', e => { go(e); cv.setPointerCapture(e.pointerId); cv.dataset.drag = '1'; });
  cv.addEventListener('pointermove', e => { if (cv.dataset.drag) go(e); });
  cv.addEventListener('pointerup', () => { delete cv.dataset.drag; });
}
