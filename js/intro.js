'use strict';
// 开场转场：虚构国家全图（S.seed 生成）→ 指数放大到海岸目标区 → 收束到当前战场镜头，再以字符溶解交给实时画面
// 独立画布浮层，约 7 秒；点击 / Esc / 空格 / 回车跳过；SETTINGS.intro === false 时直接跳过
// 坐标：国家单位 CU，1 CU ≈ 333 米；战场 1 世界单位 = 1 米，ITR_K = 每世界单位的 CU
const INTRO = { on: false, el: null, g: null, sc: null, raf: 0, t0: 0, skip: 0, done: null, cue: new Set(), dpr: 1, fx: null };
const ITR_K = .003;
const ITR_T = { zoom0: 1.7, zoom1: 5.75, hold: 6.25, end: 7.15 };
const ITR_SYL = '瓦兰萨尔诺维卡塔莫里斯克托埃门德拉贝加索科纳西奥巴琉恩泽';
const ITR_OPS = ['怒涛', '铁锚', '破晓', '断潮', '长弓', '惊蛰', '赤礁', '海燕', '雷鸣', '曙光'];
const itrEase = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const itrSine = u => (1 - Math.cos(Math.PI * u)) / 2;

function itrScene() {
  const r = rng(((S && S.seed) ^ 0x2c1b3c6d) >>> 0), HN = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) HN[i] = r() * 2 - 1;
  const vn = x => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f), a = HN[i & 4095], b = HN[(i + 1) & 4095]; return a + (b - a) * s; };
  // 海岸分形：波长减半、振幅 ×0.58（统计自相似），只叠加屏幕上分辨得出的倍频
  const fbm = (X, minWl) => { let y = 0, wl = 640, a = 62; for (let o = 0; o < 20 && wl > minWl; o++) { y += a * vn(X / wl + o * 37.13); wl *= .5; a *= .58; } return y; };
  const pc = (r() - .5) * 120, base = X => 110 + 165 * Math.exp(-(((X - pc) / 270) ** 2));
  const cBig = X => base(X) + fbm(X, 30);
  // 目标：半岛南岸一处朝南的海岸
  let XT = pc + (r() - .5) * 200;
  for (let k = 0; k < 20 && Math.abs(cBig(XT + 6) - cBig(XT - 6)) > 5; k++) XT = pc + (r() - .5) * 240;
  const mid = typeof coastAt === 'function' ? coastAt(W / 2) : H * .54;
  const BX = XT - W / 2 * ITR_K, BY = cBig(XT) + fbm(XT, .5) - fbm(XT, 30) - mid * ITR_K, BW = W * ITR_K, BH = H * ITR_K;
  const real = X => BY + (typeof coastAt === 'function' ? coastAt(clamp((X - BX) / ITR_K, 0, W)) : mid) * ITR_K;
  const M = 14, wgt = X => X >= BX && X <= BX + BW ? 1 : 1 - smooth(0, M, X < BX ? BX - X : X - BX - BW);
  const coast = (X, minWl) => { const w = wgt(X), c = w < 1 ? base(X) + fbm(X, minWl) : 0; return w > 0 ? lerp(c, real(X), w) : c; };
  // 陆上国界：以国土中心为极点，从东端海岸经北方扫到西端海岸，半径叠加几组正弦
  const C = [pc + (r() - .5) * 60, -70], XE = pc + 310 + r() * 80, XW = pc - 310 - r() * 80;
  const pE = [XE, cBig(XE)], pW = [XW, cBig(XW)], aE = Math.atan2(pE[1] - C[1], pE[0] - C[0]);
  let a1 = Math.atan2(pW[1] - C[1], pW[0] - C[0]);
  while (a1 > aE) a1 -= 6.2832;
  const rE = Math.hypot(pE[0] - C[0], pE[1] - C[1]), rW = Math.hypot(pW[0] - C[0], pW[1] - C[1]), Rm = 300 + r() * 50, ph = Array.from({ length: 5 }, () => r() * 6.28), border = [];
  const wob = a => .16 * Math.sin(2 * a + ph[0]) + .1 * Math.sin(3 * a + ph[1]) + .06 * Math.sin(5 * a + ph[2]) + .03 * Math.sin(9 * a + ph[3]) + .015 * Math.sin(17 * a + ph[4]);
  for (let i = 0; i <= 110; i++) {
    const u = i / 110, a = lerp(aE, a1, u), b = Math.sin(u * Math.PI), R0 = lerp(lerp(rE, rW, u), Rm, Math.min(1, b * 1.6)) * (1 + b * wob(a));
    border.push([C[0] + Math.cos(a) * R0 * (1 + b * .12), C[1] + Math.sin(a) * R0 * (1 - b * .2)]);
  }
  const poly = [...border];
  for (let X = XW; X <= XE; X += 6) poly.push([X, cBig(X)]);
  const inside = (X, Y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > Y) !== (yj > Y) && X < (xj - xi) * (Y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const bx0 = Math.min(...poly.map(p => p[0])), bx1 = Math.max(...poly.map(p => p[0])), by0 = Math.min(...poly.map(p => p[1])), by1 = Math.max(...poly.map(p => p[1]));
  // 邻国国界：从本国北部国界向外的几条折线
  const nbr = [];
  for (const k of [.22, .5, .78]) {
    const [x0, y0] = border[Math.round(k * 110)], a = Math.atan2(y0 - C[1], x0 - C[0]) + (r() - .5) * .5, pts = [[x0, y0]];
    for (let s = 1; s <= 12; s++) pts.push([x0 + Math.cos(a) * s * 30 + (r() - .5) * 18, y0 + Math.sin(a) * s * 30 + (r() - .5) * 18]);
    nbr.push(pts);
  }
  // 省界：泰森多边形（半平面裁剪），唯一边 + 抖动，绘制时裁剪在国土内
  const sites = [];
  for (let k = 0; sites.length < 9 && k < 600; k++) { const X = lerp(bx0, bx1, r()), Y = lerp(by0, by1, r()); if (inside(X, Y) && sites.every(([a, b]) => Math.hypot(a - X, b - Y) > 115)) sites.push([X, Y]); }
  const box = [[bx0 - 60, by0 - 60], [bx1 + 60, by0 - 60], [bx1 + 60, by1 + 60], [bx0 - 60, by1 + 60]], edges = new Map();
  for (const [i, si] of sites.entries()) {
    let cell = box;
    for (const [j, sj] of sites.entries()) if (i !== j) {
      const nx = sj[0] - si[0], ny = sj[1] - si[1], c = (sj[0] ** 2 + sj[1] ** 2 - si[0] ** 2 - si[1] ** 2) / 2, out = [], f = p => p[0] * nx + p[1] * ny - c;
      for (let k = 0; k < cell.length; k++) {
        const a = cell[k], b = cell[(k + 1) % cell.length], fa = f(a), fb = f(b);
        if (fa <= 0) out.push(a);
        if (fa * fb < 0) { const u = fa / (fa - fb); out.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]); }
      }
      cell = out;
    }
    for (let k = 0; k < cell.length; k++) {
      const a = cell[k], b = cell[(k + 1) % cell.length], key = [a, b].map(p => p.map(Math.round).join(',')).sort().join('|');
      if (!edges.has(key) && Math.hypot(a[0] - b[0], a[1] - b[1]) > 4) {
        const er = rng(Math.round(a[0] * 7 + b[1] * 13 + a[1] * 3 + b[0] * 5) >>> 0), pts = [a];
        for (let s = 1; s < 10; s++) { const u = s / 10; pts.push([lerp(a[0], b[0], u) + (er() - .5) * 12, lerp(a[1], b[1], u) + (er() - .5) * 12]); }
        pts.push(b); edges.set(key, pts);
      }
    }
  }
  // 城市：首都、大城市、城镇（沿海的贴着海岸），离目标区远一点
  const names = new Set(), nm = (n, suf) => { let s; do { s = ''; for (let i = 0; i < n; i++) s += ITR_SYL[r() * ITR_SYL.length | 0]; } while (names.has(s)); names.add(s); return s + suf; };
  const cities = [], place = (lv, coastal) => {
    for (let k = 0; k < 300; k++) {
      const X = lerp(bx0, bx1, r()), Y = coastal ? cBig(X) - 6 - r() * 5 : lerp(by0, by1, r());
      if (!inside(X, Y - (coastal ? 8 : 25))) continue;
      if (Math.abs(X - XT) < 50) continue;
      if (cities.some(c => Math.hypot(c.X - X, c.Y - Y) < (lv < 2 ? 95 : 48))) continue;
      cities.push({ X, Y, lv, name: lv < 2 ? nm(2, lv && coastal ? '港' : '') : '' });
      return;
    }
  };
  place(0, false); for (let i = 0; i < 4; i++) place(1, i < 2); for (let i = 0; i < 10; i++) place(2, i < 3);
  const roads = [];
  for (const c of cities) if (c.lv) {
    const near = cities.filter(o => o !== c && o.lv <= c.lv).sort((a, b) => Math.hypot(a.X - c.X, a.Y - c.Y) - Math.hypot(b.X - c.X, b.Y - c.Y))[0];
    if (near) roads.push([c, near]);
  }
  // 河流：内陆发源，平滑蜿蜒入海
  const rivers = [];
  for (let k = 0; k < 3; k++) {
    let X0 = 0;
    for (let tries = 0; tries < 40; tries++) { X0 = lerp(bx0 + 60, bx1 - 60, r()); if (Math.abs(X0 - XT) > 80 && rivers.every(rv => Math.abs(rv[0][0] - X0) > 130)) break; }
    let Y = by0 + 40 + r() * 90;
    while (!inside(X0, Y) && Y < by1) Y += 10;
    const p1 = r() * 6.28, p2 = r() * 6.28, dr = (r() - .5) * .35, A1 = 10 + r() * 24, L1 = 45 + r() * 60, A2 = 3 + r() * 7, Ys = Y, pts = [];
    for (let s = 0; s < 260; s++) {
      const X = X0 + A1 * Math.sin(Y / L1 + p1) + A2 * Math.sin(Y / 19 + p2) + dr * (Y - Ys), cy = cBig(X);
      pts.push([X, Math.min(Y, cy)]);
      if (Y >= cy) break;
      Y += 4;
    }
    if (pts.length > 8) rivers.push(pts);
  }
  // 海岛
  const isles = [];
  for (let k = 0; k < 7; k++) {
    const X = lerp(bx0 - 120, bx1 + 120, r());
    if (Math.abs(X - XT) < 90) continue;
    const Y = cBig(X) + 30 + r() * 110, R0 = 5 + r() * 18, q = [r() * 6.28, r() * 6.28, r() * 6.28], pts = [];
    for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283; pts.push([X + Math.cos(a) * R0 * (1 + .28 * Math.sin(2 * a + q[0]) + .16 * Math.sin(3 * a + q[1]) + .08 * Math.sin(7 * a + q[2])), Y + Math.sin(a) * R0 * .7 * (1 + .2 * Math.sin(2 * a + q[1]))]); }
    isles.push(pts);
  }
  const cname = nm(2, '') + ['共和国', '联邦', '王国'][r() * 3 | 0], op = ITR_OPS[r() * ITR_OPS.length | 0];
  const sc = { coast, cBig, XT, BX, BY, BW, BH, XW, XE, border, nbr, box: [bx0, by0, bx1, by1], edges: [...edges.values()], cities, roads, rivers, isles, cname, op, lon0: 118 + r() * 14, lat0: 30 + r() * 12 };
  sc.ter = itrRaster();
  sc.reg = itrRegion(sc, r);
  return sc;
}

