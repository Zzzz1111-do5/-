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
const V3M = { ok: false, tried: false, gl: null, ext: null, der: false, pr: null, a: {}, u: {}, mesh: new Map(), ib: null, inst: new Map(), veh: new Map() };

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
function v3mMan(kind, prone) {
  const M = mbNew(), s = 1, dk = .45;
  if (prone) {
    mbBox(M, -1.05, -.2, -.24, .24, 0, .22, s, { taper: .04 });   // 腿
    mbBox(M, -.95, -.75, -.22, .22, 0, .18, dk);   // 靴
    mbBox(M, -.25, .38, -.24, .24, 0, .32, s, { taper: .05 });   // 躯干（防弹衣）
    mbBox(M, -.2, .25, -.18, .18, .32, .45, .8, { taper: .04 });   // 背包
    mbPrism(M, mbCirc(.5, 0, .12, 8), .05, .3, .9, { taper: .03 });   // 头
    mbPrism(M, mbCirc(.5, 0, .15, 8), .2, .36, 1.05, { taper: .06 });   // 头盔
    for (const sy of [-1, 1]) mbTube(M, [.3, sy * .2, .18], [.75, sy * .12, .12], .06, .05, 6, s);   // 胳膊
    const gl = kind === 'mg' ? 1.5 : 1.1;
    mbTube(M, [.2, .04, .14], [.6 + gl, .04, .16], .035, .03, 6, dk, false);   // 枪
    mbBox(M, .35, .75, 0, .08, .08, .2, dk);
    if (kind === 'mg') { mbTube(M, [1.3, 0, .16], [1.45, -.12, 0], .015, .015, 4, dk); mbTube(M, [1.3, .08, .16], [1.45, .2, 0], .015, .015, 4, dk); }   // 两脚架
    return M;
  }
  for (const sy of [-1, 1]) {
    const fx = sy < 0 ? .1 : -.06;   // 一前一后
    mbBox(M, fx - .13, fx + .17, sy * .2 - .08, sy * .2 + .08, 0, .12, dk);   // 靴
    mbTube(M, [fx, sy * .11, .12], [fx * .4, sy * .11, .62], .085, .095, 6, s);   // 小腿
    mbTube(M, [fx * .4, sy * .11, .62], [0, sy * .1, 1.0], .1, .115, 6, s);   // 大腿
  }
  mbBox(M, -.12, .12, -.2, .2, .92, 1.05, .9, { taper: .02 });   // 腰带
  mbBox(M, -.14, .15, -.22, .22, 1.04, 1.48, s, { taper: .04 });   // 躯干
  mbBox(M, .14, .2, -.18, .18, 1.08, 1.42, .8);   // 防弹插板、弹匣包
  mbBox(M, -.32, -.14, -.17, .17, 1.02, 1.44, .75, { taper: .04 });   // 背包
  mbPrism(M, mbCirc(0, 0, .095, 8), 1.48, 1.68, .9, { taper: .02 });   // 头
  mbPrism(M, mbCirc(-.01, 0, .145, 10), 1.62, 1.8, 1.05, { taper: .07 });   // 头盔
  mbBox(M, .08, .11, -.08, .08, 1.6, 1.64, -.5);   // 护目镜反光
  mbTube(M, [0, .24, 1.42], [.18, .2, 1.14], .06, .055, 6, s); mbTube(M, [.18, .2, 1.14], [.42, .08, 1.18], .055, .05, 6, s);   // 胳膊：端枪
  mbTube(M, [0, -.24, 1.42], [.12, -.18, 1.12], .06, .055, 6, s); mbTube(M, [.12, -.18, 1.12], [.2, -.02, 1.18], .055, .05, 6, s);
  if (kind === 'aa') {   // 前卫 / 毒刺：扛在右肩的发射筒、瞄准具、握把电池
    mbTube(M, [-.6, .2, 1.52], [1.0, .2, 1.62], .07, .07, 8, .7); mbBox(M, .1, .3, .3, .42, 1.55, 1.7, .6); mbBox(M, -.05, .05, .2, .28, 1.4, 1.52, dk);
  } else if (kind === 'at') {   // PF-98 / 标枪：粗短发射筒
    mbTube(M, [-.45, .2, 1.5], [.75, .2, 1.56], .09, .09, 8, .7); mbBox(M, .05, .2, .28, .38, 1.5, 1.66, .6);
  } else {
    const gl = kind === 'mg' ? .95 : .75, gz = 1.2;
    mbBox(M, -.1, .35, 0, .07, gz - .06, gz + .07, dk);   // 机匣
    mbBox(M, -.32, -.08, 0, .06, gz - .1, gz + .03, dk);   // 枪托
    mbTube(M, [.35, .035, gz + .02], [.35 + gl, .035, gz + .02], kind === 'mg' ? .03 : .022, .02, 6, dk, false);   // 枪管
    mbBox(M, .12, .22, .01, .06, gz - .28, gz - .06, dk);   // 弹匣
    if (kind === 'mg') { mbBox(M, 0, .25, .06, .2, gz - .2, gz - .02, .6); mbTube(M, [.9, .03, gz], [.95, .14, gz - .25], .012, .012, 4, dk); }   // 弹链盒、两脚架
  }
  if (kind === 'radio') { mbBox(M, -.36, -.18, -.12, .12, 1.25, 1.55, .7); mbLine(M, [-.3, .08, 1.55], [-.38, .1, 2.7], 1); }   // 电台、鞭状天线
  if (kind === 'eng') { mbBox(M, -.36, -.32, -.05, .05, 1.1, 1.75, .8); mbBox(M, -.37, -.31, -.12, .12, 1.72, 1.92, .9); }   // 背上的工兵锹
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
// 航母（舰体坐标 u 向舰首、v 向右舷）：003 型福建舰——外飘的飞行甲板（carrier.js CVG.deck）、右舷舰岛与一体化桅杆、两部升降机，
//   两条弹射器、斜角着舰区与拦阻索画成发光标线；075 型两栖攻击舰为直通甲板，舰岛偏后，甲板上标直升机起降点
function v3mCarrier(lhd) {
  const M = mbNew(), D = typeof CVG === 'object' ? CVG.deck : [[77, 0], [-77, 13], [-77, -13]], zh = 6.2, zd = 7.4;
  mbPrism(M, D.map(([u, v]) => [u * .97, v * .74]), 0, zh, .75, { taper: .4 });
  mbPrism(M, D, zh, zd, .85, { top: .6 });
  const isl = lhd ? [-38, -8, 11, 15.5] : [-14, 10, 11.5, 16.5];
  v3mDeck(M, isl[0], isl[1], isl[2], isl[3], zd, zd + 5, .9, true);
  v3mDeck(M, isl[0] + 4, isl[1] - 2, isl[2] + .6, isl[3] - .6, zd + 5, zd + 9.5, .95, true);
  mbPrism(M, mbRect(isl[0] + 7, isl[1] - 5, isl[2] + 1.2, isl[3] - 1.2), zd + 9.5, zd + 15, .9, { taper: 1.2 });
  mbLine(M, [isl[0] + 9, (isl[2] + isl[3]) / 2, zd + 15], [isl[0] + 9, (isl[2] + isl[3]) / 2, zd + 19.5], 1);
  const z = zd + .03;
  mbLoop(M, D, z, .9);
  mbLine(M, [76, 0, z], [-60, 0, z], .5);
  if (!lhd && typeof CVG === 'object') {
    for (const [u0, v0, u1] of CVG.cats) { mbLine(M, [u0, v0, z], [u1, v0, z], 1); mbLine(M, [u0, v0 - .8, z], [u0, v0 + .8, z], 1); }
    const Ld = CVG.land, a = Math.atan2(Ld.v1 - Ld.v0, Ld.u1 - Ld.u0), nx = -Math.sin(a) * 5, ny = Math.cos(a) * 5;
    mbLine(M, [Ld.u0, Ld.v0, z], [Ld.u1, Ld.v1, z], 1);
    for (const s of [-1, 1]) mbLine(M, [Ld.u0 + nx * s, Ld.v0 + ny * s, z], [Ld.u1 + nx * s, Ld.v1 + ny * s, z], .6);
    for (let k = 0; k < 4; k++) { const u = Ld.u0 + 8 + k * 2.2, v = Ld.v0 + (u - Ld.u0) * Math.tan(a); mbLine(M, [u - Math.sin(a) * 4, v + Math.cos(a) * 4 * 0 - 4, z], [u + Math.sin(a) * 4, v + 4, z], .8); }
  } else for (let k = 0; k < 6; k++) mbLoop(M, mbCirc(50 - k * 22, -4, 3, 10), z, .8);
  for (const u of [-30, 20]) mbLoop(M, mbRect(u - 5, u + 5, 9, 15), z, .7);
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
function v3mPlane(key) {
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
  mbBox(M, -.22, .22, -.18, .18, -6.5, -5.6, 1, { taper: .03 });   // 躯干
  mbBox(M, -.4, -.2, -.16, .16, -6.4, -5.8, .55);   // 背包
  mbPrism(M, mbCirc(0, 0, .14, 8), -5.6, -5.3, 1.05, { taper: .04 });   // 头盔
  for (const sy of [-1, 1]) mbTube(M, [0, sy * .1, -6.5], [.08, sy * .14, -7.3], .07, .06, 6, .9);   // 两腿
  return M;
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

// 车轮：沿车宽方向的短圆管（u 车头方向坐标，v 车轮外侧，r 半径）
function v3mWheel(M, u, v, r, w = .9) { const s = Math.sign(v) || 1; mbTube(M, [u, v - s * w, r], [u, v, r], r, r, 10, .4); }
// 「堤丰」车阵（antiship.js TY_RIG，与二维同一套尺寸）：4 套 HEMTT 牵引车 + M870 拖车（发射箱单独实例，按起竖角转），营指挥车、发电车
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
  mbBox(M, -33, -24.6, -9.2, -4.6, 1, 6.4, .8, { taper: .15 });   // 营指挥车方舱
  v3mDeck(M, -24.2, -21, -9, -4.8, 1, 4.6, .9, true);
  mbLine(M, [-31.6, -8.3, 6.4], [-31.6, -8.3, 13], .9); mbLine(M, [-31.6, -5.5, 6.4], [-31.6, -5.5, 11], .9);   // 鞭状天线
  mbPrism(M, mbCirc(-27.6, -6.9, 1.25, 10), 6.4, 6.9, .7, { taper: .4 });   // 卫星天线
  mbBox(M, -31, -25.5, 4.8, 8.4, .8, 3.6, .75);   // 发电车
  for (let u = -30; u < -26; u += 1.1) mbLine(M, [u, 4.75, 1.6], [u, 4.75, 3.2], .7);
  for (const u of [-23, -29.5]) for (const s of [-1, 1]) v3mWheel(M, u, -6.9 + s * 2.6, .9, .7);
  for (const s of [-1, 1]) v3mWheel(M, -28.2, 6.6 + s * 2, .8, .6);
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
// 实例参数 iA = (x, y, z, 朝向)，iB = (比例, 阵营 0 我 / 1 敌 / 2 残骸, 滚转, -)，坐标是 GL 的（y 向北）
const V3M_VS = `attribute vec3 p; attribute vec3 n; attribute float s; attribute vec3 b; attribute vec4 iA; attribute vec4 iB;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vN, vB, vV; varying float vS, vSide, vD;
void main() {
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z);
  vec3 q = p * iB.x; q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr);
  vec3 m = vec3(n.x, n.y * cr - n.z * sr, n.y * sr + n.z * cr);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vB = b; vS = s; vSide = iB.y; vV = uEye - w; vD = length(vV);
  gl_Position = uM * vec4(w, 1.);
}`;
const V3M_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform vec2 uFog; uniform vec3 uBg; uniform float uMode;
uniform vec3 uBody0, uBody1, uBody2, uGlow0, uGlow1, uGlow2;
varying vec3 vN, vB, vV; varying float vS, vSide, vD;
void main() {
  vec3 body = vSide < .5 ? uBody0 : vSide < 1.5 ? uBody1 : uBody2, glow = vSide < .5 ? uGlow0 : vSide < 1.5 ? uGlow1 : uGlow2;
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
    for (const k of ['uM', 'uEye', 'uFog', 'uBg', 'uMode', 'uBody0', 'uBody1', 'uBody2', 'uGlow0', 'uGlow1', 'uGlow2']) V3M.u[k] = gl.getUniformLocation(pr, k);
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
// 一个实例：x、y 世界坐标，z 高度，a 世界朝向（屏幕坐标角），k 比例，side 0 我 / 1 敌 / 2 残骸，roll 滚转
function v3mAdd(key, build, x, y, z, a, k, side, roll = 0) {
  let L = V3M.inst.get(key);
  if (!L) { L = { build, d: [] }; V3M.inst.set(key, L); }
  L.d.push(x, -y, z, -a, k, side, roll, 0);
}
const v3mHex = h => { const s = String(h).replace('#', ''), v = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
function v3mPalette(gl) {
  const real = typeof realLook === 'function' && realLook() && !(typeof greenLook === 'function' && greenLook()), U = V3M.u;
  gl.uniform1f(U.uMode, real ? 1 : 0);
  if (real) {
    gl.uniform3f(U.uBody0, .36, .4, .31); gl.uniform3f(U.uBody1, .5, .45, .34); gl.uniform3f(U.uBody2, .13, .12, .1);
    const g = v3mHex(COL.g), e = v3mHex(COL.enemy);
    gl.uniform3f(U.uGlow0, g[0], g[1], g[2]); gl.uniform3f(U.uGlow1, e[0], e[1], e[2]); gl.uniform3f(U.uGlow2, .2, .16, .1);
  } else {
    gl.uniform3f(U.uBody0, .02, .1, .055); gl.uniform3f(U.uBody1, .13, .025, .035); gl.uniform3f(U.uBody2, .035, .032, .025);
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
  const spec = S.role === 'spectate' || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e')), near = CAM.z / CAM.fit > 2.2, t = performance.now() / 1000;
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
    v3mAdd('vh:' + bk, () => V.hull, v.x, v.y, z, h, k, sd);
    if (V.tur.t.length) {
      const c = Math.cos(h), s = Math.sin(h), px0 = v.x + (V.piv[0] * c - V.piv[1] * s) * k, py0 = v.y + (V.piv[0] * s + V.piv[1] * c) * k, aim = v.dead ? h + .6 : (v.aim ?? h);
      v3mAdd('vt:' + bk, () => V.tur, px0, py0, z, aim, k, sd);
      if (V.rad && !v.dead) { const [rx, ry, rr, rz] = V.rad, ca = Math.cos(aim), sa = Math.sin(aim); v3mAdd('rad:' + rr, () => v3mRadar(rr), px0 + (rx * ca - ry * sa) * k, py0 + (rx * sa + ry * ca) * k, z + (rz + .45) * k, t * 3 + v.id, k, sd); }
    }
  }
  // 步兵（近看才画）：三人按二维画面的三角站位，按兵种与姿态选模型
  if (near) for (const q of S.teams) {
    if (!q.men.length || q.ride || q.boarded || !inB(q.x, q.y) || (q.side === 'e' && !seen(q.x, q.y))) continue;
    const f = typeof faceDraw === 'function' ? faceDraw(q) : faceOf(q), c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), sd = q.side === 'e' ? 1 : 0, at = q.mod && q.mod.at;
    q.men.forEach((role, i) => {
      if (i > 2) return;
      let mx = q.x + MO[i][0] * c - MO[i][1] * s, my = q.y + MO[i][0] * s + MO[i][1] * c;
      const bo = typeof bldOut === 'function' && bldOut(mx, my, .5);
      if (bo) [mx, my] = bo;
      const kind = at && i === 2 ? 'at' : role === 'aa' ? 'aa' : role === 'mg' ? 'mg' : role === 'radio' ? 'radio' : role === 'eng' ? 'eng' : 'rifle';
      const pr = !!q.prone && kind !== 'aa' && kind !== 'at', pk = kind === 'mg' ? 'mg' : 'rifle';
      v3mAdd('man:' + (pr ? pk + ':p' : kind), () => v3mMan(pr ? pk : kind, pr), mx, my, v3Ht(mx, my), f, 2.4, sd);
    });
  }
  // 舰艇：位置、航向、远景放大系数跟二维画面一致（ships.js 的姿态缓存）
  const pose = (key, o, hd) => { const P = typeof SHIPV === 'object' && SHIPV.pose[key]; return P && dist(P.x, P.y, o.x, o.y) < 60 ? P : { x: o.x, y: o.y, h: hd, k: 1 }; };
  for (const sh of S.ships) {
    if (!alive(sh) || !inB(sh.x, sh.y, 80)) continue;
    const d = (typeof SHIP_DIM === 'object' && SHIP_DIM[sh.kind]) || [32, 11], P = pose(sh.id, sh, sh.heading ?? -1.57), nm = (sh.sbxCls && sh.sbxCls.name) || '';
    const kind = sh.kind === 'dd' ? (/055/.test(nm) ? 'ddA' : /054/.test(nm) ? 'ffg' : 'ddB') : sh.kind;
    v3mAdd('sh:' + kind, () => v3mShip(kind, d[0], d[1]), P.x, P.y, -2.6, P.h, P.k, 0);
  }
  for (const bt of S.boats || []) if (!bt.dead && isFinite(bt.x) && inB(bt.x, bt.y)) v3mAdd('sh:boat', () => v3mShip('boat', 12, 5), bt.x, bt.y, -2.6, bt.heading ?? -1.57, 1, 0);
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && inB(S.dd.x, S.dd.y, 80)) { const P = pose('DD', S.dd, S.dd.heading ?? -1.57), A = /055/.test(S.dd.name || '055'); v3mAdd('sh:' + (A ? 'ddA' : 'ddB'), () => v3mShip(A ? 'ddA' : 'ddB', 50, 9), P.x, P.y, -2.6, P.h, P.k, 0); }
  if (typeof cvAll === 'function') for (const cv of cvAll()) {
    if (!(cv.hp > 0) || cv.x < -999 || !inB(cv.x, cv.y, 160)) continue;
    const lhd = /075/.test(cv.name || ''), h = cv.heading ?? -1.57;
    v3mAdd('cv:' + (lhd ? 1 : 0), () => v3mCarrier(lhd), cv.x, cv.y, -2.6, h, 1, 0);
    if (typeof cvPark === 'function' && S.air && typeof CVG === 'object') {   // 甲板上的舰载机：与二维画面同一套停机位
      const home = cvHome(cv), wing = S.air.wing.filter(w => cvHome(w) === home && !(typeof airLandW === 'function' && airLandW(w)));
      for (const [id, j] of cvPark(cv, wing)) {
        const w = wing.find(o => o.id === id), sl = CVG.slots[j];
        if (!w || !sl) continue;
        const [wx, wy] = cvW(sl[0], sl[1], cv), key = typeof airSilKey === 'function' ? airSilKey(w.type, w.v) : 'j35', sz = (typeof airMdl === 'function' && airMdl(w.type, w.v).size) || 15;
        v3mAdd('pl:' + key, () => v3mPlane(key), wx, wy, -2.6 + 7.4 + .55, h + sl[2], sz / 21 * .9, 0);
      }
    }
  }
  for (const e of S.eships || []) if (!e.dead && inB(e.x, e.y, 80) && (spec || seen(e.x, e.y) || S.t - (e.det ?? -99) < 4)) { const C0 = (typeof NV_CLS === 'object' && NV_CLS[e.cls]) || { L: 46, B: 9 }; v3mAdd('es:' + e.cls, () => v3mEShip(e.cls, C0.L, C0.B), e.x, e.y, -2.6, e.heading ?? -1.57, 1, 1); }
  for (const s of S.subs || []) if (!s.dead && inB(s.x, s.y) && (spec || (typeof asSubSeen === 'function' && asSubSeen(s)))) v3mAdd('sub', v3mSub, s.x, s.y, -4.2, s.heading || 0, 1, 1);
  // 守方阵地
  for (const e of S.enemies) {
    if (e.kind === 'airfield' || !inB(e.x, e.y) || (e.dead && e.kind !== 'bunker')) continue;
    if (!seen(e.x, e.y) && e.kx == null) continue;
    const a = typeof gunAim === 'function' ? gunAim(e, t) : (e.th ?? 1.57), z0 = v3Ht(e.x, e.y), ca = Math.cos(a), sa = Math.sin(a), at = (u, v) => [e.x + u * ca - v * sa, e.y + u * sa + v * ca];
    v3mAdd('st:' + e.kind, () => v3mFort(e.kind), e.x, e.y, z0, a, 1, e.dead ? 2 : 1);
    if (!e.dead && e.kind === 'typhon' && typeof TY_RIG === 'object') for (let k = 0; k < TY_RIG.n; k++) {   // 发射箱：绕拖车尾部铰点起竖（antiship.js tyErect）
      const [px0, py0] = at(TY_RIG.piv, (k - (TY_RIG.n - 1) / 2) * TY_RIG.gap);
      v3mAdd('ty:box', v3mTyBox, px0, py0, z0 + 2.4, a + Math.PI / 2, 1, 1, tyErect(e, k));
    }
    if (!e.dead && e.kind === 'ascm' && typeof ASC_RIG === 'object') for (let k = 0; k < ASC_RIG.n; k++) {   // 发射箱：转台转向目标、仰起（missile.js ascPose）
      const P = ascPose(e, k), v0 = (k - (ASC_RIG.n - 1) / 2) * ASC_RIG.gap, b = a + P.tr, [cx, cy] = at(-3.4, v0), o = ASC_RIG.piv + 3.4;
      v3mAdd('asc:can', v3mAscCan, cx + Math.cos(b) * o, cy + Math.sin(b) * o, z0 + 3.1, b + Math.PI / 2, 1, 1, P.el);
    }
  }
  // 降落伞（para.js 伞兵 / 补给、abn.js 空降兵、a101.js 美军 101 空降师）：从运输机高度按下降进度落到地面，伞衣轻轻摆动
  const chutes = (L, jump, sd) => { for (const c of L || []) {   // 天上的伞衣老远就看得见：双方都画（与平面画面一致）
    if (c.done || !(c.t >= 0) || !isFinite(c.x) || !inB(c.x, c.y) || (c.k === 'team' && !(c.men && c.men.length))) continue;
    const f = clamp(1 - c.t / jump(c), 0, 1), z = v3Ht(c.x, c.y) + 1.5 + f * 120 + (c.k === 'veh' ? 11.3 : 7.4) * 2.2, id = c.id ?? (c.x * 7 + c.y * 3);
    v3mAdd('chute:' + c.k, () => v3mChute(c.k), c.x, c.y, z, Math.sin(id) * 3, 2.2, sd, Math.sin(t * 1.3 + id) * .09);
  } };
  if (S.para && typeof PA === 'object') chutes(S.para.ch, c => c.k === 'crate' ? PA.jump : c.role ? PA.jlJump : PA.jump, 0);
  if (S.ab && typeof AB === 'object') chutes(S.ab.ch, c => c.k === 'veh' ? AB.heavy : AB.jump, 0);
  if (S.e101 && typeof A101 === 'object') chutes(S.e101.ch, c => c.k === 'veh' ? A101.heavy : A101.jump, 1);
  // 飞机：高度与 3D 地图里的标识一致（view3d.js v3AirZ：甲板上贴着甲板，空中按高度），按滚转角倾斜；直升机主旋翼转动
  const plane = (o, hd, sd, key, sz, bank) => {
    const x = o.x, y = o.y, z = v3AirZ(o), k = sz / 21;
    v3mAdd('pl:' + key, () => v3mPlane(key), x, y, z, hd || 0, k, sd, bank || 0);
    if (V3_PLANE_TAIL[key] === 'heli') v3mAdd('rotor', () => v3mRotor(4, 7.5), x + Math.cos(hd || 0) * 1.2 * k, y + Math.sin(hd || 0) * 1.2 * k, z + 2.7 * k, t * 22, k, sd);
  };
  for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && inB(p.x, p.y, 220)) {
    const key = typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : 'j35', sz = (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || ((typeof AIR_SPEC === 'object' && AIR_SPEC[p.kind]) || {}).size || 15;
    plane(p, p.heading, 0, key, sz, p.bank);
  }
  const EA_K = { ga: ['a10', 18], heli: ['ah64', 16], uh60: ['uh60', 17], c17: ['c17', 30], ftr: ['f35', 17], f22: ['f22', 18], b2: ['b2', 34], p8: ['p8', 26] };
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && isFinite(a.x) && a.ph !== 'roll' && (spec || a.pv || seen(a.x, a.y)) && inB(a.x, a.y, 220)) { const [key, sz] = EA_K[a.type] || ['f35', 17]; plane(a, a.heading, 1, key, sz, a.bank); }
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
