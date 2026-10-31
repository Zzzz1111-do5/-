'use strict';
// 3D 立体地图里的兵种模型（view3d.js v3Draw：v3mCollect 收集这一帧的实例，v3mDraw 画；太阳阴影那一遍也画一次）：
// · 坦克装甲车、飞机、直升机、导弹、单兵：用户给的模型，原封不动导入（js/v3g.js；兵种 → 模型的对照表在那里）；
// · 舰艇：带贴图的精细模型（v3utex.js），没有的照二维画面的船体轮廓、上层建筑、桅杆雷达、主炮、垂发单元建模；航母甲板与舰岛（carrier.js CVG）；
// · 阵地、工事、卡车、补给站、降落伞、据点建筑等由代码建模。
const V3M = { ok: false, tried: false, gl: null, ext: null, der: false, pr: null, a: {}, u: {}, mesh: new Map(), ib: null, inst: new Map(), veh: new Map(), mv: new WeakMap(), tl: new Map() };   // mv：只在画面里记的朝向（抢修组）

// ———————————————— 网格构建 ————————————————
// 顶点：位置 3、法线 3、明暗 1（< 0 为发光的玻璃 / 灯）、棱线坐标 3（重心坐标，不画棱线的边加 1）= 10 个浮点
function mbNew() { return { t: [], l: [] }; }
function mbV(M, p, n, s, b) { M.t.push(p[0], -p[1], p[2], n[0], -n[1], n[2], s, b[0], b[1], b[2]); }
const mbSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mbCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mbNorm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// 三角形：e = [对边 0、1、2 是否画棱线]
function mbTri(M, a, b, c, s, e = [1, 1, 1], n) {
  n = n || mbNorm(mbCross(mbSub(b, a), mbSub(c, a)));
  const k = [e[0] ? 0 : 1, e[1] ? 0 : 1, e[2] ? 0 : 1];
  mbV(M, a, n, s, [1 + k[0], k[1], k[2]]); mbV(M, b, n, s, [k[0], 1 + k[1], k[2]]); mbV(M, c, n, s, [k[0], k[1], 1 + k[2]]);
}
// 四边形 a b c d（对角线不画棱线）；out：形体中心，用来把法线翻到朝外
function mbQuad(M, a, b, c, d, s, out) {
  let n = mbNorm(mbCross(mbSub(b, a), mbSub(d, a)));
  if (out) { const m = [(a[0] + c[0]) / 2 - out[0], (a[1] + c[1]) / 2 - out[1], (a[2] + c[2]) / 2 - out[2]]; if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]]; }
  mbTri(M, a, b, c, s, [1, 0, 1], n); mbTri(M, a, c, d, s, [1, 1, 0], n);
}
// 发光线（面板接缝、甲板标线、天线）：整条都是棱线
function mbLine(M, a, b, s = 1) { M.l.push(a[0], -a[1], a[2], 0, 0, 1, s, 0, 0, 0, b[0], -b[1], b[2], 0, 0, 1, s, 0, 0, 0); }
// 多边形三角化（耳切法；车体、炮塔、甲板轮廓都不太凹）
function mbEar(P) {
  const n = P.length, idx = P.map((_, i) => i), out = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1, cr = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sg;
  const inside = (p, a, b, c) => cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 600) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length], a = P[i0], b = P[i1], c = P[i2];
      if (cr(a, b, c) <= 1e-9) continue;
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inside(P[j], a, b, c))) continue;
      out.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.slice());
  else for (let k = 1; k < idx.length - 1; k++) out.push([idx[0], idx[k], idx[k + 1]]);
  return out;
}
const mbAdj = (a, b, n) => Math.abs(a - b) === 1 || Math.abs(a - b) === n - 1;   // 两个顶点在轮廓上相邻（这条边是外轮廓，画棱线）
// 柱体：底面轮廓 P（x, y）从 z0 挤到 z1；taper：顶面向内收（斜面装甲、炮塔斜壁）；top：顶面明暗；bottom：封底
function mbPrism(M, P, z0, z1, s, o = {}) {
  if (!P || P.length < 3 || !(z1 > z0)) return;
  const n = P.length, cx = P.reduce((a, p) => a + p[0], 0) / n, cy = P.reduce((a, p) => a + p[1], 0) / n;
  const t = o.taper || 0, Q = t ? P.map(([x, y]) => { const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy) || 1, k = Math.min(t, l * .45); return [x + dx / l * k, y + dy / l * k]; }) : P;
  const out = [cx, cy, (z0 + z1) / 2];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; mbQuad(M, [P[i][0], P[i][1], z0], [P[j][0], P[j][1], z0], [Q[j][0], Q[j][1], z1], [Q[i][0], Q[i][1], z1], s, out); }
  for (const [a, b, c] of mbEar(Q)) mbTri(M, [Q[a][0], Q[a][1], z1], [Q[b][0], Q[b][1], z1], [Q[c][0], Q[c][1], z1], o.top ?? s, [mbAdj(b, c, n), mbAdj(c, a, n), mbAdj(a, b, n)], [0, 0, 1]);
  if (o.bottom) for (const [a, b, c] of mbEar(P)) mbTri(M, [P[a][0], P[a][1], z0], [P[b][0], P[b][1], z0], [P[c][0], P[c][1], z0], s, [0, 0, 0], [0, 0, -1]);
}
const mbRect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function mbBox(M, x0, x1, y0, y1, z0, z1, s, o) { mbPrism(M, mbRect(x0, x1, y0, y1), z0, z1, s, o); }
// 侧面轮廓（x, z）沿 y 挤出：履带、斜置的发射箱
function mbSide(M, P, y0, y1, s) {
  const n = P.length, cx = P.reduce((a, p) => a + p[0], 0) / n, cz = P.reduce((a, p) => a + p[1], 0) / n, out = [cx, (y0 + y1) / 2, cz];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; mbQuad(M, [P[i][0], y0, P[i][1]], [P[j][0], y0, P[j][1]], [P[j][0], y1, P[j][1]], [P[i][0], y1, P[i][1]], s, out); }
  for (const yy of [y0, y1]) for (const [a, b, c] of mbEar(P)) mbTri(M, [P[a][0], yy, P[a][1]], [P[b][0], yy, P[b][1]], [P[c][0], yy, P[c][1]], s, [mbAdj(b, c, n), mbAdj(c, a, n), mbAdj(a, b, n)], [0, yy === y0 ? -1 : 1, 0]);
}
// 圆管：p0 → p1，半径 r0 → r1，n 边；caps 封口
function mbTube(M, p0, p1, r0, r1, nseg, s, caps = true) {
  const d = mbNorm(mbSub(p1, p0)), up = Math.abs(d[2]) < .9 ? [0, 0, 1] : [1, 0, 0], u = mbNorm(mbCross(d, up)), v = mbCross(d, u);
  const ring = (p, r) => Array.from({ length: nseg }, (_, i) => { const a = i / nseg * 6.2832, c = Math.cos(a) * r, sn = Math.sin(a) * r; return [p[0] + u[0] * c + v[0] * sn, p[1] + u[1] * c + v[1] * sn, p[2] + u[2] * c + v[2] * sn]; });
  const A = ring(p0, r0), B = ring(p1, r1), mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  const k = nseg > 8 ? 0 : 1;   // 圆一点的管子：纵向棱线不画，只画两头的圆
  for (let i = 0; i < nseg; i++) {
    const j = (i + 1) % nseg, n = mbNorm(mbSub([(A[i][0] + B[j][0]) / 2, (A[i][1] + B[j][1]) / 2, (A[i][2] + B[j][2]) / 2], mid));
    mbTri(M, A[i], A[j], B[j], s, [k, 0, 1], n); mbTri(M, A[i], B[j], B[i], s, [1, k, 0], n);
  }
  if (caps) for (const [Rr, c, sg] of [[A, p0, -1], [B, p1, 1]]) for (let i = 0; i < nseg; i++) mbTri(M, c, Rr[i], Rr[(i + 1) % nseg], s, [1, 0, 0], [d[0] * sg, d[1] * sg, d[2] * sg]);
}
function mbLoop(M, P, z, s = 1) { for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; mbLine(M, [a[0], a[1], z], [b[0], b[1], z], s); } }
const mbCirc = (x, y, r, n = 12) => Array.from({ length: n }, (_, i) => { const a = i / n * 6.2832; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; });

// —— 记录路径的假画布：二维模型里直接调用的 g.save / translate / rotate 等照常变换，绘图调用都忽略；路径点按当前变换换算 ——
function mbRecCtx() {
  let T = [1, 0, 0, 1, 0, 0], cur = null, last = null;
  const st = [], subs = [];
  const tf = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
  const R0 = {
    tf, subs,
    save() { st.push(T.slice()); }, restore() { if (st.length) T = st.pop(); },
    translate(x, y) { T = [T[0], T[1], T[2], T[3], T[4] + T[0] * x + T[2] * y, T[5] + T[1] * x + T[3] * y]; },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); T = [T[0] * c + T[2] * s, T[1] * c + T[3] * s, -T[0] * s + T[2] * c, -T[1] * s + T[3] * c, T[4], T[5]]; },
    scale(x, y) { T = [T[0] * x, T[1] * x, T[2] * y, T[3] * y, T[4], T[5]]; },
    setTransform(a, b, c, d, e, f) { T = [a, b, c, d, e, f]; }, getTransform() { return { a: T[0], b: T[1], c: T[2], d: T[3], e: T[4], f: T[5] }; },
    beginPath() { subs.length = 0; cur = null; },
    moveTo(x, y) { cur = [tf(x, y)]; subs.push(cur); last = [x, y]; },
    lineTo(x, y) { if (!cur) return R0.moveTo(x, y); cur.push(tf(x, y)); last = [x, y]; },
    quadraticCurveTo(cx, cy, x, y) { if (!last) return R0.moveTo(x, y); const [a0, b0] = last; for (let i = 1; i <= 6; i++) { const t = i / 6, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; cur.push(tf(a * a0 + b * cx + c * x, a * b0 + b * cy + c * y)); } last = [x, y]; },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { if (!last) return R0.moveTo(x, y); const [a0, b0] = last; for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; cur.push(tf(u * u * u * a0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * b0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y)); } last = [x, y]; },
    arc(x, y, r, a0, a1) { const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / .5)); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; R0.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } },
    arcTo(x1, y1) { R0.lineTo(x1, y1); }, rect(x, y, w, h) { R0.moveTo(x, y); R0.lineTo(x + w, y); R0.lineTo(x + w, y + h); R0.lineTo(x, y + h); },
    ellipse(x, y, rx, ry, rot, a0 = 0, a1 = 6.2832) { for (let i = 0; i <= 12; i++) { const a = a0 + (a1 - a0) * i / 12; R0.lineTo(x + Math.cos(a) * rx, y + Math.sin(a) * ry); } },
    roundRect(x, y, w, h) { R0.rect(x, y, w, h); }, closePath() {},
    createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; }, createPattern() { return null; },
    measureText() { return { width: 0 }; }, getLineDash() { return []; }
  };
  return new Proxy(R0, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
}


// 搜索雷达天线（单独转）：一块长条反射面
function v3mRadar(rr) { const M = mbNew(); mbBox(M, -.06, .06, -rr, rr, 0, .45, .95, { taper: .02 }); mbLine(M, [.07, -rr, .22], [.07, rr, .22], 1); return M; }

// ———————————————— 步兵 ————————————————
// 单兵用用户给的士兵模型（js/v3g.js v3gMan，原样摆放）；V3_MAN 是战场上的放大比例（远看不至于缩成一个点）
const V3_MAN = 1.9;
const MS = { uni: 1, uni2: .88, skin: 2.5, blk: 3.42, blk2: 3.3, gear: 4.5, gear2: 4.36, helm: 5.5, glass: -.9 };
// 子网格按坐标系 (o, X, Y, Z) 装到总网格上（mbV 存的 y 是取了负号的，这里先还原再存回）
function mbXf(M, M2, o, X, Y, Z) {
  for (const [A, out] of [[M2.t, M.t], [M2.l, M.l]]) for (let i = 0; i < A.length; i += 10) {
    const px = A[i], py = -A[i + 1], pz = A[i + 2], nx = A[i + 3], ny = -A[i + 4], nz = A[i + 5];
    out.push(o[0] + X[0] * px + Y[0] * py + Z[0] * pz, -(o[1] + X[1] * px + Y[1] * py + Z[1] * pz), o[2] + X[2] * px + Y[2] * py + Z[2] * pz,
      X[0] * nx + Y[0] * ny + Z[0] * nz, -(X[1] * nx + Y[1] * ny + Z[1] * nz), X[2] * nx + Y[2] * ny + Z[2] * nz, A[i + 6], A[i + 7], A[i + 8], A[i + 9]);
  }
}

// 光滑的半椭球（头盔、帽子）：逐顶点法线，只描底圈
function mbDome(M, cx, cy, rx, ry, z0, h, s, n = 16, m = 5) {
  const P = (i, j) => { const a = i / n * 6.2832, t = j / m * 1.5708, c = Math.cos(t); return [cx + Math.cos(a) * rx * c, cy + Math.sin(a) * ry * c, z0 + Math.sin(t) * h]; };
  const N = (i, j) => { const a = i / n * 6.2832, t = j / m * 1.5708; return mbNorm([Math.cos(a) * Math.cos(t) / rx, Math.sin(a) * Math.cos(t) / ry, Math.sin(t) / h]); };
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    mbTriN(M, P(i, j), P(i2, j), P(i2, j + 1), N(i, j), N(i2, j), N(i2, j + 1), s, [0, 0, 0]);
    if (j < m - 1) mbTriN(M, P(i, j), P(i2, j + 1), P(i, j + 1), N(i, j), N(i2, j + 1), N(i, j + 1), s, [0, 0, 0]);
  }
  for (let i = 0; i < n; i++) mbLine(M, P(i, 0), P((i + 1) % n, 0), .6);
}

// 枪口焰（发光的小锥，开火那一瞬间立在枪口）
function v3mFlash() {
  const M = mbNew();
  mbTube(M, [0, 0, 0], [.55, 0, 0], .12, .02, 6, -1.2, true);
  return M;
}