// 地形配色（暗色战术图）：与实时画面亮度接近，交叉淡化时不跳
const ITR_RGB = [[2, 9, 6], [4, 22, 17], [26, 12, 17], [32, 78, 50], [20, 52, 35], [52, 116, 76], [8, 30, 18], [10, 42, 23], [17, 56, 33], [30, 78, 50],
  [9, 36, 32], [14, 62, 78], [120, 200, 150], [32, 90, 58], [50, 120, 78], [20, 88, 104]];
// 战场地形：按格取色（高程明暗），放大 4 倍平滑后四边羽化，便于与周围区域底图衔接
function itrRaster() {
  if (typeof TER !== 'object' || !TER) return null;
  const c = document.createElement('canvas'), g = c.getContext('2d'), img = g.createImageData(GW, GH);
  c.width = GW; c.height = GH;
  for (let i = 0; i < GW * GH; i++) {
    const t = TER.type[i], cc = ITR_RGB[t] || ITR_RGB[0], e = t <= 2 ? 1 : .7 + TER.elev[i] * .7;
    img.data[i * 4] = cc[0] * e; img.data[i * 4 + 1] = cc[1] * e; img.data[i * 4 + 2] = cc[2] * e; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const big = document.createElement('canvas'), b = big.getContext('2d');
  big.width = GW * 4; big.height = GH * 4;
  b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high';
  b.drawImage(c, 0, 0, big.width, big.height);
  b.globalCompositeOperation = 'destination-in';
  for (const [x0, y0, x1, y1] of [[0, 0, big.width, 0], [0, 0, 0, big.height]]) {
    const gr = b.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.035, '#000'); gr.addColorStop(.965, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = gr; b.fillRect(0, 0, big.width, big.height);
  }
  return big;
}

// 区域底图：目标周围 96×64 CU 的程序化地形（同一海岸函数 + 噪声高程/林地 + 等高线），战场之外的区域尺度细节
// 分帧生成（每帧若干行），第一阶段结束前完成，避免开场卡顿
function itrRegion(sc, r) {
  const RW = 96, RH = 64, PX = 576, PY = Math.round(PX * RH / RW), x0 = sc.XT - RW / 2, y0 = sc.BY + sc.BH * .45 - RH / 2;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = PX; c.height = PY;
  const cy = new Float32Array(PX);
  for (let i = 0; i < PX; i++) cy[i] = sc.coast(x0 + (i + .5) / PX * RW, .08);
  return { c, g, x0, y0, w: RW, h: RH, PX, PY, cy, row: 0, done: false, img: g.createImageData(PX, PY), el: new Float32Array(PX * PY),
    n1: valueNoise(r, 14, 10), n2: valueNoise(r, 48, 32), nf: valueNoise(r, 30, 20) };
}
function itrRegionStep(R0, rows) {
  if (R0.done) return;
  const { PX, PY, cy, img, el, n1, n2, nf, w, h } = R0, d = img.data, end = Math.min(PY, R0.row + rows);
  for (let j = R0.row; j < end; j++) for (let i = 0; i < PX; i++) {
    const Y = R0.y0 + (j + .5) / PY * h, u = i / PX, v = j / PY, dc = cy[i] - Y, k = j * PX + i;
    let col;
    if (dc <= 0) { el[k] = -1; col = -dc < .25 ? ITR_RGB[1] : [2, 8 + 7 * Math.exp(dc / 2), 6 + 5 * Math.exp(dc / 2)]; }
    else {
      const e = el[k] = clamp(n1(u, v) * .75 + n2(u, v) * .35 - .25 + Math.min(.25, dc / 40), 0, 1), sh = .75 + e * .45;
      col = dc < .08 ? ITR_RGB[4] : e > .78 ? ITR_RGB[9] : e > .58 ? ITR_RGB[8] : nf(u, v) > .62 ? ITR_RGB[7] : ITR_RGB[6];
      col = [col[0] * sh, col[1] * sh, col[2] * sh];
      // 等高线：与上、左像素不在同一高程带
      const b = Math.floor(e * 7);
      if (b > 0 && (j > 0 && el[k - PX] >= 0 && Math.floor(el[k - PX] * 7) !== b || i > 0 && el[k - 1] >= 0 && Math.floor(el[k - 1] * 7) !== b)) col = [col[0] + 14, col[1] + 34, col[2] + 20];
    }
    d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 255;
  }
  R0.row = end;
  if (end < PY) return;
  const g = R0.g;
  g.putImageData(img, 0, 0);
  g.globalCompositeOperation = 'destination-in';   // 四边羽化
  for (const [ax, ay, bx, by] of [[0, 0, PX, 0], [0, 0, 0, PY]]) {
    const gr = g.createLinearGradient(ax, ay, bx, by);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.18, '#000'); gr.addColorStop(.82, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, PX, PY);
  }
  R0.done = true; R0.img = null; R0.el = null;
}

