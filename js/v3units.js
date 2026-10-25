'use strict';
// 3D 立体地图里的兵种模型（view3d.js v3Draw 在地形、房屋之后调用 v3Units）
// 步兵：每组三人（站立 / 卧倒，持枪），近看才画；坦克 / 装甲车 / 自行火炮 / 防空车：车体按写实画面的俯视外形（models.js RLM，单位：米）挤出，
//   履带车两侧画履带、轮式车画车轮，炮塔按瞄准方向转动、炮管伸出；登陆舰艇、驱逐舰、航母（飞行甲板 + 右舷舰岛）、守方水面舰艇与潜艇；
//   飞机按高度悬空（战斗机、大型机、B-2 飞翼）；守方碉堡、火炮、高炮、导弹发射车。
// 画法：每帧把贴图覆盖范围内看得见的单位在 CPU 上按位置、朝向拼成一批三角形（位置、法线、颜色各 3 个浮点），一次画完；
//   平面图标仍留在地面贴图上，看起来像落在地上的影子。单位颜色：我方用阵营色、敌方用敌方色，与画面风格（黑绿 / 写实 / 数码）一致
const V3U = { ok: false, tried: false, pr: null, u: {}, a: {}, vb: null, buf: new Float32Array(1 << 16), n: 0 };
const V3U_VS = `attribute vec3 p; attribute vec3 n; attribute vec3 c;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vN, vC, vV; varying float vD;
void main() { vN = n; vC = c; vV = uEye - p; vD = distance(p, uEye); gl_Position = uM * vec4(p, 1.); }`;
const V3U_FS = `precision mediump float;
uniform vec2 uFog; uniform vec3 uBg;
varying vec3 vN, vC, vV; varying float vD;
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  float lit = clamp(dot(N, normalize(vec3(-.45, .55, .7))), 0., 1.), rim = pow(1. - clamp(dot(N, V), 0., 1.), 2.5);
  vec3 c = vC * (.42 + .78 * lit) + vC * rim * .55;
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
function v3uInit(gl) {
  V3U.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3U_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3U_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3U.pr = pr;
    for (const k of ['p', 'n', 'c']) V3U.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uFog', 'uBg']) V3U.u[k] = gl.getUniformLocation(pr, k);
    V3U.vb = gl.createBuffer();
    V3U.ok = true;
  } catch (e) { V3U.ok = false; console.warn('3D 兵种模型不可用', e); }
}

// —— 拼装：T = 局部坐标系（x 向前、y 向右、z 向上）在世界里的位置、朝向与比例 ——
function v3uPush(x, y, z, nx, ny, nz, c) {
  let B = V3U.buf;
  if (V3U.n + 9 > B.length) { const nb = new Float32Array(B.length * 2); nb.set(B); V3U.buf = B = nb; }
  const i = V3U.n;
  B[i] = x; B[i + 1] = y; B[i + 2] = z; B[i + 3] = nx; B[i + 4] = ny; B[i + 5] = nz; B[i + 6] = c[0]; B[i + 7] = c[1]; B[i + 8] = c[2];
  V3U.n = i + 9;
}
const v3uT = (x, y, z, a, k = 1) => ({ x, y, z, c: Math.cos(a), s: Math.sin(a), k });
const v3uSub = (T, lx, ly, a) => { const w = v3uW(T, lx, ly, 0); return { x: w[0], y: -w[1], z: T.z, c: Math.cos(Math.atan2(T.s, T.c) + a), s: Math.sin(Math.atan2(T.s, T.c) + a), k: T.k }; };   // 子坐标系（炮塔）：在 (lx, ly) 处再转 a
// 局部点 → GL 坐标（x 东、y 北、z 上；世界 y 向南取负）
function v3uW(T, lx, ly, lz) { const k = T.k, wx = T.x + (lx * T.c - ly * T.s) * k, wy = T.y + (lx * T.s + ly * T.c) * k; return [wx, -wy, T.z + lz * k]; }
function v3uN(T, nx, ny, nz) { return [nx * T.c - ny * T.s, -(nx * T.s + ny * T.c), nz]; }
function v3uTri(T, a, b, c, n, col) {
  const N = v3uN(T, n[0], n[1], n[2]);
  for (const p of [a, b, c]) { const w = v3uW(T, p[0], p[1], p[2]); v3uPush(w[0], w[1], w[2], N[0], N[1], N[2], col); }
}
function v3uQuad(T, a, b, c, d, n, col) { v3uTri(T, a, b, c, n, col); v3uTri(T, a, c, d, n, col); }
// 长方体（不画底面）；top：顶面另一种颜色
function v3uBox(T, x0, x1, y0, y1, z0, z1, col, top) {
  v3uQuad(T, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], top || col);
  v3uQuad(T, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col);
  v3uQuad(T, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], col);
  v3uQuad(T, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col);
  v3uQuad(T, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0], col);
}
// 多边形柱体：侧面 + 顶面（扇形三角化；车体外形都是凸的或近似凸）
function v3uPrism(T, poly, z0, z1, col, top) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0] / n; cy += p[1] / n; }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    const nn = [ey / l * sg, -ex / l * sg, 0];
    v3uQuad(T, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], nn, col);
    v3uTri(T, [cx, cy, z1], [a[0], a[1], z1], [b[0], b[1], z1], [0, 0, 1], top || col);
  }
}
const v3uOct = (r, sx = 1, ox = 0) => Array.from({ length: 8 }, (_, i) => { const a = (i + .5) * Math.PI / 4; return [ox + Math.cos(a) * r * sx, Math.sin(a) * r]; });
const v3uMix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function v3uRGB(hex) { const h = String(hex).replace('#', ''), v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; }
// 阵营配色：车体暗、炮塔与上表面亮一档
function v3uPal(side, dead) {
  const sc = v3uRGB(side === 'e' ? COL.enemy : COL.g), real = typeof realLook === 'function' && realLook() && !(typeof greenLook === 'function' && greenLook());
  const base = real ? (side === 'e' ? [.42, .38, .3] : [.36, .42, .34]) : [.05, .12, .08];
  if (dead) return { body: [.12, .11, .1], top: [.16, .14, .12], hi: [.2, .17, .14], dark: [.06, .06, .06] };
  return { body: v3uMix(base, sc, real ? .28 : .55), top: v3uMix(base, sc, real ? .4 : .8), hi: v3uMix(sc, [1, 1, 1], .25), dark: v3uMix(base, [0, 0, 0], .5) };
}

// —— 各兵种 ——
function v3uVeh(v) {
  const sp = vehSp(v), M = typeof rlModelOf === 'function' ? rlModelOf(v) : null, L = M ? M.L : sp.len / 2.2, B = M ? M.B : sp.wid / 2.2, k = sp.len / L;
  const z = v3Ht(v.x, v.y), P = v3uPal(v.side, v.dead), T = v3uT(v.x, v.y, z, v.heading || 0, k);
  const wheel = M ? M.run === 'w' : !!sp.wheel, tw = M && M.tw ? M.tw : .55;
  if (!wheel) for (const s of [-1, 1]) v3uBox(T, -L / 2, L / 2, s > 0 ? B / 2 - tw : -B / 2, s > 0 ? B / 2 : -B / 2 + tw, 0, .95, P.dark);   // 履带
  else for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const x = -L * .36 + i * L * .24; v3uBox(T, x - .5, x + .5, s * B / 2 - .25, s * B / 2 + .25, 0, 1, P.dark); }   // 车轮
  const hull = M && M.hull ? M.hull : [[L / 2, -B / 2], [L / 2, B / 2], [-L / 2, B / 2], [-L / 2, -B / 2]];
  const hs = wheel ? .95 : .9;
  v3uPrism(T, hull.map(([x, y]) => [x, y * hs]), wheel ? .7 : .45, wheel ? 2.1 : 1.75, P.body, P.top);
  const tur = M ? M.tur : sp.tur ? { x: 0 } : null, aim = (v.aim ?? v.heading ?? 0) - (v.heading || 0);
  const top = wheel ? 2.1 : 1.75;
  if (tur) {
    const r = Math.min(B * .4, L * .26) * (sp.tur ? Math.max(.75, Math.min(1.3, sp.tur / 3.8)) : 1);
    const TT = v3uSub(T, tur.x || 0, tur.y || 0, aim);
    v3uPrism(TT, v3uOct(r, 1.25), top, top + .8, P.top, P.hi);
    const g = M && M.gun;
    if (g && sp.gun) { const r0 = Math.max(.12, g.r * 1.4); v3uBox(TT, g.x0 || r * 1.1, (g.x0 || r * 1.1) + g.len, -r0, r0, top + .3, top + .3 + r0 * 2, P.hi); }
    else if (sp.aa || sp.sam) { v3uBox(TT, 0, r * 2.4, -.55, -.35, top + .55, top + .8, P.hi); v3uBox(TT, 0, r * 2.4, .35, .55, top + .55, top + .8, P.hi); if (sp.sam) v3uBox(TT, -r * .8, r * .2, -r * .9, r * .9, top + .8, top + 1.3, P.top); }
    else if (sp.mg) v3uBox(TT, r * .5, r * 1.8, -.1, .1, top + .55, top + .75, P.hi);
  } else if (sp.gun) {   // 无炮塔（突击炮 / 自行火炮车体固定战斗室）：车体前部的炮
    v3uBox(T, -L * .1, L * .25, -B * .32, B * .32, top, top + .7, P.top, P.hi);
    v3uBox(T, L * .2, L * .2 + (sp.bar || 9) / k, -.16, .16, top + .2, top + .5, P.hi);
  }
}
function v3uMen(q) {
  const P = v3uPal(q.side), f = typeof faceDraw === 'function' ? faceDraw(q) : faceOf(q), c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), n = q.men.length;
  for (let i = 0; i < n; i++) {
    const mx = q.x + MO[i][0] * c - MO[i][1] * s, my = q.y + MO[i][0] * s + MO[i][1] * c, T = v3uT(mx, my, v3Ht(mx, my), f, 1);
    if (q.prone) { v3uBox(T, -2, 1.4, -.65, .65, 0, .8, P.body, P.top); v3uBox(T, 1.4, 2.1, -.4, .4, 0, .75, P.hi); v3uBox(T, 1.6, 3.4, .45, .65, .2, .4, P.dark); continue; }
    v3uBox(T, -.45, .45, -.75, .75, 0, 3.3, P.body, P.top);   // 身体
    v3uBox(T, -.38, .38, -.38, .38, 3.4, 4.2, P.hi);   // 头盔
    const role = q.men[i];
    if (role === 'aa' || (q.mod && q.mod.at && i === 2)) v3uBox(T, -1.6, 1.4, .55, .95, 3.2, 3.6, P.dark);   // 扛在肩上的导弹 / 火箭筒
    else v3uBox(T, .3, role === 'mg' ? 2.6 : 2.2, .55, .78, 2.4, 2.65, P.dark);   // 枪
  }
}
function v3uShip(x, y, hd, L, B, side, kind) {
  const P = v3uPal(side), T = v3uT(x, y, -2.6, hd, 1), bow = Math.min(B * 1.2, L * .25);
  const hull = [[L / 2, 0], [L / 2 - bow, B / 2], [-L / 2, B / 2], [-L / 2, -B / 2], [L / 2 - bow, -B / 2]];
  v3uPrism(T, hull, 0, kind === 'cv' ? 7 : 3.2, P.body, P.top);
  if (kind === 'cv') {   // 航母：外飘的飞行甲板、右舷舰岛
    v3uPrism(T, [[L / 2 - 4, -B * .45], [L / 2 - 4, B * .55], [-L / 2 + 2, B * .62], [-L / 2 + 2, -B * .55]], 7, 8.4, P.top, P.top);
    v3uBox(T, -L * .12, L * .06, B * .42, B * .62, 8.4, 19, P.body, P.hi);
    v3uBox(T, -L * .07, -L * .01, B * .46, B * .58, 19, 25, P.hi);
  } else if (kind === 'dd' || kind === 'eship') {   // 驱逐舰：前主炮、上层建筑、桅杆、烟囱
    v3uBox(T, L * .18, L * .28, -B * .16, B * .16, 3.2, 4.6, P.top, P.hi); v3uBox(T, L * .28, L * .38, -.25, .25, 3.9, 4.3, P.hi);
    v3uBox(T, -L * .12, L * .14, -B * .34, B * .34, 3.2, 8.2, P.body, P.top);
    v3uBox(T, -L * .02, L * .04, -.4, .4, 8.2, 15, P.hi);
    v3uBox(T, -L * .26, -L * .14, -B * .22, B * .22, 3.2, 7, P.body, P.top);
  } else if (kind === 'lst' || kind === 'supply') {   // 坦克登陆舰 / 后勤舰：尾部上层建筑，前甲板空
    v3uBox(T, -L / 2 + 1, -L * .18, -B * .4, B * .4, 3.2, 8, P.body, P.top);
    v3uBox(T, -L * .3, -L * .24, -.3, .3, 8, 12, P.hi);
  } else {   // 登陆艇：尾部驾驶室、艏门
    v3uBox(T, -L / 2 + .5, -L * .25, -B * .3, B * .3, 3.2, 5.6, P.body, P.top);
    v3uBox(T, L / 2 - bow - 1, L / 2 - bow, -B * .45, B * .45, 3.2, 4.4, P.top);
  }
}
function v3uSubm(s) {
  const P = v3uPal('e'), T = v3uT(s.x, s.y, -3.4, s.heading || 0, 1);
  v3uPrism(T, v3uOct(3.3, 5.4), 0, 2.2, P.body, P.top);
  v3uBox(T, 2, 6.5, -1, 1, 2.2, 6.4, P.top, P.hi);
}
// 飞机：高度与 3D 地图里的标识一致（离地 30 + 高度 × 200）
function v3uPlane(x, y, alt, hd, side, kind) {
  const P = v3uPal(side), z = v3Ht(x, y) + 30 + clamp(alt ?? 1, 0, 1) * 200, T = v3uT(x, y, z, hd || 0, 1);
  if (kind === 'b2') {   // 飞翼
    v3uPrism(T, [[9, 0], [-4, 26], [-8, 22], [-5, 8], [-9, 4], [-6, 0], [-9, -4], [-5, -8], [-8, -22], [-4, -26]], 0, 1.6, P.body, P.top);
    return;
  }
  const big = kind === 'big', heli = kind === 'heli', s = big ? 2.2 : 1;
  if (heli) { v3uBox(T, -3, 4, -1.4, 1.4, 0, 2.6, P.body, P.top); v3uBox(T, -10, -3, -.4, .4, .8, 1.6, P.body); v3uBox(T, -6, 6, -.25, .25, 3, 3.2, P.hi); v3uBox(T, -.25, .25, -6, 6, 3, 3.2, P.hi); return; }
  v3uBox(T, -8 * s, 8 * s, -1 * s, 1 * s, 0, 1.6 * s, P.body, P.top);   // 机身
  v3uPrism(T, [[2 * s, 0], [-3 * s, 8 * s], [-5 * s, 8 * s], [-3 * s, 0], [-5 * s, -8 * s], [-3 * s, -8 * s]], .5 * s, .9 * s, P.top, P.hi);   // 机翼
  v3uBox(T, -8 * s, -5.5 * s, -.2 * s, .2 * s, 1.6 * s, 4.4 * s, P.top);   // 垂尾
  v3uBox(T, -8 * s, -6 * s, -3 * s, 3 * s, 1 * s, 1.3 * s, P.top);   // 平尾
}
function v3uFort(e) {
  const P = v3uPal('e', e.dead), z = v3Ht(e.x, e.y), a = typeof gunAim === 'function' ? gunAim(e, performance.now() / 1000) : (e.th ?? Math.PI / 2), T = v3uT(e.x, e.y, z, a, 1);
  if (e.kind === 'bunker') { v3uBox(T, -8, 8, -8, 8, 0, 5, P.body, P.top); v3uBox(T, 8, 9, -3, 3, 2, 3.2, P.dark); return; }
  if (e.kind === 'tel' || e.kind === 'typhon' || e.kind === 'ascm') {
    v3uBox(T, -10, 7, -3.2, 3.2, 0, 3.2, P.body, P.top); v3uBox(T, 7, 11, -3, 3, 0, 4, P.top);
    const up = (e.fireT != null && S.t - e.fireT < 3) ? .9 : .25;
    v3uBox(T, -9.5, -9.5 + 14 * Math.cos(up), -1.6, 1.6, 3.2, 3.2 + 14 * Math.sin(up) * .5 + 2, P.hi);
    return;
  }
  // 火炮 / 岸防炮 / 高炮：炮位土堤、炮架、炮管
  const big = e.kind === 'coastal' ? 1.5 : 1;
  v3uPrism(T, v3uOct(9 * big, 1), 0, 1.6, P.dark, P.dark);
  v3uBox(T, -3 * big, 3 * big, -3 * big, 3 * big, 1.6, 4 * big, P.body, P.top);
  if (e.kind === 'aa') { v3uBox(T, 2, 10, -1.4, -.8, 4, 5, P.hi); v3uBox(T, 2, 10, .8, 1.4, 4, 5, P.hi); }
  else v3uBox(T, 2 * big, (e.kind === 'mortar' ? 6 : 15) * big, -.6 * big, .6 * big, 3 * big, 4 * big, P.hi);
}

// 每帧：拼好可见范围内的单位一次画完。近看（地图缩放 2.2 倍以上）才画步兵小人
function v3Units(C, box) {
  if (!S || !V3.gl) return;
  const gl = V3.gl;
  if (!V3U.tried) v3uInit(gl);
  if (!V3U.ok) return;
  V3U.n = 0;
  const [bx, by, bw, bh] = box, inB = (x, y, m = 40) => x > bx - m && x < bx + bw + m && y > by - m && y < by + bh + m;
  const spec = S.role === 'spectate' || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e')), near = CAM.z / CAM.fit > 2.2;
  const seen = (x, y) => inVision(x, y);
  for (const v of S.veh || []) {
    if (v.lst || !inB(v.x, v.y) || (v.dead && S.t - (v.deadT ?? 0) > 120)) continue;
    if (v.side === 'e' && !seen(v.x, v.y) && !v.dead) continue;
    v3uVeh(v);
  }
  if (near) for (const q of S.teams) {
    if (!q.men.length || q.ride || q.boarded || !inB(q.x, q.y) || (q.side === 'e' && !seen(q.x, q.y))) continue;
    v3uMen(q);
  }
  for (const s of S.ships) if (alive(s) && inB(s.x, s.y)) { const d = (typeof SHIP_DIM === 'object' && SHIP_DIM[s.kind]) || [32, 11]; v3uShip(s.x, s.y, s.heading, d[0], d[1], 'p', s.kind); }
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && inB(S.dd.x, S.dd.y)) v3uShip(S.dd.x, S.dd.y, S.dd.heading ?? -Math.PI / 2, 60, 11, 'p', 'dd');
  if (typeof cvAll === 'function') for (const c of cvAll()) if (c.hp > 0 && c.x > -999 && inB(c.x, c.y, 120)) v3uShip(c.x, c.y, c.heading ?? -Math.PI / 2, 150, 26, 'p', 'cv');
  for (const e of S.eships || []) if (!e.dead && inB(e.x, e.y) && (spec || seen(e.x, e.y) || S.t - (e.det ?? -99) < 4)) { const C0 = typeof NV_CLS === 'object' && NV_CLS[e.cls] || { L: 46, B: 9 }; v3uShip(e.x, e.y, e.heading, C0.L * 1.2, C0.B * 1.1, 'e', 'eship'); }
  for (const s of S.subs || []) if (!s.dead && inB(s.x, s.y) && (spec || (typeof asSubSeen === 'function' && asSubSeen(s)))) v3uSubm(s);
  for (const e of S.enemies) {
    if (e.kind === 'airfield' || !inB(e.x, e.y) || (e.dead && e.kind !== 'bunker')) continue;
    if (!seen(e.x, e.y) && e.kx == null) continue;
    v3uFort(e);
  }
  for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && inB(p.x, p.y, 200)) v3uPlane(p.x, p.y, p.alt, p.heading, 'p', p.kind === 'bomber' || p.kind === 'transport' || p.kind === 'recon' && p.v !== 'wz7' ? 'big' : p.v === 'heli' || p.kind === 'heli' ? 'heli' : 'ftr');
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && isFinite(a.x) && a.ph !== 'roll' && (spec || a.pv) && inB(a.x, a.y, 200)) v3uPlane(a.x, a.y, a.alt, a.heading, 'e', a.type === 'b2' ? 'b2' : a.type === 'heli' || a.type === 'uh60' ? 'heli' : a.type === 'c17' || a.type === 'p8' ? 'big' : 'ftr');
  if (!V3U.n) return;
  gl.useProgram(V3U.pr);
  gl.uniformMatrix4fv(V3U.u.uM, false, C.M);
  gl.uniform3f(V3U.u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(V3U.u.uFog, C.D * 1.3, C.D * 2.8);
  gl.uniform3f(V3U.u.uBg, .004, .02, .011);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3U.vb);
  gl.bufferData(gl.ARRAY_BUFFER, V3U.buf.subarray(0, V3U.n), gl.DYNAMIC_DRAW);
  const A = V3U.a;
  gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(A.c); gl.vertexAttribPointer(A.c, 3, gl.FLOAT, false, 36, 24);
  gl.drawArrays(gl.TRIANGLES, 0, V3U.n / 9);
  gl.disableVertexAttribArray(A.p); gl.disableVertexAttribArray(A.n); gl.disableVertexAttribArray(A.c);
}
