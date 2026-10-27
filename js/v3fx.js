'use strict';
// 3D 弹道（view3d.js v3Draw 在兵种模型之后调用 v3Fx）：子弹、炮弹、导弹都在空中立体地飞——
//   炮弹（榴弹炮、舰炮、迫击炮）走抛物线弹道，弹头一个亮点、后面拖一段渐暗的光迹；炸弹从飞机的高度加速落下；
//   步兵曳光弹、坦克炮弹在枪口 / 炮口的高度平直飞过去（穿甲弹白热、榴弹琥珀色、喷火是一股宽的橙色火舌）；
//   导弹（战术导弹、防空导弹、反舰导弹、精确制导炸弹）按各自的飞行高度飞，尾焰亮点加一条渐暗的尾迹；直升机的火箭、反坦克导弹从机上射向地面
// 画法：面向镜头的发光带（宽度按世界单位），加法混合、不写深度，被地形、房屋、车辆挡住的部分不画；3D 时平面贴图里不再画这些弹道（R.fx3d）
const V3F = { ok: false, tried: false, pr: null, a: {}, u: {}, buf: null, trail: new Map(), S: null, puff: [], seen: new Set() };   // puff：发射点的点火闪光与烟团（只在画面里记）
const V3F_VS = `attribute vec3 p; attribute vec4 c; attribute vec2 q;
uniform mat4 uM; varying vec4 vC; varying vec2 vQ;
void main() { vC = c; vQ = q; gl_Position = uM * vec4(p, 1.); }`;
const V3F_FS = `precision mediump float;
varying vec4 vC; varying vec2 vQ;
void main() {
  float r = dot(vQ, vQ), a = vC.a * exp(-2.6 * r) * step(r, 1.);
  gl_FragColor = vec4(vC.rgb * a + vec3(1.) * a * a * .35, a);   // 中心发白
}`;
function v3fxInit(gl) {
  V3F.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3F_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3F_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    Object.assign(V3F, { pr, a: { p: gl.getAttribLocation(pr, 'p'), c: gl.getAttribLocation(pr, 'c'), q: gl.getAttribLocation(pr, 'q') }, u: { uM: gl.getUniformLocation(pr, 'uM') }, buf: gl.createBuffer(), ok: true });
  } catch (e) { V3F.ok = false; console.warn('3D 弹道不可用', e); }
}
// 世界坐标 + 高度 → GL 坐标
const v3fP = (x, y, z) => [x, -y, z];
// 发光带：p0 → p1，宽 w，两头颜色 c0 / c1（rgba）；顶点 = 位置 3、颜色 4、带内坐标 2
function v3fRib(out, E, p0, p1, w, c0, c1) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], m = [(p0[0] + p1[0]) / 2 - E[0], (p0[1] + p1[1]) / 2 - E[1], (p0[2] + p1[2]) / 2 - E[2]];
  let s = [d[1] * m[2] - d[2] * m[1], d[2] * m[0] - d[0] * m[2], d[0] * m[1] - d[1] * m[0]];
  const l = Math.hypot(s[0], s[1], s[2]);
  if (l < 1e-6) return;
  s = [s[0] / l * w / 2, s[1] / l * w / 2, s[2] / l * w / 2];
  const V = (p, sg, c) => out.push(p[0] + s[0] * sg, p[1] + s[1] * sg, p[2] + s[2] * sg, c[0], c[1], c[2], c[3], 0, sg);
  V(p0, -1, c0); V(p0, 1, c0); V(p1, 1, c1); V(p0, -1, c0); V(p1, 1, c1); V(p1, -1, c1);
}
// 亮点：面向镜头的方块（镜头的右、上轴），半径 r
function v3fSpark(out, C, p, r, c) {
  const X = C.x, Y = C.y, P = (a, b) => out.push(p[0] + (X[0] * a + Y[0] * b) * r, p[1] + (X[1] * a + Y[1] * b) * r, p[2] + (X[2] * a + Y[2] * b) * r, c[0], c[1], c[2], c[3], a, b);
  P(-1, -1); P(1, -1); P(1, 1); P(-1, -1); P(1, 1); P(-1, 1);
}
// 一条沿参数曲线 f(u)（返回 GL 坐标）的光迹：从 u0 到 u1 分 n 段，越靠弹头越亮
function v3fTrail(out, E, f, u0, u1, n, w, col) {
  let prev = f(u0);
  for (let i = 1; i <= n; i++) {
    const u = lerp(u0, u1, i / n), p = f(u), k0 = (i - 1) / n, k1 = i / n;
    v3fRib(out, E, prev, p, w * (.5 + .5 * k1), [col[0], col[1], col[2], col[3] * k0 * k0], [col[0], col[1], col[2], col[3] * k1 * k1]);
    prev = p;
  }
}
// 垂发：舰上发射的导弹（vls 对陆、dd / esc 舰空、eship 敌舰）先从垂发单元舱口竖直冲出、升到几十米再转向目标；位置只在画面里改（逻辑照旧）
const V3F_SHIPSRC = { vls: 1, dd: 1, esc: 1, eship: 1 };
function v3VlsOrigin(m) {
  if (!V3F_SHIPSRC[m.src] || !isFinite(m.x0)) return null;
  const V = V3F.vo || (V3F.vo = new Map());
  if (V.has(m.id)) return V.get(m.id);
  let sh = null, bd = 45, cls = null;
  const take = (o, c) => { const d = dist(o.x, o.y, m.x0, m.y0); if (d < bd) { bd = d; sh = o; cls = c; } };
  if (m.src === 'eship') { for (const e of S.eships || []) if (!e.dead) take(e, null); }
  else { if (S.dd && S.dd.state !== 'sunk') take(S.dd, typeof vlsCls === 'function' ? vlsCls(S.dd) : '055'); for (const o of S.ships) if (o.kind === 'dd' && alive(o)) take(o, typeof vlsCls === 'function' ? vlsCls(o) : '052D'); }
  let o = null;
  if (sh) {
    const K = cls && typeof SH_DDC === 'object' ? SH_DDC[cls] : null, blocks = K ? K.vls : [[8, 13, 2.2]], b = blocks[m.id % blocks.length], k = K ? K.k : 1;
    const pseudo = (m.id * 9301 + 49297) % 233280 / 233280, pv = (m.id * 4271 + 113) % 1000 / 1000;
    const u = lerp(b[0], b[1], .15 + .7 * pseudo) * k, v = (pv * 2 - 1) * b[2] * .7 * k * (K ? K.w : 1);
    const key = sh === S.dd ? 'DD' : sh.id, P = typeof SHIPV === 'object' && SHIPV.pose[key], h = P ? P.h : (sh.heading ?? -1.57), px0 = P ? P.x : sh.x, py0 = P ? P.y : sh.y;
    o = { x: px0 + u * Math.cos(h) - v * Math.sin(h), y: py0 + u * Math.sin(h) + v * Math.cos(h), z: -2.6 + 2.8 * k + .3, h, up: m.kind === 'sam' ? .45 : .9 };
  }
  V.set(m.id, o);
  return o;
}
// 画面里导弹的位置：垂发冲出阶段竖直往上（加速），之后半秒内平滑接上实际弹道
function v3MslPos(m, zReal) {
  const o = v3VlsOrigin(m);
  if (!o) return null;
  const top = 34 * (o.up > .6 ? 1.3 : 1);
  if (m.t < o.up) { const u = clamp(m.t / o.up, 0, 1); return { x: o.x, y: o.y, z: o.z + top * Math.pow(u, 1.7), vls: true }; }
  const b = clamp((m.t - o.up) / .5, 0, 1), e = b * b * (3 - 2 * b);
  if (b >= 1) return null;
  return { x: lerp(o.x, m.x, e), y: lerp(o.y, m.y, e), z: lerp(o.z + top, zReal, e), vls: true };
}
const V3F_COL = { p: [.45, 1, .65, .9], e: [1, .32, .28, .9], amber: [1, .72, .3, .95], white: [1, .97, .88, 1], smoke: [.55, .62, .58, .5], flame: [1, .55, .15, .7] };