// 预渲染：扫描线与暗角
function itrFx(w, h, dpr) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = w * dpr; c.height = h * dpr;
  g.fillStyle = 'rgba(0,0,0,.22)';
  for (let y = 0; y < c.height; y += 3 * dpr) g.fillRect(0, y, c.width, dpr);
  const v = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * .35, c.width / 2, c.height / 2, Math.hypot(c.width, c.height) * .55);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.7)');
  g.fillStyle = v; g.fillRect(0, 0, c.width, c.height);
  return { c, w, h, dpr };
}

function playIntro(onDone) {
  const fin = typeof onDone === 'function' ? onDone : () => {};
  if (typeof document === 'undefined' || (typeof SETTINGS === 'object' && SETTINGS.intro === false) || !S || typeof TER !== 'object' || !TER) { fin(); return; }
  if (INTRO.on) itrStop(false);
  let sc;
  try { sc = itrScene(); } catch (e) { console.error('intro', e); fin(); return; }
  const el = INTRO.el = document.createElement('canvas');
  el.className = 'mn-layer'; el.setAttribute('aria-label', '开场转场，点击跳过');
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:60;cursor:pointer;touch-action:none;background:#010402';
  document.body.appendChild(el);
  Object.assign(INTRO, { on: true, g: el.getContext('2d'), sc, t0: performance.now(), skip: 0, done: fin, cue: new Set(), fx: null, tiles: null, stageT: {}, cover: true });
  el.addEventListener('pointerdown', e => { e.preventDefault(); itrSkip(); });
  itrLy(el, e => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); itrSkip(); } });
  // 最终取景：当前战场镜头在国家坐标里的矩形，屏幕上对齐战场画布
  if (typeof camClamp === 'function') camClamp();
  INTRO.raf = requestAnimationFrame(itrFrame);
}
function itrLy(el, fn) { if (typeof lyPush === 'function') lyPush(el, fn); }
function itrSkip() {
  const t = (performance.now() - INTRO.t0) / 1000;
  if (!INTRO.on || INTRO.skip || t > ITR_T.end - .4) return;
  INTRO.skip = t;
  if (typeof auWhoosh === 'function') auWhoosh(.4, false, .25);
}
function itrStop(call) {
  cancelAnimationFrame(INTRO.raf);
  if (INTRO.el) { if (typeof lyPop === 'function') lyPop(INTRO.el); INTRO.el.remove(); }
  const f = INTRO.done;
  Object.assign(INTRO, { on: false, el: null, g: null, done: null });
  if (call && f) { try { f(); } catch (e) { console.error('intro done', e); } }
}
const introBusy = () => INTRO.on;