// ———————————————— 舰艇（世界单位，与二维剪影同尺寸） ————————————————
function v3mHullPts(kind, L, B) {
  const g = mbRecCtx();
  if (typeof shHullPath === 'function') shHullPath(g, kind, false);
  let P = (g.subs[0] || []).slice();
  if (P.length < 3) P = [[L / 2, 0], [L / 2 - B, B / 2], [-L / 2, B / 2], [-L / 2, -B / 2], [L / 2 - B, -B / 2]];
  P = P.filter((p, i) => i === 0 || Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) > .05);
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), l0 = Math.max(...xs) - Math.min(...xs), b0 = Math.max(...ys) - Math.min(...ys);
  return P.map(([x, y]) => [x * L / l0, y * B / b0]);   // 二维轮廓按 SHIP_DIM 画：别的长宽（守方舰艇）按比例缩放
}
// 上层建筑一层（舷窗一排发光）
function v3mDeck(M, x0, x1, y0, y1, z0, z1, s, win) {
  mbBox(M, x0, x1, y0, y1, z0, z1, s, { taper: .15 });
  if (win) { const h = z1 - z0, zw = z0 + h * .6; mbBox(M, x1 - .05, x1 + .02, y0 + .3, y1 - .3, zw - h * .12, zw + h * .12, -1); for (const y of [y0 - .02, y1 + .02]) mbLine(M, [x0 + .3, y, zw], [x1 - .3, y, zw], .8); }
}
function v3mMast(M, x, z0, h, s) {   // 格构桅杆：四根立柱 + 横撑 + 顶部雷达
  const w = .35;
  for (const [a, b] of [[-w, -w], [w, -w], [w, w], [-w, w]]) mbTube(M, [x + a, b, z0], [x + a * .3, b * .3, z0 + h], .07, .05, 4, s, false);
  for (let k = 1; k <= 3; k++) { const z = z0 + h * k / 4, r = w * (1 - .7 * k / 4); mbLoop(M, [[x - r, -r], [x + r, -r], [x + r, r], [x - r, r]], z, .9); }
  mbBox(M, x - .1, x + .1, -1.1, 1.1, z0 + h, z0 + h + .35, .95);
}
function v3mGun(M, x, z, r, len, s) {   // 舰炮：隐身多面体炮塔 + 炮管
  mbPrism(M, [[x + r * 1.1, 0], [x + r * .5, r * .8], [x - r * .9, r * .8], [x - r * 1.1, 0], [x - r * .9, -r * .8], [x + r * .5, -r * .8]], z, z + r * .9, s, { taper: r * .18 });
  mbTube(M, [x + r * .7, 0, z + r * .45], [x + r * .7 + len, 0, z + r * .5], r * .16, r * .13, 8, .6);
}
function v3mCells(M, x0, x1, y0, y1, z, nx, ny) {   // 垂发单元：方块阵，盖板缝发光
  mbBox(M, x0, x1, y0, y1, z, z + .25, .7);
  for (let i = 1; i < nx; i++) { const x = lerp(x0, x1, i / nx); mbLine(M, [x, y0, z + .26], [x, y1, z + .26], .6); }
  for (let j = 1; j < ny; j++) { const y = lerp(y0, y1, j / ny); mbLine(M, [x0, y, z + .26], [x1, y, z + .26], .6); }
}
function v3mHi() {
  return typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'high' && !(typeof V3 === 'object' && V3 && V3.coarse) && !(typeof R === 'object' && R && R.lowCap);
}
function v3mQKey(key) { return key + (v3mHi() ? ':hi' : ':std'); }
function v3mRail(M, pts, z, h = .85, step = 7, s = .55) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
    mbLine(M, [a[0], a[1], z + h], [b[0], b[1], z + h], s); mbLine(M, [a[0], a[1], z + h * .52], [b[0], b[1], z + h * .52], s * .72);
    for (let k = 0; k <= n; k++) { const t = k / n, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t); mbLine(M, [x, y, z], [x, y, z + h], s * .75); }
  }
}
function v3mShipSideGear(M, hl, hb, fb, scale = 1) {
  if (!v3mHi()) return;
  // 锚、锚链孔、舷侧救生筏筒：高精模式下丰富舰体侧面
  for (const sg of [-1, 1]) {
    const y = sg * hb * 1.02;
    mbTube(M, [hl * .78, y, fb * .48], [hl * .88, y, fb * .48], .18 * scale, .1 * scale, 6, .42);   // 舰首锚链孔 / 锚
    mbLine(M, [hl * .84, y, fb * .48], [hl * .76, sg * hb * .8, fb * .22], .45);
    for (const x of [-hl * .18, -hl * .34, hl * .04]) mbTube(M, [x - 1.1 * scale, y, fb + .75 * scale], [x + 1.1 * scale, y, fb + .75 * scale], .28 * scale, .28 * scale, 8, .86);
  }
}
function v3mDeckTractor() {
  const M = mbNew();
  mbBox(M, -2.2, 2.2, -1.05, 1.05, .22, 1.05, .72, { taper: .12 }); mbBox(M, .55, 1.8, -.78, .78, 1.05, 1.65, .62, { taper: .1 });
  for (const [x, y] of [[-1.45, -1.02], [1.45, -1.02], [-1.45, 1.02], [1.45, 1.02]]) mbTube(M, [x, y - .16, .35], [x, y + .16, .35], .34, .34, 8, .28);
  mbLine(M, [-2.15, 0, .72], [-3.25, 0, .4], .8); mbBox(M, -2.9, -2.35, -.18, .18, .28, .52, .7);
  return M;
}
function v3mDeckCart() {
  const M = mbNew();
  mbBox(M, -1.75, 1.75, -.82, .82, .3, .82, .68, { taper: .05 });
  for (let i = 0; i < 3; i++) mbTube(M, [-1 + i, 0, .94], [-.65 + i, 0, .94], .18, .18, 8, .86);
  for (const [x, y] of [[-1.35, -.9], [1.35, -.9], [-1.35, .9], [1.35, .9]]) mbTube(M, [x, y - .12, .24], [x, y + .12, .24], .22, .22, 6, .32);
  return M;
}
function v3mCarrierCIWS(M, u, v, z, dir) {
  mbPrism(M, mbCirc(u, v, 1.55, 12), z, z + .9, .82, { taper: .35 }); mbBox(M, u - .75, u + .75, v - .7, v + .7, z + .9, z + 1.65, .9, { taper: .18 });
  for (let i = 0; i < 6; i++) { const o = (i - 2.5) * .08; mbTube(M, [u, v + o, z + 1.35], [u + dir * 3.2, v + o, z + 1.55], .055, .045, 5, .6, false); }
  mbPrism(M, mbCirc(u - dir * .45, v, .42, 8), z + 1.68, z + 2.25, .9, { taper: .2 });
}
function v3mCarrierHQ10(M, u, v, z, dir) {
  mbPrism(M, mbCirc(u, v, 1.35, 10), z, z + .6, .82, { taper: .2 });
  for (let i = 0; i < 6; i++) { const yy = v + (i - 2.5) * .32; mbBox(M, u - dir * .4, u + dir * 2.3, yy - .11, yy + .11, z + .75, z + 1.18, .7, { taper: .04 }); }
}
function v3mShip(kind, L, B) {
  const M = mbNew(), hk = kind === 'ddA' || kind === 'ddB' || kind === 'ffg' ? 'dd' : kind, H = v3mHullPts(hk, L, B);
  const fb = kind === 'assault' ? 1.8 : kind === 'boat' ? .9 : kind === 'supply' ? 2.6 : kind === 'lst' ? 3 : 2.8, hl = L / 2, hb = B / 2;
  mbPrism(M, H, 0, fb, .8, { top: .55, taper: .25 });   // 船体：干舷略内倾
  if (kind === 'assault') {   // 271 型登陆艇：艏门跳板、井型坞舱（两舷挡墙）、尾部驾驶室、桅杆
    for (const s of [-1, 1]) mbBox(M, -hl * .55, hl * .8, s > 0 ? hb * .72 : -hb * .9, s > 0 ? hb * .9 : -hb * .72, fb, fb + 1.4, .85);
    mbBox(M, hl * .8, hl * .97, -hb * .7, hb * .7, fb, fb + 1.7, .9, { taper: .2 });
    for (let x = -hl * .5; x < hl * .78; x += 2.2) mbLine(M, [x, -hb * .7, fb + .02], [x, hb * .7, fb + .02], .45);   // 坞舱甲板防滑条
    v3mDeck(M, -hl * .97, -hl * .58, -hb * .6, hb * .6, fb, fb + 2.2, .9, true);
    v3mDeck(M, -hl * .9, -hl * .66, -hb * .4, hb * .4, fb + 2.2, fb + 3.4, 1, true);
    v3mMast(M, -hl * .78, fb + 3.4, 3.2, .9);
  } else if (kind === 'boat') {
    mbBox(M, -hl * .9, -hl * .3, -hb * .55, hb * .55, fb, fb + 1, .9);
  } else if (kind === 'supply' || kind === 'lst') {   // 072A 坦克登陆舰 / 后勤舰：艏楼与双联炮、长坦克甲板（舱口盖）、艉部三层上层建筑、烟囱、桅杆
    mbBox(M, hl * .62, hl * .92, -hb * .8, hb * .8, fb, fb + 1.2, .85, { taper: .3 });
    v3mGun(M, hl * .55, fb, 1.1, 2.4, .9);
    for (let x = -hl * .2; x < hl * .5; x += 3) mbLoop(M, [[x, -hb * .55], [x + 2.4, -hb * .55], [x + 2.4, hb * .55], [x, hb * .55]], fb + .02, .4);
    if (kind === 'supply') { mbTube(M, [hl * .1, hb * .5, fb], [hl * .1, hb * .5, fb + 5], .18, .14, 6, .8); mbTube(M, [hl * .1, hb * .5, fb + 4.6], [hl * .45, 0, fb + 3.6], .1, .08, 4, .8); }   // 吊杆
    v3mDeck(M, -hl * .98, -hl * .3, -hb * .85, hb * .85, fb, fb + 2.2, .9, true);
    v3mDeck(M, -hl * .9, -hl * .42, -hb * .7, hb * .7, fb + 2.2, fb + 4.2, .95, true);
    v3mDeck(M, -hl * .8, -hl * .52, -hb * .5, hb * .5, fb + 4.2, fb + 5.8, 1, true);
    mbPrism(M, mbCirc(-hl * .88, 0, 1, 8), fb + 2.2, fb + 7, .6, { taper: .15 });
    v3mMast(M, -hl * .66, fb + 5.8, 4, .9);
  } else {
    // 驱逐舰 / 护卫舰：艏部主炮 → 前垂发 → 舰桥（舷窗）→ 桅杆（055 为一体化塔式桅杆，四面相控阵）→ 烟囱 → 后垂发 → 机库与近防炮 → 飞行甲板（着舰圈）
    const big = kind === 'ddA';
    v3mGun(M, hl * .62, fb, 1.4, big ? 4.4 : 3.6, .9);
    const vx = hl * .38, vw = big ? 3.2 : 2.4;
    v3mCells(M, vx - vw, vx + vw * .4, -hb * .55, hb * .55, fb, big ? 8 : 6, 4);
    v3mDeck(M, -hl * .05, hl * .22, -hb * .85, hb * .85, fb, fb + 2.6, .9, false);
    v3mDeck(M, hl * .02, hl * .2, -hb * .7, hb * .7, fb + 2.6, fb + 4.4, .95, true);
    if (big) {
      const z0 = fb + 4.4, z1 = z0 + 7, x0 = hl * .02, x1 = hl * .16;
      mbPrism(M, mbRect(x0 - 1.4, x1, -hb * .6, hb * .6), z0, z1, .9, { taper: 1.1 });
      for (const xf of [x1 - .35, x0 - 1.05]) for (const zz of [z0 + 3, z0 + 5]) mbLine(M, [xf, -hb * .42, zz], [xf, hb * .42, zz], 1);
      for (const xf of [x1 - .35, x0 - 1.05]) for (const yy of [-hb * .42, hb * .42]) mbLine(M, [xf, yy, z0 + 3], [xf, yy, z0 + 5], 1);
      mbTube(M, [x0 + .3, 0, z1], [x0 + .3, 0, z1 + 2.4], .12, .08, 6, .9);
    } else v3mMast(M, hl * .05, fb + 4.4, 5, .9);
    mbPrism(M, mbRect(-hl * .2, -hl * .06, -hb * .4, hb * .4), fb, fb + 4.5, .7, { taper: .5 });
    v3mCells(M, -hl * .36, -hl * .22, -hb * .5, hb * .5, fb, big ? 6 : 4, 4);
    v3mDeck(M, -hl * .6, -hl * .38, -hb * .8, hb * .8, fb, fb + 2.4, .85, false);
    mbPrism(M, mbCirc(-hl * .42, 0, .55, 8), fb + 2.4, fb + 3.2, .9, { taper: .2 });
    mbLoop(M, mbCirc(-hl * .8, 0, hb * .55, 16), fb + .02, 1);
    mbLine(M, [-hl * .6, 0, fb + .02], [-hl * .98, 0, fb + .02], .8);
  }
  if (kind !== 'boat') v3mShipSideGear(M, hl, hb, fb, Math.max(.75, Math.min(1.2, L / 70)));
  // 两舷救生艇：贴着干舷挂在舷侧
  if (kind !== 'boat' && L >= 40) for (const [xf, sg] of [[.14, 1], [-.28, 1], [.14, -1], [-.28, -1]]) {   // 30 来米的登陆艇只带救生筏筒（v3mShipSideGear），不挂救生艇
    const u = hl * xf, vy = sg * hb * 1.06, z = fb + .35;
    mbTube(M, [u - 1.7, vy, z], [u + 1.7, vy, z], .6, .6, 8, .78);                       // 救生艇（首尾沿舰长横躺）
    mbBox(M, u - .85, u + .85, vy - .52, vy + .52, z + .5, z + .62, .9);                  // 顶盖
    mbLine(M, [u, vy, z + .62], [u, sg * hb * .92, z + 1.9], .5);                         // 吊索
  }
  mbLoop(M, H, fb + .03, .9);
  return M;
}
// 我方驱护舰按舰型建模（布局与二维 ships.js SH_DDC 一致，坐标按二维的 50 × 9 舰长缩放）：
//   055（一体化塔式桅杆四面相控阵、前 64 后 48 单元垂发、130 主炮、双机库）· 052D（舰桥四面相控阵、独立封闭桅杆、前后各 32 单元、双烟囱）·
//   052C（圆形转轮式垂发、100 主炮、格构桅杆、舯部鹰击-62 发射箱）· 054A（小一圈、76 炮、32 单元、塔式桅杆、鹰击-83 四联装、两座近防炮）
function v3mDD(cls) {
  const K = (typeof SH_DDC === 'object' && SH_DDC[cls]) || { k: 1, w: 1, gun: 1, vls: [[8.6, 14.4, 2.7]] }, L = 50 * K.k, B = 9 * K.k * K.w, sx = L / 50, sy = B / 9;
  const M = mbNew(), H = v3mHullPts('dd', L, B), fb = 2.8 * sx, X = x => x * sx, Y = y => y * sy;
  mbPrism(M, H, 0, fb, .8, { top: .55, taper: .25 });
  const blk = (x0, x1, hw, z0, z1, sh = .9, win = false) => v3mDeck(M, X(x0), X(x1), -Y(hw), Y(hw), z0, z1, sh, win);
  const panels = (x0, x1, hw, z0, z1) => {   // 四面相控阵：每面一块略凸的深色阵面 + 一圈亮边
    const zc = (z0 + z1) / 2, hz = (z1 - z0) * .32;
    for (const xf of [X(x1) + .02, X(x0) - .02]) { mbBox(M, xf - .06, xf + .06, -Y(hw) * .55, Y(hw) * .55, zc - hz, zc + hz, .5); mbLoop(M, [[xf, -Y(hw) * .55], [xf, Y(hw) * .55]], zc + hz, 1); }
    for (const yf of [-Y(hw) - .02, Y(hw) + .02]) { mbBox(M, X(x0) + (X(x1) - X(x0)) * .2, X(x1) - (X(x1) - X(x0)) * .2, yf - .06, yf + .06, zc - hz, zc + hz, .5); mbLine(M, [X(x0) + (X(x1) - X(x0)) * .2, yf, zc + hz], [X(x1) - (X(x1) - X(x0)) * .2, yf, zc + hz], 1); }
  };
  const cells = ([x0, x1, hw], nx) => v3mCells(M, X(x0), X(x1), -Y(hw), Y(hw), fb, nx, 4);
  const revolver = (x, y, r) => { mbPrism(M, mbCirc(X(x), Y(y), r * sx, 12), fb, fb + .3, .7); mbLoop(M, mbCirc(X(x), Y(y), r * sx * .62, 6), fb + .32, .8); };
  const quad = (x, sd) => { for (let i = 0; i < 4; i++) { const y = sd * Y(1.1 + i * .55); mbTube(M, [X(x) - 1.6 * sx, y, fb + .5], [X(x) + 1.6 * sx, y, fb + 1.1], .22 * sx, .22 * sx, 6, .75); } };   // 反舰导弹发射筒：斜置的四联装
  const hangar = (x0, x1, hw, dx) => { blk(x0, x1, hw, fb, fb + 2.6, .85); mbPrism(M, mbCirc(X(x0 + .9), 0, .55 * sx, 8), fb + 2.6, fb + 3.4, .9, { taper: .2 }); mbLoop(M, mbCirc(X(dx), 0, Y(2.6), 18), fb + .02, 1); mbLine(M, [X(dx) - 1, -.9, fb + .02], [X(dx) - 1, .9, fb + .02], .9); mbLine(M, [X(dx) + 1, -.9, fb + .02], [X(dx) + 1, .9, fb + .02], .9); mbLine(M, [X(dx) - 1, 0, fb + .02], [X(dx) + 1, 0, fb + .02], .9); };
  const [V1, V2] = K.vls;
  v3mGun(M, X(cls === '054A' ? 16.6 : 16.2), fb, 1.4 * K.gun * sx, 4.4 * K.gun * sx, .9);
  if (cls === '055') {
    cells(V1, 8); cells(V2, 6);
    blk(-1.5, 8.2, 3.4, fb, fb + 2.8, .9); blk(-.5, 7.6, 3, fb + 2.8, fb + 4.8, .95, true);
    const z0 = fb + 4.8, z1 = z0 + 8.5;
    mbPrism(M, mbRect(X(1.2), X(6.6), -Y(2.4), Y(2.4)), z0, z1, .9, { taper: 1 });   // 一体化塔式桅杆
    panels(1.6, 6.2, 2, z0 + 1.5, z0 + 7);
    mbPrism(M, mbCirc(X(3.9), 0, .7 * sx, 10), z1, z1 + 1.4, .9, { taper: .3 }); mbTube(M, [X(3.9), 0, z1 + 1.4], [X(3.9), 0, z1 + 3.4], .08, .05, 4, .9, false);
    mbPrism(M, mbCirc(X(-3.2), 0, 1.7 * sx, 12), fb, fb + 5.5, .7, { taper: .4 });   // 烟囱
    hangar(-15.2, -10, 3.6, -19.6);
  } else if (cls === '052D') {
    cells(V1, 4); cells(V2, 4);
    blk(2.6, 8.6, 3, fb, fb + 2.6, .9); blk(3.2, 8.2, 2.7, fb + 2.6, fb + 5.6, .95, true);
    panels(3.2, 8.2, 2.7, fb + 2.6, fb + 5.6);
    mbPrism(M, mbRect(X(-.4), X(2), -Y(1.3), Y(1.3)), fb, fb + 8, .9, { taper: .8 });   // 独立封闭桅杆
    mbBox(M, X(.8) - .1, X(.8) + .1, -1.2, 1.2, fb + 8, fb + 8.4, .95);
    for (const y of [-.75, .75]) mbPrism(M, mbCirc(X(-2.6), Y(y), 1 * sx, 10), fb, fb + 4.6, .7, { taper: .3 });   // 双烟囱
    hangar(-14, -9, 3.3, -19.2);
    mbBox(M, X(-11.6) - .5, X(-11.6) + .5, -.5, .5, fb + 2.6, fb + 3.6, .85);   // 机库顶的 518 型 L 波段雷达：大块竖直矩形阵面
    mbBox(M, X(-11.6) - .1, X(-11.6) + .1, -Y(2.2), Y(2.2), fb + 3.6, fb + 6.2, .95); mbLoop(M, mbRect(X(-11.6) - .12, X(-11.6) + .12, -Y(2.2), Y(2.2)), fb + 6.2, 1);
  } else if (cls === '052C') {
    for (let i = 0; i < 3; i++) for (const y of [-1.15, 1.15]) revolver(lerp(V1[0] + 1, V1[1] - 1, i / 2), y, 1);
    for (const y of [-.9, .9]) revolver(-7, y, .85);
    blk(2.8, 8.4, 2.9, fb, fb + 2.6, .9); blk(3.4, 8, 2.6, fb + 2.6, fb + 5.4, .95, true);
    panels(3.4, 8, 2.6, fb + 2.6, fb + 5.4);
    v3mMast(M, X(1.2), fb, 8.5, .9);   // 格构桅杆
    { const zt = fb + 9.2; mbLine(M, [X(1.2), -Y(2.4), zt], [X(1.2), Y(2.4), zt], 1); for (let i = 0; i < 7; i++) { const y = Y(-2.1 + i * .7); mbLine(M, [X(1.2) - .5, y, zt - .7], [X(1.2) - .5, y, zt + .7], .95); } }   // 517 型米波雷达：桅顶横梁上一排八木天线
    quad(-1.6, -1); quad(-1.6, 1);
    mbPrism(M, mbCirc(X(-4.2), 0, 1.6 * sx, 10), fb, fb + 4.8, .7, { taper: .35 });
    hangar(-13.4, -9.2, 3.2, -19);
  } else {   // 054A
    cells(V1, 4);
    blk(4.6, 10, 2.8, fb, fb + 2.4, .9); blk(5.2, 9.6, 2.4, fb + 2.4, fb + 4.4, .95, true);
    mbPrism(M, [[X(4), 0], [X(1.6), -Y(1.4)], [X(1.6), Y(1.4)]], fb + 2.4, fb + 7.5, .9, { taper: .5 });   // 塔式桅杆
    mbBox(M, X(2.6) - .1, X(2.6) + .1, -1.1, 1.1, fb + 7.5, fb + 7.9, .95);
    mbPrism(M, mbCirc(X(2.6), 0, .3, 8), fb + 7.9, fb + 8.4, .9); mbPrism(M, [[X(2.6) - .5, -Y(1.6)], [X(2.6) + .2, -Y(1.6)], [X(2.6) + .2, Y(1.6)], [X(2.6) - .5, Y(1.6)]], fb + 8.4, fb + 9.6, .95, { taper: .7 });   // 382 型三坐标雷达：桅顶背靠背的旋转阵面
    for (const y of [-1.6, 1.6]) mbPrism(M, mbCirc(X(7.4), Y(y), .45, 10), fb + 4.4, fb + 5.2, .9, { taper: .2 });   // 驾驶室顶两侧的火控雷达罩
    quad(-.6, -1); quad(-.6, 1);
    mbPrism(M, mbCirc(X(-3.4), 0, 1.4 * sx, 10), fb, fb + 4, .7, { taper: .35 });
    hangar(-12.4, -7.2, 3, -18.4);
    for (const y of [-2.2, 2.2]) mbPrism(M, mbCirc(X(-8), Y(y), .5 * sx, 8), fb + 2.6, fb + 3.3, .9, { taper: .2 });   // 两座近防炮
  }
  v3mShipSideGear(M, L / 2, B / 2, fb, Math.max(.75, Math.min(1.25, L / 55)));
  mbLoop(M, H, fb + .03, .9);
  return M;
}
// 驱护舰的实例键与建网格函数：055 有外部精细模型（v3import.js）时用它，没载入好之前用上面自己画的
const v3mDDK = c => c === '055' && typeof v3im === 'function' ? v3im('t055', 'dd:055', () => v3mDD(c)) : ['dd:' + c, () => v3mDD(c)];
// 守方舰艇（NV_CLS 长宽）：阿利·伯克级（SPY-1 相控阵、两座烟囱）、提康德罗加级（两座上层建筑）、星座级、独立级（三体船）
function v3mEShip(cls, L, B) {
  if (cls === 'ffg') return v3mShip('ffg', L, B);
  const M = mbNew(), fb = 2.8, hl = L / 2, hb = B / 2;
  if (cls === 'lcs') {
    mbPrism(M, [[hl, 0], [hl * .3, hb * .5], [-hl * .2, hb], [-hl, hb], [-hl, -hb], [-hl * .2, -hb], [hl * .3, -hb * .5]], 0, fb, .8, { top: .55, taper: .3 });
    v3mGun(M, hl * .55, fb, 1, 2.2, .9);
    v3mDeck(M, -hl * .05, hl * .35, -hb * .5, hb * .5, fb, fb + 3.6, .9, true);
    mbPrism(M, mbRect(-hl * .02, hl * .2, -hb * .3, hb * .3), fb + 3.6, fb + 7, .9, { taper: .6 });
    mbLoop(M, mbCirc(-hl * .6, 0, hb * .55, 16), fb + .02, 1);
    return M;
  }
  const H = v3mHullPts('dd', L, B);
  mbPrism(M, H, 0, fb, .8, { top: .55, taper: .25 });
  v3mGun(M, hl * .62, fb, 1.4, 3.8, .9);
  v3mCells(M, hl * .32, hl * .48, -hb * .5, hb * .5, fb, 8, 4);
  const sup = (x0, x1, h) => {   // 上层建筑 + 斜面四周的八角形相控阵面
    v3mDeck(M, x0, x1, -hb * .82, hb * .82, fb, fb + h, .9, true);
    mbPrism(M, mbRect(x0 + .4, x1 - .4, -hb * .62, hb * .62), fb + h, fb + h + 2.6, .95, { taper: .5 });
    for (const xf of [x1 - .25, x0 + .65]) { const ring = mbCirc(0, 0, 1.1, 8); for (let i = 0; i < 8; i++) { const a = ring[i], b = ring[(i + 1) % 8]; mbLine(M, [xf, a[0], fb + h + 1.3 + a[1]], [xf, b[0], fb + h + 1.3 + b[1]], 1); } }
  };
  sup(hl * .02, hl * .26, 2.6);
  if (cls === 'cg') { sup(-hl * .34, -hl * .14, 2.2); v3mMast(M, hl * .1, fb + 5.2, 5, .9); v3mMast(M, -hl * .24, fb + 4.8, 4, .9); }
  else v3mMast(M, hl * .12, fb + 5.2, 6, .9);
  for (const x of [-hl * .08, -hl * .2]) mbPrism(M, mbRect(x - 1.1, x + 1.1, -hb * .3, hb * .3), fb, fb + 5, .7, { taper: .3 });
  v3mCells(M, -hl * .5, -hl * .34, -hb * .5, hb * .5, fb, 8, 4);
  mbLoop(M, mbCirc(-hl * .8, 0, hb * .55, 16), fb + .02, 1);
  v3mShipSideGear(M, hl, hb, fb, Math.max(.75, Math.min(1.2, L / 70)));
  mbLoop(M, H, fb + .03, .9);
  return M;
}
// 航母（舰体坐标 u 向舰首、v 向右舷；carrier.js CVG，1 单位约 1 米）：照 003 型福建舰——
//   舰体：水线宽约 40，往上明显外飘（到机库甲板高度约宽 54），水线处舰首尖、舰尾方；舰首往上大幅外飘，接住平直方头的飞行甲板（封闭式舰首）；
//   飞行甲板（含两舷外伸的舷台）厚约 5，右舷前后两部升降机处留缺口，
//   缺口下方舰体侧面是机库门；舰首两舷白色舷号「18」
//   舰岛（右舷中后部）：底层甲板室、尾部烟囱（两个排烟口）、四面有源相控阵层、驾驶室（玻璃窗带）、八角形一体化桅杆与顶部天线罩
//   甲板：三条电磁弹射器滑轨、斜角着舰区边线与中线、三道拦阻索、安全线、舰首舰尾舷号；四角近防炮 / 红旗-10 舷台、左舷后部着舰指挥官平台
//   升降机平台、偏流板另外实例化（会动）；075 型两栖攻击舰（lhd）用直通甲板、舰岛偏后、甲板标直升机起降点
const V3_CVB = [[154, 0], [140, 7], [112, 14], [80, 18.5], [40, 20], [-80, 20], [-140, 19], [-155, 16.5], [-155, -16.5], [-140, -19], [-80, -20], [40, -20], [80, -18.5], [112, -14], [140, -7]];   // 水线：飞剪型舰首、方尾
const V3_ZH = 12;   // 舰体外飘到这个高度，再往上是飞行甲板（含舷台）
// 七段式数字（舷号）：P(x, y) 把字格坐标（x 0–1 宽、y 0–1 高）换成 3D 点
// 金属度（写实画面的金属反光）：把网格 M 里从第 i0 个数开始的三角形法线拉长成 1 + k 倍（着色器按长度读回；玻璃、标线不动）
function mbMetal(M, k, i0 = 0) { for (let i = i0; i < M.t.length; i += 10) if (M.t[i + 6] >= 0) { M.t[i + 3] *= 1 + k; M.t[i + 4] *= 1 + k; M.t[i + 5] *= 1 + k; } return M; }
// 涂装色：sRGB '#rrggbb' → 明暗 s 的颜色编码（|s| ≥ 16 时 s − 16 是 7 位 RGB，负数是玻璃；v3import.js 同一约定）——写实画面直接用涂装色，黑绿画面按深浅调暗实体
const mbRGB = h => { const v = parseInt(h.slice(1), 16); return 16 + (v >> 17 & 127) * 16384 + (v >> 9 & 127) * 128 + (v >> 1 & 127); };
const V3_PINC = mbRGB('#c8242c');   // 保险销红飘带（"起飞前拔除"）
// 福建舰涂装（照片）：舰体、舰岛海灰，飞行甲板深灰防滑涂层，白、黄甲板标线，橙色封闭救生艇，相控阵面深灰，窗是深色玻璃
const V3_CVP = { side: mbRGB('#82888e'), hull: mbRGB('#8c9298'), deck: mbRGB('#4b4f52'), under: mbRGB('#62676b'), dark: mbRGB('#2c2f31'), isl: mbRGB('#979da3'), isl2: mbRGB('#8a9096'),
  win: -mbRGB('#1d242a'), door: mbRGB('#5f666c'), spy: mbRGB('#3f454a'), stack: mbRGB('#262829'), dome: mbRGB('#d3d6d8'), white: mbRGB('#e4e6e2'), yellow: mbRGB('#d9b437'),
  steel: mbRGB('#45484b'), boat: mbRGB('#d2682d'), cap: mbRGB('#ece9e0'), rail: mbRGB('#5a5e61'), jbd: mbRGB('#6d7276'), el: mbRGB('#484c4f') };