function v3Fx(C) {
  if (!S || !V3.gl) return;
  const gl = V3.gl;
  if (!V3F.tried) v3fxInit(gl);
  if (!V3F.ok) return;
  if (V3F.S !== S) { V3F.S = S; V3F.trail.clear(); V3F.puff.length = 0; V3F.seen.clear(); if (V3F.vo) V3F.vo.clear(); }
  const out = [], E = C.E, box = V3.box || [0, 0, W, H], inB = (x, y, m = 200) => x > box[0] - m && x < box[0] + box[2] + m && y > box[1] - m && y < box[1] + box[3] + m;
  const spec = specAll() || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e'));
  const seen = (x, y) => spec || inVision(x, y);
  const g = (x, y) => v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1));
  // —— 炮弹与炸弹 ——
  for (const s of S.shells || []) {
    if (s.t < 0 || !inB(s.x1, s.y1)) continue;
    const u = clamp(s.t / s.dur, 0, 1), sx = s.fuzzy ? s.fx0 : s.x0, sy = s.fuzzy ? s.fy0 : s.y0;
    if (s.side === 'e' && !s.fuzzy && !seen(s.x1, s.y1) && !seen(sx, sy)) continue;
    const d = dist(sx, sy, s.x1, s.y1), z0 = g(sx, sy) + 3, z1 = g(s.x1, s.y1);
    let f;
    if (s.kind === 'bomb') { const zt = Math.max(z1 + 60, v3AltZ(sx, sy, .95 * 230, -2.6, 1.5)); f = v => v3fP(lerp(sx, s.x1, v), lerp(sy, s.y1, v), z1 + (zt - z1) * (1 - v * v)); }   // 炸弹：从飞机高度（按海拔平飞）加速落下
    else { const apex = s.kind === 'mortar' ? Math.min(320, d * .75) : Math.min(420, d * .32); f = v => v3fP(lerp(sx, s.x1, v), lerp(sy, s.y1, v), lerp(z0, z1, v) + Math.sin(Math.PI * v) * apex); }
    const col = s.kind === 'smoke' ? V3F_COL.smoke : s.kind === 'bomb' ? V3F_COL.amber : s.side === 'p' ? V3F_COL.p : V3F_COL.e;
    v3fTrail(out, E, f, Math.max(0, u - .1), u, 6, s.kind === 'bomb' ? 2.2 : 1.8, col);
    v3fSpark(out, C, f(u), s.kind === 'bomb' ? 3.2 : 2.6, s.kind === 'smoke' ? col : V3F_COL.white);
  }
  // —— 步兵曳光弹：枪口高度平直飞 ——
  for (const t of S.tracers || []) {
    if (!inB(t.x1, t.y1, 60)) continue;
    const a = 1 - t.life / t.max, u = t.life / t.max, u0 = Math.max(0, u - .4), col = t.side === 'p' ? V3F_COL.p : V3F_COL.e;
    if (t.fuzzy) continue;   // 模糊曳光只在平面上示意方向
    const p0 = v3fP(lerp(t.x0, t.x1, u0), lerp(t.y0, t.y1, u0), g(t.x0, t.y0) + 1.6), p1 = v3fP(lerp(t.x0, t.x1, u), lerp(t.y0, t.y1, u), lerp(g(t.x0, t.y0) + 1.6, g(t.x1, t.y1) + 1, u));
    v3fRib(out, E, p0, p1, .7, [col[0], col[1], col[2], 0], [col[0], col[1], col[2], .95 * a]);
  }
  // —— 坦克炮、机关炮、喷火 ——
  for (const s of S.vshots || []) {
    if (!inB(s.x1, s.y1, 60)) continue;
    const u = clamp(s.t / s.dur, 0, 1), z0 = g(s.x0, s.y0) + 2.6, z1 = g(s.x1, s.y1) + 1.5;
    if (s.k === 'flame') {
      const f = v => v3fP(lerp(s.x0, s.x1, v), lerp(s.y0, s.y1, v), lerp(z0, z1, v) + Math.sin(Math.PI * v) * 2);
      v3fTrail(out, E, f, 0, Math.min(1, u * 2.5), 5, 5.5, [...V3F_COL.flame.slice(0, 3), .7 * (1 - u)]);
      continue;
    }
    const col = s.k === 'ap' ? V3F_COL.white : V3F_COL.amber, b = Math.max(0, u - .35);
    v3fRib(out, E, v3fP(lerp(s.x0, s.x1, b), lerp(s.y0, s.y1, b), lerp(z0, z1, b)), v3fP(lerp(s.x0, s.x1, u), lerp(s.y0, s.y1, u), lerp(z0, z1, u)), 1.3, [col[0], col[1], col[2], 0], col);
    if (u < .15) v3fSpark(out, C, v3fP(s.x0, s.y0, z0), 4.5 * (1 - u / .15), V3F_COL.amber);   // 炮口焰
  }
  // —— 导弹：按飞行高度；发射点一团点火闪光与翻滚扩散的烟；尾迹是近弹头一段亮的尾焰 + 后面 4 秒里慢慢变宽、变淡的烟迹 ——
  const live = new Set();
  for (const m of S.missiles || []) {
    if (m.t < 0 || m.done || !isFinite(m.x)) continue;
    live.add(m.id);
    if (!V3F.seen.has(m.id)) {   // 刚点火：在发射点记一团烟（离机的空射弹在挂点附近点火，不在地面）
      V3F.seen.add(m.id);
      const air = typeof AIRV === 'object' && AIRV.mv && AIRV.mv.has(m.id);
      const vo = v3VlsOrigin(m);
      if (vo && m.t < .6) V3F.puff.push({ x: vo.x, y: vo.y, z: vo.z, t0: S.t, big: m.kind !== 'sam', side: m.side, sea: true, vls: true, up: vo.up });
      else if (!air && m.t < .6 && isFinite(m.x0)) { const sea = !isLand(m.x0, m.y0); V3F.puff.push({ x: m.x0, y: m.y0, z: sea ? 4 : g(m.x0, m.y0) + 1.5, t0: S.t, big: m.kind === 'tbm' || m.kind === 'asm', side: m.side, sea }); }
    }
    if (!inB(m.x, m.y, 400) || (m.side === 'e' && !seen(m.x, m.y))) continue;
    const rp = typeof airRelPos === 'function' ? airRelPos(m, true) : null;   // 刚离机（airmdl.js）：没点火前是立体弹体（v3units.js），点火后光点从挂点接上弹道
    if (rp) { V3F.trail.delete(m.id); if (rp.lit) { const q = v3fP(rp.x, rp.y, airRelZ(rp, m)); v3fSpark(out, C, q, 2.2 + rp.e * 1.4, V3F_COL.amber); } continue; }
    const z0 = v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : 230), -2.6, 2), VP = v3MslPos(m, z0), p = VP ? v3fP(VP.x, VP.y, VP.z) : v3fP(m.x, m.y, z0);   // 与飞机同一套高度：低空沿地形包络、高空按海拔；垂发冲出阶段竖直往上
    let tr = V3F.trail.get(m.id);
    if (!tr) V3F.trail.set(m.id, tr = []);
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 2) tr.push([...p, S.t]);
    while (tr.length && S.t - tr[0][3] > 4) tr.shift();
    const col = m.side === 'p' ? V3F_COL.p : V3F_COL.e, w0 = m.kind === 'tbm' ? 4 : 2.2, sm = V3F_COL.smoke;
    for (let i = 1; i < tr.length; i++) {
      const a0 = S.t - tr[i - 1][3], a1 = S.t - tr[i][3], hot = a1 < .35;   // 越老的一段越宽、越淡（烟在空中散开）
      v3fRib(out, E, tr[i - 1], tr[i], w0 * (1 + a1 * 1.6), [sm[0], sm[1], sm[2], .3 * (1 - a0 / 4)], hot ? [...V3F_COL.amber.slice(0, 3), .85] : [sm[0], sm[1], sm[2], .3 * (1 - a1 / 4)]);
    }
    if (tr.length > 1) { const q = tr[tr.length - 2]; v3fRib(out, E, q, p, w0 * .9, [...col.slice(0, 3), .5], [...V3F_COL.flame.slice(0, 3), .95]); }   // 尾焰
    v3fSpark(out, C, p, m.kind === 'tbm' ? 6 : 3.4, V3F_COL.white);
    v3fSpark(out, C, p, (m.kind === 'tbm' ? 10 : 6) * (.85 + .15 * Math.sin(S.t * 40 + m.id)), [...V3F_COL.flame.slice(0, 3), .45]);   // 尾焰的光晕（闪烁）
  }
  for (const id of V3F.trail.keys()) if (!live.has(id)) V3F.trail.delete(id);
  for (const id of V3F.seen) if (!live.has(id) && !(S.missiles || []).some(m => m.id === id)) { V3F.seen.delete(id); if (V3F.vo) V3F.vo.delete(id); }
  // 发射点：点火瞬间的闪光、发射筒 / 发射箱口喷出的一团烟（地面上贴地翻滚、海面上是水汽），4 秒里翻滚扩散、往上飘、变淡
  V3F.puff = V3F.puff.filter(o => S.t - o.t0 < 4.5);
  for (const o of V3F.puff) {
    if (!inB(o.x, o.y, 200) || (o.side === 'e' && !seen(o.x, o.y))) continue;
    const a = S.t - o.t0, k = o.big ? 1.6 : 1;
    if (o.vls) {   // 垂发：舱口一团闪光，燃气沿出筒方向拉成一根竖直的白色烟柱（随风慢慢散开、变淡）
      if (a < .35) v3fSpark(out, C, v3fP(o.x, o.y, o.z + 1), (5 + a * 18) * k, [1, .92, .75, .95 * (1 - a / .35)]);
      const top = 34 * (o.up > .6 ? 1.3 : 1) * clamp(a / o.up, 0, 1), fade = clamp(1 - a / 3.5, 0, 1);
      if (top > 1 && fade > 0) { const drift = a * 1.6; v3fRib(out, E, v3fP(o.x, o.y, o.z + .5), v3fP(o.x + drift, o.y - drift * .5, o.z + top), (1.6 + a * 2.2) * k, [.85, .9, .9, .5 * fade], [.75, .8, .82, .18 * fade]); }
    }
    if (a < .3 && !o.vls) v3fSpark(out, C, v3fP(o.x, o.y, o.z + 2), (8 + a * 20) * k, [1, .9, .7, .8 * (1 - a / .3)]);
    for (let i = 0; i < 7; i++) {
      const an = i * 2.4 + o.t0, r = (2 + a * (o.sea ? 5 : 3.5)) * k, ex = Math.cos(an) * r * .9, ey = Math.sin(an) * r * .9;
      const c = o.sea ? [.7, .78, .8] : V3F_COL.smoke;
      v3fSpark(out, C, v3fP(o.x + ex, o.y + ey, o.z + 1 + a * (1.2 + i * .35) * k), (3 + a * 4.5) * k, [c[0] * .6, c[1] * .6, c[2] * .6, .13 * (1 - a / 4.5)]);   // 加法混合：几团叠在一起也不发白
    }
  }
  // —— 直升机的火箭、反坦克导弹（从机上射向地面）——
  if (S.eair) for (const p of S.eair.proj || []) {
    if (p.t < 0 || p.done || (!spec && !inVision(p.tx, p.ty) && !inVision(p.x0, p.y0)) || !inB(p.tx, p.ty, 100)) continue;
    const za = v3AltZ(p.x0, p.y0, .25 * 230, -2.6, 1.5), zb = g(p.tx, p.ty) + 1;   // 直升机悬停高度（view3d.js v3AirZ）
    if (p.k === 'rk') {
      const u = clamp(p.t / p.dur, 0, 1), f = v => v3fP(lerp(p.x0, p.tx, v), lerp(p.y0, p.ty, v), lerp(za, zb, v));
      v3fTrail(out, E, f, Math.max(0, u - .12), u, 3, 1.6, V3F_COL.e);
      v3fSpark(out, C, f(u), 2.4, V3F_COL.amber);
    } else if (isFinite(p.x)) {
      const k = clamp(dist(p.x0, p.y0, p.x, p.y) / Math.max(1, dist(p.x0, p.y0, p.tx, p.ty)), 0, 1), q = v3fP(p.x, p.y, lerp(za, zb, k));
      v3fRib(out, E, v3fP(p.x0, p.y0, za), q, 1, [...V3F_COL.smoke.slice(0, 3), .2], [...V3F_COL.e.slice(0, 3), .7]);
      v3fSpark(out, C, q, 2.6, V3F_COL.white);
    }
  }
  // —— 飞机灯光：左翼尖红、右翼尖绿航行灯，垂尾顶上的白色防撞灯一闪一闪；歼击机起飞滑跑、刚离地爬升时尾喷口拖出加力火焰 ——
  if (typeof AIRD === 'object') {
    const EA_K3 = { ga: ['a10', 18], heli: ['ah64', 16], uh60: ['uh60', 17], c17: ['c17', 30], ftr: ['f35', 17], ftrb: ['f35b', 17], f22: ['f22', 18], b2: ['b2', 34], p8: ['p8', 26] };
    const FTR = { j35: 1, j20: 1, j15: 1, j36: 1, f35: 1, f22: 1, j15t: 1 };
    const lit = (o, key, sz, own, burn) => {
      const D = AIRD[key];
      if (!D || !D.wing || !inB(o.x, o.y, 220)) return;
      const k = sz / 21, gnd = o.ph === 'gnd' || o.ph === 'roll' || o.phase === 'roll' && !o.kind, z = gnd ? g(o.x, o.y) + 1.9 * k : v3AirZ(o), h = o.heading || 0, r = o.bank || 0;
      const ch = Math.cos(h), sh = Math.sin(h), cr = Math.cos(r), sr = Math.sin(r);
      const Wp = (u, v, w) => { const y = v * cr - w * sr, zz = v * sr + w * cr; return v3fP(o.x + (u * ch + y * sh) * k, o.y + (u * sh - y * ch) * k, z + zz * k); };
      const tip = D.wing.reduce((m, q) => q[1] > m[1] ? q : m, D.wing[0]), tu = tip[0] - .6;
      v3fSpark(out, C, Wp(tu, tip[1], 0), 1.1 * k + .5, [1, .25, .2, .95]);   // 左翼尖红灯
      v3fSpark(out, C, Wp(tu, -tip[1], 0), 1.1 * k + .5, [.3, 1, .45, .95]);   // 右翼尖绿灯
      const tail = D.stab ? D.stab.reduce((m, q) => Math.min(m, q[0]), 0) : (D.body ? D.body[D.body.length - 1][0] : -9);
      if (((S.t * .8 + o.id * .37) % 1) < .07) v3fSpark(out, C, Wp(tail + 1, 0, 2.6), 2.4 * k + 1, [1, 1, 1, 1]);   // 防撞灯
      if (burn) {   // 加力：尾喷口一束橙白的火舌 + 光晕，长度随时间抖动
        const nu = D.body ? D.body[D.body.length - 1][0] : -10, L = 4.5 + Math.sin(S.t * 31 + o.id) * .6;
        v3fRib(out, E, Wp(nu, 0, 0), Wp(nu - L, 0, 0), 1.5 * k + .4, [1, .95, .8, .95], [1, .45, .1, 0]);
        v3fSpark(out, C, Wp(nu - .5, 0, 0), 2.6 * k + 1, [1, .6, .2, .55]);
      }
    };
    for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && !(p.phase === 'cat' || p.phase === 'trap' || (p.phase === 'roll' && !p.afPh && !p.land))) {   // 甲板上的由航母那边画
      const key = typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : null;
      if (!key) continue;
      const sz = (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || 15;
      lit(p, key, sz, true, !!FTR[key] && (p.phase === 'out' && (p.alt ?? 1) < .5));
    }
    if (S.eair) for (const a of S.eair.fly) {
      if (a.dead || !isFinite(a.x) || !(spec || a.pv || inVision(a.x, a.y))) continue;
      const [key, sz] = EA_K3[a.type] || ['f35', 17];
      lit(a, key, sz, false, !!FTR[key] && ((a.ph === 'roll' && !(a.wait > 0)) || (a.ph === 'out' && (a.alt ?? 1) < .4)));
    }
  }
  if (!out.length) return;
  // —— 画：加法混合，测深度不写深度 ——
  const A = V3F.a;
  gl.useProgram(V3F.pr);
  gl.uniformMatrix4fv(V3F.u.uM, false, C.M);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3F.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(A.c); gl.vertexAttribPointer(A.c, 4, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(A.q); gl.vertexAttribPointer(A.q, 2, gl.FLOAT, false, 36, 28);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, out.length / 9);
  gl.depthMask(true); gl.disable(gl.BLEND);
  gl.disableVertexAttribArray(A.p); gl.disableVertexAttribArray(A.c); gl.disableVertexAttribArray(A.q);
}