function itrCue(id, t, at, fn) { if (t >= at && !INTRO.cue.has(id)) { INTRO.cue.add(id); try { fn(); } catch (e) { /* 无音频时忽略 */ } } }
const itrBeep = (f, d, g) => { if (typeof auBeep === 'function') auBeep(f, d, g); };

// 镜头：先略推近国家全图，再锚定目标做指数放大，屏幕偏移随前 45% 收回中心
function itrCam(t, vw, vh, fr) {
  const sc = INTRO.sc, [bx0, by0, bx1, by1] = sc.box, cw = bx1 - bx0, ch = by1 - by0, s0 = Math.min(fr.w / (cw * 1.3), fr.h / (ch * 1.4)), c0 = [(bx0 + bx1) / 2, (by0 + by1) / 2 + ch * .06];
  const v0 = toWorld(0, 0), v1 = toWorld(CAM.vw, CAM.vh);
  const cf = [sc.BX + (v0.x + v1.x) / 2 * ITR_K, sc.BY + (v0.y + v1.y) / 2 * ITR_K], s1 = fr.w / ((v1.x - v0.x) * ITR_K);
  const kb = 1 + .06 * smooth(0, ITR_T.zoom0, t), sa = s0 * 1.06;
  if (t < ITR_T.zoom0) return { cx: c0[0], cy: c0[1], s: s0 * kb, cf, s1, s0 };
  const u = itrSine(clamp((t - ITR_T.zoom0) / (ITR_T.zoom1 - ITR_T.zoom0), 0, 1)), s = Math.exp(lerp(Math.log(sa), Math.log(s1), u));
  const o = [(cf[0] - c0[0]) * sa, (cf[1] - c0[1]) * sa], g = 1 - smooth(0, .45, u);
  return { cx: cf[0] - o[0] * g / s, cy: cf[1] - o[1] * g / s, s, cf, s1, s0 };
}

function itrFrame(now) {
  if (!INTRO.on) return;
  INTRO.raf = requestAnimationFrame(itrFrame);
  let t = INTRO.freeze != null ? INTRO.freeze : (now - INTRO.t0) / 1000;   // freeze：测试截图用
  if (INTRO.skip) t = Math.max(t, ITR_T.end - .35 + (t - INTRO.skip));   // 跳过：直接进入最后 0.35 秒的溶解
  if (t >= ITR_T.end) { itrStop(true); return; }
  INTRO.cover = t < ITR_T.hold - .1;   // 浮层完全不透明时主循环可跳过战场绘制
  try { itrDraw(t); } catch (e) { console.error('intro', e); itrStop(true); }
}