// 漆在面上的条带（甲板标线、舷号笔画）：a → b，宽 w，贴着法线 n 的面；黑绿画面里照样另画一道发光线
function v3mStripe(M, a, b, w, n, s) {
  const d = mbNorm(mbSub(b, a)), q = mbNorm(mbCross(n, d)), h = w / 2, o = (p, k) => [p[0] + q[0] * h * k, p[1] + q[1] * h * k, p[2] + q[2] * h * k];
  mbTri(M, o(a, -1), o(b, -1), o(b, 1), s, [0, 0, 0], n); mbTri(M, o(a, -1), o(b, 1), o(a, 1), s, [0, 0, 0], n);
}
// 数字笔画：P(x, y) 把字面坐标换到船上；w 给了就再漆一道条带（法线 n）
function v3mDigits(M, str, P, s = 1, w = 0, n = [0, 0, 1]) {
  const SEG = { 1: [[.6, 0, .6, 1], [.6, 1, .32, .8]], 8: [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0], [0, .5, 1, .5]] };
  [...str].forEach((ch, i) => { for (const [a, b, c, d] of SEG[ch] || []) { const A = P(i * 1.45 + a, b), B = P(i * 1.45 + c, d); mbLine(M, A, B, s); if (w) v3mStripe(M, A, B, w, n, s); } });
}
function v3mCarrier(lhd) {
  const M = mbNew(), C = typeof CVG === 'object' ? CVG : null, D = C ? C.deck : [[158, 0], [-158, 30], [-158, -30]], zh = V3_ZH, zd = C ? C.zd : 17;
  // 舰体：水线轮廓 → 外飘的上沿（逐点连成侧面），上面压着飞行甲板
  // 两段折面：水线 → 舷侧折角线（硬舭，稍外飘）→ 上沿大幅外飘接飞行甲板；折角线描一道亮边，舷侧不是圆滑的一整块
  // 上沿：舰首一段外飘到飞行甲板边（往里收 1.5），舰首尖点接到方头甲板的中点
  const half = (u, sg) => { let best = 0; for (let i = 0; i < D.length; i++) { const a = D[i], b = D[(i + 1) % D.length]; if ((a[0] - u) * (b[0] - u) <= 0 && a[0] !== b[0]) { const v = lerp(a[1], b[1], (u - a[0]) / (b[0] - a[0])); if (v * sg > best) best = v * sg; } } return best; };
  const T = V3_CVB.map(([u, v]) => u > 100 ? (v ? [u + 5, Math.sign(v) * Math.max(Math.abs(v) * 1.35, half(u + 5, Math.sign(v)) - 1.5)] : [159, 0]) : [u + (u < -140 ? -2 : 0), v * 1.35]);
  const K = V3_CVB.map(([u, v]) => [u + (u > 100 ? 2.5 : u < -140 ? -1 : 0), v * 1.1]), zk = zh * .55, ctr = [0, 0, zh / 2];
  for (let i = 0; i < V3_CVB.length; i++) {
    const j = (i + 1) % V3_CVB.length;
    mbQuad(M, [V3_CVB[i][0], V3_CVB[i][1], 0], [V3_CVB[j][0], V3_CVB[j][1], 0], [K[j][0], K[j][1], zk], [K[i][0], K[i][1], zk], V3_CVP.side, ctr);
    mbQuad(M, [K[i][0], K[i][1], zk], [K[j][0], K[j][1], zk], [T[j][0], T[j][1], zh], [T[i][0], T[i][1], zh], V3_CVP.hull, ctr);
  }
  mbLoop(M, K, zk + .02, V3_CVP.side);
  const ownDeck = !lhd && typeof v3dkOn === 'function' && v3dkOn();   // 高画质：甲板顶面由 v3deck.js 的着色器画（纹路、光影），这里只画侧面与底面
  if (typeof V3DK === 'object' && !lhd) V3DK.noTop = ownDeck;
  if (ownDeck) {
    const n = D.length, out = [0, 0, (zh + zd) / 2];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; mbQuad(M, [D[i][0], D[i][1], zh], [D[j][0], D[j][1], zh], [D[j][0], D[j][1], zd], [D[i][0], D[i][1], zd], V3_CVP.hull, out); }
    for (const [a, b, c] of mbEar(D)) mbTri(M, [D[a][0], D[a][1], zh], [D[b][0], D[b][1], zh], [D[c][0], D[c][1], zh], V3_CVP.hull, [0, 0, 0], [0, 0, -1]);
  } else mbPrism(M, D, zh, zd, V3_CVP.hull, { top: V3_CVP.deck, bottom: true });   // 飞行甲板与舷台
  mbLine(M, [-156, -14, zh - 1], [-156, 14, zh - 1], V3_CVP.dark);   // 舰尾甲板（飞行甲板下的系泊甲板）
  mbBox(M, -157, -153, -13, 13, zh - 4, zh, V3_CVP.dark);
  if (C) for (const E of C.el) {   // 升降机井：平台降下时甲板边缺口里露出的井底、内侧与前后井壁（暗）
    const a0 = E.u - E.L / 2, a1 = E.u + E.L / 2, b0 = E.v - E.B / 2, b1 = E.v + E.B / 2, zf = zd - C.hang;
    mbBox(M, a0, a1, b0, b1, zf - .3, zf, V3_CVP.dark);
    mbQuad(M, [a0, b0, zf], [a1, b0, zf], [a1, b0, zd], [a0, b0, zd], V3_CVP.dark, [E.u, b1, zf + 3]);
    for (const u of [a0, a1]) mbQuad(M, [u, b0, zf], [u, b1, zf], [u, b1, zd], [u, b0, zd], V3_CVP.dark, [E.u, E.v, zf + 3]);
  }
  // 舷号「18」：两舷靠舰首（从舷外看都是正的）
  for (const sg of [1, -1]) v3mDigits(M, '18', (x, y) => [sg > 0 ? 112 + x * 6 : 124 - x * 6, sg * (16.55 + y * 2.5), 4 + y * 7], V3_CVP.white, .9, [0, sg, 0]);
  // 两舷救生艇：封闭式救生艇挂在飞行甲板外伸部分下面的舷侧（两根吊索、吊艇臂从舷侧上沿伸出），左舷三艘、右舷两艘（避开舰岛与升降机）
  if (!lhd && C) for (const [u, sg] of [[64, -1], [8, -1], [-52, -1], [78, 1], [-44, 1]]) {
    const vy = sg * 25.9, z = 9.6;
    mbBox(M, u - 3, u + 3, vy - .95, vy + .95, z - .9, z + .15, V3_CVP.boat);   // 艇体
    mbBox(M, u - 2.3, u + 2.5, vy - .8, vy + .8, z + .15, z + 1, V3_CVP.boat, { taper: .18 });   // 封闭顶篷
    for (const du of [-2.2, 2.2]) { mbLine(M, [u + du, vy, z + 1], [u + du, vy, zh - .3], V3_CVP.steel); mbBox(M, u + du - .15, u + du + .15, Math.min(vy, sg * 24.6), Math.max(vy, sg * 24.6), zh - .55, zh - .25, V3_CVP.steel); }   // 吊索、吊艇臂
  }
  // 舰岛
  if (lhd) {
    const isl = [-38, -8, 11, 15.5].map(x => x * 2);
    v3mDeck(M, isl[0], isl[1], isl[2], isl[3], zd, zd + 9, .9, true);
    v3mDeck(M, isl[0] + 8, isl[1] - 4, isl[2] + 1.2, isl[3] - 1.2, zd + 9, zd + 17, .95, true);
    mbPrism(M, mbRect(isl[0] + 14, isl[1] - 10, isl[2] + 2.4, isl[3] - 2.4), zd + 17, zd + 27, .9, { taper: 2.4 });
  } else if (C) {
    // 舰岛（照福建舰正俯视与斜拍照片）：外侧与甲板边齐平；底层甲板室，内侧前部一块矮的甲板室（飞行指挥）；外挑的驾驶室层（一圈窗户）；
    //   高塔在中后部（四面大块相控阵），塔后的排烟道顶上三个圆形排烟口；塔顶细桅杆、球形天线罩与天线
    const [u0, u1, v0, v1] = C.isl, vm = (v0 + v1) / 2;
    mbBox(M, u0 + 1, u1, v0, v1, zd, zd + 7, V3_CVP.isl);   // 底层甲板室
    for (let u = u0 + 4; u < (C.isx ? C.isx[0] : u1) - 1.5; u += 5) mbBox(M, u, u + 1.4, v0 - .07, v0 + .02, zd + .3, zd + 2.4, V3_CVP.door);   // 朝甲板一侧的舱门
    if (C.isx) { const [x0, x1, y0, y1] = C.isx; mbBox(M, x0, x1, y0, y1 + .5, zd, zd + 4.5, V3_CVP.isl2, { taper: .2 }); mbBox(M, x0 + 1, x1 - 1, y0 - .06, y0 + .02, zd + 2.6, zd + 3.8, V3_CVP.win); }   // 内侧矮甲板室与朝甲板的窗带
    v3mDeck(M, u0 - .5, u1 + 1.5, v0 - 1.4, v1 + .6, zd + 7, zd + 11.5, V3_CVP.isl, true);   // 驾驶室层（外挑一圈）
    mbBox(M, u0, u1 + 1.2, v0 - 1.46, v0 - 1.36, zd + 8.8, zd + 10.4, V3_CVP.win);   // 朝甲板一侧的窗带
    const tu0 = u0 + 13.5, tu1 = u1 - 16, tv0 = v0 + 4.5, tv1 = v1 - 3.5, tz0 = zd + 11.5, tz1 = zd + 31;   // 高塔：又高又瘦（照片里塔顶的方块阵面在舰岛中后部）
    mbBox(M, tu0, tu1, tv0, tv1, tz0, tz1, V3_CVP.isl, { taper: .9 });
    const pz0 = tz0 + 4.5, pz1 = tz0 + 15;
    for (const [a, b, c, d] of [[tu0 + 2, tu1 - 2, tv0 - .22, tv0 + .05], [tu0 + 2, tu1 - 2, tv1 - .05, tv1 + .22], [tu1 - .05, tu1 + .22, tv0 + 1.4, tv1 - 1.4], [tu0 - .22, tu0 + .05, tv0 + 1.4, tv1 - 1.4]]) mbBox(M, a, b, c, d, pz0, pz1, V3_CVP.spy);   // 四面相控阵
    mbBox(M, u0 + 2, tu0 + .5, v0 + 4.5, v1 - 4.5, zd + 11.5, zd + 21, V3_CVP.isl2, { taper: .3 });   // 排烟道
    for (const v of [vm - 2.5, vm, vm + 2.5]) { mbPrism(M, mbCirc(u0 + 6, v, 1.05, 10), zd + 21, zd + 21.6, V3_CVP.stack); mbLoop(M, mbCirc(u0 + 6, v, 1.05, 10), zd + 21.62, V3_CVP.stack); }   // 三个圆形排烟口
    const mu = (tu0 + tu1) / 2, mz = tz1;
    mbPrism(M, [[mu + 1.9, vm], [mu + .95, vm - 1.7], [mu - .95, vm - 1.7], [mu - 1.9, vm], [mu - .95, vm + 1.7], [mu + .95, vm + 1.7]], mz, mz + 7, V3_CVP.isl, { taper: .7 });   // 顶部细桅杆
    mbDome(M, mu, vm, 1.15, 1.15, mz + 7, 1.5, V3_CVP.dome);   // 球形天线罩
    mbLine(M, [mu, vm, mz + 8.5], [mu, vm, mz + 13], V3_CVP.steel); mbLine(M, [mu, vm - 3.2, mz + 4.6], [mu, vm + 3.2, mz + 4.6], V3_CVP.steel);   // 天线、横桁
    for (const a of [.39, 1.96, 3.53, 5.1]) { const x = mu + Math.cos(a) * 1.6, y = vm + Math.sin(a) * 1.6; mbLine(M, [x, y, mz + 1], [x, y, mz + 4.6], V3_CVP.spy); }   // 桅杆面上的小型阵面
  }
  // 甲板标线
  const z = zd + .03;
  if (v3mHi()) v3mRail(M, D, zd + .06, .72, 12, V3_CVP.rail);   // Ultra：飞行甲板边缘安全网 / 低栏杆（封闭式舰首：锚机、系泊设备在甲板下面，飞行甲板上没有）
  mbLoop(M, D, z, V3_CVP.white);
  if (!lhd && C) {
    const L = C.land, a = Math.atan2(L.v1 - L.v0, L.u1 - L.u0), nx = -Math.sin(a), ny = Math.cos(a), at = t => [lerp(L.u0, L.u1, t), lerp(L.v0, L.v1, t)];
    for (const sg of [-1, 1]) { const A = [L.u0 + nx * L.hw * sg, L.v0 + ny * L.hw * sg, z], B = [L.u1 + nx * L.hw * sg, L.v1 + ny * L.hw * sg, z]; mbLine(M, A, B, V3_CVP.white); v3mStripe(M, A, B, .45, [0, 0, 1], V3_CVP.white); }   // 着舰区边线
    for (let t = .02; t < .98; t += .07) { const [u, v] = at(t), [u2, v2] = at(t + .035); mbLine(M, [u, v, z], [u2, v2, z], V3_CVP.white); v3mStripe(M, [u, v, z], [u2, v2, z], .5, [0, 0, 1], V3_CVP.white); }   // 中线虚线
    for (let t = 0; t < .98; t += .05) { const [u, v] = at(t), [u2, v2] = at(t + .025), o = L.hw + 2.5, A = [u + nx * o, v + ny * o, z], B = [u2 + nx * o, v2 + ny * o, z]; mbLine(M, A, B, V3_CVP.yellow); v3mStripe(M, A, B, .35, [0, 0, 1], V3_CVP.yellow); }   // 右侧安全线
    for (const t of C.wires) { const [u, v] = at(t), o = L.hw + 1.5; for (const sg of [-1, 1]) mbBox(M, u + nx * o * sg - .9, u + nx * o * sg + .9, v + ny * o * sg - .5, v + ny * o * sg + .5, zd, zd + .25, V3_CVP.steel); }   // 拦阻索两头的滑轮座（钢索本身在 v3det.js v3dWires：着舰时被尾钩拉成 V 字）
    for (const c of C.cats) { const ca = Math.cos(c.a), sa = Math.sin(c.a), A = [c.u, c.v, z], B = [c.u + ca * c.L, c.v + sa * c.L, z]; mbLine(M, A, B, V3_CVP.dark); v3mStripe(M, A, B, .6, [0, 0, 1], V3_CVP.dark); for (const o of [-2.2, 2.2]) { const A2 = [c.u - sa * o, c.v + ca * o, z], B2 = [c.u + ca * c.L - sa * o, c.v + sa * c.L + ca * o, z]; mbLine(M, A2, B2, V3_CVP.white); v3mStripe(M, A2, B2, .25, [0, 0, 1], V3_CVP.white); } }   // 弹射器滑轨（槽深色，两边白线）
    for (let u = 62; u < 150; u += 9) { mbLine(M, [u, 0, z], [u + 4.5, 0, z], V3_CVP.white); v3mStripe(M, [u, 0, z], [u + 4.5, 0, z], .45, [0, 0, 1], V3_CVP.white); }   // 舰首中线
    v3mDigits(M, '18', (x, y) => [120 + y * 12, -6.5 + x * 4.6, z], V3_CVP.white, 1.1);   // 甲板舷号（字头朝舰首，从舰尾方向看是正的）
    v3mDigits(M, '18', (x, y) => [-152 + y * 10, 8 + x * 3.8, z], V3_CVP.white, .9);
    for (const [u, v] of C.spots || []) { const ci = mbCirc(u, v, 3.2, 16); mbLoop(M, ci, z, V3_CVP.yellow); ci.forEach((q, i) => v3mStripe(M, [q[0], q[1], z], [ci[(i + 1) % 16][0], ci[(i + 1) % 16][1], z], .3, [0, 0, 1], V3_CVP.yellow)); for (const [A, B] of [[[u - 3.2, v, z], [u + 3.2, v, z]], [[u, v - 3.2, z], [u, v + 3.2, z]], [[u + 3.2, v, z], [u + 9, v, z]]]) { mbLine(M, A, B, V3_CVP.yellow); v3mStripe(M, A, B, .3, [0, 0, 1], V3_CVP.yellow); } }   // 圆圈十字标记（尾巴指向舰首）
    // 近防炮 / 红旗-10 舷台
    if (v3mHi()) for (const [u, v, k] of C.wpn) {
      const dir = u > 0 ? 1 : -1;
      mbPrism(M, mbCirc(u, v, 2.6, 12), zd - 1, zd + 1.15, V3_CVP.hull, { taper: .5 }); v3mRail(M, mbCirc(u, v, 2.45, 12), zd + 1.15, .55, 3, V3_CVP.rail);
      if (k === 'ciws') v3mCarrierCIWS(M, u, v, zd + 1.1, dir); else v3mCarrierHQ10(M, u, v, zd + 1.1, dir);
    } else for (const [u, v] of C.wpn) { mbPrism(M, mbCirc(u, v, 2.4, 10), zd - 1, zd + 1.5, V3_CVP.hull, { taper: .5 }); mbTube(M, [u, v, zd + 1.1], [u + (u > 0 ? 3 : -3), v, zd + 1.5], .18, .15, 6, V3_CVP.steel); }
    // 舷边设备（福建舰的舷边不是一条光滑的直线）：放平的鞭状天线、救生艇舷台、着舰指挥官平台、小舷台（救生筏筒）
    for (const [u, v, k] of C.gear || []) {
      const sg = Math.sign(v) || 1, o = v + sg * .1, out = (d0, d1) => [Math.min(v + sg * d0, v + sg * d1), Math.max(v + sg * d0, v + sg * d1)];
      if (k === 'ant') { const [a, b] = out(0, 1.2); mbBox(M, u - .5, u + .5, a, b, zd - 1.2, zd - .3, V3_CVP.hull); mbTube(M, [u, o + sg * .8, zd - .6], [u - 3.5, v + sg * 11, zd - 1.5], .16, .07, 5, V3_CVP.cap); }   // 起降作业时放倒、伸向舷外
      else if (k === 'boat') { const [a, b] = out(0, 6.2), c = v + sg * 3.4; mbBox(M, u - 4.6, u + 4.6, a, b, zd - 1.7, zd - 1.3, V3_CVP.hull); mbBox(M, u - 3.6, u + 3.6, c - 1.1, c + 1.1, zd - 1.3, zd - .4, V3_CVP.boat, { taper: .25 }); mbBox(M, u - 2.6, u + 2.8, c - .9, c + .9, zd - .4, zd + .4, V3_CVP.boat, { taper: .3 }); }
      else if (k === 'lso') { const [a, b] = out(0, 4.5); mbBox(M, u - 4, u + 4, a, b, zd - 1.2, zd - .2, V3_CVP.hull); mbBox(M, u - 4, u - 3.7, a, b, zd - .2, zd + 1, V3_CVP.steel); mbBox(M, u - 4, u + 4, sg > 0 ? b - .3 : a, sg > 0 ? b : a + .3, zd - .2, zd + .8, V3_CVP.steel); }
      else if (k === 'spn') { const [a, b] = out(0, 3.6); mbBox(M, u - 3, u + 3, a, b, zd - 1.5, zd - .5, V3_CVP.hull); for (let i = 0; i < 3; i++) mbTube(M, [u - 1.7 + i * 1.7, v + sg * 2, zd - .5], [u - 1.7 + i * 1.7, v + sg * 2, zd + .45], .55, .55, 8, V3_CVP.cap); }
    }
    // 两舷走道：飞行甲板边外侧、比甲板低一点的一条窄平台，外缘一道栏杆
    for (const [a0, b0, a1, b1, sg] of C.walk || []) {
      const Lw = Math.hypot(a1 - a0, b1 - b0), nu = -(b1 - b0) / Lw * sg, nv = (a1 - a0) / Lw * sg, w = 1.8, zw = zd - 1.15;
      const P = [[a0, b0], [a1, b1], [a1 + nu * w, b1 + nv * w], [a0 + nu * w, b0 + nv * w]];
      mbPrism(M, P, zw - .25, zw, V3_CVP.hull);
      const n = Math.max(1, Math.round(Lw / 3));
      mbLine(M, [P[3][0], P[3][1], zw + 1], [P[2][0], P[2][1], zw + 1], V3_CVP.rail); mbLine(M, [P[3][0], P[3][1], zw + .5], [P[2][0], P[2][1], zw + .5], V3_CVP.rail);
      for (let k = 0; k <= n; k++) { const t = k / n, x = lerp(P[3][0], P[2][0], t), y = lerp(P[3][1], P[2][1], t); mbLine(M, [x, y, zw], [x, y, zw + 1], V3_CVP.rail); }
    }
  } else for (let k = 0; k < 6; k++) mbLoop(M, mbCirc(100 - k * 44, -8, 6, 10), z, .8);
  return mbMetal(M, .22);   // 漆面的船体钢板：淡淡的光泽
}
// 升降机平台（中心为原点，顶面 z = 0）：黄色边框、防滑分块线
function v3mCvEl(L, B) {
  const M = mbNew(), hl = L / 2, hb = B / 2, R = mbRect(-hl + .3, hl - .3, -hb + .3, hb - .3);
  mbBox(M, -hl, hl, -hb, hb, -1.2, 0, V3_CVP.hull, { top: V3_CVP.el });
  mbLoop(M, R, .04, V3_CVP.yellow); R.forEach((q, i) => v3mStripe(M, [q[0], q[1], .04], [R[(i + 1) % 4][0], R[(i + 1) % 4][1], .04], .3, [0, 0, 1], V3_CVP.yellow));   // 黄色边框
  for (const x of [-hl / 3, hl / 3]) mbLine(M, [x, -hb + .3, .04], [x, hb - .3, .04], V3_CVP.deck);
  return M;
}
// 偏流板（铰链在局部 x 轴上，板子往 +y 伸 5；实例按滚转角翻起）
function v3mCvJbd() {
  const M = mbNew();
  mbBox(M, -8, 8, 0, 5, 0, .5, V3_CVP.jbd, { top: V3_CVP.jbd });
  for (let x = -6; x <= 6; x += 3) mbLine(M, [x, .2, .52], [x, 4.8, .52], V3_CVP.steel);
  mbMetal(M, .65);   // 偏流板：耐热钢板，金属光泽
  return M;
}
// 攻击核潜艇：雪茄形艇体、指挥台围壳与围壳舵、X 形尾舵
function v3mSub() {
  const M = mbNew(), n = 12, rad = t => 3.2 * Math.sqrt(Math.max(.04, 1 - Math.pow(t / 17, 2) * (t > 0 ? .95 : .85)));
  for (let i = 0; i < n; i++) { const x0 = -17 + i * 34 / n, x1 = x0 + 34 / n; mbTube(M, [x0, 0, 0], [x1, 0, 0], rad(x0), rad(x1), 10, .85, false); }
  mbPrism(M, [[5.5, 0], [4.6, .7], [1.6, .75], [.8, 0], [1.6, -.75], [4.6, -.7]], 1.5, 5.6, .95, { taper: .15 });
  mbBox(M, 2.6, 3.8, -2.6, 2.6, 4.2, 4.4, .8);
  for (const a of [.785, 2.356, 3.927, 5.498]) mbTube(M, [-15.5, 0, 0], [-17, Math.cos(a) * 3.4, Math.sin(a) * 3.4], .3, .1, 4, .8);
  return M;
}

