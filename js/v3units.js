'use strict';
// 3D 立体地图里的兵种模型（view3d.js v3Draw 在地形、房屋之后调用 v3Units）——照游戏里已有的精细俯视模型「还原」成立体：
// · 坦克 / 装甲车：写实画面每型车的俯视模型（models.js RLM：车体轮廓、前上装甲、附加装甲块、舱盖、周视镜、指挥塔、机枪、烟幕弹、格栅、
//   储物箱、网篮……）用同一套画笔接口重放一遍（v3mPainter），每个零件按真实高度叠起来挤成立体；履带车加负重轮与履带、轮式车加车轮；
//   炮塔单独成件随瞄准转动，主炮按型号的炮管长、口径、抽烟装置、热护套箍、炮口制退器做成圆管；炮塔后的搜索雷达照样转
// · 步兵：每组三人，按兵种做（步枪手、机枪手、通讯兵背电台天线、工兵背锹、单兵防空导弹、反坦克火箭），站姿 / 卧姿
// · 舰艇：船体轮廓用二维画面同一条曲线（ships.js shHullPath），上层建筑、舰桥舷窗、桅杆雷达、主炮、垂发单元、机库与飞行甲板；
//   航母用二维的飞行甲板轮廓（carrier.js CVG），右舷舰岛、弹射器、斜角着舰区、拦阻索画成发光标线，甲板上停着的舰载机也立起来
// · 飞机：用二维的真实机型平面轮廓（AIR_SIL）挤出机翼，沿中线放样机身，按型号加双垂尾 / 单垂尾 / V 尾 / T 尾、发动机短舱、座舱；
//   直升机主旋翼转动；按滚转角倾斜
// · 守方阵地：碉堡、牵引榴弹炮、迫击炮、高炮、岸防炮、导弹发射车
// 画风：黑绿（默认）——深色实体 + 发光棱线（像 3D 房屋），舷窗、观察镜、座舱、车灯发光；敌方暗红实体 + 红色棱线；写实画面改成涂装色 + 暗棱线
// 实现：每种模型的网格只建一次（零件坐标：x 向前、y 向右、z 向上；车辆、步兵按米，舰艇、飞机、阵地按世界单位），
//   每帧只收集位置、朝向、比例、阵营，按模型实例化一次画完
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
const mbIn = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const mbLum = hex => { const h = String(hex || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return .5; const v = parseInt(h, 16); return ((v >> 16 & 255) * .299 + (v >> 8 & 255) * .587 + (v & 255) * .114) / 255; };

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

// —— 立体画笔：与 sprites.js sprPainter 同一套接口，零件按画的先后叠高（落在先画的零件上，就从它的顶面起）——
// L：图层 { base 底高, first 第一个零件的厚度, second 第二个零件的厚度, taper 第一个零件的收边 }，画进网格 M；
//   L.placed 记已放零件的轮廓与顶高，L.top(x, y) 查某处的顶高
function v3mPainter(M, L, side) {
  const g = mbRecCtx(), mat = (typeof SPR_MAT === 'object' && (SPR_MAT[side] || SPR_MAT.p)) || {}, paint = mat.paint || '#56604a', pl = mbLum(paint);
  const GLASS = typeof SPR_GLASS === 'string' ? SPR_GLASS : '#2e4653';
  L.placed = L.placed || [];
  const sh = col => typeof col !== 'string' ? 1 : col === GLASS ? -1 : clamp(mbLum(col) / pl, .35, 1.35);
  const at = (x, y) => { let z = L.base; for (const p of L.placed) if (p.top > z && mbIn([x, y], p.pts)) z = p.top; return z; };
  const put = (pts, h, s, o = {}) => {
    if (!pts || pts.length < 3) return L.base;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const z0 = o.z0 ?? at(cx, cy), taper = o.taper ?? (h >= .25 ? Math.min(.16, h * .3) : 0);
    mbPrism(M, pts, z0, z0 + h, s, { taper });
    if (!o.flat) L.placed.push({ pts, top: z0 + h });
    return z0 + h;
  };
  // 路径：二维画笔里 poly / rr / circ 返回一个函数，这里同时带上已换算的轮廓点
  const mk = pts => { const f = () => {}; f.pts = pts; return f; };
  const poly = pts => mk(pts.map(([x, y]) => g.tf(x, y)));
  const rr = (x, y, w, h, r = 0) => {
    r = Math.min(r || 0, w / 2, h / 2);
    const P = [];
    if (r > .03) { for (const [cx, cy, a0] of [[x + w - r, y + r, -1.5708], [x + w - r, y + h - r, 0], [x + r, y + h - r, 1.5708], [x + r, y + r, 3.1416]]) for (let i = 0; i <= 2; i++) { const a = a0 + i * .7854; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } }
    else P.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
    return mk(P.map(([a, b]) => g.tf(a, b)));
  };
  const circ = (x, y, r) => mk(mbCirc(x, y, r, r > .3 ? 12 : 8).map(([a, b]) => g.tf(a, b)));
  let nPart = 0;
  const part = (path, col) => {
    const h = nPart === 0 ? L.first : nPart === 1 && L.second ? L.second : .3;
    put(path.pts, h, sh(col), nPart === 0 ? { taper: L.taper ?? .1 } : {});
    nPart++;
  };
  const P = {
    g, side, paint, M: mat, shade: (hex, k) => typeof rlShade === 'function' ? rlShade(hex, k) : hex, poly, rr, circ, part,
    plate: (pts, col) => put(poly(pts).pts, .1, sh(col)),
    box: (x, y, w, h, col, o = {}) => { const glass = col === GLASS, hh = glass ? .07 : clamp(Math.min(w, h) * .5, .08, .42); put(rr(x - w / 2, y - h / 2, w, h, o.r ?? .05).pts, hh, glass ? -1 : sh(col), glass ? { flat: true } : {}); },
    disc: (x, y, r, col) => put(circ(x, y, r).pts, Math.min(.18, r * .6 + .04), sh(col)),
    hatch: (x, y, r) => { const z = put(circ(x, y, r).pts, .07, .92), c = g.tf(x, y); mbLoop(M, mbCirc(c[0], c[1], r * .7, 10), z + .005, .6); },
    peri: (x, y, w = .22, h = .1, a = 0) => {   // 潜望镜：小护框 + 一条发光的镜面
      g.save(); g.translate(x, y); g.rotate(a);
      const z = put(rr(-w / 2, -h / 2, w, h).pts, .13, .7);
      mbPrism(M, [g.tf(-w / 2 + .03, h / 2), g.tf(w / 2 - .03, h / 2), g.tf(w / 2 - .03, h / 2 + .03), g.tf(-w / 2 + .03, h / 2 + .03)], z - .1, z - .03, -1);
      g.restore();
    },
    cupola: (x, y, r, n = 6) => { put(circ(x, y, r).pts, .32, .95); for (let i = 0; i < n; i++) { const b = i / n * 6.2832; P.peri(x + Math.cos(b) * r * .82, y + Math.sin(b) * r * .82, .16, .08, b + 1.5708); } P.hatch(x, y, r * .62); },
    grille: (x0, y0, x1, y1, n = 6, across = true) => {   // 格栅：压低的深色面板 + 一排发光百叶线
      const z = put(rr(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)).pts, .03, .35, { flat: true });
      for (let i = 1; i < n; i++) { const u = i / n, a = across ? g.tf(lerp(x0, x1, u), y0) : g.tf(x0, lerp(y0, y1, u)), b = across ? g.tf(lerp(x0, x1, u), y1) : g.tf(x1, lerp(y0, y1, u)); mbLine(M, [a[0], a[1], z + .01], [b[0], b[1], z + .01], .5); }
    },
    era: (x0, y0, x1, y1, nx, ny) => { const cw = (x1 - x0) / nx, ch = (y1 - y0) / ny; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) put(rr(x0 + i * cw + .025, y0 + j * ch + .025, cw - .05, ch - .05).pts, .13, .95 + ((i * 7 + j * 3) % 3) * .05, { flat: true, taper: .02 }); },
    smoke: (x, y, n, a, sp = .17) => {   // 烟幕弹发射器：底座 + 一排斜向上的发射筒
      g.save(); g.translate(x, y); g.rotate(a);
      const z = put(rr(-.12, -n * sp / 2, .26, n * sp).pts, .14, .6, { flat: true });
      for (let i = 0; i < n; i++) { const yy = -n * sp / 2 + sp * (i + .5), p0 = g.tf(0, yy), p1 = g.tf(.32, yy); mbTube(M, [p0[0], p0[1], z], [p1[0], p1[1], z + .22], .06, .06, 6, .7); }
      g.restore();
    },
    light: (x, y, w = .22, h = .16) => put(rr(x - w / 2, y - h / 2, w, h).pts, .12, -.6, { flat: true }),
    cable: () => {}, bolts: () => {}, camo: () => {}, dirt: () => {},
    bag: (x, y, w, h, a = 0) => { g.save(); g.translate(x, y); g.rotate(a); put(rr(-w / 2, -h / 2, w, h, Math.min(w, h) * .35).pts, .26, .8, { taper: .06 }); g.restore(); },
    tool: (x, y, len, a = 0) => { g.save(); g.translate(x, y); g.rotate(a); put(rr(-len / 2, -.04, len, .08).pts, .06, .8, { flat: true }); g.restore(); },
    mg: (x, y, a = 0, len = 1.2, heavy = false) => {   // 机枪：机匣、枪管、弹箱
      g.save(); g.translate(x, y); g.rotate(a);
      const z = put(rr(-.25, -.08, .55, .16).pts, .16, .55, { flat: true }), p0 = g.tf(.25, 0), p1 = g.tf(.25 + len, 0);
      mbTube(M, [p0[0], p0[1], z - .06], [p1[0], p1[1], z - .06], heavy ? .055 : .035, heavy ? .05 : .03, 6, .5);
      put(rr(-.15, .08, .3, .2).pts, .16, .7, { flat: true });
      g.restore();
    },
    mesh: (x0, y0, x1, y1, items = 4) => {   // 尾舱网篮：底板 + 发光的网框 + 里面的帆布包
      const z0 = put(rr(x0, y0, x1 - x0, y1 - y0).pts, .06, .5), w = x1 - x0, h = y1 - y0;
      for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]]) { const A = g.tf(...a), B = g.tf(...b); mbLine(M, [A[0], A[1], z0 + .42], [B[0], B[1], z0 + .42], .8); mbLine(M, [A[0], A[1], z0], [A[0], A[1], z0 + .42], .8); }
      for (let i = 0; i < items; i++) { const r = Math.sin(i * 12.9 + x0) * .5 + .5; P.bag(x0 + w * (i % 2 ? .7 : .3) + (r - .5) * w * .15, y0 + h * (i + .5) / items, w * .38, h / items * .8, (r - .5) * .4); }
    },
    line: (x0, y0, x1, y1) => { const a = g.tf(x0, y0), b = g.tf(x1, y1), z = Math.max(at(a[0], a[1]), at(b[0], b[1])) + .012; mbLine(M, [a[0], a[1], z], [b[0], b[1], z], .7); },
    wheel: (x, y, l, w) => { const c = g.tf(x, y), r = l / 2; mbTube(M, [c[0], c[1] - w / 2, r], [c[0], c[1] + w / 2, r], r, r, 12, .4); mbTube(M, [c[0], c[1] - w / 2 - .01, r], [c[0], c[1] + w / 2 + .01, r], r * .45, r * .45, 8, .9); },
    cells: (x0, y0, x1, y1, nx, ny) => v3mCells(M, x0, x1, y0, y1, at((x0 + x1) / 2, (y0 + y1) / 2), nx, ny)
  };
  L.top = at;
  return P;
}