function itrDraw(t) {
  const el = INTRO.el, g = INTRO.g, sc = INTRO.sc, dpr = Math.min(2, window.devicePixelRatio || 1), vw = innerWidth, vh = innerHeight;
  if (el.width !== Math.round(vw * dpr) || el.height !== Math.round(vh * dpr)) { el.width = Math.round(vw * dpr); el.height = Math.round(vh * dpr); INTRO.fx = null; INTRO.tiles = null; }
  if (!INTRO.fx) INTRO.fx = itrFx(vw, vh, dpr);
  const cr = R.cv ? R.cv.getBoundingClientRect() : { left: 0, top: 0, width: vw, height: vh }, fr = { x: cr.left, y: cr.top, w: cr.width || vw, h: cr.height || vh };
  const cam = INTRO.cam = itrCam(t, vw, vh, fr), { s } = cam, ox = fr.x + fr.w / 2, oy = fr.y + fr.h / 2;
  const SX = X => (X - cam.cx) * s + ox, SY = Y => (Y - cam.cy) * s + oy, X0 = cam.cx - ox / s, X1 = cam.cx + (vw - ox) / s, Y0 = cam.cy - oy / s;
  const zl = Math.log(s / cam.s0), zt = Math.log(cam.s1 / cam.s0), zu = clamp(zl / zt, 0, 1);   // 放大进度（对数）
  const rectPx = sc.BW * s, stage = rectPx > vw * .45 ? 3 : zl > 2 ? 2 : 1;
  const fade = smooth(0, .45, t);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#010402'; g.fillRect(0, 0, vw, vh);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // 海岸采样（按屏幕 2px 步长，倍频随缩放增加 → 越放大细节越多）
  const step = 2 / s, minWl = 6 / s, cs = [];
  for (let X = X0 - step * 2; X <= X1 + step * 2; X += step) cs.push([X, sc.coast(X, minWl)]);
  const top = Y0 - 50 / s;
  // 海面：等深线（屏幕固定间距，点线）
  g.globalAlpha = fade;
  for (const [off, a] of [[12, .14], [30, .07], [58, .04]]) {
    g.beginPath(); cs.forEach(([X, Y], i) => i ? g.lineTo(SX(X), SY(Y) + off) : g.moveTo(SX(X), SY(Y) + off));
    g.setLineDash([2, 5]); g.strokeStyle = rgba(COL.g, a); g.lineWidth = 1; g.stroke();
  }
  g.setLineDash([]);
  // 陆地
  g.beginPath(); cs.forEach(([X, Y]) => g.lineTo(SX(X), SY(Y))); g.lineTo(vw + 10, SY(top)); g.lineTo(-10, SY(top)); g.closePath();
  g.fillStyle = 'rgba(61,255,138,.035)'; g.fill();
  // 本国国土（略亮）与国界
  const cAlpha = 1 - smooth(1.6, 3.6, zl);
  g.save(); g.beginPath();
  const csIn = cs.filter(([X]) => X > sc.XW && X < sc.XE);
  if (X0 > sc.XW && X1 < sc.XE && csIn.length) { csIn.forEach(([X, Y]) => g.lineTo(SX(X), SY(Y))); g.lineTo(vw + 10, SY(top)); g.lineTo(-10, SY(top)); }
  else {
    for (let X = sc.XW; X <= sc.XE; X += Math.max(step, 1)) g.lineTo(SX(X), SY(sc.coast(X, Math.max(minWl, 2))));
    for (const [X, Y] of sc.border) g.lineTo(SX(X), SY(Y));
  }
  g.closePath(); g.fillStyle = 'rgba(61,255,138,.05)'; g.fill(); g.clip();
  if (cAlpha > .01) {   // 省界
    g.globalAlpha = fade * cAlpha * smooth(.3, 1.1, t);
    g.strokeStyle = 'rgba(61,255,138,.22)'; g.lineWidth = 1; g.setLineDash([5, 4]);
    for (const pts of sc.edges) { g.beginPath(); pts.forEach(([X, Y], i) => i ? g.lineTo(SX(X), SY(Y)) : g.moveTo(SX(X), SY(Y))); g.stroke(); }
    g.setLineDash([]);
    g.strokeStyle = 'rgba(61,255,138,.1)';   // 公路
    for (const [a, b] of sc.roads) { g.beginPath(); g.moveTo(SX(a.X), SY(a.Y)); g.lineTo(SX(b.X), SY(b.Y)); g.stroke(); }
    g.strokeStyle = 'rgba(92,200,255,.35)'; g.lineWidth = 1.2;   // 河流
    for (const pts of sc.rivers) { g.beginPath(); pts.forEach(([X, Y], i) => i ? g.lineTo(SX(X), SY(Y)) : g.moveTo(SX(X), SY(Y))); g.stroke(); }
  }
  g.restore();
  g.globalAlpha = fade * (1 - smooth(1.5, 3, zl));
  g.beginPath(); sc.border.forEach(([X, Y], i) => i ? g.lineTo(SX(X), SY(Y)) : g.moveTo(SX(X), SY(Y)));
  g.setLineDash([7, 4, 1.5, 4]); g.strokeStyle = 'rgba(61,255,138,.5)'; g.lineWidth = 1.2; g.stroke();
  g.strokeStyle = 'rgba(61,255,138,.18)'; g.lineWidth = 1;   // 邻国国界
  for (const pts of sc.nbr) { g.beginPath(); pts.forEach(([X, Y], i) => i ? g.lineTo(SX(X), SY(Y)) : g.moveTo(SX(X), SY(Y))); g.stroke(); }
  g.setLineDash([]);
  // 区域底图（程序化地形）与战场地形：放大到区域尺度后淡入
  const R0 = sc.reg, rg = smooth(260, 900, R0.w * s);
  itrRegionStep(R0, t < 1.5 ? 24 : 1e4);
  // 纹素放大后淡出，避免块状
  if (rg > .01 && R0.done) { g.globalAlpha = rg * .9 * (1 - .6 * smooth(3, 9, R0.w * s / R0.PX)); g.drawImage(R0.c, SX(R0.x0), SY(R0.y0), R0.w * s, R0.h * s); }
  const ra = smooth(Math.log(36), Math.log(vw * .35), Math.log(rectPx));
  if (sc.ter && ra > .01) {
    g.globalAlpha = ra;
    g.drawImage(sc.ter, SX(sc.BX), SY(sc.BY), sc.BW * s, sc.BH * s);
    if (stage >= 2) {   // 战场方格（与沙盘一致：100 米）
      const gs = 100 * ITR_K * s;
      if (gs > 14) {
        g.globalAlpha = ra * .5 * smooth(14, 40, gs); g.strokeStyle = 'rgba(61,255,138,.1)'; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x <= W; x += 100) { g.moveTo(SX(sc.BX + x * ITR_K), SY(sc.BY)); g.lineTo(SX(sc.BX + x * ITR_K), SY(sc.BY + sc.BH)); }
        for (let y = 0; y <= H; y += 100) { g.moveTo(SX(sc.BX), SY(sc.BY + y * ITR_K)); g.lineTo(SX(sc.BX + sc.BW), SY(sc.BY + y * ITR_K)); }
        g.stroke();
      }
    }
  }
  // 海岸线：入场时自西向东描出
  g.globalAlpha = 1;
  const draw = clamp(t / 1.2, 0, 1), nDraw = Math.max(2, Math.round(cs.length * itrEase(draw)));
  g.beginPath(); for (let i = 0; i < nDraw; i++) { const [X, Y] = cs[i]; i ? g.lineTo(SX(X), SY(Y)) : g.moveTo(SX(X), SY(Y)); }
  g.strokeStyle = rgba(COL.g, .85 - ra * .35); g.lineWidth = 1.4; g.shadowColor = COL.g; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
  // 海岛
  g.globalAlpha = fade * (1 - smooth(2, 4, zl));
  g.strokeStyle = rgba(COL.g, .6); g.fillStyle = 'rgba(61,255,138,.05)'; g.lineWidth = 1;
  for (const pts of sc.isles) { g.beginPath(); pts.forEach(([X, Y]) => g.lineTo(SX(X), SY(Y))); g.closePath(); g.fill(); g.stroke(); }
  itrGraticule(g, sc, cam, SX, SY, vw, vh, fade * (1 - ra * .6));
  itrCities(g, sc, t, SX, SY, cAlpha * fade);
  itrBeaches(g, sc, SX, SY, rectPx, vw);
  if (stage === 3) itrShips(g, sc, SX, SY, ra);
  itrReticle(g, sc, cam, t, SX, SY, vw, vh, fr);
  // 屏幕效果
  g.globalAlpha = 1;
  g.drawImage(INTRO.fx.c, 0, 0, vw, vh);
  const sy = ((t * .3) % 1.3 - .15) * vh;   // 缓慢下扫的亮带
  const bar = g.createLinearGradient(0, sy - 40, 0, sy + 2); bar.addColorStop(0, 'rgba(61,255,138,0)'); bar.addColorStop(1, 'rgba(61,255,138,.035)');
  g.fillStyle = bar; g.fillRect(0, sy - 40, vw, 42);
  itrHud(g, sc, cam, t, stage, zu, vw, vh);
  itrSounds(t, stage);
  if (t > ITR_T.hold) itrDissolve(g, (t - ITR_T.hold) / (ITR_T.end - ITR_T.hold), vw, vh, fr);
}

