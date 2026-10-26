'use strict';
// 3D 弹道（view3d.js v3Draw 在兵种模型之后调用 v3Fx）：子弹、炮弹、导弹都在空中立体地飞——
//   炮弹（榴弹炮、舰炮、迫击炮）走抛物线弹道，弹头一个亮点、后面拖一段渐暗的光迹；炸弹从飞机的高度加速落下；
//   步兵曳光弹、坦克炮弹在枪口 / 炮口的高度平直飞过去（穿甲弹白热、榴弹琥珀色、喷火是一股宽的橙色火舌）；
//   导弹（战术导弹、防空导弹、反舰导弹、精确制导炸弹）按各自的飞行高度飞，尾焰亮点加一条渐暗的尾迹；直升机的火箭、反坦克导弹从机上射向地面
// 画法：面向镜头的发光带（宽度按世界单位），加法混合、不写深度，被地形、房屋、车辆挡住的部分不画；3D 时平面贴图里不再画这些弹道（R.fx3d）
const V3F = { ok: false, tried: false, pr: null, a: {}, u: {}, buf: null, trail: new Map(), S: null };
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
const V3F_COL = { p: [.45, 1, .65, .9], e: [1, .32, .28, .9], amber: [1, .72, .3, .95], white: [1, .97, .88, 1], smoke: [.55, .62, .58, .5], flame: [1, .55, .15, .7] };

function v3Fx(C) {
  if (!S || !V3.gl) return;
  const gl = V3.gl;
  if (!V3F.tried) v3fxInit(gl);
  if (!V3F.ok) return;
  if (V3F.S !== S) { V3F.S = S; V3F.trail.clear(); }
  const out = [], E = C.E, box = V3.box || [0, 0, W, H], inB = (x, y, m = 200) => x > box[0] - m && x < box[0] + box[2] + m && y > box[1] - m && y < box[1] + box[3] + m;
  const spec = S.role === 'spectate' || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e'));
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
  // —— 导弹：按飞行高度，尾迹记最近 1.4 秒的位置 ——
  const live = new Set();
  for (const m of S.missiles || []) {
    if (m.t < 0 || m.done || !isFinite(m.x)) continue;
    live.add(m.id);
    if (!inB(m.x, m.y, 400) || (m.side === 'e' && !seen(m.x, m.y))) continue;
    const z = v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : 230), -2.6, 2), p = v3fP(m.x, m.y, z);   // 与飞机同一套高度：低空沿地形包络、高空按海拔
    let tr = V3F.trail.get(m.id);
    if (!tr) V3F.trail.set(m.id, tr = []);
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 2) tr.push([...p, S.t]);
    while (tr.length && S.t - tr[0][3] > 1.4) tr.shift();
    const col = m.side === 'p' ? V3F_COL.p : V3F_COL.e;
    for (let i = 1; i < tr.length; i++) { const k0 = (i - 1) / tr.length, k1 = i / tr.length; v3fRib(out, E, tr[i - 1], tr[i], m.kind === 'tbm' ? 4 : 2.2, [...V3F_COL.smoke.slice(0, 3), .45 * k0], [...(i > tr.length - 3 ? V3F_COL.amber : col).slice(0, 3), .8 * k1]); }
    v3fSpark(out, C, p, m.kind === 'tbm' ? 6 : 3.4, V3F_COL.white);
  }
  for (const id of V3F.trail.keys()) if (!live.has(id)) V3F.trail.delete(id);
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