// ———————————————— 车辆（米） ————————————————
// 返回 { hull, tur, piv 炮塔转轴, top 座圈高度, rad: [x, y, r, z] 炮塔后的搜索雷达 }
function v3mVehicle(Mk, side) {
  const M0 = RLM[Mk], hull = mbNew(), tur = mbNew(), L = M0.L, B = M0.B, hl = L / 2, hb = B / 2, wheel = M0.run === 'w', tw = M0.tw || .6;
  // 行走机构（履带车）：带前后斜坡的履带 + 一排负重轮 + 主动轮 / 诱导轮，履带板画成发光短线；轮式车的车轮由模型自己画（P.wheel）
  if (!wheel) for (const s of [-1, 1]) {
    const y0 = s > 0 ? hb - tw : -hb, y1 = s > 0 ? hb : -hb + tw;
    mbSide(hull, [[-hl + .05, .55], [-hl + .55, .04], [hl - .7, .04], [hl - .05, .62], [hl - .25, .95], [-hl + .15, .9]], y0, y1, .32);
    const n = Math.max(5, Math.round((L - 1.6) / .95)), yo = s > 0 ? y1 + .005 : y0 - .005;
    for (let i = 0; i < n; i++) { const x = -hl + .85 + i * (L - 1.9) / (n - 1); mbTube(hull, [x, yo - s * .06, .36], [x, yo + s * .04, .36], .34, .34, 10, .55); mbTube(hull, [x, yo + s * .04, .36], [x, yo + s * .07, .36], .14, .14, 6, .9); }
    mbTube(hull, [hl - .42, yo - s * .06, .55], [hl - .42, yo + s * .06, .55], .3, .3, 8, .65);
    mbTube(hull, [-hl + .42, yo - s * .06, .5], [-hl + .42, yo + s * .06, .5], .28, .28, 8, .65);
    for (let x = -hl + .5; x < hl - .5; x += .45) mbLine(hull, [x, yo, .9], [x + .1, yo, .93], .35);
  }
  const HL = { base: wheel ? .55 : .62, first: wheel ? 1.35 : .5, second: wheel ? 0 : .58, taper: wheel ? .22 : .05 };
  const P = v3mPainter(hull, HL, side);
  try { M0.H(P); } catch (e) { mbPrism(hull, M0.hull, HL.base, HL.base + 1.1, 1, { taper: .2 }); }
  if (M0.mast) { const [mx, my, mr] = M0.mast, z = HL.top(mx, my); mbTube(hull, [mx, my, z], [mx, my, z + 1.6], .07, .05, 6, .6); mbBox(hull, mx - .08, mx + .08, my - mr, my + mr, z + 1.6, z + 1.85, .9); }
  let top = 0, piv = [0, 0], rad = null;
  if (M0.T && M0.tur) {
    piv = [M0.tur.x || 0, M0.tur.y || 0];
    top = HL.top(piv[0], piv[1]);
    const TL = { base: top, first: wheel ? .7 : .78, taper: .2 }, Q = v3mPainter(tur, TL, side);
    try { M0.T(Q); } catch (e) { mbPrism(tur, mbCirc(0, 0, Math.min(B * .38, 1.6), 8), top, top + .75, 1.1, { taper: .2 }); }
    const tz = TL.top(0, 0);
    for (const gn of [M0.gun, M0.gun2].filter(Boolean)) {
      const oy = gn.oy || 0, z = (gn.gat || gn.tube || gn.arm ? tz - .25 : top + Math.min(.45, (tz - top) * .55)), x0 = gn.x0, x1 = gn.x0 + gn.len, r = Math.max(gn.r, .05);
      if (gn.tube) { mbBox(tur, x0, x1, oy - r, oy + r, z - r, z + r, .8); mbLine(tur, [x1 + .01, oy - r * .6, z], [x1 + .01, oy + r * .6, z], 1); continue; }   // 导弹发射箱
      if (gn.arm) { mbBox(tur, x0, x1, oy - r, oy + r, z, z + r * 2, .7); continue; }   // 吊臂
      if (gn.gat) { const k = Math.min(4, gn.gat); for (let i = 0; i < k; i++) { const a = i / k * 6.2832; mbTube(tur, [x0, oy + Math.cos(a) * r * .6, z + Math.sin(a) * r * .6], [x1, oy + Math.cos(a) * r * .6, z + Math.sin(a) * r * .6], r * .3, r * .3, 5, .5, false); } continue; }   // 转管炮
      mbBox(tur, x0 - .35, x0 + .15, oy - r * 3.2, oy + r * 3.2, z - r * 2.6, z + r * 2.6, .85, { taper: .04 });   // 炮盾
      mbTube(tur, [x0, oy, z], [x1, oy, z], r * 1.15, r, 10, .62);
      if (gn.fe) mbTube(tur, [x0 + gn.fe[0], oy, z], [x0 + gn.fe[0] + gn.fe[1], oy, z], gn.fe[2] * 1.1, gn.fe[2] * 1.1, 10, .72);   // 抽烟装置
      if (gn.sl) for (let i = 1; i <= gn.sl; i++) { const x = x0 + gn.len * (.15 + .8 * i / (gn.sl + 1)); mbTube(tur, [x - .04, oy, z], [x + .04, oy, z], r * 1.35, r * 1.35, 10, .5); }   // 热护套箍
      if (gn.br) mbTube(tur, [x1 - .42, oy, z], [x1, oy, z], r * 1.6, r * 1.6, 8, .5);   // 炮口制退器
    }
    if (M0.radar) { const [rx, ry, rr] = M0.radar; rad = [rx, ry, rr, TL.top(rx, ry)]; mbTube(tur, [rx, ry, rad[3]], [rx, ry, rad[3] + .45], .12, .1, 6, .6); }
  }
  return { hull, tur, piv, top, rad };
}
// 搜索雷达天线（单独转）：一块长条反射面
function v3mRadar(rr) { const M = mbNew(); mbBox(M, -.06, .06, -rr, rr, 0, .45, .95, { taper: .02 }); mbLine(M, [.07, -rr, .22], [.07, rr, .22], 1); return M; }