// 经纬网：按缩放挑选间距（5° … 10″），粗细两级交替淡入
function itrGraticule(g, sc, cam, SX, SY, vw, vh, a) {
  const dLon = .012, dLat = .009, steps = [10, 5, 2, 1, .5, .25, 1 / 6, 1 / 12, 1 / 30, 1 / 60, 1 / 120, 1 / 360, 1 / 720, 1 / 1800, 1 / 3600];
  const pxDeg = cam.s / dLon;
  let i = steps.findIndex(st => st * pxDeg < 90);
  if (i < 1) i = steps.length - 1;
  const fine = steps[i], coarse = steps[i - 1], fa = smooth(30, 90, fine * pxDeg);
  const lonAt = X => sc.lon0 + X * dLon, latAt = Y => sc.lat0 - Y * dLat;
  const Xof = lon => (lon - sc.lon0) / dLon, Yof = lat => (sc.lat0 - lat) / dLat;
  const l0 = lonAt(cam.cx - vw / cam.s), l1 = lonAt(cam.cx + vw / cam.s), b0 = latAt(cam.cy + vh / cam.s), b1 = latAt(cam.cy - vh / cam.s);
  g.font = '10px "IBM Plex Mono", monospace'; g.lineWidth = 1;
  for (const [st, al, lab] of [[fine, .07 * fa, false], [coarse, .13, true]]) {
    g.globalAlpha = a; g.strokeStyle = rgba(COL.g, al); g.beginPath();
    for (let lon = Math.ceil(l0 / st) * st; lon <= l1; lon += st) { const x = SX(Xof(lon)); g.moveTo(x, 0); g.lineTo(x, vh); }
    for (let lat = Math.ceil(b0 / st) * st; lat <= b1; lat += st) { const y = SY(Yof(lat)); g.moveTo(0, y); g.lineTo(vw, y); }
    g.stroke();
    if (lab) {
      g.fillStyle = rgba(COL.g, .4); g.textBaseline = 'top';
      for (let lon = Math.ceil(l0 / st) * st; lon <= l1; lon += st) { const x = SX(Xof(lon)); if (x > 230 && x < vw - 230) g.fillText(itrDeg(lon, 'E'), x + 3, 70); }
      g.textBaseline = 'bottom';
      for (let lat = Math.ceil(b0 / st) * st; lat <= b1; lat += st) { const y = SY(Yof(lat)); if (y > 90 && y < vh - 70) g.fillText(itrDeg(lat, 'N'), 8, y - 2); }
    }
  }
}
function itrDeg(v, h) {
  const d = Math.floor(v + 1e-9), m = (v - d) * 60, mi = Math.floor(m + 1e-6), sec = Math.round((m - mi) * 60);
  return `${d}°${String(mi).padStart(2, '0')}′${sec ? String(sec).padStart(2, '0') + '″' : ''}${h}`;
}

function itrCities(g, sc, t, SX, SY, a) {
  if (a < .01) return;
  g.font = '11px "Noto Sans SC", "IBM Plex Mono", sans-serif'; g.textBaseline = 'middle';
  sc.cities.forEach((c, i) => {
    const at = .45 + i * .06, k = smooth(at, at + .25, t);
    if (k <= 0) return;
    const x = SX(c.X), y = SY(c.Y), r = (c.lv === 0 ? 4 : c.lv === 1 ? 2.8 : 1.6) * (1 + (1 - k) * 1.5);
    g.globalAlpha = a * k;
    g.fillStyle = c.lv === 2 ? rgba(COL.g, .55) : COL.g;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    if (c.lv === 0) { g.strokeStyle = rgba(COL.g, .8); g.lineWidth = 1; g.beginPath(); g.arc(x, y, 8, 0, 6.283); g.stroke(); shape(g, x, y, 12, 4, Math.PI / 4); g.strokeStyle = rgba(COL.g, .3); g.stroke(); }
    if (c.name) { g.fillStyle = rgba(COL.text, c.lv ? .55 : .85); g.fillText(c.lv ? c.name : '★ ' + c.name, x + 10, y); }
  });
}