// —— 飞机的几个尺寸常数（机型单位，与二维 airmdl.js 的 AIRD 同一单位）：甲板作业、喷口、弹舱位置还在用 ——
const V3_AIRZ = .25;
const V3_GEAR = 1.9;   // 放下起落架时机身中心离地的高度（机型单位）：停在甲板 / 地面上的飞机按它抬高
const V3_NUP = { a10: .95, ah64: .25, h6k: 0, z10: .7, heli: .7, uh60: .85, j15: -.05, kj600: -.6 };   // 「up」短舱的中心高度（相对机身中心）
function v3AirSec(D) {   // 截面：上半 kt、下半 kb（乘半宽），facet 棱线六边形
  const facet = !!(D.glass === 'gold' || D.flat || D.heli);
  return D.flat ? { kt: .38, kb: .26, facet } : D.heli ? { kt: .95, kb: .8, facet, sh: 'heli' } : facet ? { kt: .55, kb: .4, facet } : D.hi || D.tt ? { kt: .9, kb: .85, facet } : { kt: .72, kb: .6, facet };
}
function mbTriN(M, a, b, c, na, nb, nc, s, e = [0, 0, 0]) {   // 每个顶点各自的法线（平滑明暗）
  const k = [e[0] ? 0 : 1, e[1] ? 0 : 1, e[2] ? 0 : 1];
  mbV(M, a, na, s, [1 + k[0], k[1], k[2]]); mbV(M, b, nb, s, [k[0], 1 + k[1], k[2]]); mbV(M, c, nc, s, [k[0], k[1], 1 + k[2]]);
}
// 垂发单元舱盖：铰链在 y = 0 一边，按滚转角翻起
function v3mVlsLid() { const M = mbNew(); mbBox(M, -.55, .55, 0, 1.1, 0, .12, .8); mbLoop(M, [[-.55, 0], [.55, 0], [.55, 1.1], [-.55, 1.1]], .13, 1); return M; }