// ———————————————— 步兵（米） ————————————————
// kind：rifle 步枪手 · mg 机枪手 · radio 通讯兵 · eng 工兵 · aa 单兵防空导弹 · at 反坦克火箭；prone 卧姿
// 3D 单兵（模型单位约 1 米，实例比例 V3_MAN）：按姿态生成——st 站姿瞄准 · w0–w3 行走四帧（两腿前后交替）· r0–r3 跑步四帧（前倾、步幅大、枪斜端胸前）·
//   kn 跪姿射击 · pr 卧倒 · c0 / c1 匍匐两帧 · dead 阵亡；兵种：步枪 · 机枪（弹链盒、脚架）· 反坦克（粗筒扛肩）· 防空（长筒、握把电池）·
//   通讯（电台、鞭状天线）· 工兵（锹、爆破包）· 狙击 / 观察（长枪、瞄准镜、伪装披挂）· 温压火箭（背两具发射筒）· 车组（坦克帽、短冲锋枪）
const V3_MAN = 1.9;
function v3mMan(kind, pose) {
  const M = mbNew(), dk = .45, s = 1;
  pose = pose || 'st';
  if (pose === 'pr' || pose === 'c0' || pose === 'c1' || pose === 'dead') return v3mManLow(M, kind, pose);
  const walk = pose[0] === 'w', run = pose[0] === 'r', ph = (+pose[1] || 0) * Math.PI / 2, kneel = pose === 'kn', clb = pose === 'cl0' || pose === 'cl1', crw = kind === 'pilot' || kind === 'deck';
  const amp = run ? .75 : walk ? .42 : 0, hz = kneel ? .6 : run ? .94 : 1, lean = run ? .3 : kneel ? .06 : 0, ox = z => (z - hz) * Math.sin(lean);
  // 腿：髋 → 膝 → 脚（tt 大腿前摆角、tk 屈膝角）；跪姿左脚在前、右膝着地
  const legs = kneel ? [[1.5, 1.5], [-.15, 1.62]] : clb ? (pose === 'cl0' ? [[1.05, 1.75], [.05, .1]] : [[.05, .1], [1.05, 1.75]]) : [-1, 1].map(sg => { const tt = amp * Math.sin(ph) * sg; return [tt, tt < 0 ? -tt * (run ? 1.7 : 1.15) + .06 : .08]; });   // 爬梯：一腿抬起踩上一级
  [-1, 1].forEach((sy, j) => {
    const [tt, tk] = legs[j], H0 = [0, sy * .11, hz], K = [H0[0] + .48 * Math.sin(tt), H0[1], H0[2] - .48 * Math.cos(tt)], ts = tt - tk;
    const F = [K[0] + .5 * Math.sin(ts), K[1], Math.max(.06, K[2] - .5 * Math.cos(ts))];
    mbTube(M, H0, K, .1, .09, 6, s); mbTube(M, K, F, .085, .075, 6, s);
    mbBox(M, F[0] - .1, F[0] + .17, sy * .11 - .07, sy * .11 + .07, F[2] - .06, F[2] + .06, dk);   // 靴
  });
  const zT = hz + .5, cx = ox(hz + .25);
  mbBox(M, -.12, .12, -.2, .2, hz - .08, hz + .05, .9, { taper: .02 });   // 腰带
  mbBox(M, -.14 + cx, .15 + cx, -.22, .22, hz + .04, zT, s, { taper: .04 });   // 躯干
  if (kind !== 'crew' && !crw) mbBox(M, .14 + cx, .2 + cx, -.18, .18, hz + .08, zT - .06, .8);   // 防弹插板、弹匣包
  if (crw) mbBox(M, -.16 + cx, .17 + cx, -.23, .23, hz + .15, zT - .08, kind === 'pilot' ? .7 : 1.05, { taper: .03 });   // 救生背心 / 甲板人员彩色马甲
  const hx = ox(zT + .15);
  mbPrism(M, mbCirc(hx, 0, .095, 8), zT, zT + .2, .9, { taper: .02 });   // 头
  if (kind === 'pilot') { mbPrism(M, mbCirc(hx - .02, 0, .16, 10), zT + .1, zT + .34, 1.15, { taper: .08 }); mbBox(M, hx + .1, hx + .15, -.1, .1, zT + .12, zT + .22, .12); }   // 飞行头盔（白）、深色面罩
  else if (kind === 'deck') { mbPrism(M, mbCirc(hx - .01, 0, .15, 10), zT + .13, zT + .3, 1.05, { taper: .06 }); for (const y of [-.15, .15]) mbBox(M, hx - .05, hx + .05, y - .04, y + .04, zT + .02, zT + .16, .3); }   // 护耳头盔
  else if (kind === 'crew') mbPrism(M, mbCirc(hx - .01, 0, .13, 10), zT + .12, zT + .28, .85, { taper: .05 });   // 坦克帽
  else { mbPrism(M, mbCirc(hx - .01, 0, .145, 10), zT + .14, zT + .32, 1.05, { taper: .07 }); mbBox(M, hx + .08, hx + .11, -.08, .08, zT + .12, zT + .16, -.5); }   // 钢盔、护目镜反光
  // 背后
  const bx = ox(hz + .25);
  if (kind === 'radio') { mbBox(M, -.38 + bx, -.14 + bx, -.13, .13, hz + .05, zT - .02, .7); mbLine(M, [-.32 + bx, .08, zT - .02], [-.42 + bx, .1, zT + 1.1], 1); }   // 电台、鞭状天线
  else if (kind === 'flame') { for (const y of [-.1, .1]) mbTube(M, [-.3 + bx, y, hz + .02], [-.3 + bx, y, zT + .3], .07, .07, 8, .7); }   // 背两具 PF-97
  else if (kind !== 'crew' && !crw) mbBox(M, -.32 + bx, -.14 + bx, -.17, .17, hz + .02, zT - .04, .75, { taper: .04 });   // 背包
  if (kind === 'eng') { mbBox(M, -.37 + bx, -.31 + bx, -.05, .05, hz + .1, zT + .25, .8); mbBox(M, -.38 + bx, -.3 + bx, -.12, .12, zT + .22, zT + .42, .9); }   // 背上的工兵锹
  if (kind === 'mg') mbBox(M, -.34 + bx, -.12 + bx, .1, .26, hz - .05, hz + .2, .6);   // 备用弹链箱
  if (kind === 'medic') mbBox(M, -.05 + cx, .12 + cx, .2, .31, hz - .14, hz + .1, .85);   // 卫生兵：腰侧急救包
  if (kind === 'mortar' && (walk || run)) mbBox(M, -.42 + bx, -.35 + bx, -.2, .2, hz + .08, zT - .02, .6);   // 迫击炮座钣背在背上
  if (kind === 'sniper' || kind === 'spot') for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832; mbLine(M, [cx + Math.cos(a) * .2, Math.sin(a) * .25, zT - .02], [cx + Math.cos(a) * .32 - .05, Math.sin(a) * .36, hz + .2], .55); }   // 伪装披挂
  // 武器与手臂：瞄准时枪平端；跑步时枪斜端胸前
  const gz = zT - .26 + (kneel ? .02 : 0), sz = zT - .05, shoulderW = kind === 'at' || kind === 'aa' || kind === 'flame' || kind === 'mortar';
  const RS = [cx, .24, sz], LS = [cx, -.24, sz], still = !walk && !run, sling = () => mbTube(M, [-.25 + bx, -.18, hz + .05], [-.2 + bx, .18, zT + .25], .022, .02, 6, dk, false);   // 两肩；斜挎在背上的步枪
  if (crw) {   // 飞行员、甲板人员：不带枪——爬梯时两手交替往上抓、弹射官（kn）右臂直指舰首、跑步两臂前后摆
    if (clb) { const up = pose === 'cl0' ? 1 : -1; mbTube(M, RS, [cx + .32, .2, sz + .35 + up * .18], .06, .05, 6, s); mbTube(M, LS, [cx + .32, -.2, sz + .35 - up * .18], .06, .05, 6, s); }
    else if (kneel || pose === 'pt') { mbTube(M, RS, [cx + .78, .3, sz + .08], .06, .05, 6, s); mbTube(M, LS, [cx + .1, -.32, sz - .45], .06, .05, 6, s); }
    else { const sw = (walk || run) ? Math.sin(ph) * .35 : 0; mbTube(M, RS, [cx + sw, .3, sz - .5], .06, .05, 6, s); mbTube(M, LS, [cx - sw, -.3, sz - .5], .06, .05, 6, s); }
    return M;
  }
  if (kind === 'mortar' && still) {   // 架好的迫击炮：座钣、约 60° 仰角的炮身、两脚架；右手在炮口装填，左手扶脚架
    const f0 = cx + .2;
    mbBox(M, f0 - .12, f0 + .12, .14, .38, 0, .03, dk);
    mbTube(M, [f0, .26, .03], [f0 + .36, .26, .66], .05, .045, 8, .7);
    mbTube(M, [f0 + .26, .26, .5], [f0 + .42, .1, 0], .014, .014, 4, dk); mbTube(M, [f0 + .26, .26, .5], [f0 + .42, .42, 0], .014, .014, 4, dk);
    mbTube(M, RS, [f0 + .32, .26, .72], .06, .05, 6, s); mbTube(M, LS, [f0 + .2, .16, .46], .06, .05, 6, s);
  } else if (kind === 'fo' && pose === 'st') {   // 观察员：双手举望远镜到眼前，步枪斜挎背上
    const bz = zT + .1, b0 = hx + .13;
    mbBox(M, b0, b0 + .13, -.09, .09, bz - .045, bz + .045, dk);
    mbTube(M, RS, [b0, .08, bz - .03], .06, .05, 6, s); mbTube(M, LS, [b0, -.08, bz - .03], .06, .05, 6, s);
    sling();
  } else if (kind === 'officer' && pose === 'st') {   // 指挥员：左手拿平板，右手指向前方，卡宾枪斜挎背上
    mbBox(M, cx + .2, cx + .38, -.22, -.04, gz, gz + .025, .9);
    mbTube(M, LS, [cx + .26, -.14, gz], .06, .05, 6, s); mbTube(M, RS, [cx + .74, .32, sz + .1], .06, .05, 6, s);
    sling();
  } else if (run && !shoulderW) {
    const A = [cx + .1, .22, gz - .1], B = [cx + .62, -.22, gz + .32];
    mbTube(M, A, B, .03, .025, 6, dk, false); mbBox(M, A[0] + .12, A[0] + .3, .05, .12, gz - .05, gz + .08, dk);
    mbTube(M, RS, [A[0] + .15, .18, gz - .02], .06, .05, 6, s); mbTube(M, LS, [B[0] - .2, -.12, gz + .2], .06, .05, 6, s);
  } else if (shoulderW) {   // 扛肩的发射筒
    const len = kind === 'aa' ? 1.65 : kind === 'flame' ? 1.25 : kind === 'mortar' ? 1 : 1.35, r = kind === 'at' ? .09 : kind === 'aa' ? .07 : kind === 'mortar' ? .065 : .08, sx = cx - (kind === 'aa' ? .65 : .45);
    mbTube(M, [sx, .2, sz + .08], [sx + len, .2, sz + .12], r, r, 8, .7);
    if (kind === 'at') mbBox(M, cx + .05, cx + .22, .3, .4, sz + .02, sz + .18, .6);   // 瞄准镜
    if (kind === 'aa') { mbBox(M, cx + .1, cx + .3, .3, .42, sz + .05, sz + .2, .6); mbBox(M, cx - .05, cx + .05, .2, .28, sz - .1, sz + .02, dk); mbLine(M, [cx + .35, .2, sz + .2], [cx + .35, .2, sz + .45], .9); }   // 握把电池、敌我识别天线
    mbTube(M, RS, [cx + .22, .2, sz], .06, .05, 6, s); mbTube(M, LS, [cx + .55, .12, sz + .05], .06, .05, 6, s);
  } else {
    const gl = kind === 'mg' ? .95 : kind === 'sniper' ? 1.1 : kind === 'crew' ? .35 : .75, x0 = cx + (kneel ? .02 : 0);
    mbBox(M, x0 - .1, x0 + .35, 0, .07, gz - .06, gz + .07, dk);   // 机匣
    if (kind !== 'crew') mbBox(M, x0 - .32, x0 - .08, 0, .06, gz - .1, gz + .03, dk);   // 枪托
    mbTube(M, [x0 + .35, .035, gz + .02], [x0 + .35 + gl, .035, gz + .02], kind === 'mg' ? .03 : .022, .02, 6, dk, false);   // 枪管
    mbBox(M, x0 + .12, x0 + .22, .01, .06, gz - .28, gz - .06, dk);   // 弹匣
    if (kind === 'mg') { mbBox(M, x0, x0 + .25, .06, .2, gz - .2, gz - .02, .6); mbTube(M, [x0 + .9, .03, gz], [x0 + .95, .14, gz - .25], .012, .012, 4, dk); }   // 弹链盒、两脚架
    if (kind === 'sniper') mbTube(M, [x0 + .05, .035, gz + .11], [x0 + .38, .035, gz + .11], .035, .035, 6, .6);   // 瞄准镜
    mbTube(M, RS, [x0 + .18, .2, gz - .14], .06, .055, 6, s); mbTube(M, [x0 + .18, .2, gz - .14], [x0 + .32, .08, gz - .02], .055, .05, 6, s);
    mbTube(M, LS, [x0 + .14, -.18, gz - .16], .06, .055, 6, s); mbTube(M, [x0 + .14, -.18, gz - .16], [x0 + .45, -.02, gz - .02], .055, .05, 6, s);
  }
  return M;
}
// 卧倒 / 匍匐 / 阵亡：贴地的身体（匍匐两帧：一侧膝盖收起、对侧手臂前伸）
function v3mManLow(M, kind, pose) {
  const s = 1, dk = .45, dead = pose === 'dead', c = pose === 'c0' ? 1 : pose === 'c1' ? -1 : 0;
  for (const sy of [-1, 1]) {
    const up = c * sy > 0, kx = up ? -.62 : -.9, ky = sy * (up ? .34 : .17);
    mbTube(M, [-.2, sy * .11, .14], [kx, ky, .12], .1, .09, 6, s); mbTube(M, [kx, ky, .12], [up ? -.95 : -1.32, sy * (up ? .3 : .2), .1], .085, .075, 6, s);
    mbBox(M, (up ? -.95 : -1.32) - .15, (up ? -.95 : -1.32) + .05, sy * (up ? .3 : .2) - .07, sy * (up ? .3 : .2) + .07, .02, .16, dk);
  }
  mbBox(M, -.25, .38, -.24, .24, 0, .32, s, { taper: .05 });   // 躯干（防弹衣）
  if (kind !== 'crew') mbBox(M, -.2, .25, -.18, .18, .32, .45, .8, { taper: .04 });   // 背包
  if (kind === 'radio' && !dead) mbLine(M, [-.15, .1, .45], [-.75, .15, 1.2], 1);
  mbPrism(M, mbCirc(.5, 0, .12, 8), .05, .3, .9, { taper: .03 });   // 头
  mbPrism(M, mbCirc(.5, 0, .15, 8), .2, .36, 1.05, { taper: .06 });   // 头盔
  for (const sy of [-1, 1]) { const fw = c * sy < 0 ? .2 : 0; mbTube(M, [.3, sy * .2, .18], [.75 + fw, sy * (.12 + fw * .4), .12], .06, .05, 6, s); }   // 胳膊
  if (dead) { mbTube(M, [.9, .55, .05], [1.9, .95, .05], .03, .025, 6, dk, false); return M; }   // 枪脱手落在一旁
  const gl = kind === 'mg' ? 1.5 : kind === 'sniper' ? 1.6 : kind === 'at' || kind === 'aa' ? 1.35 : 1.1, r = kind === 'at' ? .08 : kind === 'aa' ? .06 : .035;
  mbTube(M, [.2, .04, .14], [.6 + gl, .04, .16], r, r * .85, 6, kind === 'at' || kind === 'aa' ? .7 : dk, false);   // 枪 / 发射筒
  mbBox(M, .35, .75, 0, .08, .08, .2, dk);
  if (kind === 'mg') { mbTube(M, [1.3, 0, .16], [1.45, -.12, 0], .015, .015, 4, dk); mbTube(M, [1.3, .08, .16], [1.45, .2, 0], .015, .015, 4, dk); }   // 两脚架
  if (kind === 'sniper') mbTube(M, [.55, .04, .27], [.9, .04, .27], .035, .035, 6, .6);
  return M;
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
  mbLoop(M, H, fb + .03, .9);
  return M;
}
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
  mbLoop(M, H, fb + .03, .9);
  return M;
}
// 航母（舰体坐标 u 向舰首、v 向右舷；carrier.js CVG，1 单位约 1 米）：照 003 型福建舰——
//   舰体：水线宽约 40，往上明显外飘（到机库甲板高度约宽 54），舰首尖、舰尾方；飞行甲板（含两舷外伸的舷台）厚约 5，右舷前后两部升降机处留缺口，
//   缺口下方舰体侧面是机库门；舰首两舷白色舷号「18」
//   舰岛（右舷中后部）：底层甲板室、尾部烟囱（两个排烟口）、四面有源相控阵层、驾驶室（玻璃窗带）、八角形一体化桅杆与顶部天线罩
//   甲板：三条电磁弹射器滑轨、斜角着舰区边线与中线、三道拦阻索、安全线、舰首舰尾舷号；四角近防炮 / 红旗-10 舷台、左舷后部着舰指挥官平台
//   升降机平台、偏流板另外实例化（会动）；075 型两栖攻击舰（lhd）用直通甲板、舰岛偏后、甲板标直升机起降点
const V3_CVB = [[154, 0], [140, 7], [112, 14], [80, 18.5], [40, 20], [-80, 20], [-140, 19], [-155, 16.5], [-155, -16.5], [-140, -19], [-80, -20], [40, -20], [80, -18.5], [112, -14], [140, -7]];   // 水线：飞剪型舰首、方尾
const V3_ZH = 12;   // 舰体外飘到这个高度，再往上是飞行甲板（含舷台）
// 七段式数字（舷号）：P(x, y) 把字格坐标（x 0–1 宽、y 0–1 高）换成 3D 点
function v3mDigits(M, str, P, s = 1) {
  const SEG = { 1: [[.6, 0, .6, 1], [.6, 1, .32, .8]], 8: [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0], [0, .5, 1, .5]] };
  [...str].forEach((ch, i) => { for (const [a, b, c, d] of SEG[ch] || []) mbLine(M, P(i * 1.45 + a, b), P(i * 1.45 + c, d), s); });
}
function v3mCarrier(lhd) {
  const M = mbNew(), C = typeof CVG === 'object' ? CVG : null, D = C ? C.deck : [[158, 0], [-158, 30], [-158, -30]], zh = V3_ZH, zd = C ? C.zd : 17;
  // 舰体：水线轮廓 → 外飘的上沿（逐点连成侧面），上面压着飞行甲板
  // 两段折面：水线 → 舷侧折角线（硬舭，稍外飘）→ 上沿大幅外飘接飞行甲板；折角线描一道亮边，舷侧不是圆滑的一整块
  const T = V3_CVB.map(([u, v]) => [u + (u > 100 ? 6 : u < -140 ? -2 : 0), v * 1.35]), K = V3_CVB.map(([u, v]) => [u + (u > 100 ? 2.5 : u < -140 ? -1 : 0), v * 1.1]), zk = zh * .55, ctr = [0, 0, zh / 2];
  for (let i = 0; i < V3_CVB.length; i++) {
    const j = (i + 1) % V3_CVB.length;
    mbQuad(M, [V3_CVB[i][0], V3_CVB[i][1], 0], [V3_CVB[j][0], V3_CVB[j][1], 0], [K[j][0], K[j][1], zk], [K[i][0], K[i][1], zk], .7, ctr);
    mbQuad(M, [K[i][0], K[i][1], zk], [K[j][0], K[j][1], zk], [T[j][0], T[j][1], zh], [T[i][0], T[i][1], zh], .78, ctr);
  }
  mbLoop(M, K, zk + .02, .55);
  mbPrism(M, D, zh, zd, .7, { top: .5, bottom: true });   // 飞行甲板与舷台
  mbLine(M, [-156, -14, zh - 1], [-156, 14, zh - 1], .5);   // 舰尾甲板（飞行甲板下的系泊甲板）
  mbBox(M, -157, -153, -13, 13, zh - 4, zh, .15);
  if (C) for (const E of C.el) {   // 升降机：舷侧机库门、平台降下时露出的井底
    mbBox(M, E.u - 10, E.u + 10, 22, 27.6, zd - C.hang, zh, .12);
    mbBox(M, E.u - 11, E.u + 11, 26, 34, zd - C.hang - .3, zd - C.hang, .15);
  }
  // 舷号「18」：两舷靠舰首（从舷外看都是正的）
  for (const sg of [1, -1]) v3mDigits(M, '18', (x, y) => [sg > 0 ? 112 + x * 6 : 124 - x * 6, sg * (16.4 + y * 2.5), 4 + y * 7], .95);
  // 舰岛
  if (lhd) {
    const isl = [-38, -8, 11, 15.5].map(x => x * 2);
    v3mDeck(M, isl[0], isl[1], isl[2], isl[3], zd, zd + 9, .9, true);
    v3mDeck(M, isl[0] + 8, isl[1] - 4, isl[2] + 1.2, isl[3] - 1.2, zd + 9, zd + 17, .95, true);
    mbPrism(M, mbRect(isl[0] + 14, isl[1] - 10, isl[2] + 2.4, isl[3] - 2.4), zd + 17, zd + 27, .9, { taper: 2.4 });
  } else if (C) {
    const [u0, u1, v0, v1] = C.isl, vm = (v0 + v1) / 2;
    mbBox(M, u0, u1, v0, v1, zd, zd + 6, .84, { taper: .1 });   // 底层甲板室
    mbPrism(M, mbRect(u0, u0 + 9, v0 + 1.5, v1 - 1.5), zd + 6, zd + 15, .8, { taper: .8 });   // 烟囱
    for (const v of [vm - 1.7, vm + 1.7]) mbBox(M, u0 + 2.6, u0 + 6.6, v - 1, v + 1, zd + 15, zd + 15.25, .1);   // 排烟口
    mbBox(M, u0 + 9, u1 - 2, v0 + .6, v1 - .6, zd + 6, zd + 12, .9, { taper: .25 });   // 相控阵层
    const pz0 = zd + 6.6, pz1 = zd + 11.4, pu0 = u0 + 14, pu1 = u0 + 27;
    for (const [v, d] of [[v0 + .6, -1], [v1 - .6, 1]]) mbBox(M, pu0, pu1, Math.min(v, v + d * .18), Math.max(v, v + d * .18), pz0, pz1, .28);   // 两舷两面阵
    mbBox(M, u1 - 2.05, u1 - 1.85, v0 + 2.2, v1 - 2.2, pz0, pz1, .28);   // 前向阵面
    for (const [v, d] of [[v0 + .6, -1], [v1 - .6, 1]]) { const vv = v + d * .19; mbLoop(M, [[pu0 + .4, vv], [pu1 - .4, vv], [pu1 - .4, vv], [pu0 + .4, vv]], pz0 + .4, .5); mbLine(M, [pu0 + .4, vv, pz0 + .4], [pu0 + .4, vv, pz1 - .4], .5); mbLine(M, [pu1 - .4, vv, pz0 + .4], [pu1 - .4, vv, pz1 - .4], .5); mbLine(M, [pu0 + .4, vv, pz1 - .4], [pu1 - .4, vv, pz1 - .4], .5); }
    v3mDeck(M, u0 + 16, u1 - 4, v0 + 1.4, v1 - 1.4, zd + 12, zd + 15.5, .95, true);   // 驾驶室（玻璃窗带）
    mbBox(M, u0 + 17, u0 + 30, v0 + 1.3, v0 + 1.45, zd + 13.1, zd + 14.5, -1);   // 舰岛朝甲板一侧：飞行指挥所窗
    const mu = u0 + 23, mz = zd + 15.5;
    mbPrism(M, [[mu + 3.4, vm], [mu + 1.6, vm - 2.8], [mu - 2.6, vm - 2.8], [mu - 3.4, vm], [mu - 2.6, vm + 2.8], [mu + 1.6, vm + 2.8]], mz, mz + 11, .9, { taper: 1.3 });   // 一体化桅杆（前尖的六棱台，平面阵面，向上收窄）
    mbBox(M, mu - 1.5, mu + 1.5, vm - 1.3, vm + 1.3, mz + 11, mz + 13.2, 1, { taper: .5 });   // 顶部方形天线罩
    mbLine(M, [mu, vm, mz + 13.2], [mu, vm, mz + 17.5], .9); mbLine(M, [mu, vm - 3.6, mz + 8.5], [mu, vm + 3.6, mz + 8.5], .8);   // 天线、横桁
    for (const a of [.39, 1.96, 3.53, 5.1]) { const x = mu + Math.cos(a) * 2.25, y = vm + Math.sin(a) * 2.25; mbLine(M, [x, y, mz + 2], [x, y, mz + 7], .6); }   // 桅杆面上的小型阵面
  }
  // 甲板标线
  const z = zd + .03;
  mbLoop(M, D, z, .9);
  if (!lhd && C) {
    const L = C.land, a = Math.atan2(L.v1 - L.v0, L.u1 - L.u0), nx = -Math.sin(a), ny = Math.cos(a), at = t => [lerp(L.u0, L.u1, t), lerp(L.v0, L.v1, t)];
    for (const sg of [-1, 1]) mbLine(M, [L.u0 + nx * L.hw * sg, L.v0 + ny * L.hw * sg, z], [L.u1 + nx * L.hw * sg, L.v1 + ny * L.hw * sg, z], .7);   // 着舰区边线
    for (let t = .02; t < .98; t += .07) { const [u, v] = at(t), [u2, v2] = at(t + .035); mbLine(M, [u, v, z], [u2, v2, z], .9); }   // 中线虚线
    for (let t = 0; t < .98; t += .05) { const [u, v] = at(t), [u2, v2] = at(t + .025), o = L.hw + 2.5; mbLine(M, [u + nx * o, v + ny * o, z], [u2 + nx * o, v2 + ny * o, z], .55); }   // 右侧安全线
    for (const t of C.wires) { const [u, v] = at(t); mbLine(M, [u + nx * 15, v + ny * 15, z + .1], [u - nx * 15, v - ny * 15, z + .1], 1); }   // 拦阻索
    for (const c of C.cats) { const ca = Math.cos(c.a), sa = Math.sin(c.a); mbLine(M, [c.u, c.v, z], [c.u + ca * c.L, c.v + sa * c.L, z], 1); for (const o of [-2.2, 2.2]) mbLine(M, [c.u - sa * o, c.v + ca * o, z], [c.u + ca * c.L - sa * o, c.v + sa * c.L + ca * o, z], .45); }   // 弹射器滑轨
    for (let u = 62; u < 150; u += 9) mbLine(M, [u, 0, z], [u + 4.5, 0, z], .5);   // 舰首中线
    v3mDigits(M, '18', (x, y) => [120 + y * 12, -6.5 + x * 4.6, z], .9);   // 甲板舷号（字头朝舰首，从舰尾方向看是正的）
    v3mDigits(M, '18', (x, y) => [-152 + y * 10, 8 + x * 3.8, z], .8);
    // 近防炮 / 红旗-10 舷台、着舰指挥官平台
    for (const [u, v] of [[144, -19], [136, 23], [-148, -20], [-150, 30]]) { mbPrism(M, mbCirc(u, v, 2.4, 10), zd - 1, zd + 1.5, .82, { taper: .5 }); mbTube(M, [u, v, zd + 1.1], [u + (u > 0 ? 3 : -3), v, zd + 1.5], .18, .15, 6, .6); }
    mbBox(M, -124, -115, -30, -24, zd - 1.2, zd - .2, .7);
  } else for (let k = 0; k < 6; k++) mbLoop(M, mbCirc(100 - k * 44, -8, 6, 10), z, .8);
  return M;
}
// 升降机平台（中心为原点，顶面 z = 0）：黄色边框、防滑分块线
function v3mCvEl(L, B) {
  const M = mbNew(), hl = L / 2, hb = B / 2;
  mbBox(M, -hl, hl, -hb, hb, -1.2, 0, .55, { top: .5 });
  mbLoop(M, mbRect(-hl + .3, hl - .3, -hb + .3, hb - .3), .04, .95);
  for (const x of [-hl / 3, hl / 3]) mbLine(M, [x, -hb + .3, .04], [x, hb - .3, .04], .4);
  return M;
}
// 偏流板（铰链在局部 x 轴上，板子往 +y 伸 5；实例按滚转角翻起）
function v3mCvJbd() {
  const M = mbNew();
  mbBox(M, -8, 8, 0, 5, 0, .5, .72, { top: .8 });
  for (let x = -6; x <= 6; x += 3) mbLine(M, [x, .2, .52], [x, 4.8, .52], .55);
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

// ———————————————— 飞机（世界单位，平面轮廓同二维剪影，机头 +x、长约 21） ————————————————
const V3_PLANE_TAIL = { j20: 'twin', j35: 'twin', j15: 'twin', f35: 'twin', f22: 'twin', a10: 'twin', kj600: 'end', wz7: 'twin', gj2: 'v', h6k: 'one', transport: 't', y20: 't', c17: 't', p8: 'one', z10: 'heli', heli: 'heli', ah64: 'heli', uh60: 'heli', gj11: 'none', b2: 'none', j36: 'none', j50: 'none' };
const V3_PLANE_ENG = { h6k: [[-.5, 4.4, 1.1]], transport: [[-.4, 4.2, .9], [-2.2, 7.4, .85]], y20: [[-.4, 4.2, .9], [-2.2, 7.4, .85]], c17: [[-.6, 4.4, .9], [-2.6, 7.6, .85]], p8: [[-.5, 4.8, .9]], kj600: [[2, 4.2, .6]] };
// —— 精细飞机（与二维 airmdl.js 的 AIRD 同一套分件数据、同一单位）——
//   机身按半宽剖面放样：隐身机是两侧棱线的六边形截面（棱线发光），其余是上圆下扁的椭圆截面（平滑法线、只描轮廓）；
//   机翼 / 平尾 / 鸭翼有厚度，上单翼压在机身上，T 形尾的平尾架在垂尾顶；外倾垂尾、玻璃座舱（写实画面是蓝灰玻璃，黑绿画面发光）、
//   进气道与排气槽（暗）、喷口、发动机短舱、翼下挂架、背负雷达罩、直升机桨毂与尾桨；外挂弹药、主旋翼、螺旋桨另外实例化（随消耗、随转动）
//   fold：舰载机停在甲板上，外翼沿折叠线竖起
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
function v3mLoft(M, prof, sec, s) {
  const zc = V3_AIRZ, P = prof.map(([x, w], i) => [x, Math.max(w, i === 0 ? .05 : .08)]), n = P.length;
  const S6 = [[1, 0], [.55, 1], [-.55, 1], [-1, 0], [-.6, -1], [.6, -1]], S8 = [[1, -.15], [1, .42], [.6, 1], [-.6, 1], [-1, .42], [-1, -.15], [-.62, -1], [.62, -1]], SE = Array.from({ length: 14 }, (_, i) => { const a = i / 14 * 6.2832; return [Math.cos(a), Math.sin(a)]; });
  const SEC = sec.sh === 'heli' ? S8 : sec.facet ? S6 : SE, kz = cz => cz > 0 ? sec.kt : sec.kb;   // 直升机：竖直平侧板、斜切的肩部与机腹（武装直升机的多面体机身），不是圆筒
  const ring = (x, w) => SEC.map(([cy, cz]) => [x, w * cy, zc + w * cz * kz(cz)]);
  const slope = i => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; return (b[1] - a[1]) / ((b[0] - a[0]) || -1); };
  const nrm = (i, k) => { const [cy, cz] = SEC[k], v = [-slope(i) * .7, cy, cz / Math.max(.3, kz(cz))], l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const Rg = P.map(([x, w]) => ring(x, w));
  for (let i = 1; i < n; i++) {
    const A = Rg[i - 1], B = Rg[i], mx = (P[i][0] + P[i - 1][0]) / 2;
    for (let k = 0; k < SEC.length; k++) {
      const j = (k + 1) % SEC.length;
      if (sec.facet) {   // 棱线机身：每块平面明暗，只描纵向棱线（不描剖面站之间的横缝）
        let nn = mbNorm(mbCross(mbSub(A[j], A[k]), mbSub(B[k], A[k])));
        const m0 = [(A[k][0] + B[j][0]) / 2 - mx, (A[k][1] + B[j][1]) / 2, (A[k][2] + B[j][2]) / 2 - zc];
        if (nn[0] * m0[0] + nn[1] * m0[1] + nn[2] * m0[2] < 0) nn = [-nn[0], -nn[1], -nn[2]];
        mbTri(M, A[k], A[j], B[j], s, [1, 0, i === 1 ? 1 : 0], nn); mbTri(M, A[k], B[j], B[k], s, [i === n - 1 ? 1 : 0, 1, 0], nn);
      }
      else { mbTriN(M, A[k], A[j], B[j], nrm(i - 1, k), nrm(i - 1, j), nrm(i, j), s, [0, 0, i === 1 ? 1 : 0]); mbTriN(M, A[k], B[j], B[k], nrm(i - 1, k), nrm(i, j), nrm(i, k), s, [i === n - 1 ? 1 : 0, 0, 0]); }
    }
  }
  const L = Rg[n - 1], xe = P[n - 1][0];
  for (let k = 0; k < L.length; k++) mbTri(M, [xe, 0, zc], L[(k + 1) % L.length], L[k], s * .55, [1, 0, 0], [-1, 0, 0]);   // 尾端
}
// 机身某处的半宽（剖面插值）
function v3AirHw(D, x) {
  const P = D.body || [];
  for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  return P.length ? Math.max(...P.map(p => p[1])) * .5 : 1;
}
// opt：{ gear 放下起落架（停在甲板 / 地面、滑行时；轮子在 z = −V3_GEAR），cpo 座舱盖打开的程度 0–1（后铰链掀起，露出座舱） }；fold 0–1 外翼折起的程度
function v3mAir(key, fold, opt = {}) {
  fold = fold === true ? 1 : +fold || 0;
  const M = mbNew(), D = AIRD[key], sec = v3AirSec(D), zc = V3_AIRZ, hw0 = D.body ? Math.max(...D.body.map(b => b[1])) : 1.5, top = hw0 * sec.kt, bot = hw0 * sec.kb;
  const mir = P => P.map(([x, y]) => [x, -y]).reverse(), topAt = x => zc + v3AirHw(D, x) * sec.kt;
  const zw = D.hi ? zc + top * .82 : zc - bot * .35, thW = D.hi || D.tt ? .16 : .1;
  // 机翼（飞翼：整块带厚度、边缘收薄）
  if (D.flat) mbPrism(M, [...D.wing, ...mir(D.wing).slice(D.wing[D.wing.length - 1][1] === 0 ? 1 : 0, D.wing[0][1] === 0 ? -1 : undefined)], zc - bot * .9, zc + top * .75, .85, { top: .92, taper: .7 });
  else if (D.wing) {
    const W = fold && D.fold ? adClipY(D.wing, D.fold) : D.wing;
    for (const P of [W, mir(W)]) mbPrism(M, P, zw - thW, zw + thW, .82, { top: .9, taper: .03 });
    if (fold && D.fold) { const c = adChordAt(D.wing, D.fold), ph = fold * Math.PI / 2, h = (Math.max(...D.wing.map(p => p[1])) - D.fold) * .9, dy = h * Math.cos(ph), dz = h * Math.sin(ph); if (c) for (const sg of [1, -1]) { const y = D.fold * sg; mbQuad(M, [c[0], y, zw], [c[1], y, zw], [c[1] + .3, y + dy * sg, zw + dz], [c[0] - .6, y + dy * sg, zw + dz], .8); } }   // 折起的外翼（绕折叠线翻起，竖直 = 完全折起）
  }
  if (D.wing2) for (const P of [D.wing2, mir(D.wing2)]) mbPrism(M, P, zc + top * .6, zc + top * .6 + .14, .8);   // 无侦-7 的后翼（连翼）
  if (D.cnd) for (const P of [D.cnd, mir(D.cnd)]) mbPrism(M, P, zc + top * .25, zc + top * .25 + .12, .85);
  // 机身、尾椎、背部鼓包
  if (D.body) v3mLoft(M, D.body, sec, .92);
  if (D.tail) mbPrism(M, [...D.tail, ...mir(D.tail).slice(1)], zc - .35, zc + .35, .8, { taper: .2 });
  if (D.hump) mbPrism(M, mbCirc(D.hump[0], 0, D.hump[2], 10).map(([x, y]) => [D.hump[0] + (x - D.hump[0]) * D.hump[1] / D.hump[2], y]), topAt(D.hump[0]) - .2, topAt(D.hump[0]) + .45, .95, { taper: .35 });
  // 短舱：翼下吊舱 / 机身旁（A-10 尾部、阿帕奇两侧、轰-6K 翼根、直升机顶部、歼-15 两台发动机）
  for (const [x0, x1, y, r, k] of D.nac || []) for (const sg of [1, -1]) {
    const z = k === 'dn' ? zw - r * .95 : zc + (V3_NUP[key] ?? .3);
    const ns = D.heli ? 6 : 12;   // 直升机发动机舱：六棱的整流罩（有棱有角）
    mbTube(M, [x0, y * sg, z], [x1, y * sg, z], r * .9, r * .78, ns, .88);
    mbTube(M, [x0 + .05, y * sg, z], [x0 - .15, y * sg, z], r * .62, r * .62, D.heli ? 6 : 10, .2);   // 进气口（暗）
    if (k === 'dn') mbBox(M, x0 - (x0 - x1) * .65, x1 + .4, y * sg - .1, y * sg + .1, z + r * .7, zw, .7);   // 吊挂
  }
  // 平尾 / T 形尾、垂尾
  const fin = (x, c, y, h, cant, sw, zr) => {
    const off = h * Math.sin(cant), hz = h * Math.cos(cant), tc = c * .45;
    for (const sg of y ? [1, -1] : [1]) {
      const P = [[x, y * sg, zr], [x - c, y * sg, zr], [x - sw - tc, (y + off) * sg, zr + hz], [x - sw, (y + off) * sg, zr + hz]];
      mbQuad(M, P[0], P[1], P[2], P[3], .8); mbQuad(M, P[3], P[2], P[1], P[0], .8);
      const nx = 0, ny = .07 * Math.cos(cant) * sg, nz = -.07 * Math.sin(cant);   // 两层薄板之间封边（有厚度）
      mbQuad(M, P[0].map((v, i) => v + [nx, ny, nz][i]), P[1].map((v, i) => v + [nx, ny, nz][i]), P[2].map((v, i) => v + [nx, ny, nz][i]), P[3].map((v, i) => v + [nx, ny, nz][i]), .8);
    }
    return zr + hz;
  };
  let finTop = zc + top;
  if (D.fin) { const [x, c, y, h, cant, sw] = D.fin; finTop = fin(x, c, y, h * 1.05, cant, sw, y ? topAt(x - c / 2) - .1 : topAt(x - c / 2) - .15); }
  if (D.fin4) for (const [x, c, y, h] of D.fin4) fin(x, c, y, h, 0, .5, zc + .2);
  if (D.stab) { const zs = D.tt ? finTop - .05 : zc + top * .15, t = D.tt ? .1 : .08; for (const P of [D.stab, mir(D.stab)]) mbPrism(M, P, zs - t, zs + t, .84, { top: .88 }); }
  // 座舱：气泡（玻璃）、串列双座、大飞机风挡
  if (D.cp) {
    const [x0, x1, w, kd] = D.cp, cx = (x0 + x1) / 2, rx = (x1 - x0) / 2, zb = topAt(cx);
    const dome = (cx, rx, ry, z0, h, T = M) => mbPrism(T, (D.heli ? [[1, 0], [.45, .8], [-.55, 1], [-1, .7], [-1, -.7], [-.55, -1], [.45, -.8]] : mbCirc(0, 0, 1, 14)).map(([a, b]) => [cx + a * rx, b * ry]), z0, z0 + h, -.85, { taper: Math.min(rx, ry) * (D.heli ? .55 : .7) });   // 直升机：平板玻璃拼成的多面座舱盖
    if (kd === 'tandem') { dome(x1 - rx * .5, rx * .48, w * .85, zb - .15, w * .8); dome(x0 + rx * .5, rx * .5, w, zb - .05, w * .95); }
    else if (kd === 'win') mbPrism(M, [[x1, -w * .55], [x1 + .25, 0], [x1, w * .55], [x0, w], [x0, -w]], zb - top * .3, zb - top * .05, -.85, { taper: .15 });
    else if ((opt.cpo || 0) > .02) {   // 座舱盖打开：后铰链往上掀，露出座舱里的弹射座椅
      mbBox(M, x0 + .2, x1 - .25, -w * .7, w * .7, zb - .55, zb - .08, .12); mbBox(M, x0 + .35, x0 + .95, -w * .45, w * .45, zb - .5, zb + .45, .3);
      const M2 = mbNew(), th = opt.cpo * .95, ct = Math.cos(th), st = Math.sin(th), hz = zb - .12;
      dome(cx, rx, w, hz, w * 1.05, M2);
      for (const A of [M2.t, M2.l]) for (let i = 0; i < A.length; i += 10) {   // 绕后沿铰链转起来（位置与法线）
        const dx = A[i] - x0, dz = A[i + 2] - hz, nx = A[i + 3], nz = A[i + 5];
        A[i] = x0 + dx * ct - dz * st; A[i + 2] = hz + dx * st + dz * ct; A[i + 3] = nx * ct - nz * st; A[i + 5] = nx * st + nz * ct;
      }
      M.t.push(...M2.t); M.l.push(...M2.l);
    } else dome(cx, rx, w, zb - .12, w * 1.05);
  }
  // 进气道（暗）、B-2 排气槽
  for (const [x0, x1, y, w, k] of D.inl || []) {
    if (k === 'top') { for (const sg of y ? [1, -1] : [1]) mbBox(M, x1, x0, y * sg - w * .8, y * sg + w * .8, topAt((x0 + x1) / 2) - .1, topAt((x0 + x1) / 2) + .18, .18, { taper: .1 }); }
    else for (const sg of [1, -1]) mbBox(M, x1, x0, Math.min(y * sg, (y - w * .7) * sg), Math.max(y * sg, (y - w * .7) * sg), zc - bot * .55, zc + top * .2, .18);
  }
  for (const [x0, y0, y1] of D.ex || []) for (const sg of [1, -1]) mbBox(M, x0 - 1.3, x0, Math.min(y0, y1) * sg - (sg < 0 ? 0 : 0), Math.max(y0, y1) * sg, zc + top * .5, zc + top * .5 + .12, .2);
  // 喷口：圆形（收敛调节片）/ 二元扁平
  for (const nz of D.noz || []) for (const sg of nz[1] ? [1, -1] : [1]) {
    const [x, y] = [nz[0], nz[1] * sg];
    if (nz[4] === 'flat') { mbBox(M, x - nz[3], x + .2, y - nz[2], y + nz[2], zc - nz[2] * .45, zc + nz[2] * .45, .45); mbBox(M, x - nz[3] - .05, x - nz[3] + .1, y - nz[2] * .8, y + nz[2] * .8, zc - nz[2] * .3, zc + nz[2] * .3, .12); }
    else { mbTube(M, [x + .7, y, zc], [x - .35, y, zc], nz[2] * 1.02, nz[2] * .88, 12, .5); mbTube(M, [x - .3, y, zc], [x - .4, y, zc], nz[2] * .7, nz[2] * .7, 10, .12); }
  }
  // 挂架（外挂弹另外实例化）
  for (const [x, y, k] of D.st || []) for (const sg of y ? [1, -1] : [1]) { const z = D.heli ? zw : zw; mbBox(M, x - .55, x + .45, y * sg - .07, y * sg + .07, z - .32, z, .6); }
  // A-10 起落架整流罩、背负雷达罩、直升机桨毂 / 尾桨 / 长弓雷达
  if (D.pods) for (const sg of [1, -1]) mbTube(M, [D.pods[0] + 1, D.pods[1] * sg, zw - .25], [D.pods[0] - 1, D.pods[1] * sg, zw - .25], .42, .36, 10, .8);
  if (D.dome) {
    const [x, r] = D.dome, z0 = zc + top;
    for (const dx of [-1, 1]) mbTube(M, [x + dx * 1.1, 0, z0 - .1], [x + dx * .7, 0, z0 + 1.3], .12, .1, 6, .8);
    mbPrism(M, mbCirc(x, 0, r, 22), z0 + 1.3, z0 + 1.85, .96, { taper: .5, bottom: true });
    mbLoop(M, mbCirc(x, 0, r * .62, 22), z0 + 1.88, .7);
  }
  if (D.heli && D.rot) {
    const hz = zc + top + .35;
    mbTube(M, [D.rot[0], 0, zc + top - .1], [D.rot[0], 0, hz + .55], .3, .22, 8, .8);   // 桨毂立柱
    if (D.radome) mbPrism(M, mbCirc(D.rot[0], 0, .85, 12), hz + .75, hz + 1.45, .9, { taper: .4 });   // 长弓雷达罩
    if (D.tr) { const [x, y, r] = D.tr, z = zc + .9; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.2832, b = (i + 1) / 16 * 6.2832; mbLine(M, [x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(b) * r, y, z + Math.sin(b) * r], .55); } mbTube(M, [x - r, y, z], [x + r, y, z], .08, .08, 4, .7); }
  }
  if (opt.gear) {   // 起落架：前起落架在座舱下前方，两个主起落架在机身两侧；支柱 + 轮子（轮底在 z = −V3_GEAR）
    const xf = D.body ? D.body[0][0] : 10, xn = D.cp ? Math.min(D.cp[1] + .6, xf - 1.6) : xf * .6, xm = D.heli ? 1.2 : D.hi ? -.4 : -1.4, ym = D.heli ? 1.7 : Math.max(1.3, hw0 * .82), zb0 = zc - bot * .7;
    for (const [x, y, r] of [[xn, 0, .32], [xm, ym, .46], [xm, -ym, .46]]) {
      const zw0 = -V3_GEAR + r;
      mbTube(M, [x, y, zb0], [x, y, zw0], .1, .09, 6, .75);
      mbTube(M, [x, y - .2, zw0], [x, y + .2, zw0], r, r, 10, .22); mbTube(M, [x, y - .21, zw0], [x, y + .21, zw0], r * .5, r * .5, 8, .7);
    }
  }
  return M;
}
// 精细飞机的附件实例：外挂弹药（按 airmdl.js 记的消耗逐个去掉）、主旋翼（转）、螺旋桨（绕机身轴转）；still：停放，不转
function v3AirExtras(key, x, y, z, h, k, sd, roll, rs, t, still) {
  const D = typeof AIRD === 'object' && AIRD[key];
  if (!D) return;
  const sec = v3AirSec(D), hw0 = D.body ? Math.max(...D.body.map(b => b[1])) : 1.5, top = hw0 * sec.kt, bot = hw0 * sec.kb, zc = V3_AIRZ;
  const zw = D.hi ? zc + top * .82 : zc - bot * .35, c = Math.cos(h), sn = Math.sin(h), cr = Math.cos(roll), sr = Math.sin(roll);
  const W = (lx, ly, lz) => { const yy = ly * cr + lz * sr, zz = -ly * sr + lz * cr; return [x + (lx * c - yy * sn) * k, y + (lx * sn + yy * c) * k, z + zz * k]; };
  if (D.st && typeof adStores === 'function') for (const st of adStores(D, { used: rs && rs.used })) {
    const kd = st.k === 'atgm4' ? 'atgm4' : st.k, L = (AD_ST[kd] || AD_ST.agm), zz = zw - .36 - L[1];
    const put = (ly, lz) => { const [X, Y, Z] = W(st.x, ly, lz); v3mAdd('st3:' + kd, () => v3mMsl(kd), X, Y, Z, h, k, sd, roll); };
    if (kd === 'atgm4') for (let i = 0; i < Math.min(4, st.n ?? 4); i++) put(st.y + (i % 2 ? .2 : -.2), zz + (i > 1 ? -.3 : 0)); else put(st.y, zz);
  }
  if (D.heli && D.rot) { const [X, Y, Z] = W(D.rot[0], 0, zc + top + .35 + .55); v3mAdd('rot:' + D.rot[2] + ':' + D.rot[1], () => v3mRotor(D.rot[2], D.rot[1] * .92), X, Y, Z, still ? h + .4 : t * 22, k, sd); }
  for (const [px, py, r, nb, push] of D.prop || []) for (const sg of py ? [1, -1] : [1]) {
    const n = (D.nac || []).find(q => Math.abs(q[2] - Math.abs(py)) < .3), pz = n ? (n[4] === 'dn' ? zw - n[3] * .95 : zc + (V3_NUP[key] ?? .3)) : zc;
    const [X, Y, Z] = W(px, py * sg, pz);
    v3mAdd('prop:' + nb + ':' + r, () => v3mProp(Math.min(nb, 6), r), X, Y, Z, h, k, sd, still ? .3 : roll + t * (push ? -24 : 24) * sg);
  }
}
// 螺旋桨（桨盘在 y–z 平面，按滚转角转）
function v3mProp(nb, r) {
  const M = mbNew();
  for (let i = 0; i < nb; i++) { const a = i / nb * 6.2832; mbTube(M, [0, Math.cos(a) * .3, Math.sin(a) * .3], [0, Math.cos(a) * r, Math.sin(a) * r], .14, .08, 4, .55); }
  mbTube(M, [.5, 0, 0], [-.3, 0, 0], .04, .32, 8, .7);
  for (let i = 0; i < 20; i++) { const a = i / 20 * 6.2832, b = (i + 1) / 20 * 6.2832; mbLine(M, [0, Math.cos(a) * r, Math.sin(a) * r], [0, Math.cos(b) * r, Math.sin(b) * r], .35); }
  return M;
}
function v3mPlane(key) {
  if (typeof AIRD === 'object' && AIRD[key] && typeof adClipY === 'function') return v3mAir(key, false);   // 有精细分件数据的机型（airmdl.js）
  const M = mbNew(), all = typeof AIR_SIL === 'object' ? AIR_SIL : {}, sil = all[key === 'p8' ? 'c17' : key] || all.j35 || [[10, 0], [-10, 8], [-10, 0]];
  const full = [...sil, ...sil.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  const xs = sil.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), tail = V3_PLANE_TAIL[key] || 'twin', heli = tail === 'heli';
  const wing = ['b2', 'gj11', 'j36', 'j50'].includes(key);
  if (!heli) mbPrism(M, full, -.18, wing ? .55 : .14, .85, { top: .95, taper: wing ? .6 : .05 });   // 机翼（飞翼稍厚、收边）
  const fw = heli ? 1.4 : ['c17', 'transport', 'y20', 'p8'].includes(key) ? 1.9 : key === 'h6k' ? 1.5 : wing ? 1.2 : 1.35;
  // 机身半宽：该处轮廓宽度与机身最大半宽的较小者（机头、尾锥自然收细）
  const halfW = x => { let w = 0; for (let i = 0; i < sil.length - 1; i++) { const a = sil[i], b = sil[i + 1]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) { const y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); w = w ? Math.min(w, y) : y; } } return w; };
  const N = 14;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const x = x0 + (x1 - x0) * i / N, r = Math.max(.12, Math.min(fw, halfW(x) || .12)) * (i === 0 || i === N ? .35 : 1);
    if (prev) mbTube(M, [prev[0], 0, .25], [x, 0, .25], prev[1], r, 8, .9, false);
    prev = [x, r];
  }
  if (!['b2', 'gj11', 'gj2', 'wz7'].includes(key)) mbPrism(M, [[x1 - 2.2, 0], [x1 - 3, .45], [x1 - 5.4, .45], [x1 - 6, 0], [x1 - 5.4, -.45], [x1 - 3, -.45]], .9, 1.35, -.9, { taper: .2 });   // 座舱盖（发光）
  // 垂尾：两层薄板（cant 外倾角）
  const fin = (x, y, h, cant) => {
    const dy = Math.sin(cant) * h, tz = .4, P = [[x, y, tz], [x + 2.6, y, tz], [x + 1.4, y + dy, tz + h], [x + .2, y + dy, tz + h]];
    mbQuad(M, P[0], P[1], P[2], P[3], .95); mbQuad(M, ...P.map(p => [p[0], p[1] + .12, p[2]]), .95);
  };
  const tx = x0 + 1.2;
  if (tail === 'twin') { fin(tx, fw * .7, 3, .35); fin(tx, -fw * .7, 3, -.35); }
  else if (tail === 'one' || tail === 't') { fin(tx, 0, tail === 't' ? 4.2 : 3.6, 0); if (tail === 't') mbPrism(M, [[tx + 2.2, 0], [tx + .6, 4.4], [tx - .4, 4.4], [tx - .2, 0], [tx - .4, -4.4], [tx + .6, -4.4]], 4.4, 4.6, .9); }
  else if (tail === 'v') { fin(tx, .3, 2.6, .7); fin(tx, -.3, 2.6, -.7); }
  else if (tail === 'end') { fin(tx, 4.4, 2.4, 0); fin(tx, -4.4, 2.4, 0); fin(tx, 0, 2.2, 0); }
  for (const [ex, ey, er] of V3_PLANE_ENG[key] || []) for (const s of [-1, 1]) mbTube(M, [ex + 2.2, ey * s, -.4], [ex - 1.6, ey * s, -.4], er, er * .8, 8, .7);   // 发动机短舱
  if (key === 'a10') for (const s of [-1, 1]) mbTube(M, [-4, s * 1.5, 1.4], [-7, s * 1.5, 1.4], .9, .8, 8, .7);   // 背负双发
  if (key === 'kj600') { mbTube(M, [0, 0, 1.2], [0, 0, 2.2], .3, .3, 6, .8); mbTube(M, [0, 0, 2.2], [0, 0, 2.9], 3.6, 3.6, 16, .9); }   // 背负雷达圆盘
  if (heli) {   // 直升机：短翼与外挂、桨毂立柱、尾桨（主旋翼单独转）
    mbPrism(M, full, -.1, .1, .8);
    mbTube(M, [1.2, 0, 1.4], [1.2, 0, 2.6], .3, .25, 6, .8);
    mbBox(M, x0 - .2, x0 + 1.2, -.08, .08, .3, 2.8, .9);
    mbBox(M, x0 - .9, x0 + 1.9, .55, .62, 1.45, 1.65, .7); mbBox(M, x0 + .4, x0 + .6, .55, .62, .2, 2.9, .7);
  }
  return M;
}
// 弹舱（airmdl.js 的 AIRD 尺寸）：开舱时机腹下一块深色凹槽、舱门绕两侧铰链向下翻开，舱里的弹露出来；侧弹舱的舱门向外翻、弹被挂架推出舱外
function v3mBay(key, kb, ks) {
  const M = mbNew(), D = typeof AIRD === 'object' && AIRD[key];
  if (!D) return M;
  const sec = v3AirSec(D), hw0 = D.body ? Math.max(...D.body.map(b => b[1])) : 1.4, zb = V3_AIRZ - hw0 * sec.kb * .9;   // 机腹高度（与 v3mAir 的机身一致）
  if (D.bay && kb > 0) {
    const [x0, x1, hw, yc] = D.bay, th = kb * 1.45;
    for (const s of yc ? [1, -1] : [0]) {
      const y0 = yc * s;
      mbBox(M, x1, x0, y0 - hw, y0 + hw, zb - .1, zb + .05, .22);   // 舱内（暗）
      for (const g of [-1, 1]) {
        const hy = y0 + g * hw, fy = hy - g * hw * .95 * Math.cos(th), fz = zb - hw * .95 * Math.sin(th);
        mbQuad(M, [x0, hy, zb], [x1, hy, zb], [x1, fy, fz], [x0, fy, fz], .8);
        mbTube(M, [x0 - .5, y0 + g * hw * .45, zb - .18], [x1 + .5, y0 + g * hw * .45, zb - .18], .13, .11, 6, .95);   // 舱里的弹
      }
    }
  }
  if (D.sbay && ks > 0) {
    const [x0, x1, y] = D.sbay;
    for (const s of [1, -1]) {
      mbQuad(M, [x0, y * s, zb + .5], [x1, y * s, zb + .5], [x1, (y + ks * .9) * s, zb - .2], [x0, (y + ks * .9) * s, zb - .2], .8);
      mbTube(M, [x0 + .4, (y + ks * .7) * s, zb], [x1 - .4, (y + ks * .7) * s, zb], .1, .09, 6, .95);
    }
  }
  return M;
}
// 导弹 / 炸弹弹体（离机阶段画立体的）：弹身、弹头锥、十字尾翼
function v3mMsl(kind) {
  const M = mbNew(), [L, r] = (typeof AD_ST === 'object' && AD_ST[kind]) || [2.4, .2];
  mbTube(M, [-L / 2, 0, 0], [L / 2 - r * 2, 0, 0], r, r, 8, .95);
  mbTube(M, [L / 2 - r * 2, 0, 0], [L / 2, 0, 0], r, .03, 8, .95);
  for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) mbQuad(M, [-L / 2, dy * r, dz * r], [-L / 2 + .55, dy * r, dz * r], [-L / 2 + .25, dy * r * 3, dz * r * 3], [-L / 2, dy * r * 3, dz * r * 3], .8);
  return M;
}
// 垂发单元舱盖：铰链在 y = 0 一边，按滚转角翻起
function v3mVlsLid() { const M = mbNew(); mbBox(M, -.55, .55, 0, 1.1, 0, .12, .8); mbLoop(M, [[-.55, 0], [.55, 0], [.55, 1.1], [-.55, 1.1]], .13, 1); return M; }
function v3mRotor(n = 4, r = 7.5) {   // 主旋翼：桨叶 + 桨毂，桨盘外圈一道淡线
  const M = mbNew();
  for (let i = 0; i < n; i++) { const a = i / n * 6.2832, c = Math.cos(a), s = Math.sin(a); mbPrism(M, [[c * .3 - s * .25, s * .3 + c * .25], [c * r - s * .25, s * r + c * .25], [c * r + s * .25, s * r - c * .25], [c * .3 + s * .25, s * .3 - c * .25]], 0, .1, .9); }
  mbPrism(M, mbCirc(0, 0, .45, 8), -.15, .25, .8);
  mbLoop(M, mbCirc(0, 0, r, 32), .05, .35);
  return M;
}

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
  return M;   // 人：伞衣下另挂立体士兵（v3mMan，与地面上的士兵同一套模型）
}
function v3mFort(kind) {
  const M = mbNew();
  if (kind === 'bunker') {   // 混凝土碉堡：倒角厚墙、正面射孔（发光）、顶上伪装网线
    mbPrism(M, [[8, -5], [8, 5], [5, 8], [-6, 8], [-8, 6], [-8, -6], [-6, -8], [5, -8]], 0, 5.2, .7, { taper: 1.3 });
    mbBox(M, 6.9, 7.6, -3, 3, 2, 3, -.4);
    for (let k = -2; k <= 2; k++) mbLine(M, [-5, k * 2.2, 5.25], [5, k * 2.2 + 1, 5.25], .5);
  } else if (kind === 'arty' || kind === 'coastal') {   // 牵引榴弹炮（M777）：开脚大架、摇架、长身管、炮口制退器、炮位土堤；岸防炮在混凝土炮台里
    const k = kind === 'coastal' ? 1.5 : 1, z = kind === 'coastal' ? 3.4 : 0;
    if (kind === 'coastal') mbPrism(M, mbCirc(0, 0, 13, 16), 0, 3.4, .55, { taper: 1.2 });
    else mbPrism(M, mbCirc(0, 0, 11, 14), 0, 1.4, .45, { taper: 1.6 });
    for (const s of [-1, 1]) mbTube(M, [0, s * .5 * k, z + 1.2], [-8 * k, s * 3.2 * k, z + .3], .35 * k, .3 * k, 6, .8);
    mbBox(M, -1.6 * k, 1.8 * k, -1.2 * k, 1.2 * k, z + .9, z + 2.4 * k, .9, { taper: .2 });
    mbTube(M, [1.2 * k, 0, z + 2 * k], [13 * k, 0, z + 3.2 * k], .32 * k, .26 * k, 8, .65);
    mbTube(M, [12 * k, 0, z + 3.1 * k], [13.4 * k, 0, z + 3.2 * k], .5 * k, .5 * k, 8, .5);
    if (kind === 'coastal') mbBox(M, -3, 3.5, -3.2, 3.2, z, z + 3.6, .85, { taper: .6 });
  } else if (kind === 'mortar') {
    mbPrism(M, mbCirc(0, 0, 2, 10), 0, .35, .6);
    mbTube(M, [0, 0, .3], [4.2, 0, 5.6], .28, .25, 8, .75);
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
function v3mPoint(kind, blown) {
  const M = mbNew();
  const house = (x, y, w, h, z, roof) => { mbBox(M, x - w / 2, x + w / 2, y - h / 2, y + h / 2, 0, z, .8); if (roof) mbBox(M, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z, z + roof, .95, { taper: Math.min(w, h) * .45 }); };
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
varying vec3 vN, vB, vV; varying float vS, vSide, vD;
void main() {
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z), cp = cos(iB.w), sp = sin(iB.w);
  vec3 q = p * iB.x; q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr); q = vec3(q.x * cp - q.z * sp, q.y, q.x * sp + q.z * cp);
  vec3 m = vec3(n.x, n.y * cr - n.z * sr, n.y * sr + n.z * cr); m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vB = b; vS = s; vSide = iB.y; vV = uEye - w; vD = length(vV);
  gl_Position = uM * vec4(w, 1.);
}`;
const V3M_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform vec2 uFog; uniform vec3 uBg; uniform float uMode;
uniform vec3 uBody0, uBody1, uBody2, uBody3, uBody4, uGlow0, uGlow1, uGlow2;
varying vec3 vN, vB, vV; varying float vS, vSide, vD;
void main() {
  vec3 body = vSide < .5 ? uBody0 : vSide < 1.5 ? uBody1 : vSide < 2.5 ? uBody2 : vSide < 3.5 ? uBody3 : uBody4;   // 3、4：我方 / 敌方飞机
  vec3 glow = vSide < .5 || (vSide > 2.5 && vSide < 3.5) ? uGlow0 : vSide < 1.5 || vSide > 3.5 ? uGlow1 : uGlow2;
  vec3 N = normalize(vN), V = normalize(vV);
  float lit = clamp(dot(N, normalize(vec3(-.45, .55, .7))), 0., 1.), up = clamp(N.z, 0., 1.);
  float e = min(min(vB.x, vB.y), vB.z);
#ifdef DER
  float w = max(fwidth(e), 1e-4), ed = 1. - smoothstep(w * .6, w * 1.9, e);
#else
  float ed = 1. - smoothstep(.015, .06, e);
#endif
  float sh = abs(vS), rim = pow(1. - clamp(dot(N, V), 0., 1.), 3.);
  vec3 c;
  if (uMode < .5) {   // 黑绿：深色实体 + 发光棱线 + 边缘光；玻璃、车灯、观察镜发光
    c = body * (.45 + .95 * lit + .25 * up) * sh + glow * ed * .95 + glow * rim * .22;
    if (vS < 0.) c += glow * .75 * sh;
  } else {   // 写实：涂装色受光 + 暗棱线，边缘描一道阵营色细光
    c = body * (.38 + .8 * lit + .15 * up) * sh * (1. - ed * .45) + glow * rim * .18;
    if (vS < 0.) c = mix(c, vec3(.55, .7, .78), .6);
  }
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
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
    for (const k of ['uM', 'uEye', 'uFog', 'uBg', 'uMode', 'uBody0', 'uBody1', 'uBody2', 'uBody3', 'uBody4', 'uGlow0', 'uGlow1', 'uGlow2']) V3M.u[k] = gl.getUniformLocation(pr, k);
    V3M.ib = gl.createBuffer();
    V3M.ok = true;
  } catch (e) { V3M.ok = false; console.warn('3D 兵种模型不可用', e); }
}
// 网格上传（每种模型只建一次）
function v3mGet(key, build) {
  let m = V3M.mesh.get(key);
  if (m) return m;
  const gl = V3M.gl;
  let MB;
  try { MB = build(); } catch (e) { console.warn('3D 模型 ' + key, e); MB = mbNew(); }
  m = { tn: MB.t.length / 10, ln: MB.l.length / 10, tb: null, lb: null };
  if (m.tn) { m.tb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.tb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MB.t), gl.STATIC_DRAW); }
  if (m.ln) { m.lb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.lb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MB.l), gl.STATIC_DRAW); }
  V3M.mesh.set(key, m);
  return m;
}
// 停在甲板 / 地面上（或在地面滑行）的飞机：精细模型放下起落架（轮子着地），外翼折起程度、座舱盖开度按四档取模型；外挂、旋翼、螺旋桨另外实例化
const V3_PIL = .95;   // 飞行员、甲板人员的比例（按飞机的真实比例，比战场上的士兵小）
function v3GroundPlane(key, sz, x, y, ground, hd, fold, cpo, still, side, t) {
  const k = sz / 21;
  if (typeof AIRD === 'object' && AIRD[key]) {
    const f = AIRD[key].fold ? Math.round(clamp(fold, 0, 1) * 3) : 0, c = Math.round(clamp(cpo, 0, 1) * 3), z = ground + V3_GEAR * k;
    v3mAdd('plg:' + key + ':' + f + ':' + c, () => v3mAir(key, f / 3, { gear: true, cpo: c / 3 }), x, y, z, hd, k, side, 0);
    v3AirExtras(key, x, y, z, hd, k, side, 0, null, t, still);
  } else { const z = ground + 1.25 * k; v3mAdd('pl:' + key, () => v3mPlane(key), x, y, z, hd, k, side, 0); v3AirExtras(key, x, y, z, hd, k, side, 0, null, t, still); }
}
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
function v3mPalette(gl) {
  const real = typeof realLook === 'function' && realLook() && !(typeof greenLook === 'function' && greenLook()), U = V3M.u;
  gl.uniform1f(U.uMode, real ? 1 : 0);
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
function v3Units(C, box) {
  if (!S || !V3.gl) return;
  const gl = V3.gl;
  if (!V3M.tried) v3mInit(gl);
  if (!V3M.ok) return;
  for (const L of V3M.inst.values()) L.d.length = 0;
  const [bx, by, bw, bh] = box, inB = (x, y, m = 40) => x > bx - m && x < bx + bw + m && y > by - m && y < by + bh + m;
  const spec = specAll() || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e')), near = !!R.m3dNear, t = performance.now() / 1000;   // near：画得出单兵的距离就用立体士兵（view3d.js）
  const seen = (x, y) => inVision(x, y);
  // 车辆：车体 + 炮塔（随瞄准转）+ 炮塔后的雷达（转）
  for (const v of S.veh || []) {
    if (v.lst || !inB(v.x, v.y) || (v.dead && S.t - (v.deadT ?? 0) > 120)) continue;
    if (v.side === 'e' && !v.dead && !seen(v.x, v.y)) continue;
    const Mm = typeof rlModelOf === 'function' ? rlModelOf(v) : null;
    if (!Mm || !RLM[Mm.key]) continue;
    const side = v.side === 'e' ? 'e' : 'p', bk = Mm.key + ':' + side, sd = v.dead ? 2 : side === 'e' ? 1 : 0, k = vehSp(v).len / Mm.L, z = v3Ht(v.x, v.y), h = v.heading || 0;
    let V = V3M.veh.get(bk);
    if (!V) { V = v3mVehicle(Mm.key, side); V3M.veh.set(bk, V); }
    // 贴地：车体按脚下坡度俯仰、侧倾（上坡车头抬起、横坡车身侧倾）；炮塔装在倾斜的车体上，按它自己的朝向取同一个坡面的姿态
    const g = v3Grad(v.x, v.y, Math.max(2.5, vehSp(v).len * .45), v.id), [hp, hr] = v3Pose(g, h);
    v3mAdd('vh:' + bk, () => V.hull, v.x, v.y, z, h, k, sd, hr, hp);
    if (V.tur.t.length) {
      const c = Math.cos(h), s = Math.sin(h), px0 = v.x + (V.piv[0] * c - V.piv[1] * s) * k, py0 = v.y + (V.piv[0] * s + V.piv[1] * c) * k, aim = v.dead ? h + .6 : (v.aim ?? h);
      const zt = z + g[0] * (px0 - v.x) + g[1] * (py0 - v.y), [tp, tr] = v3Pose(g, aim);
      v3mAdd('vt:' + bk, () => V.tur, px0, py0, zt, aim, k, sd, tr, tp);
      if (V.rad && !v.dead) { const [rx, ry, rr, rz] = V.rad, ca = Math.cos(aim), sa = Math.sin(aim), qx = px0 + (rx * ca - ry * sa) * k, qy = py0 + (rx * sa + ry * ca) * k; v3mAdd('rad:' + rr, () => v3mRadar(rr), qx, qy, zt + g[0] * (qx - px0) + g[1] * (qy - py0) + (rz + .45) * k, t * 3 + v.id, k, sd); }
    }
  }
  // 步兵（画得出单兵的距离都是立体模型，地面贴图里不再画平的小人）：三人按二维画面的三角站位，按兵种建模、按动作选姿态帧（manim.js：走 / 跑四帧、跪射、卧倒、匍匐），开火时枪口焰
  if (near) for (const q of S.teams) {
    if (!q.men.length || q.ride || q.boarded || !inB(q.x, q.y) || (q.side === 'e' && !seen(q.x, q.y))) continue;
    const f = typeof faceDraw === 'function' ? faceDraw(q) : faceOf(q), c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), sd = q.side === 'e' ? 1 : 0, T = typeof manTeam === 'function' ? manTeam(q) : null;
    q.men.forEach((role, i) => {
      if (i > 2) return;
      let mx = q.x + MO[i][0] * c - MO[i][1] * s, my = q.y + MO[i][0] * s + MO[i][1] * c;
      const bo = typeof bldOut === 'function' && bldOut(mx, my, .5);
      if (bo) [mx, my] = bo;
      const kind = typeof manKind === 'function' ? manKind(q, i, role) : role, P = T ? manPose3(q, T, i, kind) : { p: q.prone ? 'pr' : 'st', fire: null }, z = v3Ht(mx, my);
      v3mAdd('man:' + kind + ':' + P.p, () => v3mMan(kind, P.p), mx, my, z, f, V3_MAN, sd);
      if (P.fire != null && P.fire < .07) {   // 枪口焰：站姿在胸高、卧倒贴地
        const low = P.p === 'pr' || P.p[0] === 'c', L = (low ? 1.5 : kind === 'mg' ? 1.55 : 1.15) * V3_MAN, h = (low ? .16 : P.p === 'kn' ? .86 : 1.24) * V3_MAN;
        v3mAdd('mflash', v3mFlash, mx + Math.cos(f) * L, my + Math.sin(f) * L, z + h, f, V3_MAN, sd);
      }
    });
  }
  // 阵亡的遗体（manim.js）：倒地后躺在原地，约一分钟后消失
  if (near && typeof MANV === 'object' && MANV.S === S) for (const d of MANV.dead) {
    if (S.t - d.t0 < .3 || S.t - d.t0 > 60 || !inB(d.x, d.y) || (d.side === 'e' && !spec && !seen(d.x, d.y))) continue;
    v3mAdd('man:' + d.kind + ':dead', () => v3mMan(d.kind, 'dead'), d.x, d.y, v3Ht(d.x, d.y), d.a + d.tw, V3_MAN, 2);
  }
  // 舰艇：位置、航向、远景放大系数跟二维画面一致（ships.js 的姿态缓存）
  const pose = (key, o, hd) => { const P = typeof SHIPV === 'object' && SHIPV.pose[key]; return P && dist(P.x, P.y, o.x, o.y) < 60 ? P : { x: o.x, y: o.y, h: hd, k: 1 }; };
  for (const sh of S.ships) {
    if (!alive(sh) || !inB(sh.x, sh.y, 80)) continue;
    const d = (typeof SHIP_DIM === 'object' && SHIP_DIM[sh.kind]) || [32, 11], P = pose(sh.id, sh, sh.heading ?? -1.57), nm = (sh.sbxCls && sh.sbxCls.name) || '';
    if (sh.kind === 'dd') { const c = typeof vlsCls === 'function' ? vlsCls(sh) : '052D'; v3mAdd('dd:' + c, () => v3mDD(c), P.x, P.y, -2.6, P.h, P.k, 0); continue; }   // 驱护舰按舰型建模
    v3mAdd('sh:' + sh.kind, () => v3mShip(sh.kind, d[0], d[1]), P.x, P.y, -2.6, P.h, P.k, 0);
  }
  for (const bt of S.boats || []) if (!bt.dead && isFinite(bt.x) && inB(bt.x, bt.y)) v3mAdd('sh:boat', () => v3mShip('boat', 12, 5), bt.x, bt.y, -2.6, bt.heading ?? -1.57, 1, 0);
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && inB(S.dd.x, S.dd.y, 80)) { const P = pose('DD', S.dd, S.dd.heading ?? -1.57), c = typeof vlsCls === 'function' ? vlsCls(S.dd) : '055'; v3mAdd('dd:' + c, () => v3mDD(c), P.x, P.y, -2.6, P.h, P.k, 0); }
  if (typeof cvAll === 'function') for (const cv of cvAll()) {
    if (!(cv.hp > 0) || cv.x < -999 || !inB(cv.x, cv.y, 220)) continue;
    const lhd = /075/.test(cv.name || ''), h = cv.heading ?? -1.57, C = typeof CVG === 'object' ? CVG : null, top = -2.6 + (C ? C.zd : 17), home = cvHome(cv);   // top：飞行甲板顶面
    v3mAdd('cv:' + (lhd ? 1 : 0), () => v3mCarrier(lhd), cv.x, cv.y, -2.6, h, 1, 3);   // 3：写实画面用海军灰（与舰载机同色）
    if (!C) continue;
    const at = (u, v) => cvW(u, v, cv), live = (S.planes || []).filter(p => !p.dead && cvHome(p) === home && !p.land && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap'));
    C.el.forEach((E, i) => { const [x, y] = at(E.u, E.v); v3mAdd('cvel', () => v3mCvEl(E.L, E.B), x, y, top - C.hang * (typeof cvElH === 'function' ? cvElH(cv, i) : 0), h, 1, 3); });   // 升降机平台
    if (!lhd) C.cats.forEach((c, k) => { const [x, y] = at(c.u - Math.cos(c.a) * 9.5, c.v - Math.sin(c.a) * 9.5); v3mAdd('cvjbd', v3mCvJbd, x, y, top + .02, h + c.a + Math.PI / 2, 1, 3, -(typeof cvJbd === 'function' ? cvJbd(cv, k, live) : 0) * .96); });   // 偏流板
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
      v3GroundPlane(key, sz, p.x, p.y, top - C.hang * sink, p.heading, p.fold ?? 0, p.cpo || 0, p.dk === 'brd' || p.dk === 'lift', 3, t);
      const P = p.dk === 'brd' && typeof cvPilotPose === 'function' ? cvPilotPose(p) : null;   // 飞行员跑过来、顺登机梯爬进座舱
      if (P) { const [x, y] = at(P.u, P.v), pose = P.run ? 'r' + (Math.floor(P.ph / 1.5708) & 3) : 'cl' + (Math.floor(P.ph / 1.7) & 1); v3mAdd('man:pilot:' + pose, () => v3mMan('pilot', pose), x, y, top + P.z, h + P.a, V3_PIL, 0); }
      if (P && (p.cpo || 0) > .3) { const L = cvLadder(p), [x, y] = at(L[0], L[1]); v3mAdd('ladder', v3mLadder, x, y, top, p.heading + Math.PI / 2, sz / 21, 0); }
    }
    for (const o of typeof cvShooters === 'function' ? cvShooters(cv, live) : []) { const [x, y] = at(o.u, o.v), pose = o.go ? 'kn' : 'pt'; v3mAdd('man:deck:' + pose, () => v3mMan('deck', pose), x, y, top, h + o.a, V3_PIL, 0); }   // 弹射官
  }
  for (const e of S.eships || []) if (!e.dead && inB(e.x, e.y, 80) && (spec || seen(e.x, e.y) || S.t - (e.det ?? -99) < 4)) { const C0 = (typeof NV_CLS === 'object' && NV_CLS[e.cls]) || { L: 46, B: 9 }; v3mAdd('es:' + e.cls, () => v3mEShip(e.cls, C0.L, C0.B), e.x, e.y, -2.6, e.heading ?? -1.57, 1, 1); }
  for (const s of S.subs || []) if (!s.dead && inB(s.x, s.y) && (spec || (typeof asSubSeen === 'function' && asSubSeen(s)))) v3mAdd('sub', v3mSub, s.x, s.y, -4.2, s.heading || 0, 1, 1);
  // 守方阵地
  for (const e of S.enemies) {
    if (e.kind === 'airfield' || !inB(e.x, e.y)) continue;   // 被毁的也立着（暗色残骸），贴图里不再画平面残骸（render2.js）
    if (!seen(e.x, e.y) && e.kx == null) continue;
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
    v3mAdd('st:' + e.kind, () => v3mFort(e.kind), e.x, e.y, z0, a, 1, e.dead ? 2 : 1);
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
    if (man) { const s = Math.sin(roll) * hang; v3mAdd('man:rifle:st', () => v3mMan('rifle', 'st'), c.x + s * Math.sin(a), c.y - s * Math.cos(a), z - Math.cos(roll) * hang, a, V3_MAN, sd, roll); }   // 吊在伞下的伞兵：和伞衣同一个摆（绕伞衣顶转），吊索始终连在头顶
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
    v3mAdd('pt:' + k + (blown ? ':x' : ''), () => v3mPoint(k, blown), p.x, p.y, z, 0, 1, sd);
    if (k === 'radar') v3mAdd('rad:4', () => v3mRadar(4), p.x + 4, p.y - 4, z + 9.6, p.owner === 'e' ? t * 1.4 : .5, 1, sd);
  }
  for (const o of S.obst || []) if (o.known && !o.dead && inB(o.x, o.y)) v3mAdd('hedge', v3mHedgehog, o.x, o.y, sea(o.x, o.y), (o.x * 7.1 + o.y * 3.3) % 6.28, 1.3, 1);   // 海滩反登陆障碍
  for (const w of S.wire || []) if (w.known && inB((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 120)) {   // 铁丝网：每 6 米一段
    const L = dist(w.x0, w.y0, w.x1, w.y1), n = Math.max(1, Math.round(L / 6)), a = Math.atan2(w.y1 - w.y0, w.x1 - w.x0);
    for (let i = 0; i < n; i++) { const u = (i + .5) / n, x = lerp(w.x0, w.x1, u), y = lerp(w.y0, w.y1, u), c = !!(w.cut && i % 3 === 1); v3mAdd(c ? 'wire:x' : 'wire', () => v3mWire(c), x, y, v3Ht(x, y), a, L / n / 6, 1); }
  }
  if (S.armor && S.armor.length && typeof RLM === 'object' && RLM.m1117) {   // 守方轮式装甲车（ai3.js）：借 M1117 的立体模型
    let V = V3M.veh.get('m1117:e');
    if (!V) { V = v3mVehicle('m1117', 'e'); V3M.veh.set('m1117:e', V); }
    const k = (typeof A3_LEN === 'number' ? A3_LEN : 18) / RLM.m1117.L;
    for (const a of S.armor) {
      if (!inB(a.x, a.y) || !(spec || seen(a.x, a.y)) || (a.dead && S.t - (a.deadT ?? 0) > 120)) continue;
      const z = v3Ht(a.x, a.y), h = a.heading || 0, sd = a.dead ? 2 : 1;
      v3mAdd('vh:m1117:e', () => V.hull, a.x, a.y, z, h, k, sd);
      if (V.tur.t.length) { const c = Math.cos(h), sn = Math.sin(h); v3mAdd('vt:m1117:e', () => V.tur, a.x + (V.piv[0] * c - V.piv[1] * sn) * k, a.y + (V.piv[0] * sn + V.piv[1] * c) * k, z, a.dead ? h + .6 : (a.aim ?? h), k, sd); }
    }
  }
  if (S.trk && S.trk.list) for (const tr of S.trk.list) if ((tr.ph !== 'idle' || tr.dead) && inB(tr.x, tr.y)) { const [tp, trl] = v3Pose(v3Grad(tr.x, tr.y, 3, 'trk' + tr.id), tr.h || 0); v3mAdd('truck', () => v3mTruck('cargo'), tr.x, tr.y, v3Ht(tr.x, tr.y), tr.h || 0, 1, tr.dead ? 2 : 0, trl, tp); }   // 补给卡车
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
      const [x2, y2] = eaW(b, P.u + Math.cos(P.a), P.v + Math.sin(P.a)), h = Math.atan2(y2 - y, x2 - x), k = P.size / 21, z = v3Ht(x, y) + 1.25 * k, sd = own ? 0 : 1;
      v3mAdd('pl:' + P.sil, () => v3mPlane(P.sil), x, y, z, h, k, sd + 3, 0);
      v3AirExtras(P.sil, x, y, z, h, k, sd + 3, 0, null, t, true);
    }
  }
  // 飞机：高度与 3D 地图里的标识一致（view3d.js v3AirZ：甲板上贴着甲板，空中按高度），按滚转角倾斜；直升机主旋翼转动
  const plane = (o, hd, sd, key, sz, bank) => {
    const x = o.x, y = o.y, z = v3AirZ(o), k = sz / 21, ac = sd + 3;   // 3、4：飞机涂装（写实画面灰色）
    v3mAdd('pl:' + key, () => v3mPlane(key), x, y, z, hd || 0, k, ac, bank || 0);
    const rs = typeof airRelState === 'function' ? airRelState(sd ? 'e' : 'p', o.id) : null;   // 弹舱开合、外挂消耗（airmdl.js）
    if (rs && (rs.bay > .04 || rs.sbay > .04)) { const b = Math.round(rs.bay * 4), sb = Math.round(rs.sbay * 4); v3mAdd('bay:' + key + ':' + b + ':' + sb, () => v3mBay(key, b / 4, sb / 4), x, y, z, hd || 0, k, ac, bank || 0); }
    v3AirExtras(key, x, y, z, hd || 0, k, ac, bank || 0, rs, t, false);
    if (!(typeof AIRD === 'object' && AIRD[key]) && V3_PLANE_TAIL[key] === 'heli') v3mAdd('rotor', () => v3mRotor(4, 7.5), x + Math.cos(hd || 0) * 1.2 * k, y + Math.sin(hd || 0) * 1.2 * k, z + 2.7 * k, t * 22, k, sd);
  };
  for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && inB(p.x, p.y, 220) && !(!p.land && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap'))) {   // 甲板上的在航母那里画（放下起落架）
    const key = typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : 'j35', sz = (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || ((typeof AIR_SPEC === 'object' && AIR_SPEC[p.kind]) || {}).size || 15;
    plane(p, p.heading, 0, key, sz, p.bank);
  }
  const EA_K = { ga: ['a10', 18], heli: ['ah64', 16], uh60: ['uh60', 17], c17: ['c17', 30], ftr: ['f35', 17], f22: ['f22', 18], b2: ['b2', 34], p8: ['p8', 26] };
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && isFinite(a.x) && (spec || a.pv || seen(a.x, a.y)) && inB(a.x, a.y, 220)) {
    const [key, sz] = EA_K[a.type] || ['f35', 17];
    if (a.ph !== 'gnd' && a.ph !== 'roll') { plane(a, a.heading, 1, key, sz, a.bank); continue; }
    // 机场地面作业（eair.js eaGnd）：放下起落架停在机位 / 沿滑行道滑行 / 跑道上滑跑；登机时飞行员跑过来、顺梯子爬进座舱，座舱盖开合，地勤在机头前打手势
    const b = S.enemies.find(e => e.id === a.base), Cr = typeof eaGndCrew === 'function' ? eaGndCrew(a) : null, gz = v3Ht(a.x, a.y);
    v3GroundPlane(key, sz, a.x, a.y, gz, a.heading, 0, Cr ? Cr.cpo : 0, !!(Cr && !Cr.eng && Cr.crew && S.t - a.g.t0 < a.g.crew - EA_GND.start), 4, t);
    if (!Cr || !b) continue;
    const toW = (u, v) => eaW(b, u, v), hb = (b.rh || 0), da = A => hb + Math.atan2(Math.sin(A) * (b.rs || 1), Math.cos(A));
    if (Cr.pilot) { const [x, y] = toW(Cr.pilot.u, Cr.pilot.v), pose = Cr.pilot.run ? 'r' + (Math.floor(Cr.pilot.ph / 1.5708) & 3) : 'cl' + (Math.floor(Cr.pilot.ph / 1.7) & 1); v3mAdd('man:pilot:' + pose, () => v3mMan('pilot', pose), x, y, v3Ht(x, y) + Cr.pilot.z, da(Cr.pilot.a), V3_PIL, 1); }
    if (Cr.lad) { const [x, y] = toW(Cr.lad[0], Cr.lad[1]); v3mAdd('ladder', v3mLadder, x, y, v3Ht(x, y), a.heading + Math.PI / 2, sz / 21, 1); }
    if (Cr.crew) { const [nx, ny] = toW(Cr.mar[0], Cr.mar[1]), pose = Cr.eng || Math.floor(S.t * 1.5) & 1 ? 'pt' : 'kn'; v3mAdd('man:deck:' + pose, () => v3mMan('deck', pose), nx, ny, v3Ht(nx, ny), da(Cr.mh), V3_PIL, 1); }   // 地勤：站在机位前方指挥开车、引导滑出
  }
  // 刚离机的导弹 / 炸弹：从弹舱 / 挂架落下（还没点火时是立体弹体，点火后由 v3fx.js 画光点与尾迹）
  if (typeof airRelPos === 'function' && typeof AIRV === 'object' && AIRV.mv && AIRV.mv.size) for (const m of S.missiles || []) {
    if (!AIRV.mv.has(m.id)) continue;
    const P = airRelPos(m, true);
    if (!P || P.u < (P.r.k === 'main' ? AIR_REL.open : .05) || P.e > .5 || !inB(P.x, P.y, 100) || (m.side === 'e' && !(spec || seen(P.x, P.y)))) continue;
    const sk = P.r.w === 'aam' ? 'aam' : P.r.w === 'bomb' ? 'bomb' : P.r.w === 'cm' ? 'cm' : 'agm';
    v3mAdd('msl:' + sk, () => v3mMsl(sk), P.x, P.y, airRelZ(P, m), P.h, P.sc, m.side === 'e' ? 1 : 0, 0);
  }
  // 飞行中的导弹：立体弹体，按飞行方向取朝向与俯仰（发光的尾焰、烟迹在 v3fx.js）；刚离机还没点火的在上面画
  const MK3 = { sam: ['aam', 2.2], asm: ['asm', 2.2], pgm: ['agm', 1.8], tbm: ['cm', 3.6] };
  const mp = V3M.mp || (V3M.mp = new Map()), mlive = new Set();
  for (const m of S.missiles || []) {
    if (m.t < 0 || m.done || !isFinite(m.x)) continue;
    mlive.add(m.id);
    if ((typeof AIRV === 'object' && AIRV.mv && AIRV.mv.has(m.id) && typeof airRelPos === 'function' && airRelPos(m, true)) || !inB(m.x, m.y, 300) || (m.side === 'e' && !(spec || seen(m.x, m.y)))) continue;
    const z0 = typeof v3AltZ === 'function' ? v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : 230), -2.6, 2) : v3Ht(m.x, m.y) + 20;
    const VP = typeof v3MslPos === 'function' ? v3MslPos(m, z0) : null, mx = VP ? VP.x : m.x, my = VP ? VP.y : m.y, z = VP ? VP.z : z0;   // 垂发冲出阶段（v3fx.js）
    let o = mp.get(m.id);
    if (!o) mp.set(m.id, o = { x: mx, y: my, z: z - 1, h: Math.atan2(m.ty - m.y, m.tx - m.x), p: VP ? 1.5 : .8 });
    const dx = mx - o.x, dy = my - o.y, dz = z - o.z, dl = Math.hypot(dx, dy);
    if (dl + Math.abs(dz) > .4) { o.h = dl > .05 ? Math.atan2(dy, dx) : o.h; o.p = Math.atan2(dz, Math.max(.01, dl)); o.x = mx; o.y = my; o.z = z; }
    const [mk, sc] = MK3[m.kind] || ['aam', 2];
    v3mAdd('msl:' + mk, () => v3mMsl(mk), mx, my, z, o.h, sc, m.side === 'e' ? 1 : 0, 0, o.p);
    // 垂发舱盖：发射后翻开约 2 秒
    if (VP && m.t < 2.2 && typeof v3VlsOrigin === 'function') { const vo = v3VlsOrigin(m); if (vo) v3mAdd('vlslid', v3mVlsLid, vo.x, vo.y, vo.z, vo.h, 1, m.side === 'e' ? 1 : 0, -1.25 * clamp(m.t / .25, 0, 1) * clamp((2.2 - m.t) / .4, 0, 1)); }
  }
  for (const id of mp.keys()) if (!mlive.has(id)) mp.delete(id);
  // —— 画 ——
  gl.useProgram(V3M.pr);
  gl.uniformMatrix4fv(V3M.u.uM, false, C.M);
  gl.uniform3f(V3M.u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(V3M.u.uFog, C.D * 1.3, C.D * 2.8);
  gl.uniform3f(V3M.u.uBg, .004, .02, .011);
  v3mPalette(gl);
  const A = V3M.a, X = V3M.ext;
  for (const [key, L] of V3M.inst) {
    const n = L.d.length / 8;
    if (!n) continue;
    const m = v3mGet(key, L.build), data = new Float32Array(L.d);
    for (const [buf, cnt, mode] of [[m.tb, m.tn, gl.TRIANGLES], [m.lb, m.ln, gl.LINES]]) {
      if (!buf || !cnt) continue;
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
  for (const k of ['p', 'n', 's', 'b']) gl.disableVertexAttribArray(A[k]);
}