// 区域尺度：标注六处海滩（进入战场尺度前淡出，战场画面保持无字）
function itrBeaches(g, sc, SX, SY, rectPx, vw) {
  const a = smooth(vw * .18, vw * .3, rectPx) * (1 - smooth(vw * .55, vw * .8, rectPx));
  if (a < .01 || !TER.beaches) return;
  g.globalAlpha = a; g.font = '11px "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (const b of TER.beaches) {
    const x0 = SX(sc.BX + b.x0 * ITR_K), x1 = SX(sc.BX + b.x1 * ITR_K), y = SY(sc.BY + coastAt(b.cx) * ITR_K) + 14;
    g.strokeStyle = rgba(COL.amber, .7); g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y - 4); g.lineTo(x0, y); g.lineTo(x1, y); g.lineTo(x1, y - 4); g.stroke();
    g.fillStyle = rgba(COL.amber, .85); g.fillText(b.name, (x0 + x1) / 2, y + 3);
  }
  g.textAlign = 'left';
}

function itrShips(g, sc, SX, SY, a) {
  g.globalAlpha = a * .8; g.fillStyle = COL.g;
  for (const s of S.ships || []) if (s.state !== 'sunk') { const x = SX(sc.BX + s.x * ITR_K), y = SY(sc.BY + s.y * ITR_K); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
}

// 目标标线：作战区（当前战场镜头）四角括线，最小 44px；国家尺度为红色脉动，收束时转绿
function itrReticle(g, sc, cam, t, SX, SY, vw, vh, fr) {
  const v0 = toWorld(0, 0), v1 = toWorld(CAM.vw, CAM.vh);
  const ax0 = SX(sc.BX + v0.x * ITR_K), ay0 = SY(sc.BY + v0.y * ITR_K), ax1 = SX(sc.BX + v1.x * ITR_K), ay1 = SY(sc.BY + v1.y * ITR_K);
  const cx = (ax0 + ax1) / 2, cy = (ay0 + ay1) / 2, hw = Math.max(22, (ax1 - ax0) / 2), hh = Math.max(22, (ay1 - ay0) / 2);
  const app = smooth(.95, 1.35, t);
  if (app <= 0) return;
  const lock = smooth(ITR_T.zoom1 - .5, ITR_T.zoom1, t), col = lock > .5 ? COL.g : COL.enemy;
  const k = (1 - app) * 3 + 1, bw = hw * k, bh = hh * k, L = Math.min(18, bw * .5, bh * .5) + Math.max(0, Math.min(bw, bh) * .04);
  g.globalAlpha = app * (1 - smooth(ITR_T.hold, ITR_T.hold + .3, t));
  g.strokeStyle = col; g.lineWidth = 1.6; g.shadowColor = col; g.shadowBlur = 6;
  g.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = cx + sx * bw, y = cy + sy * bh; g.moveTo(x - sx * L, y); g.lineTo(x, y); g.lineTo(x, y - sy * L); }
  g.stroke(); g.shadowBlur = 0;
  if (hw < 60) {   // 国家尺度：脉冲环与贯穿屏幕的十字准线
    const p = (t * 1.1) % 1;
    g.globalAlpha = app * (1 - p) * .8; g.lineWidth = 1.2;
    g.beginPath(); g.arc(cx, cy, 8 + p * 34, 0, 6.283); g.stroke();
    g.globalAlpha = app * .9; g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 2.2, 0, 6.283); g.fill();
    g.globalAlpha = app * .22; g.lineWidth = 1; g.setLineDash([3, 6]); g.beginPath();
    g.moveTo(0, cy); g.lineTo(cx - bw - 6, cy); g.moveTo(cx + bw + 6, cy); g.lineTo(vw, cy); g.moveTo(cx, 0); g.lineTo(cx, cy - bh - 6); g.moveTo(cx, cy + bh + 6); g.lineTo(cx, vh); g.stroke(); g.setLineDash([]);
  }
}

