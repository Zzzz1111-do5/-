'use strict';
// 3D 弹道（view3d.js v3Draw 在兵种模型之后调用 v3Fx）：子弹、炮弹、导弹都在空中立体地飞——
//   炮弹（榴弹炮、舰炮、迫击炮）走抛物线弹道，弹头一个亮点、后面拖一段渐暗的光迹；炸弹从飞机的高度加速落下；
//   步兵曳光弹、坦克炮弹在枪口 / 炮口的高度平直飞过去（穿甲弹白热、榴弹琥珀色、喷火是一股宽的橙色火舌）；
//   导弹（战术导弹、防空导弹、反舰导弹、精确制导炸弹）按各自的飞行高度飞，尾焰亮点加一条渐暗的尾迹；直升机的火箭、反坦克导弹从机上射向地面
// 画法：面向镜头的发光带（宽度按世界单位），加法混合、不写深度，被地形、房屋、车辆挡住的部分不画；3D 时平面贴图里不再画这些弹道（R.fx3d）
const V3F = { ok: false, tried: false, pr: null, a: {}, u: {}, buf: null, trail: new Map(), S: null, puff: [], seen: new Set(), ign: new Set(), ex: [], exSeen: new WeakSet() };   // ex：爆炸（火球、碎片、烟）   // puff：发射点的点火闪光与烟团（只在画面里记）
const V3F_VS = `attribute vec3 p; attribute vec4 c; attribute vec2 q;
uniform mat4 uM; varying vec4 vC; varying vec2 vQ;
void main() { vC = c; vQ = q; gl_Position = uM * vec4(p, 1.); }`;
// 片元：普通亮点 / 光带是高斯光斑（中心发白）；翻滚的烟团、火球（v3fPuff）在带内坐标里编了画法和噪声种子——
//   带内坐标 x 加 8 × 画法（1 烟、2 火），y 加 4 × 种子（0–15），这里解出来，用两层随时间翻卷的值噪声把边缘啃得参差不齐、里面一团团明暗
const V3F_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uT;
varying vec4 vC; varying vec2 vQ;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1., 0.)), f.x), mix(h2(i + vec2(0., 1.)), h2(i + vec2(1., 1.)), f.x), f.y); }
void main() {
  float md = floor((vQ.x + 4.) / 8.), sd = floor((vQ.y + 2.) / 4.);
  vec2 q = vec2(vQ.x - 8. * md, vQ.y - 4. * sd);
  float r = dot(q, q);
  if (md < .5) {
    float a = vC.a * exp(-2.6 * r) * step(r, 1.);
    gl_FragColor = vec4(vC.rgb * a + vec3(1.) * a * a * .35, a);   // 中心发白
    return;
  }
  if (r > 1.) discard;
  vec2 np = q * 1.7 + vec2(sd * 7.31, sd * 3.17);
  float t = uT * (md > 1.5 ? .9 : .22);
  float n = vn(np + vec2(t * .6, -t)) * .62 + vn(np * 2.3 - vec2(t, t * .4) + 5.1) * .38;
  float e = 1. - smoothstep(.22, 1., r + (n - .5) * .75);
  if (md < 1.5) {   // 烟（预乘透明度、遮光）：顶上受光亮一点、底下暗，噪声暗的地方更透
    float a = vC.a * e * (.5 + .65 * n);
    gl_FragColor = vec4(vC.rgb * (.74 + .32 * q.y + .14 * (n - .5)) * a, a);
  } else {   // 火（加法）：噪声亮的一团团接近白黄，边上是本身的橙红
    float h = e * (.4 + .8 * n);
    gl_FragColor = vec4(mix(vC.rgb, vec3(1., .88, .62), smoothstep(.68, 1.12, h)) * vC.a * h, vC.a * h);
  }
}`;
function v3fxInit(gl) {
  V3F.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3F_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3F_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    Object.assign(V3F, { pr, a: { p: gl.getAttribLocation(pr, 'p'), c: gl.getAttribLocation(pr, 'c'), q: gl.getAttribLocation(pr, 'q') }, u: { uM: gl.getUniformLocation(pr, 'uM'), uT: gl.getUniformLocation(pr, 'uT') }, buf: gl.createBuffer(), ok: true });
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
// 翻滚的烟团（m 1，放进遮光的 sm）/ 火球（m 2，放进加法的 out）：和 v3fSpark 一样面向镜头的方块，带内坐标里编进画法和噪声种子（着色器解出来）；
//   bot：下半截的不透明度倍数（贴地的烟团往底边淡出，被地面切掉的硬边看不出来）。注意下面另有画烟幕的 v3fPuff（不翻滚），名字不能重
function v3fBillow(L, C, p, r, c, m, seed, bot = 1) {
  const X = C.x, Y = C.y, ox = 8 * m, oy = 4 * ((seed | 0) & 15), P = (a, b) => L.push(p[0] + (X[0] * a + Y[0] * b) * r, p[1] + (X[1] * a + Y[1] * b) * r, p[2] + (X[2] * a + Y[2] * b) * r, c[0], c[1], c[2], c[3] * (b < 0 ? bot : 1), a + ox, b + oy);
  P(-1, -1); P(1, -1); P(1, 1); P(-1, -1); P(1, 1); P(-1, 1);
}
const V3F_WIND = [1.6, -.55];   // 烟往下风飘（米 / 秒，游戏坐标：往东、偏北）
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
    const IM = cls && typeof v3imOn === 'function' ? v3imOn(cls === '055' ? 't055' : null) : null;   // 换成外部精细模型的舰：垂发位置按那个模型
    const K = IM && IM.vls ? { k: 1, w: 1, vls: IM.vls } : cls && typeof SH_DDC === 'object' ? SH_DDC[cls] : null, blocks = K ? K.vls : [[8, 13, 2.2]], b = blocks[m.id % blocks.length], k = K ? K.k : 1;
    const pseudo = (m.id * 9301 + 49297) % 233280 / 233280, pv = (m.id * 4271 + 113) % 1000 / 1000;
    const u = lerp(b[0], b[1], .15 + .7 * pseudo) * k, v = (pv * 2 - 1) * b[2] * .7 * k * (K ? K.w : 1);
    const key = sh === S.dd ? 'DD' : sh.id, P = typeof SHIPV === 'object' && SHIPV.pose[key], h = P ? P.h : (sh.heading ?? -1.57), px0 = P ? P.x : sh.x, py0 = P ? P.y : sh.y;
    const x = px0 + u * Math.cos(h) - v * Math.sin(h), y = py0 + u * Math.sin(h) + v * Math.cos(h);
    o = { x, y, z: -2.6 + (IM && IM.vlsZ != null ? IM.vlsZ : 2.8 * k) + .3, h, lx: x, ly: y, lk: 1, cls, up: m.kind === 'sam' ? .45 : .9 };   // lx、ly、lk：舱盖铰链处与大小（v3units.js 画舱盖）
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
  if (V3F.S !== S) { V3F.S = S; V3F.trail.clear(); V3F.puff.length = 0; V3F.seen.clear(); V3F.ign.clear(); V3F.ex.length = 0; V3F.exSeen = new WeakSet(); if (V3F.vo) V3F.vo.clear(); }
  const out = [], sm = [], E = C.E, box = V3.box || [0, 0, W, H], inB = (x, y, m = 200) => x > box[0] - m && x < box[0] + box[2] + m && y > box[1] - m && y < box[1] + box[3] + m;   // sm：遮挡的烟（普通混合，先画；发光的 out 加法混合后画）
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
    if (s.kind === 'bomb') { const zt = Math.max(z1 + 60, v3AltZ(sx, sy, .95 * V3_AIR, -2.6, 1.5)); f = v => v3fP(lerp(sx, s.x1, v), lerp(sy, s.y1, v), z1 + (zt - z1) * (1 - v * v)); }   // 炸弹：从飞机高度（按海拔平飞）加速落下
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
      else if (!air && m.z3 == null && m.t < .6 && isFinite(m.x0)) { const sea = !isLand(m.x0, m.y0); V3F.puff.push({ x: m.x0, y: m.y0, z: sea ? 4 : g(m.x0, m.y0) + 1.5, t0: S.t, big: m.kind === 'tbm' || m.kind === 'asm', side: m.side, sea }); }
    }
    if (!inB(m.x, m.y, 400) || (m.side === 'e' && !seen(m.x, m.y))) continue;
    if (m.fw && !m.fw.lit) { V3F.trail.delete(m.id); continue; }   // 还没点火（刚推出弹舱、炸弹滑翔）：只有弹体（v3units.js），没有尾焰、烟迹
    const rp = typeof airRelPos === 'function' ? airRelPos(m, true) : null;   // 刚离机（airmdl.js）：没点火前是立体弹体（v3units.js），点火后光点从挂点接上弹道
    if (rp) {
      V3F.trail.delete(m.id);
      if (rp.lit && rp.r.w !== 'bomb') {   // 点火（炸弹没有发动机，只是落下去）：弹尾一闪、一束尾焰；点火的地方空中留一团白烟（飞机飞走了烟还在原地慢慢散开）
        const zq = airRelZ(rp, m), q = v3fP(rp.x, rp.y, zq), k = clamp((rp.u - AIR_REL.ign) / .12, 0, 1), L = (2.5 + 6 * k) * rp.sc, tx = rp.x - Math.cos(rp.h) * L, ty = rp.y - Math.sin(rp.h) * L;
        if (!V3F.ign.has(m.id)) { V3F.ign.add(m.id); V3F.puff.push({ x: rp.x, y: rp.y, z: zq, t0: S.t, big: false, side: m.side, air: true }); }
        v3fRib(out, E, q, v3fP(tx, ty, zq), 1.3 * rp.sc + .5, [1, .95, .8, .95], [1, .45, .1, 0]);
        v3fSpark(out, C, q, 2.2 + rp.e * 1.4 + (1 - k) * 3, V3F_COL.amber);
      }
      continue;
    }
    const z0 = m.z3 != null ? m.z3 : v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : V3_AIR), -2.6, 2), VP = v3MslPos(m, z0), p = VP ? v3fP(VP.x, VP.y, VP.z) : v3fP(m.x, m.y, z0);   // 与飞机同一套高度：低空沿地形包络、高空按海拔；垂发冲出阶段竖直往上
    let tr = V3F.trail.get(m.id);
    if (!tr) V3F.trail.set(m.id, tr = []);
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 2) tr.push([...p, S.t]);
    while (tr.length && S.t - tr[0][3] > 4) tr.shift();
    const col = m.side === 'p' ? V3F_COL.p : V3F_COL.e, w0 = m.kind === 'tbm' ? 4 : 2.2, smc = V3F_COL.smoke;
    for (let i = 1; i < tr.length; i++) {
      const a0 = S.t - tr[i - 1][3], a1 = S.t - tr[i][3], hot = a1 < .35;   // 越老的一段越宽、越淡（烟在空中散开）
      v3fRib(out, E, tr[i - 1], tr[i], w0 * (1 + a1 * 1.6), [smc[0], smc[1], smc[2], .3 * (1 - a0 / 4)], hot ? [...V3F_COL.amber.slice(0, 3), .85] : [smc[0], smc[1], smc[2], .3 * (1 - a1 / 4)]);
      if (i % 2 === 0 && a1 > .15) v3fSpark(sm, C, tr[i], w0 * (.9 + a1 * 1.3), [.86, .87, .86, .3 * (1 - a1 / 4)]);   // 固体火箭的白烟：遮得住后面的东西，几秒里散开变淡
    }
    // 尾焰挂在弹尾（导弹按真实长度画，v3msl.js），光晕按弹体大小
    const hl = typeof v3MslKey === 'function' ? ((V3MS[v3MslKey(m)] || V3MS.pl15).L / 2) * v3MslK(m) : 0, fs = hl > 0 ? clamp(hl / 2, .5, 2) : 1;
    let pt = p;
    if (hl > 0 && tr.length > 1) { const q = tr[tr.length - 2], dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2], l = Math.hypot(dx, dy, dz); if (l > 1e-3) pt = [p[0] - dx / l * hl, p[1] - dy / l * hl, p[2] - dz / l * hl]; }
    if (tr.length > 1) { const q = tr[tr.length - 2]; v3fRib(out, E, q, pt, w0 * .9 * fs, [...col.slice(0, 3), .5], [...V3F_COL.flame.slice(0, 3), .95]); }   // 尾焰
    // 亮点、光晕按离镜头的距离缩：五百米外照旧（远处看是一个亮点），越近越小——导弹视角贴在弹后十几米，原来 6 米的光晕盖住半个屏幕
    const sk = clamp(Math.hypot(pt[0] - E[0], pt[1] - E[1], pt[2] - E[2]) / 500, .12, 1);
    v3fSpark(out, C, pt, (m.kind === 'tbm' ? 6 : 3.4) * fs * sk, V3F_COL.white);
    v3fSpark(out, C, pt, (m.kind === 'tbm' ? 10 : 6) * fs * sk * (.85 + .15 * Math.sin(S.t * 40 + m.id)), [...V3F_COL.flame.slice(0, 3), .45]);   // 尾焰的光晕（闪烁）
  }
  for (const id of V3F.trail.keys()) if (!live.has(id)) V3F.trail.delete(id);
  for (const id of V3F.seen) if (!live.has(id) && !(S.missiles || []).some(m => m.id === id)) { V3F.seen.delete(id); V3F.ign.delete(id); if (V3F.vo) V3F.vo.delete(id); }
  // 发射点：点火瞬间的闪光、发射筒 / 发射箱口喷出的一团烟（地面上贴地翻滚、海面上是水汽），4 秒里翻滚扩散、往上飘、变淡
  V3F.puff = V3F.puff.filter(o => S.t - o.t0 < 7);
  for (const o of V3F.puff) {
    if (!inB(o.x, o.y, 200) || (o.side === 'e' && !seen(o.x, o.y))) continue;
    const a = S.t - o.t0, k = o.big ? 1.6 : 1;
    v3fLaunchSmoke(sm, C, o, a, k);   // 发射药的烟团（遮挡的白烟 / 扬尘）
    if (a > 4.5) continue;
    if (o.vls) {   // 垂发：舱口一团闪光，燃气沿出筒方向拉成一根竖直的白色烟柱（随风慢慢散开、变淡）
      if (a < .35) v3fSpark(out, C, v3fP(o.x, o.y, o.z + 1), (5 + a * 18) * k, [1, .92, .75, .95 * (1 - a / .35)]);
      const top = 34 * (o.up > .6 ? 1.3 : 1) * clamp(a / o.up, 0, 1), fade = clamp(1 - a / 3.5, 0, 1);
      if (top > 1 && fade > 0) { const drift = a * 1.6; v3fRib(out, E, v3fP(o.x, o.y, o.z + .5), v3fP(o.x + drift, o.y - drift * .5, o.z + top), (1.6 + a * 2.2) * k, [.85, .9, .9, .5 * fade], [.75, .8, .82, .18 * fade]); }
    }
    if (o.air) {   // 空中点火：发动机一闪，一团白烟在空中翻滚着散开、变淡（不往地上落、几乎不往上飘）
      if (a < .15) v3fSpark(out, C, v3fP(o.x, o.y, o.z), 3 + a * 26, [1, .95, .85, .95 * (1 - a / .15)]);
      for (let i = 0; i < 6; i++) { const an = i * 2.4 + o.t0, r = 1 + a * 2.2, ex = Math.cos(an) * r, ey = Math.sin(an) * r; v3fSpark(out, C, v3fP(o.x + ex, o.y + ey, o.z + (i % 3 - 1) * r * .5 + a * .4), 1.8 + a * 3.2, [.55, .58, .56, .2 * (1 - a / 4.5)]); }
      continue;
    }
    if (a < .3 && !o.vls) v3fSpark(out, C, v3fP(o.x, o.y, o.z + 2), (8 + a * 20) * k, [1, .9, .7, .8 * (1 - a / .3)]);
    for (let i = 0; i < 7; i++) {
      const an = i * 2.4 + o.t0, r = (2 + a * (o.sea ? 5 : 3.5)) * k, ex = Math.cos(an) * r * .9, ey = Math.sin(an) * r * .9;
      const c = o.sea ? [.7, .78, .8] : V3F_COL.smoke;
      v3fSpark(out, C, v3fP(o.x + ex, o.y + ey, o.z + 1 + a * (1.2 + i * .35) * k), (3 + a * 4.5) * k, [c[0] * .6, c[1] * .6, c[2] * .6, .13 * (1 - a / 4.5)]);   // 加法混合：几团叠在一起也不发白
    }
  }
  // —— 爆炸：空中（击落飞机）在被击中的高度炸开，地面的从地上腾起——白热闪光、翻滚扩散的火球、四散的碎片（受重力往下掉）、往上飘的烟 ——
  for (const f of S.fx) if ((f.kind === 'boom' || f.kind === 'b2') && !V3F.exSeen.has(f)) {
    V3F.exSeen.add(f);
    if (f.life > .3) continue;   // 打开 3D 之前就炸了的不补
    const air = !!f.air, z = air ? v3AltZ(f.x, f.y, Math.max(0, clamp(f.alt ?? 1, 0, 1) - .05) * V3_AIR, -2.6, 1.5) : Math.max(g(f.x, f.y), -2.6);
    V3F.ex.push({ x: f.x, y: f.y, z, r: f.r * (f.kind === 'b2' ? 1.4 : 1), t0: S.t - f.life, air, side: f.side, sd: (f.x * 13.7 + f.y * 7.1) % 6.283 });
  }
  V3F.ex = V3F.ex.filter(o => S.t - o.t0 < 9);
  const WX = V3F_WIND[0], WY = V3F_WIND[1];
  for (const o of V3F.ex) {
    if (!inB(o.x, o.y, 300)) continue;   // 与平面画面一样：爆炸都画（看得见火光）
    const a = S.t - o.t0, r = clamp(o.r, 6, 90), up = o.air ? 0 : 1, sid = Math.floor(o.sd * 97), sea = !o.air && o.z < -1.5;
    if (a < .18) v3fSpark(out, C, v3fP(o.x, o.y, o.z + r * .3 * up), r * (1.1 + a * 3), [1, .95, .8, 1 - a / .18]);   // 白热闪光
    if (!o.air && a < .32) {   // 冲击波：贴地往外扩的一圈（掀起的尘土、水面的一圈白），一闪就过
      const R0 = r * (.5 + a * 11), al = .3 * (1 - a / .32), col = sea ? [.9, .95, 1, al] : [.95, .82, .6, al];
      for (let i = 0; i < 20; i++) { const a0 = i / 20 * 6.2832, a1 = a0 + .3142; v3fRib(out, E, v3fP(o.x + Math.cos(a0) * R0, o.y + Math.sin(a0) * R0, o.z + .6), v3fP(o.x + Math.cos(a1) * R0, o.y + Math.sin(a1) * R0, o.z + .6), r * .14, col, col); }
    }
    if (a < 1.4) for (let i = 0; i < 6; i++) {   // 火球：几团翻滚的火往外膨胀、往上腾，从白黄冷却成橙红、暗红
      const an = o.sd + i * 2.39, el = (i % 3 - 1) * .55, d = r * (.1 + .42 * Math.sqrt(a / 1.4)) * (.7 + (i * 37 % 10) / 25);
      const p = v3fP(o.x + Math.cos(an) * Math.cos(el) * d, o.y + Math.sin(an) * Math.cos(el) * d, o.z + (Math.sin(el) * d + up * (r * .22 + a * r * .5)) * (o.air ? 1 : .9));
      const k = 1 - a / 1.4, cool = smooth(.08, 1.1, a);
      v3fBillow(out, C, p, r * (.42 + .42 * a), [1, .66 - .34 * cool, .3 - .24 * cool, (.72 - .2 * cool) * k], 2, sid + i);   // 几团叠起来（加法）不至于整片发白：单团偏橙、淡一些
    }
    if (a < 1.6) for (let i = 0; i < 12; i++) {   // 碎片：亮点四散，受重力往下掉
      const an = o.sd * 1.7 + i * 2.1, el = .25 + (i * 53 % 10) / 14, v = r * (1.4 + (i * 29 % 10) / 6), c = Math.cos(el) * v * a, zz = Math.sin(el) * v * a - 4.9 * a * a * (o.air ? 3 : 4);
      const zp = Math.max(o.air ? -1e9 : o.z, o.z + zz);
      v3fSpark(out, C, v3fP(o.x + Math.cos(an) * c, o.y + Math.sin(an) * c, zp), Math.max(.5, r * .045), [1, .7, .3, .9 * (1 - a / 1.6)]);
    }
    if (a > .12) for (let i = 0; i < 6; i++) {   // 烟：浓的灰黑烟从火球里翻滚着升起，越来越大、往下风飘、慢慢变淡（遮光）；水面上是白色的水汽
      const u = a / 9, an = o.sd + i * 1.05, d = r * (.22 + a * .1), rise = o.air ? a * 1.2 - a * a * .05 : r * .3 + a * (2.6 + i * .8);
      const fade = Math.min(1, (a - .12) / .5) * Math.pow(1 - u, 1.4), sh = .02 * i;
      const col = sea ? [.78 + sh, .8 + sh, .82 + sh, .55 * fade] : [.17 + sh, .155 + sh, .14 + sh, .78 * fade];
      v3fBillow(sm, C, v3fP(o.x + Math.cos(an) * d + WX * a, o.y + Math.sin(an) * d + WY * a, o.z + rise), r * (.48 + a * .3 + i * .05), col, 1, sid + 20 + i);
    }
    if (!o.air && a < 3.6) for (let i = 0; i < 6; i++) {   // 地面爆炸掀起的尘土（水面是水花雾）：贴地往外推、慢慢落下散开
      const an = o.sd * 1.3 + i * 1.047, d = r * (.35 + 1.15 * Math.sqrt(a / 3.6)), k = 1 - a / 3.6;
      v3fBillow(sm, C, v3fP(o.x + Math.cos(an) * d + WX * a * .5, o.y + Math.sin(an) * d + WY * a * .5, o.z + r * .12 + a * .7), r * (.32 + a * .26), sea ? [.85, .9, .93, .45 * k] : [.44, .37, .28, .55 * k], 1, sid + 40 + i);
    }
  }
  // —— 被打掉的车辆：车上起火（约 50 秒，越烧越小），一根往下风飘的黑烟柱（约两分钟后散尽）——
  {
    let nW = 0;
    const wreck = (x, y, L, age, id) => {
      if (age < 0 || age > 120 || !inB(x, y, 150) || ++nW > 18) return;
      const z = g(x, y), k = 1 - age / 120, sid = id & 15;
      if (age < 50) { const fk = 1 - age / 50; for (let i = 0; i < 2; i++) v3fBillow(out, C, v3fP(x + (i - .5) * L * .18, y, z + L * (.2 + .1 * i)), L * (.2 + .12 * fk), [1, .48, .14, .6 * fk], 2, sid + i); }
      for (let i = 0; i < 8; i++) {   // 一串烟团从车上升起到 u = 1 消失，循环接上，连成一根烟柱：根上又黑又浓，越往上越散、越灰、越淡
        const u = (S.t * .07 + i / 8 + id * .131) % 1, wx = u * u * L * 7;
        const a = .58 * Math.pow(k, .6) * Math.pow(1 - u, 1.2) * Math.min(1, u / .06);   // 残骸一多（十几根烟柱）也不至于把战场整片遮黑
        v3fBillow(sm, C, v3fP(x + wx * WX / 1.7, y + wx * WY / 1.7, z + L * .3 + u * L * 10), L * (.26 + u * 1.15), [.08 + u * .16, .075 + u * .16, .07 + u * .16, a], 1, sid + 3 + i);
      }
    };
    for (const v of S.veh || []) if (v.dead && !v.lst) wreck(v.x, v.y, typeof vehSp === 'function' ? vehSp(v).len : 9, S.t - (v.deadT ?? -999), v.id);
    for (const v of S.armor || []) if (v.dead) wreck(v.x, v.y, 8, S.t - (v.deadT ?? -999), v.id);
  }
  // —— 行进中的车辆扬起的尘土（陆上）：车尾两侧拖出一溜黄土色的烟，离车越远越大越淡；在水里、刚上岸湿沙上的不扬 ——
  {
    let nD = 0;
    for (const v of S.veh || []) {
      if (v.dead || v.lst || v.swim || !(S.t - (v.movedT ?? -99) < .5) || !inB(v.x, v.y, 60) || (v.side === 'e' && !seen(v.x, v.y))) continue;
      const z = g(v.x, v.y);
      if (z < -1 || Math.hypot(v.x - E[0], -v.y - E[1]) > 2600 || ++nD > 40) continue;
      const L = typeof vehSp === 'function' ? vehSp(v).len : 8, h = v.heading || 0, c = Math.cos(h), s2 = Math.sin(h), sid = v.id & 15;
      for (let i = 0; i < 4; i++) {
        const u = (S.t * 1.1 + i / 4 + v.id * .37) % 1, back = L * (.45 + u * 2.2), sd = (i % 2 ? 1 : -1) * L * .22 * (1 + u);
        v3fBillow(sm, C, v3fP(v.x - c * back - s2 * sd, v.y - s2 * back + c * sd, z + L * (.12 + u * .35)), L * (.22 + u * .55), [.55, .48, .37, .3 * Math.sin(u * Math.PI)], 1, sid + i);
      }
    }
  }
  // —— 被击落的飞机往下栽：机身上的火、身后拖着的一条越来越宽的黑烟（残骸本身是 v3units.js 的立体模型）——
  const wtr = (w, T) => {
    const age = S.t - w.t;
    if (age < 0 || age > T) return;
    const P = v3WreckAt(w, age, T);
    if (!inB(P.x, P.y, 300)) return;
    let prev = null;
    for (let j = 14; j >= 0; j--) {
      const a2 = age - j * .07;
      if (a2 < 0) continue;
      const Q = v3WreckAt(w, a2, T), q = v3fP(Q.x, Q.y, Q.z), k = j / 14, sm = V3F_COL.smoke;
      if (prev) v3fRib(out, E, prev, q, 2.5 + k * 9, [sm[0] * .7, sm[1] * .7, sm[2] * .7, .28 * (1 - k)], [sm[0] * .7, sm[1] * .7, sm[2] * .7, .3 * (1 - k + .07)]);
      prev = q;
    }
    const p = v3fP(P.x, P.y, P.z);
    v3fSpark(out, C, p, 4.5 + Math.sin(S.t * 37 + w.t) * .8, [1, .55, .15, .8]);   // 机身上烧着的火
    v3fSpark(out, C, p, 2, [1, .9, .6, .9]);
  };
  for (const w of (S.air && S.air.wrecks) || []) wtr(w, 2.2);
  if (S.eair) for (const w of S.eair.wr || []) if (seen(w.x, w.y)) wtr(w, 2);
  // —— 直升机的火箭、反坦克导弹（从机上射向地面）——
  if (S.eair) for (const p of S.eair.proj || []) {
    if (p.t < 0 || p.done || (!spec && !inVision(p.tx, p.ty) && !inVision(p.x0, p.y0)) || !inB(p.tx, p.ty, 100)) continue;
    const za = v3AltZ(p.x0, p.y0, .25 * V3_AIR, -2.6, 1.5), zb = g(p.tx, p.ty) + 1;   // 直升机悬停高度（view3d.js v3AirZ）
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
    const EA_K3 = { ga: ['a10', 18], heli: ['ah64', 16], uh60: ['uh60', 17], ch47: ['ch47', 20.8], sh60b: ['sh60b', 17], c17: ['c17', 30], ftr: ['f35', 17], ftrb: ['f35b', 17], mq9: ['mq9', 18], f22: ['f22', 18], b2: ['b2', 34], p8: ['p8', 26] };
    const FTR = { j35: 1, j20: 1, j15: 1, j16: 1, j16d: 1, j50: 1, f35: 1, f22: 1, f35b: 1, j15t: 1 };
    const lit = (o, key, sz, own, burn) => {
      const D = AIRD[key];
      if (!D || !D.wing || !inB(o.x, o.y, 220)) return;
      // 玩家亲自开的：用和机体模型同一个插值后的位置与姿态（v3units.js plane 用 fpRS）——原来按推演位置、航向、坡度画，没有俯仰，
      //   机头一抬尾焰、航行灯就跟机体错开（推演位置还比画面上的机体超前一步）
      const rs = own && o.fl && o.fp && typeof fpRS === 'function' ? fpRS(o) : null;
      const Lc = !rs && own && typeof v3dLaunch === 'function' ? v3dLaunch(o) : null;   // 刚离舰：下沉、抬头（v3det.js）
      // 机场上的敌机（停机、滑行、滑跑）：机体按机轮着地画（v3units.js v3GroundPlane），这里也按机轮着地点、绕它抬头——原来按「地面 + 1.9」当机身中线，
      //   不同机型中线高低不一样，滑跑开加力时尾焰比喷口低半米到一米
      const gnd = !own && !rs && (o.ph === 'gnd' || o.ph === 'roll'), k = sz / 21, ox = rs ? rs.x : o.x, oy = rs ? rs.y : o.y;
      const z = rs ? rs.z : gnd ? g(o.x, o.y) : v3AirZ(o) + (Lc ? Lc.dz : 0), h = rs ? rs.heading : o.heading || 0, r = rs || !gnd ? (rs ? rs.roll : o.bank || 0) : 0;
      let pt = rs ? rs.pitch : gnd ? (o.ph === 'roll' && typeof eaVlof === 'function' ? V3_ROT * sm01(((o.spd || 0) / eaVlof(o) - .83) / .17) : 0) : typeof v3dPitchOf === 'function' ? v3dPitchOf(o, own ? 0 : 1) : Lc ? Lc.pitch : 0;
      if (!own && !gnd && o.toT != null) { const tu = S.t - o.toT; if (tu >= 0 && tu < 3) pt = Math.max(pt, V3_ROT * (1 - sm01((tu - 1.5) / 1.5))); }   // 刚离地头 1.5 秒保持抬起的机头（与 v3units.js plane 一样）
      const zg = gnd && typeof v3gPlaneZc === 'function' ? v3gPlaneZc(key, sz) : 0;   // 着地画法：机身中线在机轮着地点上方多高
      // 机体坐标（前、左、上）→ GL：先滚转、再俯仰、再航向，和画机体（v3g.js）、喷口（v3det.js v3dBurner）同一个顺序
      const R = typeof v3dMul === 'function' ? v3dMul(v3dMul(v3dRz(-h), v3dRy(pt)), v3dRx(r)) : [Math.cos(h), Math.sin(h), 0, -Math.sin(h), Math.cos(h), 0, 0, 0, 1];
      const Wp = (u, v, w) => { u *= k; v *= k; w = w * k + zg; return [ox + R[0] * u + R[1] * v + R[2] * w, -oy + R[3] * u + R[4] * v + R[5] * w, z + R[6] * u + R[7] * v + R[8] * w]; };
      const tip = D.wing.reduce((m, q) => q[1] > m[1] ? q : m, D.wing[0]), tu = tip[0] - .6;
      const dE = Math.hypot(ox - C.E[0], -oy - C.E[1], z - C.E[2]), lr = Math.min(1.1 * k + .5, .012 * dE + .12);   // 灯的光晕：远处照旧，凑近时按视距缩小（不然近看是两三米的光球）
      v3fSpark(out, C, Wp(tu, tip[1], 0), lr, [1, .25, .2, .95]);   // 左翼尖红灯
      v3fSpark(out, C, Wp(tu, -tip[1], 0), lr, [.3, 1, .45, .95]);   // 右翼尖绿灯
      const tail = D.stab ? D.stab.reduce((m, q) => Math.min(m, q[0]), 0) : (D.body ? D.body[D.body.length - 1][0] : -9);
      if (((S.t * .8 + o.id * .37) % 1) < .07) v3fSpark(out, C, Wp(tail + 1, 0, 2.6), Math.min(2.4 * k + 1, .02 * dE + .2), [1, 1, 1, 1]);   // 防撞灯
      if (FTR[key] && typeof v3dBurner === 'function') {   // 喷口发热、加力尾焰（v3det.js）：按每个喷口，随机身俯仰、滚转；加力开关时火舌平滑地长出、缩回
        const Eg = v3dEng((own ? 'p' : 'e') + o.id, burn ? 1 : .65, burn ? 1 : 0);
        v3dBurner(out, C, o, key, sz, { x: ox, y: oy, z, h, pt, rl: r, ground: gnd }, Eg);
      } else if (typeof v3dExhaust === 'function') v3dExhaust(key, sz, { x: ox, y: oy, z: z + zg, h, pt, rl: r }, gnd ? .6 : 1);   // 其余发动机：排气口后的热浪
    };
    for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && !(p.phase === 'cat' || p.phase === 'trap' || (p.phase === 'roll' && !p.afPh && !p.land))) {   // 甲板上的由航母那边画
      const key = typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : null;
      if (!key) continue;
      const sz = typeof airSize3 === 'function' ? airSize3(p, 'p') : (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || 15;   // 与画机体同一个尺寸（喷口对得上）
      lit(p, key, sz, true, !!FTR[key] && (typeof fpDriving === 'function' && fpDriving(p) && p.fl ? !!p.fl.ab : p.phase === 'out' && ((p.alt ?? 1) < .5 || (p.lT != null && S.t - p.lT < 14))));   // 亲自驾驶：按真实的加力开关画尾焰（马赫环）   // 弹射离舰后全加力爬升约 14 秒（与 js/aero.js 的离舰剖面一致）
    }
    if (S.eair) for (const a of S.eair.fly) {
      if (a.dead || !isFinite(a.x) || !(spec || a.pv || inVision(a.x, a.y))) continue;
      const [key, sz] = EA_K3[a.type] || ['f35', 17];
      lit(a, key, sz, false, !!FTR[key] && ((a.ph === 'roll' && !(a.wait > 0)) || (a.ph === 'out' && (a.alt ?? 1) < .4)));
    }
  }
  v3fScreens(sm, out, C, inB, g);   // 烟幕：舰炮 / 炮兵烟幕弹、发烟罐、车载烟幕弹
  if (typeof v3dFx === 'function') v3dFx(out, C, inB, seen);   // 弹射、离机、伞降的发光与烟（v3det.js）
  if (typeof a82Fx === 'function') a82Fx(out, sm, C, inB, seen);   // 82 空降师：标枪的烟迹与尾焰、CH-47F 旋翼下洗的尘土（v3a82.js）
  if (typeof fpFx === 'function') fpFx(out, sm, C);   // 亲自驾驶：翼尖涡流、机翼水汽、迎面的风线（v3pilot.js）
  if (typeof v3dHaze === 'function') v3dHaze(C);   // 喷口后的热浪（v3det.js）：在加法特效之前，扭的是火焰后面的画面
  if (!out.length && !sm.length) return;
  // —— 画：先画遮挡的烟（预乘透明度的普通混合），再画发光（加法混合）；都测深度、不写深度 ——
  const A = V3F.a;
  gl.useProgram(V3F.pr);
  gl.uniformMatrix4fv(V3F.u.uM, false, C.M); gl.uniform1f(V3F.u.uT, (S.t || 0) % 600);   // 烟团、火球按推演时间翻卷（暂停时定住）
  gl.bindBuffer(gl.ARRAY_BUFFER, V3F.buf);
  gl.enableVertexAttribArray(A.p); gl.enableVertexAttribArray(A.c); gl.enableVertexAttribArray(A.q);
  gl.enable(gl.BLEND); gl.depthMask(false);
  for (const [L, add] of [[sm, false], [out, true]]) {
    if (!L.length) continue;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 36, 0); gl.vertexAttribPointer(A.c, 4, gl.FLOAT, false, 36, 12); gl.vertexAttribPointer(A.q, 2, gl.FLOAT, false, 36, 28);
    gl.blendFunc(gl.ONE, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, L.length / 9);
  }
  gl.depthMask(true); gl.disable(gl.BLEND);
  gl.disableVertexAttribArray(A.p); gl.disableVertexAttribArray(A.c); gl.disableVertexAttribArray(A.q);
}
// 烟幕（S.smoke）：一团团贴地翻滚的白烟（普通混合，遮得住后面），大小与推演里挡视线的范围一致（grid.js smkR），最后 6 秒变淡散去；
//   车载烟幕弹（vsmoke.js，k: 'vg'）先画弹从炮塔顶上飞出去的小亮点、炸开时一闪，烟墙几米高；舰炮、炮兵烟幕弹的大团烟二三十米高。
//   烟团位置按烟团坐标定死的伪随机数排（每帧一样，不闪），远处少画几团
function v3fScreens(sm, out, C, inB, g) {
  const E = C.E;
  for (const s of S.smoke || []) {
    if (!(s.until > S.t) || !inB(s.x, s.y, s.r + 80)) continue;
    if (s.t0 != null) {
      const a = S.t - s.t0;
      if (a < 0) continue;
      if (a < SMK_FLY) {   // 弹在飞：从炮塔顶上划一道低弧线到炸点
        if (s.lx == null) continue;
        const u = a / SMK_FLY, z0 = g(s.lx, s.ly) + 2.6, z1 = g(s.x, s.y) + 3, f = v => v3fP(lerp(s.lx, s.x, v), lerp(s.ly, s.y, v), lerp(z0, z1, v) + Math.sin(Math.PI * v) * 5);
        v3fTrail(out, E, f, Math.max(0, u - .4), u, 3, .45, [.95, .95, .9, .8]);
        v3fSpark(out, C, f(u), .7, [1, .95, .85, .95]);
        continue;
      }
      if (a < SMK_FLY + .22) v3fSpark(out, C, v3fP(s.x, s.y, g(s.x, s.y) + 3), 2.5 + (a - SMK_FLY) * 24, [1, .95, .85, .85 * (1 - (a - SMK_FLY) / .22)]);   // 炸开一闪
    }
    const r = smkR(s);
    if (!(r > 1)) continue;
    const fd = Math.min(1, (s.until - S.t) / 6), z = Math.max(g(s.x, s.y), -2.6), vg = s.k === 'vg', h = vg ? 5 + r * .3 : Math.min(28, 8 + r * .25);
    const de = Math.hypot(s.x - E[0], -s.y - E[1], z - E[2]), lod = de > 3000 ? .4 : de > 1500 ? .7 : 1;
    const n = Math.max(4, Math.round(clamp(r / 4, 5, 18) * lod)), sd = Math.abs(s.x * 12.9898 + s.y * 78.233) % 6.283;
    for (let i = 0; i < n; i++) {
      const lv = (i * .618 + sd * .1) % 1, rr = r * .62 * Math.sqrt((i + .5) / n), ang = sd + i * 2.39996 + S.t * (.03 + (i % 3) * .012);
      const pr = r * (.36 + .2 * ((i * 37 % 10) / 10)) * (1 - lv * .25), zz = z + pr * .5 + h * .6 * lv + Math.sin(S.t * .35 + i) * .5;
      v3fBillow(sm, C, v3fP(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr, zz), pr, [.86, .87, .85, .62 * fd], 1, i + (sd * 10 | 0), .12);   // 翻滚的烟团（底边淡出）
    }
  }
}
// 烟团：面向镜头的方块，下半截往底边淡出——贴地的烟团被地面切掉的那条硬边就看不出来了
function v3fPuff(out, C, p, r, c, bot = .12) {
  const X = C.x, Y = C.y, P = (a, b) => out.push(p[0] + (X[0] * a + Y[0] * b) * r, p[1] + (X[1] * a + Y[1] * b) * r, p[2] + (X[2] * a + Y[2] * b) * r, c[0], c[1], c[2], c[3] * (b < 0 ? bot : 1), a, b);
  P(-1, -1); P(1, -1); P(1, 1); P(-1, -1); P(1, 1); P(-1, 1);
}
// 发射药的烟（普通混合，遮得住后面）：地面发射——燃气冲到地上往四周翻滚的扬尘 / 白烟（海面上是水汽），再一股顺着出筒方向往上的白烟柱；
//   垂发——舱口涌出的白烟顺着弹道往上拉成一根烟柱；空中点火——一团白烟留在原地。7 秒里扩散、往上飘、变淡
function v3fLaunchSmoke(sm, C, o, a, k) {
  const fade = clamp(1 - a / 7, 0, 1);
  if (fade <= 0) return;
  if (o.air) {
    for (let i = 0; i < 5; i++) { const an = i * 2.4 + o.t0, r = .8 + a * 1.6; v3fSpark(sm, C, v3fP(o.x + Math.cos(an) * r, o.y + Math.sin(an) * r, o.z + (i % 3 - 1) * r * .4 + a * .3), (1.6 + a * 2.2) * k, [.88, .89, .88, .42 * fade]); }
    return;
  }
  if (o.vls) {
    const top = 34 * (o.up > .6 ? 1.3 : 1) * clamp(a / Math.max(.1, o.up), 0, 1);
    for (let i = 0; i < 7; i++) { const u = i / 6, dr = a * 1.6 * u; v3fSpark(sm, C, v3fP(o.x + dr, o.y - dr * .5, o.z + 1 + top * u), (1.8 + a * 1.4 + u * 2) * k, [.9, .92, .93, .5 * fade * (1 - u * .4)]); }
    for (let i = 0; i < 5; i++) { const an = i * 2.4 + o.t0, r = (1.5 + a * 2.2) * k; v3fSpark(sm, C, v3fP(o.x + Math.cos(an) * r, o.y + Math.sin(an) * r, o.z + 1.5 + a * .5), (2.2 + a * 1.8) * k, [.9, .92, .93, .4 * fade]); }   // 甲板上漫开的一层
    return;
  }
  const c = o.sea ? [.88, .91, .93] : [.8, .77, .7];   // 海面上白色水汽，陆上带土色的扬尘
  for (let i = 0; i < 10; i++) {   // 贴地往四周翻滚
    const an = i * 2.4 + o.t0, r = (2.5 + a * (o.sea ? 6 : 4.5) * (.7 + (i * 37 % 10) / 25)) * k;
    v3fSpark(sm, C, v3fP(o.x + Math.cos(an) * r, o.y + Math.sin(an) * r, o.z + .5 + a * (.4 + (i % 4) * .25) * k), (3 + a * 3.2) * k, [c[0], c[1], c[2], .55 * fade]);
  }
  for (let i = 0; i < 6; i++) { const u = i / 5, h = Math.min(1, a / .8) * 40 * u * k; v3fSpark(sm, C, v3fP(o.x + a * 1.2 * u, o.y - a * .6 * u, o.z + 2 + h), (2 + u * 2.5 + a * 1.5) * k, [.92, .92, .9, .45 * fade * (1 - u * .5)]); }   // 往上的白烟柱（出筒方向）
}