// ———————————————— 守方阵地（世界单位） ————————————————
// 降落伞：伞衣是一块块平面拼成的穹顶（10 瓣 × 3 圈，伞顶留透气孔），伞绳从伞衣边汇到吊点；
//   下面挂伞兵（躯干、背包、两腿）、弹药箱，或重装空投平台（车辆，三具主伞）
function v3mChute(kind) {
  const M = mbNew(), canopy = (cx, cy, z, R) => {
    const n = 10, lat = [[.18, 1], [.62, .8], [.92, .42], [1, 0]], ring = (f, h) => Array.from({ length: n }, (_, i) => { const a = i / n * 6.2832; return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f, z + h * R * .55]; });
    for (let k = 0; k < lat.length - 1; k++) {
      const A = ring(...lat[k]), B = ring(...lat[k + 1]);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; mbQuad(M, A[i], A[j], B[j], B[i], k === 1 ? .8 : 1, [cx, cy, z - R]); }
    }
    return ring(1, 0);
  };
  if (kind === 'veh') {
    const hook = [0, 0, -9];
    for (const [ox, oy] of [[-3.2, -2], [3.2, -2], [0, 3.2]]) { const rim = canopy(ox, oy, 0, 4.2); for (let i = 0; i < rim.length; i += 2) mbLine(M, rim[i], hook, .7); }
    mbBox(M, -2.6, 2.6, -1.4, 1.4, -11.2, -10.2, .55);   // 空投平台
    mbBox(M, -2.2, 2.2, -1.2, 1.2, -10.2, -8.9, .85, { taper: .15 });   // 车辆（裹着的外形）
    mbLine(M, [-2.2, -1.2, -8.9], hook, .6); mbLine(M, [2.2, 1.2, -8.9], hook, .6);
    return M;
  }
  const rim = canopy(0, 0, 0, 3.2), hook = [0, 0, -5.4];
  for (const p of rim) mbLine(M, p, hook, .7);
  if (kind === 'crate') { mbBox(M, -.6, .6, -.6, .6, -6.7, -5.5, .8); mbLine(M, [-.6, 0, -5.5], [.6, 0, -5.5], 1); return M; }
  return M;   // 人：伞衣下另挂立体士兵（v3g.js v3gMan，与地面上的士兵同一个模型）
}
function v3mFort(kind) {
  const M = mbNew();
  if (kind === 'bunker') {   // 混凝土碉堡：倒角厚墙、正面射孔（发光）、顶上伪装网线
    mbPrism(M, [[8, -5], [8, 5], [5, 8], [-6, 8], [-8, 6], [-8, -6], [-6, -8], [5, -8]], 0, 5.2, .7, { taper: 1.3 });
    mbBox(M, 6.9, 7.6, -3, 3, 2, 3, -.4);
    for (let k = -2; k <= 2; k++) mbLine(M, [-5, k * 2.2, 5.25], [5, k * 2.2 + 1, 5.25], .5);
  } else if (kind === 'berm') mbPrism(M, mbCirc(0, 0, 11, 14), 0, 1.4, .45, { taper: 1.6 });   // 榴弹炮发射阵地的土堤（与炮分开：转移时留在原地，ai.js e.pos）
  else if (kind === 'pit') mbPrism(M, mbCirc(0, 0, 3.4, 10), 0, .5, .5, { taper: 1 });   // 迫击炮掩体
  else if (kind === 'tow') {   // 转移途中：6×6 牵引车拖着 M777——大架并拢挂在车尾，身管朝后锁定，炮组坐在车厢里
    mbXf(M, v3mTruck('cargo'), [10.5, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    for (const s of [-1, 1]) mbTube(M, [0, s * .45, 1.1], [4.5, s * .15, .9], .3, .26, 6, .8);
    for (const s of [-1, 1]) mbTube(M, [0, s * 1.5, .75], [0, s * 2.1, .75], .75, .75, 10, .35);
    mbBox(M, -1.6, 1.8, -1.2, 1.2, .9, 2.4, .9, { taper: .2 });
    mbTube(M, [-1.2, 0, 2.1], [-12, 0, 2.3], .32, .26, 8, .65);
    mbTube(M, [-11.6, 0, 2.3], [-13, 0, 2.3], .5, .5, 8, .5);
  } else if (kind === 'arty' || kind === 'coastal') {   // 牵引榴弹炮（M777）：开脚大架、摇架、长身管、炮口制退器（土堤见 berm）；岸防炮在混凝土炮台里
    const k = kind === 'coastal' ? 1.5 : 1, z = kind === 'coastal' ? 3.4 : 0;
    if (kind === 'coastal') mbPrism(M, mbCirc(0, 0, 13, 16), 0, 3.4, .55, { taper: 1.2 });
    for (const s of [-1, 1]) mbTube(M, [0, s * .5 * k, z + 1.2], [-8 * k, s * 3.2 * k, z + .3], .35 * k, .3 * k, 6, .8);
    mbBox(M, -1.6 * k, 1.8 * k, -1.2 * k, 1.2 * k, z + .9, z + 2.4 * k, .9, { taper: .2 });
    mbTube(M, [1.2 * k, 0, z + 2 * k], [13 * k, 0, z + 3.2 * k], .32 * k, .26 * k, 8, .65);
    mbTube(M, [12 * k, 0, z + 3.1 * k], [13.4 * k, 0, z + 3.2 * k], .5 * k, .5 * k, 8, .5);
    if (kind === 'coastal') mbBox(M, -3, 3.5, -3.2, 3.2, z, z + 3.6, .85, { taper: .6 });
  } else if (kind === 'mortar') {
    mbPrism(M, mbCirc(0, 0, 1.2, 10), .5, .7, .6);   // 座钣（掩体见 pit）
    mbTube(M, [0, 0, .6], [4.2, 0, 5.6], .28, .25, 8, .75);
    for (const s of [-1, 1]) mbTube(M, [2.6, 0, 3.4], [3.6, s * 1.6, 0], .1, .1, 4, .7);
  } else if (kind === 'aa') {   // M167 火神：底座、转塔、六管加特林、瞄准座
    mbPrism(M, mbCirc(0, 0, 4.4, 12), 0, 1.4, .6, { taper: .6 });
    mbBox(M, -2, 2.2, -1.6, 1.6, 1.4, 3.6, .9, { taper: .3 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832; mbTube(M, [1.8, Math.cos(a) * .3, 3 + Math.sin(a) * .3], [7.4, Math.cos(a) * .3, 4.2 + Math.sin(a) * .3], .08, .08, 4, .6, false); }
    mbPrism(M, mbCirc(-1.2, 1.9, .9, 8), 2.4, 3.6, .8);
  } else if (kind === 'typhon') v3mTyphon(M);
  else if (kind === 'ascm') v3mAscm(M);
  else {   // 导弹发射车（海马斯）：车轮、底盘、驾驶室（舷窗）、发射箱
    for (const x of [-6, -2.5, 3.5]) for (const s of [-1, 1]) mbTube(M, [x, s * 2.6, 1.2], [x, s * 3.4, 1.2], 1.2, 1.2, 10, .4);
    mbBox(M, -9, 7, -2.6, 2.6, 1, 2.4, .8);
    v3mDeck(M, 4, 8, -2.7, 2.7, 1.2, 5.2, .9, true);
    const n = kind === 'typhon' ? 4 : kind === 'ascm' ? 2 : 1;
    for (let i = 0; i < n; i++) { const y = (i - (n - 1) / 2) * 1.6; mbSide(M, [[-9, 2.6], [2.5, 2.6], [2.5, 4.4], [-9, 4.4]], y - .7, y + .7, .85); mbLine(M, [2.55, y - .5, 3.5], [2.55, y + .5, 3.5], 1); }
  }
  return M;
}

// ———————————————— 地面上的构筑物与杂项（原来只在地面贴图上画成平面图，3D 里立起来） ————————————————
const V3_PT = ['exit', 'hq', 'radar', 'battery', 'town', 'village', 'ford', 'bridge'];   // 有立体模型的据点建筑（render4.js 在 3D 时不再画它们的平面图）
// 据点建筑（render4.js drawStructure 的同一套布局，单位与世界坐标一致）：海滩出口的半圆地堡与龙牙锥、指挥所、雷达站、炮兵排阵地、
//   城镇哨所、村舍、渡口踏石、公路桥（炸断只剩桥墩）
// 据点里的房屋（据点局部坐标 x, y、占地 w × h、墙高 z、坡顶高 roof）：外部精细模型载入后由 v3props.js 换成真实楼房，这里就不再挤出（noHouse）
const V3_PTHOUSE = { hq: [[-12, -6, 18, 12, 3.6, 0], [12, -8, 12, 9, 3.2, 0], [10, 8, 16, 8, 2.8, 0]], radar: [[-8, 8, 10, 7, 3.4, 0]], battery: [[0, -14, 14, 7, 2.2, 0]],
  town: [[16, -4, 8, 14, 6, 0], [16, -14, 5, 6, 3, 0]], village: [[-10, -4, 8, 6, 2.6, 1.6], [6, -8, 7, 6, 2.6, 1.6], [2, 6, 9, 6, 2.6, 1.6]] };
function v3mPoint(kind, blown, noHouse) {
  const M = mbNew();
  if (noHouse && (kind === 'exit' || kind === 'bridge')) return M;   // 地堡、龙牙、公路桥都换成了外部模型（v3props.js）
  const house = (x, y, w, h, z, roof) => { if (noHouse) return; mbBox(M, x - w / 2, x + w / 2, y - h / 2, y + h / 2, 0, z, .8); if (roof) mbBox(M, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z, z + roof, .95, { taper: Math.min(w, h) * .45 }); };
  if (kind === 'exit') {
    for (const sx of [-17, 17]) {   // 半圆混凝土地堡：圆顶朝海、平的一面朝内陆，朝海一侧一道射孔
      const P = Array.from({ length: 9 }, (_, i) => { const a = i / 8 * Math.PI; return [sx + Math.cos(a) * 6, Math.sin(a) * 6]; });
      mbPrism(M, P, 0, 3.4, .75, { taper: 1.6 });
      mbBox(M, sx - 3, sx + 3, 5.2, 5.6, 1.6, 2.2, -.5);
    }
    for (let i = -3; i <= 3; i++) if (i) mbBox(M, i * 8 - 1.6, i * 8 + 1.6, 9.8, 13.2, 0, 2.8, .7, { taper: 1.55 });   // 龙牙（混凝土锥）
  } else if (kind === 'hq') {   // 指挥所：三栋平房、天线杆、四周低矮围墙
    house(-12, -6, 18, 12, 3.6, 0); house(12, -8, 12, 9, 3.2, 0); house(10, 8, 16, 8, 2.8, 0);
    mbTube(M, [-20, -1, 0], [-20, -1, 14], .25, .15, 6, .9); mbLine(M, [-23, -1, 12], [-17, -1, 12], 1); mbLine(M, [-20, -1, 14], [-20, -1, 16], -1);
    for (const [a, b] of [[[-28, -20], [28, -20]], [[28, -20], [28, 20]], [[28, 20], [-28, 20]], [[-28, 20], [-28, -20]]]) mbLine(M, [a[0], a[1], 1.2], [b[0], b[1], 1.2], .7);
  } else if (kind === 'radar') {   // 雷达站：机房 + 铁塔（天线另外按方位转）
    house(-8, 8, 10, 7, 3.4, 0);
    for (const [dx, dy] of [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]]) mbTube(M, [4 + dx, -4 + dy, 0], [4 + dx * .3, -4 + dy * .3, 9], .15, .12, 4, .85);
    mbBox(M, 2.6, 5.4, -5.4, -2.6, 9, 9.6, .9);
  } else if (kind === 'battery') {   // 炮兵排：三个半圆土堤炮位，炮管朝南（海面），后面弹药掩体
    for (const [dx, dy] of [[-20, 0], [0, 5], [20, 0]]) {
      const P = Array.from({ length: 9 }, (_, i) => { const a = Math.PI + i / 8 * Math.PI; return [dx + Math.cos(a) * 7.5, dy + Math.sin(a) * 7.5]; });
      mbPrism(M, P, 0, 1.6, .55, { taper: 1.2 });
      mbBox(M, dx - 1.6, dx + 1.6, dy - 1, dy + 2.4, 0, 1.8, .8);
      mbTube(M, [dx, dy + 1.5, 1.6], [dx, dy + 13, 2.6], .3, .24, 6, .65);
    }
    house(0, -14, 14, 7, 2.2, 0);
  } else if (kind === 'town') {   // 城镇据点：哨所塔楼 + 一栋小屋
    house(16, -4, 8, 14, 6, 0); house(16, -14, 5, 6, 3, 0);
    mbTube(M, [16, -22, 0], [16, -22, 9], .2, .15, 6, .9);
  } else if (kind === 'village') {
    house(-10, -4, 8, 6, 2.6, 1.6); house(6, -8, 7, 6, 2.6, 1.6); house(2, 6, 9, 6, 2.6, 1.6);
  } else if (kind === 'ford') {
    for (let i = -2; i <= 2; i++) mbBox(M, i * 6 - 1.75, i * 6 + 1.75, (i % 2) * 2 - 1.75, (i % 2) * 2 + 1.75, -.3, .5, .7);
  } else if (kind === 'bridge') {   // 公路桥：桥面 + 护栏 + 两个桥墩；炸断的只剩桥墩
    for (const bx of [-9, 9]) mbBox(M, bx - 1.5, bx + 1.5, -7, 7, -3, 2.2, .7);
    if (!blown) {
      mbBox(M, -24, 24, -5, 5, 2.2, 3, .85);
      for (const y of [-5, 5]) { mbBox(M, -24, 24, y - .25, y + .25, 3, 4, .9); for (let x = -24; x <= 24; x += 6) mbLine(M, [x, y, 3], [x, y, 4], .8); }
    }
  }
  return M;
}
// 海滩障碍：捷克刺猬（三根工字钢交叉、三个脚着地）
function v3mHedgehog() {
  const M = mbNew(), c = [0, 0, 1.3];
  for (const d of [[1, 0, .75], [-.5, .87, .75], [-.5, -.87, .75]]) { const l = Math.hypot(...d) / 2.4, u = d.map(v => v / l); mbTube(M, [c[0] - u[0], c[1] - u[1], c[2] - u[2]], [c[0] + u[0], c[1] + u[1], c[2] + u[2]], .2, .2, 4, .6); }
  return M;
}
// 铁丝网：一段 6 米——两根木桩 + 三道铁丝（发光细线）；剪断的只剩木桩
function v3mWire(cut) {
  const M = mbNew();
  for (const x of [-3, 3]) mbTube(M, [x, 0, 0], [x, 0, 1.4], .1, .08, 4, .7);
  if (!cut) for (const z of [.4, .85, 1.3]) { mbLine(M, [-3, 0, z], [0, .25, z + .1], .55); mbLine(M, [0, .25, z + .1], [3, 0, z], .55); }
  return M;
}
// 军用卡车（补给车 / 抢修车 / 机场抢修车）：三轴、驾驶室、帆布篷货厢（抢修车是吊臂）
function v3mTruck(kind) {
  const M = mbNew();
  for (const u of [-3.8, -1.2, 3.4]) for (const s of [-1, 1]) mbTube(M, [u, s * 2.1, .9], [u, s * 2.9, .9], .9, .9, 8, .35);
  mbBox(M, -6, 6, -2, 2, .9, 1.6, .55);   // 车架
  mbBox(M, 3, 6, -1.9, 1.9, 1.6, 4.2, .85, { taper: .25 });   // 驾驶室
  mbBox(M, 5.95, 6.05, -1.5, 1.5, 2.8, 3.8, -.5);   // 风挡（发光）
  if (kind === 'fix') { mbBox(M, -6, 2.6, -2.2, 2.2, 1.6, 2.6, .7); mbTube(M, [-2, 0, 2.6], [-5.5, 0, 6], .25, .2, 6, .85); mbLine(M, [-5.5, 0, 6], [-5.5, 0, 3.4], 1); }   // 抢修车：吊臂
  else mbBox(M, -6, 2.6, -2.2, 2.2, 1.6, 4.4, .75, { taper: .35 });   // 篷布货厢
  return M;
}
// 抢修艇（海上的抢修组）
function v3mWorkBoat() {
  const M = mbNew();
  mbPrism(M, [[5, 0], [3, 2], [-4, 2], [-4.6, 0], [-4, -2], [3, -2]], -.6, 1, .7);
  mbBox(M, -2.5, 1, -1.4, 1.4, 1, 3, .85, { taper: .2 });
  return M;
}
// 空投补给点：一堆弹药箱 + 伞衣摊在一旁
function v3mCrates() {
  const M = mbNew();
  for (const [x, y, z] of [[-1.3, -1, 0], [1.3, -1, 0], [0, 1.2, 0], [0, 0, 1.4]]) mbBox(M, x - 1.2, x + 1.2, y - .9, y + .9, z, z + 1.4, .8);
  mbPrism(M, mbCirc(4.5, 2, 2.2, 10), 0, .15, .6);
  return M;
}
// 补给站（supplynet.js 前沿补给点 / 滩头补给站）：碎石垫层、沙袋矮墙、托盘物资箱堆（捆扎带）、油桶、伪装网棚（四根立杆、网面经纬线）、天线杆；
//   big = 滩头补给站：更大，多两只集装箱（波纹板）和一台叉车。n = 0–3 箱堆的多少（前沿点按存量、在建的按进度）；dead = 被毁：散落的焦黑箱子
function v3mDepot(big, n, dead) {
  const M = mbNew(), R0 = big ? 13 : 8;
  mbPrism(M, mbCirc(0, 0, R0 + 1.5, 16), 0, .12, .5);   // 碎石垫层
  if (dead) {
    for (let i = 0; i < 9; i++) { const a = i * 2.39, r = 1.5 + (i * 3.1) % R0, x = Math.cos(a) * r, y = Math.sin(a) * r, h = .5 + (i % 3) * .3; mbBox(M, x - .6, x + .6, y - .5, y + .5, 0, h, .35, { taper: .1 }); }
    for (let i = 0; i < 4; i++) { const a = i * 1.7; mbTube(M, [Math.cos(a) * 3, Math.sin(a) * 3, .3], [Math.cos(a) * 3 + .9, Math.sin(a) * 3 + .3, .3], .3, .3, 8, .3); }   // 倒地的油桶
    return M;
  }
  // 沙袋矮墙：一圈短墙，留出口
  for (let i = 0; i < 14; i++) { if (i === 3 || i === 4) continue; const a0 = i / 14 * 6.283, a1 = (i + .85) / 14 * 6.283; const P = [[Math.cos(a0) * R0, Math.sin(a0) * R0], [Math.cos(a1) * R0, Math.sin(a1) * R0], [Math.cos(a1) * (R0 - .7), Math.sin(a1) * (R0 - .7)], [Math.cos(a0) * (R0 - .7), Math.sin(a0) * (R0 - .7)]]; mbPrism(M, P, 0, .8, .62, { taper: .15 }); }
  // 托盘物资箱：每堆一个托盘 + 两三层箱子，箱面一道捆扎带
  const stack = (x, y, h) => {
    mbBox(M, x - .65, x + .65, y - .55, y + .55, 0, .15, .55);
    for (let k = 0; k < h; k++) { const z = .15 + k * .62; mbBox(M, x - .58, x + .58, y - .48, y + .48, z, z + .58, .78 + (k % 2) * .06); mbLoop(M, [[x - .59, y - .1], [x + .59, y - .1], [x + .59, y + .1], [x - .59, y + .1]], z + .29, .9); }
  };
  const cnt = big ? [8, 12, 16, 20][n] : [3, 6, 9, 12][n];
  for (let i = 0; i < cnt; i++) { const c = i % (big ? 5 : 4), r = Math.floor(i / (big ? 5 : 4)); stack(-R0 * .55 + c * 1.6, -R0 * .35 + r * 1.4, 1 + ((i * 7) % 3)); }
  // 油桶：一簇立着的 200 升桶
  for (let i = 0; i < (big ? 10 : 5); i++) { const x = R0 * .35 + (i % 3) * .75, y = R0 * .2 + Math.floor(i / 3) * .75; mbTube(M, [x, y, 0], [x, y, .9], .3, .3, 8, .7); mbLoop(M, mbCirc(x, y, .31, 8), .45, .85); }
  // 伪装网棚：四根立杆、斜坡网面、经纬线
  const cx = -R0 * .2, cy = -R0 * .05, hw = big ? 5 : 3.4, hd = big ? 4 : 2.8, hz = 3.2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mbTube(M, [cx + sx * hw, cy + sy * hd, 0], [cx + sx * hw, cy + sy * hd, hz - .4], .07, .07, 4, .7, false);
  mbQuad(M, [cx - hw, cy - hd, hz - .4], [cx + hw, cy - hd, hz - .4], [cx + hw, cy, hz], [cx - hw, cy, hz], .55);
  mbQuad(M, [cx - hw, cy, hz], [cx + hw, cy, hz], [cx + hw, cy + hd, hz - .4], [cx - hw, cy + hd, hz - .4], .5);
  for (let k = -2; k <= 2; k++) { const x = cx + k * hw / 2.5; mbLine(M, [x, cy - hd, hz - .38], [x, cy, hz + .02], .8); mbLine(M, [x, cy, hz + .02], [x, cy + hd, hz - .38], .8); }
  // 天线杆
  mbTube(M, [R0 * .6, -R0 * .55, 0], [R0 * .6, -R0 * .55, 7.5], .06, .04, 4, .8, false); mbLine(M, [R0 * .6, -R0 * .55, 7.5], [R0 * .6 + .9, -R0 * .55, 7], .9);
  if (big) {   // 集装箱（ISO 20 呎，波纹板）+ 叉车
    for (const [x, y] of [[R0 * .25, -R0 * .6], [R0 * .25, -R0 * .6 + 2.7]]) { mbBox(M, x - 3, x + 3, y - 1.2, y + 1.2, 0, 2.6, .72); for (let u = -2.6; u <= 2.6; u += .45) mbLine(M, [x + u, y - 1.21, .15], [x + u, y - 1.21, 2.45], .62); }
    const fx = -R0 * .55, fy = R0 * .5;
    mbBox(M, fx - 1, fx + 1, fy - .6, fy + .6, .3, 1.3, .75); mbBox(M, fx - .7, fx + .3, fy - .55, fy + .55, 1.3, 2.3, .65, { taper: .1 });   // 车身、护顶
    mbTube(M, [fx + 1.1, fy - .35, .1], [fx + 1.1, fy - .35, 2.6], .06, .06, 4, .8); mbTube(M, [fx + 1.1, fy + .35, .1], [fx + 1.1, fy + .35, 2.6], .06, .06, 4, .8);   // 门架
    for (const [u, v] of [[-.7, -.65], [.7, -.65], [-.7, .65], [.7, .65]]) v3mWheel(M, fx + u, fy + v, .3, .25);
  }
  return M;
}
// 机场对空监视雷达站：铁塔 + 天线（天线另外转）
function v3mRadarMast() {
  const M = mbNew();
  for (const [dx, dy] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) mbTube(M, [dx, dy, 0], [dx * .3, dy * .3, 8], .14, .1, 4, .85);
  mbBox(M, -1.2, 1.2, -1.2, 1.2, 8, 8.6, .9);
  mbBox(M, -3.4, -1.4, -2, 2, 0, 2.6, .8);
  return M;
}

// 车轮：沿车宽方向的短圆管（u 车头方向坐标，v 车轮外侧，r 半径）
function v3mWheel(M, u, v, r, w = .9) { const s = Math.sign(v) || 1; mbTube(M, [u, v - s * w, r], [u, v, r], r, r, 10, .4); }
// 「堤丰」车阵（antiship.js TY_RIG，与二维同一套尺寸）：4 套 HEMTT 牵引车 + M870 拖车（发射箱单独实例，按起竖角转），连指挥车、发电车
function v3mTyphon(M) {
  const R0 = TY_RIG;
  for (let k = 0; k < R0.n; k++) {
    const v0 = (k - (R0.n - 1) / 2) * R0.gap;
    for (const u of [13.4, 11, 4.6, 2.3]) for (const s of [-1, 1]) v3mWheel(M, u, v0 + s * 2.75, 1.1);
    for (const u of [-10.6, -12.8, -15]) for (const s of [-1, 1]) v3mWheel(M, u, v0 + s * 3.2, 1);
    mbBox(M, -.5, 9.8, v0 - 1.9, v0 + 1.9, 1.1, 2.3, .8);   // 牵引车车架
    v3mDeck(M, 9.6, 15, v0 - 2.35, v0 + 2.35, 1.2, 5, .9, true);   // 全宽驾驶室（风挡发光）
    mbBox(M, 5.8, 8.6, v0 - 1.9, v0 - .7, 2.3, 3.4, .7);   // 绞盘箱
    mbTube(M, [9.15, v0 + 1.7, 2.3], [9.15, v0 + 1.7, 5.6], .28, .24, 6, .6);   // 排气管
    mbBox(M, -17, -.5, v0 - 2.4, v0 + 2.4, 1.6, 2.4, .75);   // 拖车甲板
    for (let u = -15; u < -1; u += 2.1) mbLine(M, [u, v0 - 2.4, 2.42], [u, v0 + 2.4, 2.42], .6);
    mbBox(M, -.5, 4.4, v0 - 1.8, v0 + 1.8, 2.3, 3.3, .8, { taper: .2 });   // 鹅颈
    for (const u of [-16.2, -1.8]) for (const s of [-1, 1]) { mbBox(M, u - .25, u + .25, v0 + s * 2.4 - (s < 0 ? 1.7 : 0), v0 + s * 2.4 + (s > 0 ? 1.7 : 0), 1.7, 2.1, .6); mbBox(M, u - .65, u + .65, v0 + s * 4.35 - .55, v0 + s * 4.35 + .55, 0, 1.9, .55); }   // 液压支腿
  }
  mbBox(M, -33, -24.6, -9.2, -4.6, 1, 6.4, .8, { taper: .15 });   // 连指挥车方舱
  v3mDeck(M, -24.2, -21, -9, -4.8, 1, 4.6, .9, true);
  mbLine(M, [-31.6, -8.3, 6.4], [-31.6, -8.3, 13], .9); mbLine(M, [-31.6, -5.5, 6.4], [-31.6, -5.5, 11], .9);   // 鞭状天线
  mbPrism(M, mbCirc(-27.6, -6.9, 1.25, 10), 6.4, 6.9, .7, { taper: .4 });   // 卫星天线
  mbBox(M, -31, -25.5, 4.8, 8.4, .8, 3.6, .75);   // 发电车
  for (let u = -30; u < -26; u += 1.1) mbLine(M, [u, 4.75, 1.6], [u, 4.75, 3.2], .7);
  for (const u of [-23, -29.5]) for (const s of [-1, 1]) v3mWheel(M, u, -6.9 + s * 2.6, .9, .7);
  for (const s of [-1, 1]) v3mWheel(M, -28.2, 6.6 + s * 2, .8, .6);
}
// 堤丰车阵拆成单车（每辆按脚下坡度各自俯仰、侧倾，拖车与牵引车在第五轮处各自贴地）：局部原点放在各车中心
//   牵引车中心在车阵坐标 u = 7、拖车 u = -8.5（鹅颈压在牵引车第五轮上）、连指挥车 (-27, -6.9)、发电车 (-28.2, 6.6)
const TY3 = { tr: 7, tl: -8.5, boc: [-27, -6.9], gen: [-28.2, 6.6] };
function v3mTyTractor() {
  const M = mbNew(), o = -TY3.tr;
  for (const u of [13.4, 11, 4.6, 2.3]) for (const s of [-1, 1]) v3mWheel(M, u + o, s * 2.75, 1.1);
  mbBox(M, -.5 + o, 9.8 + o, -1.9, 1.9, 1.1, 2.3, .8);   // 车架
  v3mDeck(M, 9.6 + o, 15 + o, -2.35, 2.35, 1.2, 5, .9, true);   // 全宽驾驶室（风挡发光）
  mbBox(M, 5.8 + o, 8.6 + o, -1.9, -.7, 2.3, 3.4, .7);   // 绞盘箱
  mbTube(M, [9.15 + o, 1.7, 2.3], [9.15 + o, 1.7, 5.6], .28, .24, 6, .6);   // 排气管
  return M;
}
function v3mTyTrailer() {
  const M = mbNew(), o = -TY3.tl;
  for (const u of [-10.6, -12.8, -15]) for (const s of [-1, 1]) v3mWheel(M, u + o, s * 3.2, 1);
  mbBox(M, -17 + o, -.5 + o, -2.4, 2.4, 1.6, 2.4, .75);   // 甲板
  for (let u = -15; u < -1; u += 2.1) mbLine(M, [u + o, -2.4, 2.42], [u + o, 2.4, 2.42], .6);
  mbBox(M, -.5 + o, 4.4 + o, -1.8, 1.8, 2.3, 3.3, .8, { taper: .2 });   // 鹅颈
  for (const u of [-16.2, -1.8]) for (const s of [-1, 1]) { mbBox(M, u - .25 + o, u + .25 + o, s * 2.4 - (s < 0 ? 1.7 : 0), s * 2.4 + (s > 0 ? 1.7 : 0), 1.7, 2.1, .6); mbBox(M, u - .65 + o, u + .65 + o, s * 4.35 - .55, s * 4.35 + .55, 0, 1.9, .55); }   // 液压支腿
  return M;
}
function v3mTyBoc() {
  const M = mbNew(), [ou, ov] = TY3.boc.map(x => -x);
  mbBox(M, -33 + ou, -24.6 + ou, -9.2 + ov, -4.6 + ov, 1, 6.4, .8, { taper: .15 });   // 方舱
  v3mDeck(M, -24.2 + ou, -21 + ou, -9 + ov, -4.8 + ov, 1, 4.6, .9, true);
  mbLine(M, [-31.6 + ou, -8.3 + ov, 6.4], [-31.6 + ou, -8.3 + ov, 13], .9); mbLine(M, [-31.6 + ou, -5.5 + ov, 6.4], [-31.6 + ou, -5.5 + ov, 11], .9);   // 鞭状天线
  mbPrism(M, mbCirc(-27.6 + ou, -6.9 + ov, 1.25, 10), 6.4, 6.9, .7, { taper: .4 });   // 卫星天线
  for (const u of [-23, -29.5]) for (const s of [-1, 1]) v3mWheel(M, u + ou, s * 2.6, .9, .7);
  return M;
}
function v3mTyGen() {
  const M = mbNew(), [ou, ov] = TY3.gen.map(x => -x);
  mbBox(M, -31 + ou, -25.5 + ou, 4.8 + ov, 8.4 + ov, .8, 3.6, .75);
  for (let u = -30; u < -26; u += 1.1) mbLine(M, [u + ou, 4.75 + ov, 1.6], [u + ou, 4.75 + ov, 3.2], .7);
  for (const s of [-1, 1]) v3mWheel(M, -28.2 + ou, s * 2, .8, .6);
  return M;
}
// 堤丰的 Mk 41 四联装发射箱：沿 -y 卧放（y = 0 是拖车尾部的铰点），按滚转角绕铰点竖起；箱顶 2×2 单元格舱盖缝发光
function v3mTyBox() {
  const M = mbNew(), R0 = TY_RIG, L = R0.L, T = R0.T;
  mbBox(M, -T / 2, T / 2, -L, 0, 0, T, .8);
  for (let j = 1; j < 6; j++) { const y = -L * j / 6; mbLoop(M, [[-T / 2 - .02, y], [T / 2 + .02, y], [T / 2 + .02, y], [-T / 2 - .02, y]], T + .02, .6); mbLine(M, [-T / 2 - .02, y, 0], [-T / 2 - .02, y, T], .6); mbLine(M, [T / 2 + .02, y, 0], [T / 2 + .02, y, T], .6); }
  const y = -L - .03;
  mbLine(M, [0, y, .2], [0, y, T - .2], 1.1); mbLine(M, [-T / 2 + .2, y, T / 2], [T / 2 - .2, y, T / 2], 1.1);
  mbLoop(M, [[-T / 2 + .15, y], [T / 2 - .15, y]], 0, 1);
  for (const z of [.15, T - .15]) mbLine(M, [-T / 2 + .15, y, z], [T / 2 - .15, y, z], 1.1);
  for (const x of [-T / 2 + .15, T / 2 - .15]) mbLine(M, [x, y, .15], [x, y, T - .15], 1.1);
  return M;
}
// NMESIS 车阵（missile.js ASC_RIG）：2 辆 ROGUE-Fires 无人发射车（没有驾驶室，车头传感器吊舱、摄像头杆），后方 JLTV 遥控指挥车；发射箱单独实例
function v3mAscm(M) {
  const R0 = ASC_RIG;
  for (let k = 0; k < R0.n; k++) {
    const v0 = (k - (R0.n - 1) / 2) * R0.gap;
    for (const u of [4.3, -3.6]) for (const s of [-1, 1]) v3mWheel(M, u, v0 + s * 2.85, 1.2);
    mbPrism(M, [[-6.2, v0 - 2.5], [5.4, v0 - 2.5], [6.2, v0 - 1.7], [6.2, v0 + 1.7], [5.4, v0 + 2.5], [-6.2, v0 + 2.5]], 1.3, 2.6, .8);
    mbBox(M, 2.6, 5.8, v0 - 2.1, v0 + 2.1, 2.6, 3.3, .85, { taper: .3 });   // 发动机盖
    mbBox(M, .5, 2.2, v0 - 1.2, v0 + 1.2, 2.6, 3.8, .7);   // 传感器吊舱
    mbTube(M, [2, v0 + 1.75, 2.6], [2, v0 + 1.75, 5.2], .14, .12, 5, .7); mbBox(M, 1.75, 2.25, v0 + 1.5, v0 + 2, 5.2, 5.6, -.8);   // 摄像头杆
    mbPrism(M, mbCirc(-3.4, v0, 1.9, 12), 2.6, 3.1, .7);   // 转台
  }
  for (const u of [-10.8, -16.6]) for (const s of [-1, 1]) v3mWheel(M, u, s * 2.7, 1.1);
  mbPrism(M, [[-19, -2.4], [-9.4, -2.4], [-8.6, -1.6], [-8.6, 1.6], [-9.4, 2.4], [-19, 2.4]], 1.2, 2.6, .8);
  v3mDeck(M, -15.6, -11.6, -2.3, 2.3, 2.6, 4.8, .9, true);
  mbPrism(M, mbCirc(-13.8, 0, 1, 10), 4.8, 5.6, .75, { taper: .4 });   // 卫通天线罩
}
// NMESIS 的 2 联装 NSM 发射箱：沿 -y 卧放（y = 0 是尾部转轴），按滚转角仰起；箱口端盖发光
function v3mAscCan() {
  const M = mbNew(), L = ASC_RIG.L;
  for (const [x0, x1] of [[-1.48, -.08], [.08, 1.48]]) {
    mbBox(M, x0, x1, -L, 0, 0, 1.3, .8);
    for (const f of [.3, .62]) mbLoop(M, [[x0 - .02, -L * f], [x1 + .02, -L * f]], 1.32, .6);
    mbLine(M, [x0 + .1, -L - .03, .65], [x1 - .1, -L - .03, .65], 1.1); mbLine(M, [(x0 + x1) / 2, -L - .03, .1], [(x0 + x1) / 2, -L - .03, 1.2], 1.1);
  }
  return M;
}

// ———————————————— 着色器与绘制 ————————————————
// 实例参数 iA = (x, y, z, 朝向)，iB = (比例, 阵营 0 我 / 1 敌 / 2 残骸, 滚转, 俯仰)，坐标是 GL 的（y 向北）；先滚转、再俯仰（车头抬起为正）、再转朝向
const V3M_VS = `attribute vec3 p; attribute vec3 n; attribute float s; attribute vec3 b; attribute vec4 iA; attribute vec4 iB;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vN, vB, vV, vC; varying float vS, vSide, vD, vMet;
${typeof V3_SHV === 'string' ? V3_SHV : ''}
void main() {
  vMet = clamp(length(n) - 1., 0., 1.);   // 金属度：法线长度 − 1（mbMetal）
  // 外部模型（v3import.js）：|s| ≥ 16 时 s − 16 是 7 位 RGB 涂装色，负数是玻璃；自己画的模型 vC 记 −1
  float a = abs(s);
  if (a >= 16.) { float q = a - 16., r = floor((q + .5) / 16384.), g = floor((q - r * 16384. + .5) / 128.); vC = vec3(r, g, q - r * 16384. - g * 128.) / 127.; vS = s < 0. ? -1. : 1.; }
  else { vC = vec3(-1.); vS = s; }
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z), cp = cos(iB.w), sp = sin(iB.w);
  vec3 q = p * iB.x; q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr); q = vec3(q.x * cp - q.z * sp, q.y, q.x * sp + q.z * cp);
  vec3 m = vec3(n.x, n.y * cr - n.z * sr, n.y * sr + n.z * cr); m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vB = b; vSide = iB.y; vV = uEye - w; vD = length(vV);
  ${typeof V3_SHV === 'string' ? 'vSh = uShM * vec4(w, 1.);' : ''}
  gl_Position = uM * vec4(w, 1.);
}`;
const V3M_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform vec2 uFog; uniform vec3 uBg; uniform float uMode, uHl, uGP; uniform vec3 uHlC;
uniform vec3 uBody0, uBody1, uBody2, uBody3, uBody4, uGlow0, uGlow1, uGlow2;
varying vec3 vN, vB, vV, vC; varying float vS, vSide, vD, vMet;
${typeof V3_SHF === 'string' ? V3_SHF : 'float shadowAt() { return 1.; }'}
void main() {
  // 透明座舱玻璃（明暗 −8 ~ −9，V3_TGL）：实体那一遍（uGP 0）不画，透明那一遍（uGP 1，混合、不写深度）只画它——透过玻璃看得见座舱里的仪表台、座椅和飞行员
  float tg = step(7.5, -vS) * step(-vS, 15.5);
  if (uGP < .5 ? tg > .5 : tg < .5) discard;
  float hl = step(7.5, vSide), sd = vSide - hl * 8.;   // 阵营号 + 8：选中编队的成员（selfx.js），全身发光
  vec3 body = sd < .5 ? uBody0 : sd < 1.5 ? uBody1 : sd < 2.5 ? uBody2 : sd < 3.5 ? uBody3 : uBody4;   // 3、4：我方 / 敌方飞机
  vec3 glow = sd < .5 || (sd > 2.5 && sd < 3.5) ? uGlow0 : sd < 1.5 || sd > 3.5 ? uGlow1 : uGlow2;
  vec3 N = normalize(vN), V = normalize(vV);
  float lit = clamp(dot(N, ${typeof V3_SUNG === 'string' ? V3_SUNG : 'normalize(vec3(-.45, .55, .7))'}), 0., 1.), up = clamp(N.z, 0., 1.);
  float e = min(min(vB.x, vB.y), vB.z);
#ifdef DER
  float w = max(fwidth(e), 1e-4), ed = 1. - smoothstep(w * .6, w * 1.9, e);
#else
  float ed = 1. - smoothstep(.015, .06, e);
#endif
  float sh = abs(vS), rim = pow(1. - clamp(dot(N, V), 0., 1.), 3.);
  // 材质（|s| ≥ 2，整数部分）：2 皮肤、3 黑色件（枪、靴、手套、护膝、耳罩）、4 装具（插板携行具、弹匣包、背包）、5 头盔盔罩；小数部分是亮度
  if (sh >= 2.) {
    float mt = floor(sh), br = .5 + fract(sh);
    if (uMode < .5) body *= mt < 2.5 ? 1.35 : mt < 3.5 ? .42 : mt < 4.5 ? .8 : 1.05;
    else body = mt < 2.5 ? vec3(.6, .45, .35) : mt < 3.5 ? vec3(.075, .078, .074) : mt < 4.5 ? mix(body, vec3(.46, .41, .3), .5) : mix(body, vec3(.36, .37, .3), .35);
    sh = br; ed *= mt < 2.5 ? .25 : .7;   // 皮肤、装具的棱线淡一点（不像线框）
  }
  if (vC.x >= 0.) {   // 外部模型：黑绿画面按涂装深浅调暗实体，写实画面直接用涂装色（残骸压暗）；棱线密，淡一点
    if (uMode < .5) body *= .45 + 1.25 * dot(vC, vec3(.3, .59, .11));
    else body = sd > 1.5 && sd < 2.5 ? mix(vC, body, .75) : vC;
    ed *= uMode < .5 ? .8 : .3;   // 写实画面：暗棱线只留一点（明暗本身已经分出棱，再描黑线就满身折痕）
  }
  vec3 c;
  if (uMode < .5) {   // 黑绿：深色实体 + 发光棱线 + 边缘光；玻璃、车灯、观察镜发光
    c = body * (.45 + .95 * lit + .25 * up) * sh + glow * ed * .95 + glow * rim * .22;
    if (vS < 0.) c += glow * .75 * sh;
  } else {   // 写实：涂装色受日光、天光（半球：朝天的冷、朝下的暖，竖直面各一半，与 v3props.js 楼房一致）+ 暗棱线，边缘描一道阵营色细光；金属件再加高光与倒影
    float sd2 = shadowAt();
    c = body * (mix(vec3(.3, .29, .27), vec3(.45, .5, .58), N.z * .5 + .5) + vec3(1., .95, .86) * lit * .82 * sd2) * sh * (1. - ed * .4) * (1. - vMet * .3) + glow * rim * .18;
    if (vMet > .01) {   // 金属：太阳高光 + 天空 / 海面的倒影（菲涅耳：掠射角更亮）；越像金属，高光越尖、越带本身的颜色
      vec3 Ls = ${typeof V3_SUNG === 'string' ? V3_SUNG : 'normalize(vec3(-.45, .55, .7))'}, Hh = normalize(Ls + V), Rr = reflect(-V, N);
      float F = .04 + .96 * pow(1. - clamp(dot(N, V), 0., 1.), 5.);
      vec3 env = Rr.z > 0. ? mix(vec3(.74, .75, .8), vec3(.5, .6, .76), Rr.z) : mix(vec3(.3, .34, .38), vec3(.1, .14, .18), clamp(-Rr.z * 3., 0., 1.));
      vec3 tint = mix(vec3(1.), clamp(body * 1.7, 0., 1.), vMet * .6);
      c += tint * (pow(max(dot(N, Hh), 0.), mix(18., 110., vMet)) * mix(.06, 1.2, vMet) * sd2 + env * (mix(.02, .28, vMet) + F * mix(.08, .5, vMet))) * (1. - ed * .3);
    }
    if (vS < 0.) c = mix(c, vec3(.55, .7, .78), .6);
  }
  if (hl > .5) c += uHlC * uHl * (.28 + .9 * rim + .55 * ed);   // 选中的：整个人 / 整辆车亮起来，轮廓与棱线更亮
  float al = 1.;
  if (tg > .5) {   // 透明玻璃：淡淡的烟灰色，按菲涅耳反射天空 / 海面，掠射角几乎全反射；太阳高光
    vec3 Ls = ${typeof V3_SUNG === 'string' ? V3_SUNG : 'normalize(vec3(-.45, .55, .7))'}, Rr = reflect(-V, N);
    float F = .06 + .94 * pow(1. - abs(dot(N, V)), 4.), sp = pow(max(dot(N, normalize(Ls + V)), 0.), 160.) * (uMode < .5 ? 0. : shadowAt());
    vec3 env = Rr.z > 0. ? mix(vec3(.66, .7, .76), vec3(.42, .53, .7), Rr.z) : vec3(.13, .16, .19);
    c = uMode < .5 ? glow * (.25 + .6 * F) : env * F + vec3(.05, .06, .065) + sp * vec3(1., .96, .88);
    al = clamp(.18 + .78 * F + sp, 0., 1.);
  }
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), al);
}`;
function v3mInit(gl) {
  V3M.tried = true;
  try {
    V3M.der = !!gl.getExtension('OES_standard_derivatives');
    V3M.ext = gl.getExtension('ANGLE_instanced_arrays');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3M_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3M_FS(V3M.der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3M.pr = pr; V3M.gl = gl;
    for (const k of ['p', 'n', 's', 'b', 'iA', 'iB']) V3M.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uFog', 'uBg', 'uMode', 'uHl', 'uGP', 'uHlC', 'uBody0', 'uBody1', 'uBody2', 'uBody3', 'uBody4', 'uGlow0', 'uGlow1', 'uGlow2', 'uShM', 'uShT', 'uShOn', 'uShP']) V3M.u[k] = gl.getUniformLocation(pr, k);
    V3M.ib = gl.createBuffer();
    V3M.ok = true;
  } catch (e) { V3M.ok = false; console.warn('3D 兵种模型不可用', e); }
}
// 网格上传（每种模型只建一次）
function v3mGet(key, build) {
  const ck = v3mQKey(key);
  let m = V3M.mesh.get(ck);
  if (m) return m;
  const gl = V3M.gl;
  let MB;
  try { MB = build(); } catch (e) { console.warn('3D 模型 ' + key, e); MB = mbNew(); }
  m = { tn: MB.t.length / 10, ln: MB.l.length / 10, tb: null, lb: null, gl: false };
  for (let i = 6; i < MB.t.length; i += 10) if (MB.t[i] <= -7.5 && MB.t[i] >= -15.5) { m.gl = true; break; }   // 有透明玻璃：第二遍再画
  if (m.tn) { m.tb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.tb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MB.t), gl.STATIC_DRAW); }
  if (m.ln) { m.lb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.lb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MB.l), gl.STATIC_DRAW); }
  V3M.mesh.set(ck, m);
  return m;
}
// 停在甲板 / 地面上（或在地面滑行）的飞机：精细模型放下起落架（轮子着地），外翼折起程度、座舱盖开度按四档取模型；外挂、旋翼、螺旋桨另外实例化
const V3_PIL = .95;   // 飞行员、甲板人员的比例（按飞机的真实比例，比战场上的士兵小）
const V3_ROT = .14;   // 起飞抬头的仰角（约 8°）
function v3GroundPlane(key, sz, x, y, ground, hd, fold, cpo, still, side, t, sf, pt = 0) {   // 用户给的飞机模型（js/v3g.js）放下起落架；side 3 / 4：我方 / 敌方飞机
  if (typeof v3gPlane === 'function') v3gPlane(key, sz, x, y, ground, true, hd, side === 4 || side === 1 ? 1 : 0, 0, pt, true, still ? 0 : t, 0, sf);   // sf：挂上弹射杆后的舵面检查（v3det.js v3dDeckSurf）
}
// 登陆舰艇的外部精细模型（v3utex.js V3U_SHIP）：舰名前缀 → [模型, 画多长（世界单位）]——LC 726 型气垫艇、LA 271 型登陆艇、LV 人员登陆艇；
//   其余舰型（072A、074A、073A、072、扫雷舰、火力支援艇）没有合规的免费模型，照旧画自带模型
const V3_SHIPX = { LC: ['lcac', 30], LA: ['lcu', 32], LV: ['lcvp', 14] };
// 登机梯（机型单位，按飞机比例缩放）：梯脚在原点，斜靠向机身（局部 +x）
function v3mLadder() {
  const M = mbNew();
  for (const y of [-.32, .32]) mbTube(M, [0, y, 0], [1.3, y, 3.7], .05, .05, 4, .9, false);
  for (let i = 1; i <= 6; i++) { const q = i / 7; mbLine(M, [1.3 * q, -.32, 3.7 * q], [1.3 * q, .32, 3.7 * q], .9); }
  return M;
}
// 一个实例：x、y 世界坐标，z 高度，a 世界朝向（屏幕坐标角），k 比例，side 0 我 / 1 敌 / 2 残骸，roll 滚转，pitch 俯仰（车头抬起为正）
function v3mAdd(key, build, x, y, z, a, k, side, roll = 0, pitch = 0) {
  let L = V3M.inst.get(key);
  if (!L) { L = { build, d: [] }; V3M.inst.set(key, L); }
  L.d.push(x, -y, z, -a, k, side, roll, pitch);
}
// 贴地姿态：地面在 (x, y) 处的坡度（dz/dx、dz/dy，中心差分，跨度 d）；id 给了就按帧平滑（车辆翻过坡顶时车身平顺地俯仰，不一帧一跳）
function v3Grad(x, y, d, id) {
  const gx = (v3Ht(x + d, y) - v3Ht(x - d, y)) / (2 * d), gy = (v3Ht(x, y + d) - v3Ht(x, y - d)) / (2 * d);
  if (id == null) return [gx, gy];
  const o = V3M.tl.get(id);
  if (!o) { V3M.tl.set(id, [gx, gy]); return [gx, gy]; }
  o[0] += (gx - o[0]) * .25; o[1] += (gy - o[1]) * .25;
  return o;
}
// 朝向 th 的车体在坡度 g 上的 [俯仰, 滚转]：沿车头方向的坡度抬车头，沿车身左侧（模型 +y，朝向减 90°）的坡度抬左侧
const v3Pose = (g, th) => { const c = Math.cos(th), s = Math.sin(th); return [Math.atan(g[0] * c + g[1] * s), Math.atan(g[0] * s - g[1] * c)]; };
const v3mHex = h => { const s = String(h).replace('#', ''), v = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
function v3mPalette(gl, U = V3M.u) {   // U：着色器的 uniform 表（v3utex.js 的贴图模型也用同一套配色）
  const real = typeof realLook === 'function' && realLook() && !(typeof greenLook === 'function' && greenLook());
  gl.uniform1f(U.uMode, real ? 1 : 0);
  gl.uniform1f(U.uHl, typeof sfxHl === 'function' ? sfxHl() : 0); gl.uniform3f(U.uHlC, 1, .76, .29);   // 选中编队成员的发光（selfx.js），琥珀色
  if (real) {
    gl.uniform3f(U.uBody0, .36, .4, .31); gl.uniform3f(U.uBody1, .5, .45, .34); gl.uniform3f(U.uBody2, .13, .12, .1);
    gl.uniform3f(U.uBody3, .52, .56, .59); gl.uniform3f(U.uBody4, .42, .45, .48);   // 飞机：我方浅灰、敌方深灰（低可视度涂装）
    const g = v3mHex(COL.g), e = v3mHex(COL.enemy);
    gl.uniform3f(U.uGlow0, g[0], g[1], g[2]); gl.uniform3f(U.uGlow1, e[0], e[1], e[2]); gl.uniform3f(U.uGlow2, .2, .16, .1);
  } else {
    gl.uniform3f(U.uBody0, .02, .1, .055); gl.uniform3f(U.uBody1, .13, .025, .035); gl.uniform3f(U.uBody2, .035, .032, .025);
    gl.uniform3f(U.uBody3, .02, .1, .055); gl.uniform3f(U.uBody4, .13, .025, .035);
    gl.uniform3f(U.uGlow0, .32, 1, .58); gl.uniform3f(U.uGlow1, 1, .3, .38); gl.uniform3f(U.uGlow2, .26, .2, .1);
  }
}

// 每帧：收集贴图覆盖范围内看得见的单位，按模型分批实例化画完
// 被击落飞机的残骸（carrier.js S.air.wrecks、eair.js wr）：沿原航向往前冲，从被击中的高度加速栽下来，T 秒落地；u 下落进度
function v3WreckAt(w, age, T) {
  const x = w.x + Math.cos(w.h) * w.spd * age, y = w.y + Math.sin(w.h) * w.spd * age, u = clamp(age / T, 0, 1);
  const gz = Math.max(v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)), -2.6), z0 = v3AltZ(w.x, w.y, Math.max(0, clamp(w.alt ?? 1, 0, 1) - .05) * V3_AIR, -2.6, 1.5);
  return { x, y, z: Math.max(gz + .5, z0 + (gz - z0) * u * u), u };
}
// 收集这一帧要画的实例（每帧一次；阴影图与正常画面各画一遍，见 v3mDraw）
function v3mCollect(C, box) {
  V3M.fr = (V3M.fr || 0) + 1;
  if (!S || !V3.gl) return;
  const gl = V3.gl;
  if (!V3M.tried) v3mInit(gl);
  if (!V3M.ok) return;
  for (const L of V3M.inst.values()) L.d.length = 0;
  if (typeof v3uClear === 'function') v3uClear(C);   // 带贴图的精细模型（v3utex.js：舰艇）
  if (typeof v3gBegin === 'function') v3gBegin(C);   // 用户给的模型（js/v3g.js：坦克装甲车、飞机、直升机、导弹、士兵）
  const [bx, by, bw, bh] = box, inB = (x, y, m = 40) => x > bx - m && x < bx + bw + m && y > by - m && y < by + bh + m;
  const spec = specAll() || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e')), t = performance.now() / 1000;
  const seen = (x, y) => inVision(x, y), hl = o => typeof sfxHas === 'function' && sfxHas(o);
  // 车辆：用户给的坦克模型（js/v3g.js）——车体贴地（按脚下坡度俯仰、侧倾），炮塔随瞄准转
  for (const v of S.veh || []) {
    if (v.lst || !inB(v.x, v.y) || (v.dead && S.t - (v.deadT ?? 0) > 120)) continue;
    if (v.side === 'e' && !v.dead && !seen(v.x, v.y)) continue;
    const Mm = typeof rlModelOf === 'function' ? rlModelOf(v) : null, side = v.side === 'e' ? 'e' : 'p', h = v.heading || 0, len = vehSp(v).len, z = v3Ht(v.x, v.y);
    const g = v3Grad(v.x, v.y, Math.max(2.5, len * .45), v.id), [hp, hr] = v3Pose(g, h);
    if (typeof v3dVehHaze === 'function' && Mm) v3dVehHaze(v, Mm.key, len, z, h, C.E);   // 发动机排气的热浪（v3det.js）
    if (typeof v3gVeh === 'function') v3gVeh(v, Mm ? Mm.key : null, side, len, v.x, v.y, z, h, v.dead ? h + .6 : (v.aim ?? h), v.dead, hp, hr, hl(v));
  }
  // 步兵（画得出单兵的距离都是立体模型，地面贴图里不再画平的小人）：三人按二维画面的三角站位，按兵种建模、按动作选姿态帧（manim.js：走 / 跑四帧、跪射、卧倒、匍匐），开火时枪口焰
  // 远近都是立体的：离镜头 180 米外换低模，再远一点略放大（远看不至于缩成看不见的一个点；三人的间距一起放大，不挤成一团）
  const E3 = C.E, lod = (x, y, z) => { const d = Math.hypot(x - E3[0], y + E3[1], z - E3[2]); return { lo: d > 180, k: clamp(d / 700, 1, 1.6) }; };
  for (const q of S.teams) {
    if (!q.men.length || q.ride || q.boarded || !inB(q.x, q.y) || (q.side === 'e' && !seen(q.x, q.y))) continue;
    const f = typeof faceDraw === 'function' ? faceDraw(q) : faceOf(q), c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), sd = (q.side === 'e' ? 1 : 0) + (hl(q) ? 8 : 0), T = typeof manTeam === 'function' ? manTeam(q) : null;   // + 8：选中编队的成员，全身发光（selfx.js）
    const Lq = lod(q.x, q.y, v3Ht(q.x, q.y)), ks = Lq.k;
    q.men.forEach((role, i) => {
      if (i > 2) return;
      let mx = q.x + (MO[i][0] * c - MO[i][1] * s) * ks, my = q.y + (MO[i][0] * s + MO[i][1] * c) * ks;
      const bo = typeof bldOut === 'function' && bldOut(mx, my, .5);
      if (bo) [mx, my] = bo;
      const kind = typeof manKind === 'function' ? manKind(q, i, role) : role, P = T ? manPose3(q, T, i, kind) : { p: q.prone ? 'pr' : 'st', fire: null }, z = v3Ht(mx, my);
      const K = V3_MAN * ks;
      if (typeof v3gMan === 'function') v3gMan(kind, P.p, mx, my, z, f, K, sd);   // 用户给的士兵模型原样摆放（卧倒、匍匐时放平）
      if (P.fire != null && P.fire < .07) {   // 枪口焰：站姿在胸高、跪姿低一些、卧倒贴地（按姿态高度 L 插值）
        const Lp = P.L ?? (P.p === 'pr' || P.p[0] === 'c' ? 2 : P.p === 'kn' ? 1 : 0), low = Lp > 1.5, L = (low ? 1.35 : kind === 'mg' ? 1.45 : 1.1) * K, h = (Lp <= 1 ? lerp(1.32, .9, Lp) : lerp(.9, .2, Lp - 1)) * K;
        v3mAdd('mflash', v3mFlash, mx + Math.cos(f) * L, my + Math.sin(f) * L, z + h, f, K, sd);
      }
    });
  }
  // 阵亡的遗体（manim.js）：倒地后躺在原地，约一分钟后消失
  if (typeof MANV === 'object' && MANV.S === S) for (const d of MANV.dead) {
    if (S.t - d.t0 < .3 || S.t - d.t0 > 60 || !inB(d.x, d.y) || (d.side === 'e' && !spec && !seen(d.x, d.y))) continue;
    const z = v3Ht(d.x, d.y), Ld = lod(d.x, d.y, z);
    if (typeof v3gMan === 'function') v3gMan(d.kind, 'dead', d.x, d.y, z, d.a + d.tw, V3_MAN * Ld.k, 2);
  }
  // 舰艇：位置、航向跟二维画面一致（ships.js 的姿态缓存；3D 里不放大）
  const pose = (key, o, hd) => { const P = typeof SHIPV === 'object' && SHIPV.pose[key]; return P && dist(P.x, P.y, o.x, o.y) < 60 ? P : { x: o.x, y: o.y, h: hd, k: 1 }; };
  for (const sh of S.ships) {
    if (!alive(sh) || !inB(sh.x, sh.y, 80)) continue;
    const d = (typeof SHIP_DIM === 'object' && SHIP_DIM[sh.kind]) || [32, 11], P = pose(sh.id, sh, sh.heading ?? -1.57), nm = (sh.sbxCls && sh.sbxCls.name) || '';
    if (sh.kind === 'dd') {   // 驱护舰按舰型建模（有外部精细模型的用它，v3utex.js）
      const c = typeof vlsCls === 'function' ? vlsCls(sh) : '052D';
      const Ld = 50 * (((typeof SH_DDC === 'object' && SH_DDC[c]) || {}).k || 1) * P.k;
      if (typeof v3dFunnel === 'function') v3dFunnel(P.x, P.y, P.h, Ld, -.06, -2.6 + Ld * .21);   // 烟囱热气
      if (typeof v3uShip === 'function' && v3uShip(c, P.x, P.y, -2.6, P.h, Ld, 0)) continue;
      const [mk, mb] = v3mDDK(c); v3mAdd(mk, mb, P.x, P.y, -2.6, P.h, P.k, 0); continue;
    }
    const X = V3_SHIPX[String(sh.label || '').split('-')[0]], zx = X && sh.hover ? Math.max(-2.6, v3Ht(P.x, P.y)) : -2.6;   // 气垫艇冲上滩头时贴着地面
    if (!(X && typeof v3uShip === 'function' && v3uShip(X[0], P.x, P.y, zx, P.h, X[1] * P.k, 0))) v3mAdd('sh:' + sh.kind, () => v3mShip(sh.kind, d[0], d[1]), P.x, P.y, -2.6, P.h, P.k, 0);
    if (typeof v3dFunnel === 'function') v3dFunnel(P.x, P.y, P.h, (X ? X[1] : d[0]) * P.k, sh.kind === 'assault' ? -.4 : -.25, -2.6 + d[1] * .55, X && X[0] === 'lcac' ? 1.2 : .6);   // 柴油机排气（气垫艇是四台燃气轮机，热浪大）
  }
  for (const bt of S.boats || []) if (!bt.dead && isFinite(bt.x) && inB(bt.x, bt.y)) v3mAdd('sh:boat', () => v3mShip('boat', 12, 5), bt.x, bt.y, -2.6, bt.heading ?? -1.57, 1, 0);
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && inB(S.dd.x, S.dd.y, 80)) {   // 旗舰：有外部精细模型（055）先用它，长度与沙盒里的同型舰一样按舰型系数
    const P = pose('DD', S.dd, S.dd.heading ?? -1.57), c = typeof vlsCls === 'function' ? vlsCls(S.dd) : '055', Ld = 50 * (((typeof SH_DDC === 'object' && SH_DDC[c]) || {}).k || 1) * P.k;
    if (!(typeof v3uShip === 'function' && v3uShip(c, P.x, P.y, -2.6, P.h, Ld, 0))) { const [mk, mb] = v3mDDK(c); v3mAdd(mk, mb, P.x, P.y, -2.6, P.h, P.k, 0); }
  }
  if (typeof cvAll === 'function') for (const cv of cvAll()) {
    if (!(cv.hp > 0) || cv.x < -999 || !inB(cv.x, cv.y, 220)) continue;
    const lhd = /075/.test(cv.name || ''), h = cv.heading ?? -1.57, C = typeof CVG === 'object' ? CVG : null, top = -2.6 + (C ? C.zd : 17), home = cvHome(cv);   // top：飞行甲板顶面
    v3mAdd('cv:' + (lhd ? 1 : 0), () => v3mCarrier(lhd), cv.x, cv.y, -2.6, h, 1, 3);   // 3：写实画面用海军灰（与舰载机同色）
    if (!C) continue;
    const at = (u, v) => cvW(u, v, cv), live = (S.planes || []).filter(p => !p.dead && cvHome(p) === home && !p.land && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap'));
    C.el.forEach((E, i) => { const [x, y] = at(E.u, E.v); v3mAdd('cvel', () => v3mCvEl(E.L, E.B), x, y, top - C.hang * (typeof cvElH === 'function' ? cvElH(cv, i) : 0), h, 1, 3); });   // 升降机平台
    if (!lhd) C.cats.forEach((c, k) => { const [x, y] = at(c.u - Math.cos(c.a) * 9.5, c.v - Math.sin(c.a) * 9.5); v3mAdd('cvjbd', v3mCvJbd, x, y, top + .02, h + c.a + Math.PI / 2, 1, 3, -(typeof cvJbd === 'function' ? cvJbd(cv, k, live) : 0) * .96); });   // 偏流板
    if (!lhd && typeof v3dCatUnits === 'function') v3dCatUnits(cv, live, top, h);   // 弹射滑块（v3det.js）
    if (!S.air) continue;
    // 甲板上的舰载机：停在机位上的（外翼折起）与正在作业的（登机、滑行、挂弹射器、弹射、着舰后滑回、升降机上）；放下起落架
    const wing = S.air.wing.filter(w => cvHome(w) === home && !(typeof airLandW === 'function' && airLandW(w)));
    for (const [id, j] of cvPark(cv, wing)) {
      const w = wing.find(o => o.id === id), sl = C.slots[j];
      if (!w || !sl) continue;
      const [wx, wy] = at(sl[0], sl[1]);
      v3GroundPlane(airSilKey(w.type, w.v), airMdl(w.type, w.v).size || 15, wx, wy, top, h + sl[2], 1, 0, true, 3, t);
    }
    for (const p of live) {
      if (p.dk === 'lift' && !p.up) continue;   // 还在机库里
      const key = airSilKey(p.kind, p.v), sz = airMdl(p.kind, p.v).size || 15, sink = typeof cvDeckSink === 'function' ? cvDeckSink(p) : 0;
      v3GroundPlane(key, sz, p.x, p.y, top - C.hang * sink, p.heading, p.fold ?? 0, p.cpo || 0, p.dk === 'brd' || p.dk === 'lift', 3, t, typeof v3dDeckSurf === 'function' ? v3dDeckSurf(p) : null);   // 挂杆后舵面检查、起飞配平
      const P = p.dk === 'brd' && typeof cvPilotPose === 'function' ? cvPilotPose(p) : null;   // 飞行员跑过来、顺登机梯爬进座舱坐下，之后坐在座舱里（v3det.js）
      if (typeof v3dPilot === 'function') v3dPilot(p, key, sz, top - C.hang * sink, h, at);
      else if (P) { const [x, y] = at(P.u, P.v), pose = P.run ? 'r' + (Math.floor(P.ph / .7854) & 7) : 'cl' + (Math.floor(P.ph / 1.7) & 7); v3gMan('pilot', pose, x, y, top + P.z, h + P.a, V3_PIL, 0); }
      if (P && (p.cpo || 0) > .3) { const L = cvLadder(p), [x, y] = at(L[0], L[1]); v3mAdd('ladder', v3mLadder, x, y, top, p.heading + Math.PI / 2, sz / 21, 0); }
    }
    if (!lhd && typeof v3dDeckVeh === 'function') v3dDeckVeh(cv, C, live, wing, top, h, at);   // 挂弹车、弹药拖车、牵引车（v3det.js）
    if (!lhd && typeof v3dWires === 'function') v3dWires(live, top, h, at);   // 拦阻索
    for (const o of typeof cvShooters === 'function' ? cvShooters(cv, live) : []) { const [x, y] = at(o.u, o.v), pose = o.go ? 'kn' : 'pt'; v3gMan('deck', pose, x, y, top, h + o.a, V3_PIL, 0); }   // 弹射官
    if (v3mHi() && !lhd) {   // Ultra：地勤人员，避开弹射器/着舰区（甲板车辆在 v3det.js v3dDeckVeh，跟着停机位与整备进度）
      const crew = [[70, -13, 0, 'pt'], [58, 17, .2, 'kn'], [-103, 24, -2.6, 'st'], [-122, 24, -2.8, 'pt'], [4, 31, 1.4, 'st']];
      for (const [u, v, a0, pose] of crew) { const [x, y] = at(u, v); v3gMan('deck', pose, x, y, top, h + a0, V3_PIL, 0); }
    }
  }
  for (const e of S.eships || []) if (!e.dead && inB(e.x, e.y, 80) && (spec || seen(e.x, e.y) || (S.t - (e.det ?? -99) < 4 && !(typeof nvEsmOnly === 'function' && nvEsmOnly(e))))) { const C0 = (typeof NV_CLS === 'object' && NV_CLS[e.cls]) || { L: 46, B: 9 }; if (!(typeof v3uShip === 'function' && v3uShip(e.cls, e.x, e.y, -2.6, e.heading ?? -1.57, C0.L, 1))) v3mAdd('es:' + e.cls, () => v3mEShip(e.cls, C0.L, C0.B), e.x, e.y, -2.6, e.heading ?? -1.57, 1, 1); if (typeof v3dFunnel === 'function') v3dFunnel(e.x, e.y, e.heading ?? -1.57, C0.L, -.08, -2.6 + C0.L * .2); }
  for (const s of S.subs || []) if (!s.dead && inB(s.x, s.y) && (spec || (typeof asSubSeen === 'function' && asSubSeen(s)))) { if (!(typeof v3uShip === 'function' && v3uShip('ssn', s.x, s.y, -4.2, s.heading || 0, 34, 1))) v3mAdd('sub', v3mSub, s.x, s.y, -4.2, s.heading || 0, 1, 1); }   // 外部模型：原点在耐压壳轴线，长 34 与自带模型一样
  // 守方阵地。工事按占地范围内的最低点放（v3Seat）：坡上的碉堡、炮台、炮位不悬空，像挖进坡里
  const v3Seat = (x, y, r) => Math.min(v3Ht(x, y), v3Ht(x + r, y), v3Ht(x - r, y), v3Ht(x, y + r), v3Ht(x, y - r)) - .3;
  const SEAT = { bunker: 7, coastal: 11, aa: 4, berm: 9, pit: 3, arty: 9, mortar: 3 };   // 炮与它的掩体同一高度
  for (const e of S.enemies) {
    if (e.kind === 'airfield') continue;
    const mob = typeof gunMobile === 'function' && gunMobile(e), pit = e.kind === 'mortar' ? 'pit' : 'berm';
    if (mob && e.pos) for (const p of e.pos) if ((e.moving || e.dead || dist(p.x, p.y, e.x, e.y) > 4) && inB(p.x, p.y) && (spec || seen(p.x, p.y))) v3mAdd('st:' + pit, () => v3mFort(pit), p.x, p.y, v3Seat(p.x, p.y, SEAT[pit]), 0, 1, 1);   // 空着的发射阵地
    if (!inB(e.x, e.y)) continue;   // 被毁的也立着（暗色残骸），贴图里不再画平面残骸（render2.js）
    if (!seen(e.x, e.y) && e.kx == null) continue;
    if (mob && e.moving && !e.dead) {   // 转移途中（ai.js relocate）：榴弹炮由牵引车拖着、迫击炮组扛着炮步行
      const h = Math.atan2(e.my - e.y, e.mx - e.x), z = v3Ht(e.x, e.y);
      if (e.kind === 'mortar') for (const s of [-1, 1]) { const f = 'w' + ((Math.floor(S.t * 3 + e.id + (s > 0 ? 4 : 0)) % 8 + 8) % 8), x = e.x + Math.cos(h) * s * 2.6, y = e.y + Math.sin(h) * s * 2.6; v3gMan('mortar', f, x, y, v3Ht(x, y), h, V3_MAN, 1); }
      else { const [p, r] = v3Pose(v3Grad(e.x, e.y, 6, 'tow' + e.id), h); v3mAdd('st:tow', () => v3mFort('tow'), e.x, e.y, z, h, 1, 1, r, p); }
      continue;
    }
    if (mob) v3mAdd('st:' + pit, () => v3mFort(pit), e.x, e.y, v3Seat(e.x, e.y, SEAT[pit]), 0, 1, e.dead ? 2 : 1);
    const a = typeof gunAim === 'function' ? gunAim(e, t) : (e.th ?? 1.57), z0 = v3Ht(e.x, e.y), ca = Math.cos(a), sa = Math.sin(a), at = (u, v) => [e.x + u * ca - v * sa, e.y + u * sa + v * ca];
    if (e.kind === 'typhon' && typeof TY_RIG === 'object' && typeof tyEnsure === 'function') {
      // 堤丰车阵：每辆车单独摆、各自贴地（脚下坡度定俯仰侧倾），被毁的车是歪着的暗色残骸；发射箱装在拖车尾部铰点上，起竖角叠加拖车的坡度
      const TU = tyEnsure(e), put = (key, build, u, v, dead, sink = 0) => {
        const [x, y] = at(u, v), g = v3Grad(x, y, 4), [p, r] = v3Pose(g, a);
        v3mAdd(key, build, x, y, v3Ht(x, y) - (dead ? .5 + sink : 0), a, 1, dead || e.dead ? 2 : 1, r + (dead ? .14 : 0), p + (dead ? -.05 : 0));
        return g;
      };
      for (let k = 0; k < TY_RIG.n; k++) {
        const v0 = (k - (TY_RIG.n - 1) / 2) * TY_RIG.gap, dd = TU.u[k].dead || e.dead;
        put('ty:trac', v3mTyTractor, TY3.tr, v0, dd);
        const g = put('ty:trl', v3mTyTrailer, TY3.tl, v0, dd), [hx, hy] = at(TY_RIG.piv, v0), A = a + Math.PI / 2, [pb, rb] = v3Pose(g, A);
        v3mAdd('ty:box', v3mTyBox, hx, hy, v3Ht(hx, hy) + 2.4 - (dd ? .5 : 0), A, 1, dd ? 2 : 1, (dd ? 0 : tyErect(e, k)) + rb, pb);
      }
      const bi = TY_U.findIndex(o => o.k === 'boc'), gi = TY_U.findIndex(o => o.k === 'gen');
      put('ty:boc', v3mTyBoc, TY3.boc[0], TY3.boc[1], TU.u[bi].dead);
      put('ty:gen', v3mTyGen, TY3.gen[0], TY3.gen[1], TU.u[gi].dead);
      continue;
    }
    v3mAdd('st:' + e.kind, () => v3mFort(e.kind), e.x, e.y, SEAT[e.kind] ? v3Seat(e.x, e.y, SEAT[e.kind]) : z0, a, 1, e.dead ? 2 : 1);
    if (!e.dead && e.kind === 'ascm' && typeof ASC_RIG === 'object') for (let k = 0; k < ASC_RIG.n; k++) {   // 发射箱：转台转向目标、仰起（missile.js ascPose）
      const P = ascPose(e, k), v0 = (k - (ASC_RIG.n - 1) / 2) * ASC_RIG.gap, b = a + P.tr, [cx, cy] = at(-3.4, v0), o = ASC_RIG.piv + 3.4;
      v3mAdd('asc:can', v3mAscCan, cx + Math.cos(b) * o, cy + Math.sin(b) * o, z0 + 3.1, b + Math.PI / 2, 1, 1, P.el);
    }
  }
  // 降落伞（para.js 伞兵 / 补给、abn.js 空降兵、a101.js 美军 101 空降师）：从运输机高度按下降进度落到地面，伞衣轻轻摆动
  // 伞随风匀速飘（三处都是每秒 x + 3、y − 2），落点在整个下降过程中不变：朝向、摆动相位、地面高度都按落点取——按伞的当前坐标取会随飘移每帧变，伞衣和伞兵来回甩
  const chutes = (L, jump, sd) => { for (const c of L || []) {   // 天上的伞衣老远就看得见：双方都画（与平面画面一致）
    if (c.done || !(c.t >= 0) || !isFinite(c.x) || !inB(c.x, c.y) || (c.k === 'team' && !(c.men && c.men.length))) continue;
    const T = jump(c), r = Math.max(0, T - c.t), lx = c.x + 3 * r, ly = c.y - 2 * r, f = clamp(1 - c.t / T, 0, 1), id = c.id ?? (lx * 7 + ly * 3);
    const a = Math.sin(id) * 3, roll = Math.sin(t * 1.3 + id) * .09, man = c.k === 'team', hang = 5.4 * 2.2 + 1.85 * V3_MAN;   // hang：伞衣顶到伞兵脚底
    const z = v3Ht(lx, ly) + f * 120 + (man ? hang : 1.5 + (c.k === 'veh' ? 11.3 : 7.4) * 2.2);   // 伞兵着陆那一刻脚正好踩到地面
    v3mAdd('chute:' + c.k, () => v3mChute(c.k), c.x, c.y, z, a, 2.2, sd, roll);
    if (man) { const s = Math.sin(roll) * hang; v3gMan('rifle', 'st', c.x + s * Math.sin(a), c.y - s * Math.cos(a), z - Math.cos(roll) * hang, a, V3_MAN, sd, roll); }   // 吊在伞下的伞兵：和伞衣同一个摆（绕伞衣顶转），吊索始终连在头顶
  } };
  if (S.para && typeof PA === 'object') chutes(S.para.ch, c => c.k === 'crate' ? PA.jump : c.role ? PA.jlJump : PA.jump, 0);
  if (S.ab && typeof AB === 'object') chutes(S.ab.ch, c => c.k === 'veh' ? AB.heavy : AB.jump, 0);
  if (S.e101 && typeof A101 === 'object') chutes(S.e101.ch, c => c.k === 'veh' ? A101.heavy : A101.jump, 1);
  // —— 地面构筑物与杂项：原来只在地面贴图上画成平面图（render4 / render2 / ai3 / trucks / repair / afbase / afdef / para 在 3D 时不再画），这里立起来 ——
  const sea = (x, y) => Math.max(v3Ht(x, y), -3.2);   // 水里的东西露出水面
  for (const p of S.points || []) {   // 据点建筑（海滩出口的地堡与龙牙、指挥所、雷达站、炮兵排、哨所、村舍、渡口、桥）
    if (!inB(p.x, p.y, 60)) continue;
    const k = typeof PKIND === 'function' ? PKIND(p.key) : null;
    if (!V3_PT.includes(k)) continue;
    const blown = k === 'bridge' && typeof isBlown === 'function' && isBlown(p.key), sd = p.owner === 'p' ? 0 : p.owner === 'e' ? 1 : 2;
    const z = k === 'bridge' ? Math.max(v3Ht(p.x - 26, p.y), v3Ht(p.x + 26, p.y), -2) - 2.4 : k === 'ford' ? sea(p.x, p.y) : v3Ht(p.x, p.y);
    const nh = (!!V3_PTHOUSE[k] || k === 'exit' || k === 'bridge') && typeof v3pReady === 'function' && v3pReady();   // 房屋、地堡、桥换成了外部模型（v3props.js）
    const sv = typeof v3Mx === 'function' && !v3Mx() ? 3 : sd;   // 写实画面：混凝土、土堤用中性的灰，不按归属涂色（归属看旗子）
    v3mAdd((nh ? 'ptn:' : 'pt:') + k + (blown ? ':x' : ''), () => v3mPoint(k, blown, nh), p.x, p.y, z, 0, 1, sv);
    if (k === 'radar') v3mAdd('rad:4', () => v3mRadar(4), p.x + 4, p.y - 4, z + 9.6, p.owner === 'e' ? t * 1.4 : .5, 1, sd);
  }
  for (const o of S.obst || []) if (o.known && !o.dead && inB(o.x, o.y)) v3mAdd('hedge', v3mHedgehog, o.x, o.y, sea(o.x, o.y), (o.x * 7.1 + o.y * 3.3) % 6.28, 1.3, 1);   // 海滩反登陆障碍
  for (const w of S.wire || []) if (w.known && inB((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 120)) {   // 铁丝网：每 6 米一段
    const L = dist(w.x0, w.y0, w.x1, w.y1), n = Math.max(1, Math.round(L / 6)), a = Math.atan2(w.y1 - w.y0, w.x1 - w.x0);
    for (let i = 0; i < n; i++) { const u = (i + .5) / n, x = lerp(w.x0, w.x1, u), y = lerp(w.y0, w.y1, u), c = !!(w.cut && i % 3 === 1); v3mAdd(c ? 'wire:x' : 'wire', () => v3mWire(c), x, y, v3Ht(x, y), a, L / n / 6, 1); }
  }
  if (S.armor && S.armor.length && typeof v3gVeh === 'function') for (const a of S.armor) {   // 守方轮式装甲车（ai3.js）：美军装甲车同样用 M1A1 的模型代替
    if (!inB(a.x, a.y) || !(spec || seen(a.x, a.y)) || (a.dead && S.t - (a.deadT ?? 0) > 120)) continue;
    const h = a.heading || 0, [hp, hr] = v3Pose(v3Grad(a.x, a.y, 4, 'ar' + a.id), h);
    v3gVeh(a, 'm1117', 'e', typeof A3_LEN === 'number' ? A3_LEN : 18, a.x, a.y, v3Ht(a.x, a.y), h, a.dead ? h + .6 : (a.aim ?? h), a.dead, hp, hr);
  }
  if (S.trk && S.trk.list) for (const tr of S.trk.list) if ((tr.ph !== 'idle' || tr.dead) && inB(tr.x, tr.y)) {   // 补给卡车（排气管在驾驶室后面朝上冒热气）
    const [tp, trl] = v3Pose(v3Grad(tr.x, tr.y, 3, 'trk' + tr.id), tr.h || 0), z = v3Ht(tr.x, tr.y), h = tr.h || 0;
    v3mAdd('truck', () => v3mTruck('cargo'), tr.x, tr.y, z, h, 1, tr.dead ? 2 : 0, trl, tp);
    if (!tr.dead && typeof v3dHazeD === 'function') v3dHazeD([tr.x + Math.cos(h) * 1.2, -(tr.y + Math.sin(h) * 1.2), z + 3.4], [-Math.cos(h) * .3, Math.sin(h) * .3, 1], .35, 3.2, tr.ph === 'idle' ? .6 : 1);
  }
  if (S.rep && S.rep.crew) for (const id in S.rep.crew) {   // 抢修组：岸上抢修车 / 海上抢修艇（朝向按移动方向，只在画面里记）
    const c = S.rep.crew[id];
    if (!c.k || !inB(c.x, c.y)) continue;
    let m = V3M.mv.get(c);
    if (!m) V3M.mv.set(c, m = { x: c.x, y: c.y, h: (+id || 0) * 1.3 });
    if (dist(m.x, m.y, c.x, c.y) > .4) { m.h = Math.atan2(c.y - m.y, c.x - m.x); m.x = c.x; m.y = c.y; }
    if (c.sea) v3mAdd('wboat', v3mWorkBoat, c.x, c.y, -3, m.h, 1, 0); else v3mAdd('truck:fix', () => v3mTruck('fix'), c.x, c.y, v3Ht(c.x, c.y), m.h, 1, 0);
  }
  if (S.afd) {
    for (const r of S.afd.radar || []) if (inB(r.x, r.y) && (spec || seen(r.x, r.y) || r.kx != null)) {   // 机场对空监视雷达站
      const z = v3Ht(r.x, r.y);
      v3mAdd('radmast', v3mRadarMast, r.x, r.y, z, 0, 1, r.dead ? 2 : 1);
      if (!r.dead) v3mAdd('rad:3', () => v3mRadar(3), r.x, r.y, z + 8.7, t * 1.6 + r.x, 1, 1);
    }
    for (const id in S.afd.bases) {   // 机场抢修车（afdef.js）：从出发点开到弹坑旁
      const F = S.afd.bases[id].fix;
      if (!F || !inB(F.x, F.y) || !(spec || seen(F.x, F.y))) continue;
      const u = clamp(F.t / 8, 0, 1), e = u * u * (3 - 2 * u), x = lerp(F.sx, F.x + 6, e), y = lerp(F.sy, F.y + 6, e), a = Math.atan2(F.y - F.sy, F.x - F.sx);
      v3mAdd('truck:fix', () => v3mTruck('fix'), x, y, v3Ht(x, y), u < 1 ? a : a + .6, .55, 1);
    }
  }
  if (S.para && S.para.ca) for (const c of S.para.ca) if (inB(c.x, c.y)) v3mAdd('crates', v3mCrates, c.x, c.y, v3Ht(c.x, c.y), 0, 1, 0);   // 空投补给点
  // 补给站：滩头补给站（浮桥补给线终点）与前沿补给点；箱堆随存量增减，在建的按进度一堆堆码起来，被毁的散落一地
  for (const L of S.supply || []) if (inB(L.x, L.y)) { const z = Math.max(v3Ht(L.x, L.y), -1); v3mAdd('depot:b:3', () => v3mDepot(true, 3, false), L.x, L.y, z, 0, 1, 0); }
  if (S.snet) for (const n of S.snet.nodes) {
    if (!isFinite(n.x) || !inB(n.x, n.y)) continue;
    const live = typeof snLive === 'function' ? snLive(n) : !n.dead, dead = n.dead && !(n.built > 0);
    if (!live && !dead && !(n.built > 0)) continue;   // 只是规划，还没动工
    const k = dead ? 0 : live ? Math.round(clamp(n.stock ?? 1, 0, 1) * 3) : Math.round(clamp(n.built, 0, 1) * 3), key = `depot:n:${k}:${dead ? 1 : 0}`;
    v3mAdd(key, () => v3mDepot(false, k, dead), n.x, n.y, v3Ht(n.x, n.y), (n.id || 0) * .7, 1, dead ? 2 : 0);
  }
  if (typeof afb3dBases === 'function' && typeof afbParked === 'function') for (const b of afb3dBases()) {   // 机场停放的飞机（机堡里、停机线、直升机位）
    const own = b === S.abBase;
    if (!own && !(spec || (typeof eaBaseSeen === 'function' && eaBaseSeen(b)))) continue;
    for (const P of afbParked(b, own)) {
      const [x, y] = eaW(b, P.u, P.v);
      if (!inB(x, y, 30)) continue;
      const [x2, y2] = eaW(b, P.u + Math.cos(P.a), P.v + Math.sin(P.a)), h = Math.atan2(y2 - y, x2 - x);
      if (typeof v3gPlane === 'function') v3gPlane(P.sil, P.size, x, y, v3Ht(x, y), true, h, own ? 0 : 1, 0, 0, true, 0);   // 放下起落架停着
    }
  }
  // 机场外的前沿加油弹药点（eair.js）：停着的直升机 / F-35B、油囊、弹药箱
  if (S.eair && S.eair.farp && typeof eaFarpParked === 'function' && (spec || eaFarpSeen()) && inB(S.eair.farp.x, S.eair.farp.y, 120)) {
    const F = S.eair.farp, K = { heli: ['ah64', 16], ftrb: ['f35b', 17], uh60: ['uh60', 17] };
    for (const P of eaFarpParked()) { const [key, sz] = K[P.w.type] || ['ah64', 16]; v3GroundPlane(key, sz, P.x, P.y, v3Ht(P.x, P.y), P.h, 0, 0, true, 4, t); }
    for (const [dx, dy] of [[-62, -40], [-62, -28], [62, -40]]) v3mAdd('farpbl', () => { const M = mbNew(); mbBox(M, -6.5, 6.5, -3.2, 3.2, 0, 1.4, .6, { taper: 1.1 }); return M; }, F.x + dx, F.y + dy, v3Ht(F.x + dx, F.y + dy), 0, 1, 2);   // 油囊
    v3mAdd('crates', v3mCrates, F.x + 54, F.y + 38, v3Ht(F.x + 54, F.y + 38), .3, 1, 2);
  }
  // 飞机：高度与 3D 地图里的标识一致（view3d.js v3AirZ：甲板上贴着甲板，空中按高度），按滚转角倾斜；直升机主旋翼转动
  const plane = (o, hd, sd, key, sz, bank) => {
    if (typeof V3FP === 'object' && V3FP.on && V3FP.o === o && V3FP.vw === 'cock' && !(typeof fpPitOn === 'function' && fpPitOn(o))) return;   // 座舱视角：模型没有座舱内饰时不画自己（平面座舱，v3pilot.js）；有内饰就照画，镜头坐在模型座舱里
    const L = !sd && typeof v3dLaunch === 'function' ? v3dLaunch(o) : null;   // 刚离舰：下沉、抬头，起落架过一会儿才收（v3det.js）
    const rs = o.fl && o.fp && typeof fpRS === 'function' ? fpRS(o) : null;   // 玩家开的：推演两步之间插值（不插值一顿一顿地抖）
    const x = rs ? rs.x : o.x, y = rs ? rs.y : o.y, z = rs ? rs.z : v3AirZ(o) + (L ? L.dz : 0);
    if (rs) { hd = rs.heading; bank = rs.roll; }
    let pt = rs ? rs.pitch : o.fl && o.fp ? o.pt3 || 0 : typeof V3G_HELI === 'object' && V3G_HELI[key] ? 0 : typeof v3dPitch === 'function' ? v3dPitch(o, sd, z, L, key) : L ? L.pitch : 0;   // 玩家亲自开：机身俯仰就是物理引擎的   // 仰角跟着航迹 + 迎角（js/aero.js；直升机不按航迹抬头）
    const tu = sd && o.toT != null ? S.t - o.toT : -1;   // 机场起飞刚离地（eair.js eaRoll 记的离地时刻）：头 1.5 秒保持滑跑末段抬起的机头，起落架过几秒再收
    if (tu >= 0 && tu < 3) pt = Math.max(pt, V3_ROT * (1 - sm01((tu - 1.5) / 1.5)));
    const gd = !!(L && L.gear) || (tu >= 0 && tu < (typeof EA_TO === 'object' ? EA_TO.gear : 4));
    const Pc = o.fl && o.fp ? { de: o.fl.d[0], da: o.fl.d[1] } : typeof V3D_PT === 'object' ? V3D_PT.get((sd ? 'e' : 'p') + o.id) : null;   // 舵面：玩家开的按电传算出的真实舵偏   // v3dPitch 按气动算好的舵面：平尾按迎角配平 + 俯仰角速度，左右差动按滚转角速度
    if (typeof v3gPlane === 'function') v3gPlane(key, sz, x, y, z, false, hd || 0, sd, bank || 0, pt, gd, t, !sd && typeof fpNoz === 'function' ? fpNoz(o) : 0, Pc);   // 用户给的飞机模型（js/v3g.js）：起落架收放、直升机旋翼转、尾喷口开合、舵面偏转
  };
  for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && (inB(p.x, p.y, 220) || (typeof fpDriving === 'function' && fpDriving(p))) && !(!p.land && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap'))) {   // 甲板上的在航母那里画（放下起落架）
    const key = typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : 'j35', sz = (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || ((typeof AIR_SPEC === 'object' && AIR_SPEC[p.kind]) || {}).size || 15;
    plane(p, p.heading, 0, key, sz, p.bank);
  }
  const EA_K = { ga: ['a10', 18], heli: ['ah64', 16], uh60: ['uh60', 17], c17: ['c17', 30], ftr: ['f35', 17], ftrb: ['f35b', 17], mq9: ['mq9', 18], f22: ['f22', 18], b2: ['b2', 34], p8: ['p8', 26] };
  // 被击落的飞机：烧黑的机体（2：残骸色）从被击中的高度翻滚着、机头朝下栽下去（火球与拖着的黑烟在 v3fx.js）
  const wreck = (w, T, key, sz) => {
    const age = S.t - w.t;
    if (age < 0 || age > T) return;
    const P = v3WreckAt(w, age, T), sp = (w.t * 7.31) % 1 < .5 ? 1 : -1;
    if (inB(P.x, P.y, 220) && typeof v3gPlane === 'function') v3gPlane(key, sz, P.x, P.y, P.z, false, w.h + age * .5 * sp, 2, age * 4.2 * sp, -.2 - P.u * .95, false, 0);
  };
  for (const w of (S.air && S.air.wrecks) || []) { const key = typeof airSilKey === 'function' ? airSilKey(w.kind, w.v) : 'j35'; wreck(w, 2.2, key, (typeof airMdl === 'function' && airMdl(w.kind, w.v).size) || 15); }
  if (S.eair) for (const w of S.eair.wr || []) if (spec || seen(w.x, w.y)) { const [key, sz] = EA_K[w.type] || ['f35', 17]; wreck(w, 2, key, sz); }
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && isFinite(a.x) && (spec || a.pv || seen(a.x, a.y)) && inB(a.x, a.y, 220)) {
    const [key, sz] = EA_K[a.type] || ['f35', 17];
    if (a.ph === 'vto' || a.ph === 'vl') {   // F-35B 垂直起降：放下起落架，悬停着升降
      const zg = v3Ht(a.x, a.y), z = v3AirZ(a), zc = typeof v3gPlaneZc === 'function' ? v3gPlaneZc(key, sz) : 2;
      if (typeof v3gPlane === 'function') v3gPlane(key, sz, a.x, a.y, Math.max(zg, z - zc), true, a.heading, 1, 0, 0, true, t);
      continue;
    }
    if (a.ph !== 'gnd' && a.ph !== 'roll') { plane(a, a.heading, 1, key, sz, a.bank); continue; }
    // 机场地面作业（eair.js eaGnd）：放下起落架停在机位 / 沿滑行道滑行 / 跑道上滑跑；登机时飞行员跑过来、顺梯子爬进座舱，座舱盖开合，地勤在机头前打手势
    const b = S.enemies.find(e => e.id === a.base), Cr = typeof eaGndCrew === 'function' ? eaGndCrew(a) : null, gz = v3Ht(a.x, a.y);
    v3GroundPlane(key, sz, a.x, a.y, gz, a.heading, 0, Cr ? Cr.cpo : 0, !!(Cr && !Cr.eng && Cr.crew && S.t - a.g.t0 < a.g.crew - EA_GND.start), 4, t, null, a.ph === 'roll' && typeof eaVlof === 'function' ? V3_ROT * sm01(((a.spd || 0) / eaVlof(a) - .83) / .17) : 0);   // 滑跑末段（离地速度的 83% 起）抬头
    if (!Cr || !b) continue;
    const toW = (u, v) => eaW(b, u, v), hb = (b.rh || 0), da = A => hb + Math.atan2(Math.sin(A) * (b.rs || 1), Math.cos(A));
    if (Cr.pilot) { const [x, y] = toW(Cr.pilot.u, Cr.pilot.v), pose = Cr.pilot.run ? 'r' + (Math.floor(Cr.pilot.ph / .7854) & 7) : 'cl' + (Math.floor(Cr.pilot.ph / 1.7) & 1); v3gMan('pilot', pose, x, y, v3Ht(x, y) + Cr.pilot.z, da(Cr.pilot.a), V3_PIL, 1); }
    if (Cr.lad) { const [x, y] = toW(Cr.lad[0], Cr.lad[1]); v3mAdd('ladder', v3mLadder, x, y, v3Ht(x, y), a.heading + Math.PI / 2, sz / 21, 1); }
    if (Cr.crew) { const [nx, ny] = toW(Cr.mar[0], Cr.mar[1]), pose = Cr.eng || Math.floor(S.t * 1.5) & 1 ? 'pt' : 'kn'; v3gMan('deck', pose, nx, ny, v3Ht(nx, ny), da(Cr.mh), V3_PIL, 1); }   // 地勤：站在机位前方指挥开车、引导滑出
  }
  // 刚离机的导弹 / 炸弹：从弹舱 / 挂架落下（还没点火时是立体弹体，点火后由 v3fx.js 画光点与尾迹）
  if (typeof airRelPos === 'function' && typeof AIRV === 'object' && AIRV.mv && AIRV.mv.size) for (const m of S.missiles || []) {
    if (!AIRV.mv.has(m.id)) continue;
    const P = airRelPos(m, true);
    if (!P || P.u < (P.r.k === 'main' ? AIR_REL.open : .05) || P.e > .5 || !inB(P.x, P.y, 100) || (m.side === 'e' && !(spec || seen(P.x, P.y)))) continue;
    if (typeof v3gMsl === 'function') v3gMsl(P.r.w === 'bomb' ? 'bomb' : v3MslKey(m), P.x, P.y, airRelZ(P, m), P.h, P.sc * v3MslAk(v3MslPlaneKey(P.o)), m.side === 'e' ? 1 : 0);   // 按型号、真实尺寸，和发射它的飞机同一比例（v3msl.js）
  }
  // 飞行中的导弹：立体弹体，按飞行方向取朝向与俯仰（发光的尾焰、烟迹在 v3fx.js）；刚离机还没点火的在上面画
  const mp = V3M.mp || (V3M.mp = new Map()), mlive = new Set();
  for (const m of S.missiles || []) {
    if (m.t < 0 || m.done || !isFinite(m.x)) continue;
    mlive.add(m.id);
    if ((typeof AIRV === 'object' && AIRV.mv && AIRV.mv.has(m.id) && typeof airRelPos === 'function' && airRelPos(m, true)) || !inB(m.x, m.y, 300) || (m.side === 'e' && !(spec || seen(m.x, m.y)))) continue;
    const z0 = typeof v3AltZ === 'function' ? v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : V3_AIR), -2.6, 2) : v3Ht(m.x, m.y) + 20;
    const VP = typeof v3MslPos === 'function' ? v3MslPos(m, z0) : null, mx = VP ? VP.x : m.x, my = VP ? VP.y : m.y, z = VP ? VP.z : z0;   // 垂发冲出阶段（v3fx.js）
    let o = mp.get(m.id);
    if (!o) mp.set(m.id, o = { x: mx, y: my, z: z - 1, h: Math.atan2(m.ty - m.y, m.tx - m.x), p: VP ? 1.5 : .8 });
    const dx = mx - o.x, dy = my - o.y, dz = z - o.z, dl = Math.hypot(dx, dy);
    if (dl + Math.abs(dz) > .4) { o.h = dl > .05 ? Math.atan2(dy, dx) : o.h; o.p = Math.atan2(dz, Math.max(.01, dl)); o.x = mx; o.y = my; o.z = z; }
    if (typeof v3gMsl === 'function') v3gMsl(v3MslKey(m), mx, my, z, o.h, v3MslK(m), m.side === 'e' ? 1 : 0, o.p);   // 按型号、真实尺寸（v3msl.js 的 V3MS 表）
    // 垂发舱盖：发射后翻开约 2 秒
    if (VP && m.t < 2.2 && typeof v3VlsOrigin === 'function') { const vo = v3VlsOrigin(m); if (vo) v3mAdd('vlslid', v3mVlsLid, vo.x, vo.y, vo.z, vo.h, 1, m.side === 'e' ? 1 : 0, -1.25 * clamp(m.t / .25, 0, 1) * clamp((2.2 - m.t) / .4, 0, 1)); }
  }
  for (const id of mp.keys()) if (!mlive.has(id)) mp.delete(id);
}
// 画收集好的实例；LM：太阳阴影图的光源矩阵（这一遍只写深度，不画发光线）
function v3mDraw(C, LM) {
  if (!V3M.ok || !V3.gl || !S) return;
  const gl = V3.gl;
  gl.useProgram(V3M.pr);
  gl.uniformMatrix4fv(V3M.u.uM, false, LM || C.M);
  gl.uniform3f(V3M.u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(V3M.u.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(V3M.u.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.004, .02, .011]));
  v3mPalette(gl);
  if (typeof v3ShUni === 'function') v3ShUni(gl, V3M.u, !LM);
  const A = V3M.a, X = V3M.ext, glass = [];
  gl.uniform1f(V3M.u.uGP, 0);
  for (const [key, L] of V3M.inst) {
    const n = L.d.length / 8;
    if (!n) continue;
    if (L.fr !== V3M.fr) { L.fr = V3M.fr; L.f = new Float32Array(L.d); }   // 这一帧的实例数据只转一次（两遍共用）
    const m = v3mGet(key, L.build);
    if (m.gl && !LM) glass.push([m, L.f, n]);
    v3mDrawM(gl, m, L.f, n, LM);
  }
  if (glass.length) {   // 第二遍：透明座舱玻璃（混合、不写深度；实体都画完了，玻璃后面的座舱、甲板、海面都在）
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(V3M.u.uGP, 1);
    for (const [m, data, n] of glass) v3mDrawM(gl, m, data, n, true);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(V3M.u.uGP, 0);
  }
  for (const k of ['p', 'n', 's', 'b']) gl.disableVertexAttribArray(A[k]);
  if (typeof v3uDraw === 'function') v3uDraw(C, LM);   // 带贴图的精细模型（v3utex.js）
  if (typeof v3gDraw === 'function') v3gDraw(C, LM);   // 用户给的模型（js/v3g.js）
}
// 画一个网格的全部实例（data：每个实例 8 个数）；noLine：不画线（阴影那一遍、透明玻璃那一遍）
function v3mDrawM(gl, m, data, n, noLine) {
  const A = V3M.a, X = V3M.ext;
  for (const [buf, cnt, mode] of [[m.tb, m.tn, gl.TRIANGLES], [m.lb, m.ln, gl.LINES]]) {
    if (!buf || !cnt || (noLine && mode === gl.LINES)) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(A.s); gl.vertexAttribPointer(A.s, 1, gl.FLOAT, false, 40, 24);
    gl.enableVertexAttribArray(A.b); gl.vertexAttribPointer(A.b, 3, gl.FLOAT, false, 40, 28);
    if (X) {
      gl.bindBuffer(gl.ARRAY_BUFFER, V3M.ib); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(A.iA); gl.vertexAttribPointer(A.iA, 4, gl.FLOAT, false, 32, 0); X.vertexAttribDivisorANGLE(A.iA, 1);
      gl.enableVertexAttribArray(A.iB); gl.vertexAttribPointer(A.iB, 4, gl.FLOAT, false, 32, 16); X.vertexAttribDivisorANGLE(A.iB, 1);
      X.drawArraysInstancedANGLE(mode, 0, cnt, n);
      X.vertexAttribDivisorANGLE(A.iA, 0); X.vertexAttribDivisorANGLE(A.iB, 0);
      gl.disableVertexAttribArray(A.iA); gl.disableVertexAttribArray(A.iB);
    } else for (let i = 0; i < n; i++) {   // 没有实例化扩展：逐个画（实例参数用常量属性）
      gl.vertexAttrib4f(A.iA, data[i * 8], data[i * 8 + 1], data[i * 8 + 2], data[i * 8 + 3]);
      gl.vertexAttrib4f(A.iB, data[i * 8 + 4], data[i * 8 + 5], data[i * 8 + 6], data[i * 8 + 7]);
      gl.drawArrays(mode, 0, cnt);
    }
  }
}