// 角落信息（HUD 风格，允许文字）
function itrHud(g, sc, cam, t, stage, zu, vw, vh) {
  const mob = vw < 600, pad = mob ? 14 : 22, a = smooth(.1, .5, t) * (1 - smooth(ITR_T.hold, ITR_T.hold + .35, t));
  const T = [['战区概览', 'THEATER OVERVIEW'], ['区域态势', 'REGIONAL APPROACH'], ['作战区', 'AREA OF OPERATIONS']][stage - 1], st = INTRO.stageT;
  if (st.k !== stage) { st.k = stage; st.t = Math.max(.1, t); }
  if (a <= 0) return;
  g.globalAlpha = a;
  g.fillStyle = COL.g; g.fillRect(pad, pad + 2, 3, 30);
  g.font = `700 ${mob ? 16 : 19}px "Noto Sans SC", sans-serif`; g.textBaseline = 'top'; g.fillStyle = COL.text;
  g.fillText(itrDecode(T[0], t - st.t, .35), pad + 12, pad);
  g.font = '10px "Silkscreen", "IBM Plex Mono", monospace'; g.fillStyle = rgba(COL.g, .7);
  g.fillText(itrDecode(T[1], t - st.t, .5), pad + 12, pad + (mob ? 21 : 25));
  g.textAlign = 'right'; g.font = `600 ${mob ? 12 : 14}px "Noto Sans SC", sans-serif`; g.fillStyle = COL.text;
  g.fillText(itrDecode(sc.cname, t, .6), vw - pad, pad);
  g.font = '11px "Noto Sans SC", "IBM Plex Mono", monospace'; g.fillStyle = rgba(COL.amber, .9);
  g.fillText(itrDecode(`作战代号 · ${sc.op}`, t - .3, .6), vw - pad, pad + 20);
  g.fillStyle = rgba(COL.g, .55); g.fillText(`缩放 ×${(cam.s / cam.s0).toFixed(cam.s / cam.s0 < 10 ? 1 : 0)}`, vw - pad, pad + 36);
  // 左下：视野中心经纬度 + 比例尺
  g.textAlign = 'left'; g.textBaseline = 'bottom';
  const lon = sc.lon0 + cam.cx * .012, lat = sc.lat0 - cam.cy * .009, kmPx = .333 / cam.s;
  const nice = [500, 200, 100, 50, 20, 10, 5, 2, 1, .5, .2, .1].find(v => v / kmPx < 140) || .1, bl = nice / kmPx;
  g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = rgba(COL.g, .75);
  g.fillText(`${itrDeg(lat, 'N')}  ${itrDeg(lon, 'E')}`, pad, vh - pad - 14);
  g.strokeStyle = rgba(COL.g, .75); g.lineWidth = 1; g.beginPath(); g.moveTo(pad, vh - pad - 6); g.lineTo(pad, vh - pad); g.lineTo(pad + bl, vh - pad); g.lineTo(pad + bl, vh - pad - 6); g.stroke();
  g.fillText(nice >= 1 ? nice + ' km' : nice * 1000 + ' m', pad + bl + 8, vh - pad + 2);
  g.textAlign = 'right'; g.fillStyle = rgba(COL.text, .45);
  g.fillText(mob ? '点击跳过' : '点击 / Esc / 空格 跳过', vw - pad, vh - pad + 2);
  g.textAlign = 'left';
  // 底部进度条
  g.fillStyle = rgba(COL.g, .5); g.fillRect(0, vh - 2, vw * clamp(t / ITR_T.end, 0, 1), 2);
  if (stage === 3) {   // 锁定提示
    const k = smooth(ITR_T.zoom1 - .3, ITR_T.zoom1, t);
    g.globalAlpha = a * k; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${mob ? 12 : 13}px "Noto Sans SC", sans-serif`; g.fillStyle = COL.g;
    g.fillText(itrDecode('作战区锁定 · 进入战场', t - ITR_T.zoom1 + .3, .5), vw / 2, vh - pad - (mob ? 50 : 8));
    g.textAlign = 'left';
  }
}
function itrDecode(str, dt, dur) {
  if (dt >= dur) return str;
  if (dt <= 0) return '';
  const n = str.length, k = Math.floor(dt / dur * n), gl = typeof GLYPHS === 'string' ? GLYPHS : '01';
  let s = str.slice(0, k);
  for (let i = k; i < Math.min(n, k + 6); i++) s += str[i] === ' ' ? ' ' : gl[Math.random() * gl.length | 0];
  return s;
}

function itrSounds(t, stage) {
  itrCue('boot', t, .02, () => { itrBeep(520, .05, .08); itrBeep(780, .04, .05); });
  itrCue('trace', t, .1, () => { if (typeof auWhoosh === 'function') auWhoosh(1.1, false, .18); });
  INTRO.sc.cities.forEach((c, i) => { if (i < 8) itrCue('c' + i, t, .5 + i * .06, () => itrBeep(1400 + i * 90, .025, .035)); });
  itrCue('lock1', t, 1.05, () => itrBeep(880, .05, .1));
  itrCue('lock2', t, 1.2, () => itrBeep(1320, .08, .1));
  itrCue('zoom', t, ITR_T.zoom0, () => { if (typeof auWhoosh === 'function') auWhoosh(ITR_T.zoom1 - ITR_T.zoom0 - .2, true, .5); });
  if (stage >= 2) itrCue('s2', t, 0, () => { itrBeep(990, .05, .08); itrBeep(1180, .05, .06); });
  if (stage >= 3) itrCue('s3', t, 0, () => { itrBeep(1180, .05, .08); itrBeep(1480, .07, .07); });
  itrCue('land', t, ITR_T.zoom1 - .1, () => { if (typeof auHit === 'function') auHit(1.3, .45); });
  itrCue('out', t, ITR_T.hold, () => { if (typeof auWhoosh === 'function') auWhoosh(.8, false, .22); });
}

// 溶解：屏幕分块，按离中心距离加随机先后挖空，挖空前闪一个字符
function itrDissolve(g, p, vw, vh, fr) {
  const ts = vw < 600 ? 22 : 28;
  if (!INTRO.tiles) {
    const cols = Math.ceil(vw / ts), rows = Math.ceil(vh / ts), th = new Float32Array(cols * rows), cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2, md = Math.hypot(vw, vh) / 2;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) th[j * cols + i] = .74 * Math.hypot((i + .5) * ts - cx, (j + .5) * ts - cy) / md + .2 * Math.random();
    INTRO.tiles = { cols, rows, th, gl: Array.from({ length: cols * rows }, () => Math.random()) };
  }
  const { cols, rows, th, gl } = INTRO.tiles, G = typeof GLYPHS === 'string' ? GLYPHS : '01';
  g.globalAlpha = 1; g.font = `${ts * .55}px "Noto Sans SC", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalCompositeOperation = 'destination-out'; g.beginPath();
  for (let k = 0; k < cols * rows; k++) if (p > th[k]) g.rect((k % cols) * ts, Math.floor(k / cols) * ts, ts, ts);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  for (let k = 0; k < cols * rows; k++) {
    const d = th[k] - p;
    if (d > 0 && d < .07) { g.globalAlpha = 1 - d / .07; g.fillStyle = d < .03 ? '#d8ffe8' : COL.g; g.fillText(G[(gl[k] * G.length + p * 40) % G.length | 0], (k % cols + .5) * ts, (Math.floor(k / cols) + .5) * ts); }
  }
  g.textAlign = 'left'; g.globalAlpha = 1;
}
