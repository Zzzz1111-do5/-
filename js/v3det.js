'use strict';
// 3D 细节（只是画面，不进推演）：电磁弹射、弹舱弹射发射导弹、伞降——
//   v3units.js 画航母、飞机、降落伞时调这里加模型实例（v3dCatUnits / v3dLaunch），v3fx.js 调 v3dFx 加发光与烟
// 机型坐标（airmdl.js AIRD）：x 机头、y 右翼、z 向上，单位是机型单位（乘 k = 画面尺寸 / 21 成世界单位）；
//   换到世界（朝向 a）：x' = x cos a − y sin a、y' = x sin a + y cos a（与 v3units.js 的实例着色器一致）

const v3dKey = p => typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : 'j35';
const v3dSz = p => typeof airSize3 === 'function' ? airSize3(p, 'p') : (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || 15, v3dK = p => v3dSz(p) / 21;   // 与 v3units.js 画机体用同一个尺寸

// ———————————————— 电磁弹射（carrier.js CVG.cats、cvdeck.js 的 'cat' / 'roll'）————————————————
//   弹射滑块：从甲板滑槽里露出一截，挂杆时卡在前起落架的弹射杆上；弹射时随飞机冲到行程末端，刹停，约 1.5 秒退回起点
//   直线电机：挂杆后整条滑轨微微发光（储能），越接近弹射越亮；弹射时滑块所在的一段定子最亮、身后一段渐暗、前面一小段刚通电
//   喷气机挂杆后推到最大推力、弹射前约 2 秒点加力（v3dDeckEng），尾焰打在升起的偏流板上（板面映亮）；离舰后先略微下沉、抬头爬升，约 2 秒后收起落架
const V3D_NOSE0 = 6;   // 没有飞机时滑块停在起点前 6 米（前起落架大致的位置）
const V3D_JET = { j35: 1, j20: 1, j15: 1, j15t: 1, j16: 1, j16b: 1, j16m: 1, j16d: 1, j50: 1, f35: 1, f22: 1, f35b: 1 };   // 有加力的喷气机（j16m 歼-16 导弹卡车原来漏了：喷口不发热、开加力没有火）
// 前起落架离机身中心多远（世界单位）：用户给的模型里量的前轮位置（米，模型坐标）；没有起落架的模型按机长的两成
const V3D_NOSEX = { j31: 4, j20: 3.18 };
function v3dNose(key, k) {
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key], M = mk && typeof V3G === 'object' && V3G.M[mk];
  if (!M || !M.ready) return V3D_NOSE0;
  return (V3D_NOSEX[mk] ?? M.meta.len * .2) * k * 21 / M.meta.len;
}
// 弹射器 k 此刻：滑块位置 s（沿弹射器离起点多远）、阶段 m、挂着的飞机 p、挂杆进度 q、加力程度 burn
function v3dCat(cv, k, live) {
  const C = cvCat(k), p = live.find(o => o.cat === k && ((o.phase === 'cat' && (o.dk === 'line' || o.dk === 'hook')) || o.phase === 'roll'));
  if (p) {
    const nose = v3dNose(v3dKey(p), v3dK(p));
    if (p.phase === 'roll') return { s: (p.cs || 0) + nose, m: 'roll', p, q: 1, burn: 1 };
    if (p.dk === 'hook') return { s: nose, m: 'hook', p, q: (p.dkT || 0) / CVD.hook, burn: v3dDeckEng(p)[1] };
    return { s: V3D_NOSE0, m: 'line', p, q: 0, burn: 0 };   // 正滑上弹射器：滑块在起点等着
  }
  const u = S.t - ((cv.jl && cv.jl[k]) ?? -99), end = C.L + V3D_NOSE0 + 1;
  if (u < .3) return { s: end + 4 * (1 - (1 - u / .3) ** 2), m: 'brake', q: 0, burn: 0, u };   // 刹停：冲过行程末端一小段
  if (u < 2.2) return { s: lerp(end + 4, V3D_NOSE0, sm01((u - .5) / 1.7)), m: 'ret', q: 0, burn: 0, u };   // 退回起点
  return { s: V3D_NOSE0, m: 'rest', q: 0, burn: 0 };
}
// 弹射滑块（舰体坐标：x 沿弹射方向）：露出滑槽的一截、挂弹射杆的立板与前钩
function v3mdShuttle() {
  const M = mbNew();
  mbBox(M, -1.6, 1.6, -.55, .55, -.12, .18, .7, { taper: .12 });
  mbBox(M, -.55, .5, -.16, .16, .18, 1.05, .78, { taper: .05 });
  mbBox(M, .5, .95, -.16, .16, .72, 1.05, .78);
  return typeof mbMetal === 'function' ? mbMetal(M, .85) : M;   // 钢件：写实画面里亮的金属光泽
}
// v3units.js：每条弹射器的滑块（top 飞行甲板顶面、h 航母朝向）
function v3dCatUnits(cv, live, top, h) {
  if (typeof CVG !== 'object' || typeof cvCat !== 'function') return;
  for (let k = 0; k < CVG.cats.length; k++) {
    const st = v3dCat(cv, k, live), [u, v] = cvCatPt(k, st.s), [x, y] = cvW(u, v, cv);
    v3mAdd('cvshut', v3mdShuttle, x, y, top + .02, h + cvCat(k).a, 1, 3);
  }
}
// ———————————————— 热浪（三维）：喷口、排气口后面被烤热的一团团空气（用户：不要二维热浪）————————————————
//   每段热气柱是一个立体（GL 坐标：起点 c、单位方向 d、起点半径 r、长度 len、强度 k；o 可选：sp 末端变粗几倍、rise 末端往上飘多少（浮力，世界单位）、
//   tb 湍流疏密、spd 流速、warm 发暖、seed）：画一个包住它的盒子（镜头在外面画正面、做深度测试——前面的东西挡得住它；镜头在里面画背面），
//   片元里沿视线穿过这个立体积分 12 步：每一步按离（被浮力弯上去的）轴线多远、在喷流的哪一段算热空气浓度，乘上顺着喷流流动的三维噪声，
//   累加成三维的折射偏移，再投影到屏幕上错开取样——侧面看、顺着喷流看、斜着看都不一样，厚的地方扭得多；不是贴在屏幕上的平面。
//   v3fx.js 画加法特效之前调 v3dHaze：先把屏幕上热气柱所在的一块拷进贴图，再画盒子；编辑器（modimp.js）的预览用同一套着色器
const V3DH = { list: [], tried: false, ok: false, pr: null, a: {}, u: {}, buf: null, tex: null, tw: 0, th: 0 };
const V3DH_O = { sp: 2.5, rise: 0, tb: 1, spd: 1, warm: 1, seed: 0 };   // 没给的按这个
function v3dHazeAdd(c, R, r, len, k, o) { v3dHazeD(c, [-R[0], -R[3], -R[6]], r, len, k, o || V3DH_JET); }   // 喷口：顺着机身往后
const V3DH_JET = { sp: 2.6, rise: 0, tb: 1, spd: 1.6, warm: 1 }, V3DH_DSL = { sp: 2.2, tb: 1.1, spd: .55, warm: .6 }, V3DH_FUN = { sp: 2.8, rise: 0, tb: .9, spd: .45, warm: .5 };
// 一段热气柱；一帧最多收 240 段，画的时候只留离镜头最近的 96 段（手机 40 段）
function v3dHazeD(c, d, r, len, k, o) {
  if (!(k > .05) || !(len > 0) || !(r > 0) || V3DH.list.length > 240) return;
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  V3DH.list.push({ c: c.slice(), d: [d[0] / l, d[1] / l, d[2] / l], r, len, k, o: o || V3DH_O });
}
// —— 各种发动机的热气（按真实的排气口位置与方向）——
// 地面车辆（车的坐标：x 按车长、y 按车宽的比例，z 按车高；d 车的坐标里的方向）：柴油机的热气从车尾散热百叶窗往上冒、略向后飘；
//   M1 系列的燃气轮机从车尾排气口水平向后喷，热得多；99A、96 式（这里是 80 式外形）从车体左侧后部排气；轮式车排气管在右后方朝上
const V3D_VEXH = {
  m1a2: { p: [[-.5, 0, .45]], d: [-1, 0, .2], r: .75, len: 7, k: 1.5 }, m1a1: 'm1a2', m1150: 'm1a2',
  ztz99a: { p: [[-.3, -.5, .32]], d: [-.25, -1, .5], r: .5, len: 4, k: 1.1 }, ztz96b: 'ztz99a', ztz96m: 'ztz99a',
  t: { p: [[-.42, -.2, .56], [-.42, .2, .56]], d: [-.35, 0, 1], r: .55, len: 4.2, k: 1 }, w: { p: [[-.44, .32, .66]], d: [-.15, .2, 1], r: .38, len: 3, k: .85 } };
function v3dVehHaze(v, key, len, z, h, E) {
  const M = typeof RLM === 'object' && RLM[key];
  if (v.dead || !M || (v.x - E[0]) ** 2 + (-v.y - E[1]) ** 2 > 500 * 500) return;
  if (typeof modHazeOf === 'function' && typeof v3gVehKey === 'function' && modHazeOf(v3gVehKey(key, v.side === 'e' ? 'e' : 'p'))) return;   // 编辑器给这个模型设计了热浪（v3g.js v3gVeh 登记）
  let X = V3D_VEXH[key] || V3D_VEXH[M.run === 't' ? 't' : 'w'];
  if (typeof X === 'string') X = V3D_VEXH[X];
  const k = len / M.L, Lh = M.L * k, B = M.B * k, Hh = M.B * .6 * k, c = Math.cos(h), s = Math.sin(h), n = Math.hypot(...X.d), dx = X.d[0] / n, dy = X.d[1] / n, dz = X.d[2] / n;
  const d = [dx * c - dy * s, -(dx * s + dy * c), dz], kk = X.k * (v.moving ? 1.25 : .85);   // 走着的发动机转速高
  const o = { ...V3DH_DSL, rise: X.len * k * (X.d[2] > .5 ? .05 : .3), seed: ((v.id || 0) * 7.31) % 50 };   // 柴油机、燃气轮机的热气慢、往上飘（排气本来朝上的少飘一点）
  for (const [px, py, pz] of X.p) { const lx = px * Lh, ly = py * B; v3dHazeD([v.x + lx * c - ly * s, -(v.y + lx * s + ly * c), z + pz * Hh], d, X.r * k, X.len * k, kk, o); }
}
// 不带加力的飞机（直升机、涡桨、运输机、轰炸机、无人机）的排气口（机型单位，左右成对）：[x, y, z, 半径, 强度]——
//   发动机短舱尾端（翼下吊挂的 'dn'、机身 / 机翼上方的 'up'）、推进式螺旋桨前面的排气、B-2 机翼上表面的排气槽
const V3D_EPT = new Map();
function v3dEngPts(key) {
  if (V3D_EPT.has(key)) return V3D_EPT.get(key);
  const D = typeof AIRD === 'object' && AIRD[key], out = [];
  if (D && !V3D_JET[key] && typeof v3AirSec === 'function') {
    const sec = v3AirSec(D), hw0 = D.body ? Math.max(...D.body.map(b => b[1])) : 1.5, zc = V3_AIRZ, zw = D.hi ? zc + hw0 * sec.kt * .82 : zc - hw0 * sec.kb * .35;
    for (const n of D.nac || []) for (const sg of n[2] ? [1, -1] : [1]) out.push([n[1], n[2] * sg, n[4] === 'dn' ? zw - n[3] * .95 : zc + ((typeof V3_NUP === 'object' && V3_NUP[key]) ?? .3), n[3] * .75, D.heli ? .75 : .6]);
    for (const P of D.prop || []) if (P[4]) out.push([P[0] + 1.3, 0, zc, .45, .5]);
    for (const e of D.ex || []) for (const sg of [1, -1]) out.push([e[0], (e[1] + e[2]) / 2 * sg, zc + hw0 * sec.kt * .4, (e[2] - e[1]) * .3, .5]);
  }
  V3D_EPT.set(key, out);
  return out;
}
// o：x、y、z（模型原点：空中是机身中线，地面上是机轮着地点上方 V3_GEAR 个机型单位）、朝向 h、滚转 rl；k0 强度系数（地面怠速小）
function v3dExhaust(key, sz, o, k0) {
  const P = v3dEngPts(key);
  if (!P.length) return;
  const k = sz / 21, c = Math.cos(o.h), s = Math.sin(o.h), cr = Math.cos(o.rl || 0), sr = Math.sin(o.rl || 0), d = [-c, s, 0];   // 往后（GL 坐标 y 取反）
  const ho = { sp: 2.3, rise: 0, tb: 1, spd: 1, warm: .7 };
  for (const [x, y, z, r, kk] of P) { const yy = y * cr - z * sr, zz = y * sr + z * cr; v3dHazeD([o.x + (x * c - yy * s) * k, -(o.y + (x * s + yy * c) * k), o.z + zz * k], d, r * k * 1.3, r * k * 13, kk * k0 * 1.6, ho); }
}
// 舰艇烟囱上方的热气（往上冒）：x、y 舰的位置，h 航向，L 画面舰长，f 烟囱离舰中心多远（按舰长）、zt 烟囱口高
function v3dFunnel(x, y, h, L, f, zt, k = .5) {
  const c = Math.cos(h), s = Math.sin(h);
  v3dHazeD([x + c * f * L, -(y + s * f * L), zt], [0, 0, 1], L * .05, L * .55, k * 1.6, V3DH_FUN);
}
// 盒子（热气柱自己的坐标：沿 d、u、v；u、v 的取法着色器里一模一样）：沿喷流 [−0.3 r, 1.05 len + 0.3 |rise|]，横向 ±H
const v3dhFrame = d => { const rf = Math.abs(d[2]) < .9 ? [0, 0, 1] : [1, 0, 0], u0 = [d[1] * rf[2] - d[2] * rf[1], d[2] * rf[0] - d[0] * rf[2], d[0] * rf[1] - d[1] * rf[0]], ul = Math.hypot(...u0) || 1, u = u0.map(x => x / ul); return [u, [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]]; };
const v3dhBox = h => { const o = h.o, sp = Math.max(o.sp ?? 2.5, .2), rise = o.rise || 0; return { s0: -h.r * .3, s1: h.len * 1.05 + Math.abs(rise) * .3, H: h.r * Math.max(1, sp) * 1.15 + Math.abs(rise) + h.r * .1 }; };
const V3DH_VS = `attribute vec3 p; attribute vec4 a0, a1, a2, a3; uniform mat4 uM; varying vec3 vP; varying vec4 vA0, vA1, vA2, vA3;
void main() { vP = p; vA0 = a0; vA1 = a1; vA2 = a2; vA3 = a3; gl_Position = uM * vec4(p, 1.); }`;
const V3DH_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex; uniform vec2 uSz; uniform float uT; uniform vec3 uEyeF; uniform mat4 uMf; varying vec3 vP; varying vec4 vA0, vA1, vA2, vA3;
float h31(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1., 0., 0.)), f.x), mix(h31(i + vec3(0., 1., 0.)), h31(i + vec3(1., 1., 0.)), f.x), f.y),
             mix(mix(h31(i + vec3(0., 0., 1.)), h31(i + vec3(1., 0., 1.)), f.x), mix(h31(i + vec3(0., 1., 1.)), h31(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }
vec2 scr(vec3 p) { vec4 q = uMf * vec4(p, 1.); return q.xy / max(q.w, 1e-3); }
void main() {
  vec3 c = vA0.xyz, d = normalize(vA1.xyz); float r = vA0.w, L = vA1.w, k = vA2.x, sp = max(vA2.y, .2), rise = vA2.z, tb = max(vA2.w, .05), spd = vA3.x, warm = vA3.y, seed = vA3.z;
  vec3 rf = abs(d.z) < .9 ? vec3(0., 0., 1.) : vec3(1., 0., 0.), u = normalize(cross(d, rf)), v = cross(d, u);
  vec3 rd = normalize(vP - uEyeF), o = uEyeF - c, ro = vec3(dot(o, d), dot(o, u), dot(o, v)), rl = vec3(dot(rd, d), dot(rd, u), dot(rd, v));
  float H = r * max(1., sp) * 1.15 + abs(rise) + r * .1;
  vec3 b0 = vec3(-r * .3, -H, -H), b1 = vec3(L * 1.05 + abs(rise) * .3, H, H), iv = 1. / (rl + vec3(1e-6)), t0 = (b0 - ro) * iv, t1 = (b1 - ro) * iv, tn = min(t0, t1), tf = max(t0, t1);
  float ta = max(max(max(tn.x, tn.y), tn.z), 0.), te = min(min(tf.x, tf.y), tf.z);
  if (te <= ta) discard;
  vec3 up = vec3(d.z, u.z, v.z);   // 世界的「上」（GL z）在热气柱自己的坐标里：浮力往这边弯
  float dt = (te - ta) / 12., dens = 0., near = 0., fl = uT * spd * L * .8;
  vec3 acc = vec3(0.);
  for (int i = 0; i < 12; i++) {
    vec3 q = ro + rl * (ta + (float(i) + .5) * dt);
    float s = q.x / L;
    if (s < 0. || s > 1.) continue;
    float R = r * mix(1., sp, s);
    vec2 ax = up.yz * rise * s * s;
    float f = (1. - smoothstep(.55, 1., length(q.yz - ax) / R)) * smoothstep(0., .06, s) * (1. - smoothstep(.5, 1., s));
    if (f <= 0.) continue;
    vec3 np = vec3((q.x - fl) / (r * 2.2), (q.y - ax.x) / (R * .9) + uT * .35, (q.z - ax.y) / (R * .9)) * tb + seed;   // 湍流顺着喷流往后流、自己也慢慢翻
    vec3 g = vec3(vn3(np), vn3(np + 17.1), vn3(np + 33.7)) - .5 + (vec3(vn3(np * 2.3 + 5.3), vn3(np * 2.3 + 9.1), vn3(np * 2.3 + 2.7)) - .5) * .5;
    float w = f * dt / R;
    acc += (u * g.y + v * g.z + d * g.x * .3) * w;
    dens += w; near += w * (1. - smoothstep(0., .35, s));
  }
  if (dens < .002) discard;
  vec3 pe = uEyeF + rd * ta;   // 视线进热气柱的那一点：三维的折射偏移在这里投影到屏幕
  vec2 px = (scr(pe + acc * k * r * 1.6) - scr(pe)) * .5 * uSz;
  float pl = length(px), pm = 40. * uSz.y / 1080.;
  if (pl > pm) px *= pm / pl;
  vec2 uv = (gl_FragCoord.xy + px) / uSz, ca = px * .06 / uSz;
  vec3 col = vec3(texture2D(uTex, uv + ca).r, texture2D(uTex, uv).g, texture2D(uTex, uv - ca).b);   // 一点点色散：热空气的折射边缘
  col += vec3(.05, .025, 0.) * warm * min(near * k, 1.5);   // 排气口附近微微发暖
  gl_FragColor = vec4(col, smoothstep(0., .12, dens * min(k, 1.5)));
}`;
// 着色器（游戏、编辑器预览各自的 WebGL 里各编一份）
function v3dhProgram(gl) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3DH_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3DH_FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  const a = {}, u = {};
  for (const k of ['p', 'a0', 'a1', 'a2', 'a3']) a[k] = gl.getAttribLocation(pr, k);
  for (const k of ['uM', 'uMf', 'uEyeF', 'uTex', 'uSz', 'uT']) u[k] = gl.getUniformLocation(pr, k);
  return { pr, a, u };
}
// 一组热气柱 → 两份顶点（镜头在盒子外面的、在里面的）和它们在屏幕上占的范围；prj：位置 → 屏幕像素（在镜头后面返回 null）
function v3dhBuild(L, E, prj) {
  const out = [[], []];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, full = false;
  for (const h of L) {
    const o = h.o || V3DH_O, d = h.d, [u, v] = v3dhFrame(d), B = v3dhBox(h), e = [E[0] - h.c[0], E[1] - h.c[1], E[2] - h.c[2]];
    const le = [e[0] * d[0] + e[1] * d[1] + e[2] * d[2], e[0] * u[0] + e[1] * u[1] + e[2] * u[2], e[0] * v[0] + e[1] * v[1] + e[2] * v[2]], mg = 1.5;
    const ins = le[0] > B.s0 - mg && le[0] < B.s1 + mg && Math.abs(le[1]) < B.H + mg && Math.abs(le[2]) < B.H + mg;
    const P = [];
    for (let i = 0; i < 8; i++) { const s = i & 1 ? B.s1 : B.s0, a = i & 2 ? B.H : -B.H, b = i & 4 ? B.H : -B.H; P.push([0, 1, 2].map(k => h.c[k] + d[k] * s + u[k] * a + v[k] * b)); }
    for (const q of P) { const sc = prj(q); if (!sc) { full = true; continue; } x0 = Math.min(x0, sc[0]); x1 = Math.max(x1, sc[0]); y0 = Math.min(y0, sc[1]); y1 = Math.max(y1, sc[1]); }
    if (ins) full = true;
    const at = [h.c[0], h.c[1], h.c[2], h.r, d[0], d[1], d[2], h.len, h.k, o.sp ?? 2.5, o.rise || 0, o.tb ?? 1, o.spd ?? 1, o.warm ?? 1, o.seed ?? 0, 0];
    const ctr = [0, 1, 2].map(k => h.c[k] + d[k] * (B.s0 + B.s1) / 2), W = out[ins ? 1 : 0];
    for (const f of [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]]) {   // 六个面：按朝外的绕向（正面朝外）排
      const A = P[f[0]], Bp = P[f[1]], Cp = P[f[2]], n = [(Bp[1] - A[1]) * (Cp[2] - A[2]) - (Bp[2] - A[2]) * (Cp[1] - A[1]), (Bp[2] - A[2]) * (Cp[0] - A[0]) - (Bp[0] - A[0]) * (Cp[2] - A[2]), (Bp[0] - A[0]) * (Cp[1] - A[1]) - (Bp[1] - A[1]) * (Cp[0] - A[0])];
      const fc = [0, 1, 2].map(k => (A[k] + Cp[k]) / 2 - ctr[k]), q = n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] > 0 ? f : [f[0], f[3], f[2], f[1]];
      for (const i of [q[0], q[1], q[2], q[0], q[2], q[3]]) W.push(...P[i], ...at);
    }
  }
  return { out, box: full ? null : [x0, y0, x1, y1] };
}
// 画一组热气柱（gl 上下文、着色器 H = v3dhProgram、M 视图投影矩阵、E 镜头位置、tex 已拷好屏幕的贴图单元 unit、W×H 画布像素、t 时间）
function v3dhDraw(gl, Hp, buf, D, M, E, unit, W, Hh, t) {
  gl.useProgram(Hp.pr);
  gl.uniformMatrix4fv(Hp.u.uM, false, M); gl.uniformMatrix4fv(Hp.u.uMf, false, M); gl.uniform3f(Hp.u.uEyeF, E[0], E[1], E[2]);
  gl.uniform1i(Hp.u.uTex, unit); gl.uniform2f(Hp.u.uSz, W, Hh); gl.uniform1f(Hp.u.uT, t % 600);   // 时间取模：打久了噪声坐标不至于大到丢精度
  const A = Hp.a, st = 19 * 4;
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.CULL_FACE);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  D.out.forEach((V, ins) => {
    if (!V.length) return;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, st, 0);
    ['a0', 'a1', 'a2', 'a3'].forEach((k, i) => { if (A[k] >= 0) { gl.enableVertexAttribArray(A[k]); gl.vertexAttribPointer(A[k], 4, gl.FLOAT, false, st, 12 + i * 16); } });
    if (ins) { gl.disable(gl.DEPTH_TEST); gl.cullFace(gl.FRONT); } else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.cullFace(gl.BACK); }   // 镜头在盒子里：画背面、不做深度测试
    gl.drawArrays(gl.TRIANGLES, 0, V.length / 19);
  });
  gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
  for (const k of ['p', 'a0', 'a1', 'a2', 'a3']) if (Hp.a[k] >= 0) gl.disableVertexAttribArray(Hp.a[k]);
}
function v3dHazeInit(gl) {
  V3DH.tried = true;
  try {
    Object.assign(V3DH, v3dhProgram(gl));
    V3DH.tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, V3DH.tex);   // 13 号单元：别处没用
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.activeTexture(gl.TEXTURE0);
    V3DH.buf = gl.createBuffer();
    V3DH.ok = true;
  } catch (e) { V3DH.ok = false; console.warn('热浪不可用', e); }
}
function v3dHaze(C) {
  let L = V3DH.list; V3DH.list = [];
  const lite = (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low') || (typeof V3 === 'object' && V3.coarse), NMAX = lite ? 40 : 96, RMAX = lite ? 600 : 900;   // 手机、低画质也画：段数少一些、近一些
  if (!L.length) return;
  const E = C.E, d2 = h => (h.c[0] - E[0]) ** 2 + (h.c[1] - E[1]) ** 2 + (h.c[2] - E[2]) ** 2;
  L = L.filter(h => d2(h) < RMAX * RMAX);
  if (L.length > NMAX) L = L.sort((a, b) => d2(a) - d2(b)).slice(0, NMAX);   // 只留最近的
  if (!L.length) return;
  const gl = V3.gl;
  if (!V3DH.tried) v3dHazeInit(gl);
  if (!V3DH.ok) return;
  const M = C.M, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const prj = p => { const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15]; return w > .01 ? [(x / w * .5 + .5) * W, (y / w * .5 + .5) * H] : null; };
  const D = v3dhBuild(L, E, prj);
  if (!D.out[0].length && !D.out[1].length) return;
  // 抓屏：只拷热气柱所在的一块（外扩一圈：错开取样也不出界）；镜头在热气柱里、有角落在镜头后面的整屏拷
  const mg = Math.ceil(44 * H / 1080) + 8, B = D.box || [0, 0, W, H];
  const cx0 = Math.max(0, Math.floor(B[0] - mg)), cy0 = Math.max(0, Math.floor(B[1] - mg)), cx1 = Math.min(W, Math.ceil(B[2] + mg)), cy1 = Math.min(H, Math.ceil(B[3] + mg));
  if (cx1 <= cx0 || cy1 <= cy0) return;
  gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, V3DH.tex);
  if (V3DH.tw !== W || V3DH.th !== H) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, W, H, 0, gl.RGB, gl.UNSIGNED_BYTE, null); V3DH.tw = W; V3DH.th = H; }
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, cx0, cy0, cx0, cy0, cx1 - cx0, cy1 - cy0);
  v3dhDraw(gl, V3DH, V3DH.buf, D, M, E, 13, W, H, S.t);
  gl.activeTexture(gl.TEXTURE0);
}
// v3fx.js：滑轨通电的光带、滑块亮点、挂杆末段与弹射时的加力、偏流板被尾焰映亮
function v3dCatFx(out, C, inB) {
  if (typeof cvAll !== 'function' || typeof CVG !== 'object' || typeof cvCat !== 'function') return;
  const E = C.E, zd = -2.6 + CVG.zd + .12;
  for (const cv of cvAll()) {
    if (!(cv.hp > 0) || cv.x < -999 || !inB(cv.x, cv.y, 220) || /075/.test(cv.name || '')) continue;
    const home = cvHome(cv), live = (S.planes || []).filter(p => !p.dead && cvHome(p) === home && !p.land && (p.phase === 'cat' || p.phase === 'roll'));
    for (const p of live) {   // 甲板上开着车的喷气机：喷口发热，挂杆后点加力（v3dDeckEng 的时间轴）；预警机、直升机：发动机启动后排气口冒热气
      const key = v3dKey(p), [th, tb] = V3D_JET[key] ? v3dDeckEng(p) : [0, 0];
      if (th > .03 || tb > .02) v3dBurner(out, C, p, key, v3dSz(p), { x: p.x, y: p.y, z: zd - .12, h: p.heading || 0, ground: true }, v3dEng('p' + p.id, th, tb, true));
      else if (!V3D_JET[key] && (p.phase === 'roll' || (p.dk !== 'brd' && p.dk !== 'lift' && (p.dk !== 'eng' || (p.dkT || 0) > .4)))) v3dExhaust(key, v3dSz(p), { x: p.x, y: p.y, z: zd - .12 + V3_GEAR * v3dK(p), h: p.heading || 0 }, p.phase === 'roll' || p.dk === 'hook' ? 1 : .55);
    }
    { const [u0, , v0, v1] = CVG.isl, vm = (v0 + v1) / 2; for (const v of [vm - 2.5, vm, vm + 2.5]) { const [x, y] = cvW(u0 + 6, v, cv); v3dHazeD([x, -y, zd - .12 + 21.7], [0, 0, 1], 1.3, 9, .55); } }   // 舰岛排烟口
    for (let k = 0; k < CVG.cats.length; k++) {
      const st = v3dCat(cv, k, live), C0 = cvCat(k), L = C0.L + V3D_NOSE0 + 6;
      const P = s => { const [u, v] = cvCatPt(k, s), [x, y] = cvW(u, v, cv); return v3fP(x, y, zd); };
      const base = st.m === 'hook' ? .1 + .28 * sm01((st.q - .2) / .7) + .1 * st.burn * (.5 + .5 * Math.sin(S.t * 26)) : st.m === 'roll' ? .2 : st.m === 'brake' || st.m === 'ret' ? .2 * Math.max(0, 1 - st.u / 1.2) : 0;
      if (base > 0 || st.m === 'roll') for (let i = 0, n = 26; i < n; i++) {
        const s0 = L * i / n, s1 = L * (i + 1) / n, d = (s0 + s1) / 2 - st.s;
        let a = base;
        if (st.m === 'roll') a += d > 0 ? .5 * Math.max(0, 1 - d / 9) : .95 * Math.max(0, 1 + d / 26);   // 滑块前一小段刚通电，身后一段渐暗
        if (a < .02) continue;
        const c = [.55, 1, .92, Math.min(1, a)];
        v3fRib(out, E, P(s0 + .35), P(s1 - .35), 1.7, c, c);
      }
      if (st.m === 'roll' || st.m === 'brake') v3fSpark(out, C, P(st.s), st.m === 'roll' ? 2.6 : 1.6, [.8, 1, .95, st.m === 'roll' ? .9 : .5]);   // 滑块
      if (st.p && st.burn > .02) {
        const p = st.p, g = sm01((st.burn - .38) / .62), wash = st.burn * (st.m === 'roll' ? Math.max(0, 1 - (p.cs || 0) / 45) : 1), [ju, jv] = [C0.u - Math.cos(C0.a) * 9.5, C0.v - Math.sin(C0.a) * 9.5], [jx, jy] = cvW(ju, jv, cv);
        if (wash > .02) v3fSpark(out, C, v3fP(jx, jy, zd + 2.2), 6, [1, lerp(.42, .55, g), lerp(.15, .25, g), .22 * wash * (.8 + .2 * Math.sin(S.t * 43 + k))]);   // 偏流板被尾焰映亮
      }
    }
  }
}
// ———————————————— 飞行姿态：js/aero.js（tools/aero_jsbsim.py 用 JSBSim 离线算）————————————————
//   弹射离舰的头 14 秒：高度（含离舰后先下沉约 3 米）、俯仰、平尾、前缘襟翼、起落架照 JSBSim 的时间历程；
//   之后：俯仰 = 画面上的航迹角 + 迎角，迎角按升力线从速度、过载、翼载算（AERO.a0 / cla），平尾按配平规律 + 俯仰角速度
const V3_WS = { j35: 500, j20: 450, j15: 470, j16: 470, j50: 480, h6k: 520, y20: 620, kj600: 380 };   // 翼载（公斤 / 平方米，公开估算）：算迎角
const V3D_D2R = Math.PI / 180;
// 离舰后 u 秒的一行 [离甲板高, 俯仰, 迎角, 速度, 平尾, 前缘襟翼, 起落架]（插值）；超出 14 秒返回 null
function v3dAeroAt(u) {
  if (typeof AERO !== 'object' || !(u >= 0)) return null;
  const R = AERO.launch.rows, f = u / AERO.launch.dt, i = Math.floor(f);
  if (i >= R.length - 1) return null;
  const A = R[i], B = R[i + 1], t = f - i;
  return A.map((v, j) => v + (B[j] - v) * t);
}
// v3units.js plane()：刚离舰的舰载机（cvdeck.js 记的离舰时刻 p.lT）——起落架、俯仰、平尾照 JSBSim；高度在 view3d.js v3ClimbZ
function v3dLaunch(p) {
  const u = p.lT != null && p.phase === 'out' ? S.t - p.lT : -1, A = u >= 0 ? v3dAeroAt(u) : null;
  if (!A) return null;
  return { gear: A[6] > .5, pitch: A[1] * V3D_D2R, dz: 0, de: A[4] * V3D_D2R, lef: A[5] * V3D_D2R, u };
}
// 迎角（弧度）：升力系数 CL = n · 翼载 · g / (½ρV²)，α = a0 + CL / CLα（JSBSim 配平拟合的升力线），限在 −4°…18°
function v3dAlpha(o, key, n) {
  if (typeof AERO !== 'object') return 0;
  const V = Math.max(45, o.spd || 200), q = .5 * 1.15 * V * V, CL = n * (V3_WS[key] || 450) * 9.81 / q;
  return clamp(AERO.a0 + CL / AERO.cla, -4, 18) * V3D_D2R;
}
// 机身俯仰：航迹角（画面上每帧的高度变化与水平位移，平滑约 1/3 秒）+ 迎角（过载按航迹角变化率与坡度算）；刚离舰按 JSBSim 的俯仰，
//   12–14 秒平滑接上。顺带算舵面：平尾 / 鸭翼的偏角（配平 + 俯仰角速度）、左右差动（滚转角速度）。o 飞机、sd 1 = 敌方、z 画面高度、L = v3dLaunch(o)
const V3D_PT = new Map();
function v3dPitch(o, sd, z, L, key) {
  const id = (sd ? 'e' : 'p') + o.id;
  let P = V3D_PT.get(id);
  if (!P || P.S !== S || S.t < P.t) { P = { x: o.x, y: o.y, z, t: S.t, g: 0, gd: 0, pt: 0, q: 0, b: o.bank || 0, p: 0, de: 0, da: 0, S }; V3D_PT.set(id, P); }
  const dt = S.t - P.t;
  if (dt > 1e-4) {
    const dh = Math.hypot(o.x - P.x, o.y - P.y), g = clamp(Math.atan2(z - P.z, Math.max(dh, .3)), -.6, .5), g0 = P.g;
    P.g += (g - P.g) * Math.min(1, dt * 3); P.gd += ((P.g - g0) / dt - P.gd) * Math.min(1, dt * 2);
    const b = o.bank || 0; P.p += ((b - P.b) / dt - P.p) * Math.min(1, dt * 4); P.b = b;
    P.x = o.x; P.y = o.y; P.z = z;
  }
  if (V3D_PT.size > 400) for (const [k, v] of V3D_PT) if (v.S !== S || S.t - v.t > 5) V3D_PT.delete(k);
  const k = key || (o.kind && typeof v3dKey === 'function' ? v3dKey(o) : 'j35'), n = clamp((1 + Math.max(45, o.spd || 200) * P.gd / 9.81) / Math.max(.3, Math.cos(o.bank || 0)), -1, 9);
  const al = v3dAlpha(o, k, n), pf = P.g + al, w = L ? sm01((L.u - 12) / 2) : 1;
  const pt = L ? L.pitch * (1 - w) + pf * w : pf, q = dt > 1e-4 ? (pt - P.pt) / dt : P.q;
  P.q += (q - P.q) * Math.min(1, Math.max(dt, 0) * 4);
  // 平尾（JSBSim 符号：负 = 后缘上偏 = 抬头）：离舰照数据；之后按配平规律 δe = d0 + d1 α，再加俯仰角速度的一项
  const trim = typeof AERO === 'object' ? (AERO.d0 + AERO.d1 * al / V3D_D2R) * V3D_D2R : 0;
  P.de = L ? lerp(V3D_TOTRIM, L.de, sm01(L.u / .8)) * (1 - w) + (trim - .35 * P.q) * w : clamp(trim - .35 * P.q, -.3, .15);   // 离舰：从起飞配平过渡到 JSBSim 的平尾
  P.da = clamp(.3 * P.p, -.2, .2);   // 滚转：左右舵面差动
  if (dt > 1e-4 && P.al != null) P.ad = (P.ad || 0) + ((al - P.al) / dt - (P.ad || 0)) * Math.min(1, dt * 8);   // 迎角变化率（鸭翼的拉杆前导）
  P.al = al;   // 迎角（前缘机动襟翼按它放，v3dCtlAI）
  P.t = S.t; P.pt = pt;
  return pt;
}
// 舵面各通道（弧度，v3g.js V3G_CS 按权重组合成每片舵面的偏角）：玩家开的按飞控算出的真实舵偏（升降、副翼、方向舵）+ 襟翼手柄 + 减速板 + 按迎角放的前缘机动襟翼；
//   AI 的平尾、滚转差动按气动（v3dPitch），襟翼跟着起落架放（起降构型）、前缘襟翼按迎角、滚转时方向舵配一点（协调转弯）
const V3D_FLAP = .6, V3D_LEF = .44, V3D_SB = 1;   // 襟翼放到底约 35°、前缘襟翼最多约 25°、减速板约 57°
const v3dLef = al => clamp((al - 4 * V3D_D2R) * 1.1, 0, V3D_LEF);   // 机动襟翼：迎角过 4° 后跟着迎角往下放
// 全动鸭翼（歼-20，v3g.js V3G_CS 的 can，正 = 前缘上偏）：静不稳定的鸭式布局——拉杆瞬间鸭翼前缘先猛地上偏把机头带起来（按迎角变化率），
//   迎角起来以后前缘反过来往下压（按迎角，持续大迎角转弯时鸭翼前缘明显低于机身），平飞几乎顺着气流；原来只按平尾舵量 × 1.2，大过载也就 8°，平飞纹丝不动
const v3dCan = (al, ad) => clamp(.35 * (ad || 0) - .6 * (al || 0), -.5, .45);
function v3dCtlP(F) { const fl = F.flap || 0; return { de: F.d[0], da: F.d[1], dr: F.d[2], df: fl * V3D_FLAP, dl: Math.max(v3dLef(F.a || 0), fl * .5 * V3D_LEF), sb: F.sb ? V3D_SB : 0, dc: v3dCan(F.a, F.ad) }; }
function v3dCtlAI(P, gd) { return { de: P.de || 0, da: P.da || 0, dr: .3 * (P.da || 0), df: gd ? .8 * V3D_FLAP : 0, dl: Math.max(v3dLef(P.al || 0), gd ? .5 * V3D_LEF : 0), sb: 0, dc: gd ? 0 : v3dCan(P.al, P.ad) }; }
// 甲板上的舰载机：挂杆后先做舵面检查（杆前后左右推一遍，平尾上下摆、左右差动），之后停在起飞配平（后缘上偏约 10°）直到弹射
const V3D_TOTRIM = -.18;
function v3dDeckSurf(p) {
  if (p.phase === 'roll') return { de: V3D_TOTRIM, da: 0, df: V3D_FLAP, dl: .6 * V3D_LEF };   // 弹射起飞：襟翼放到底、前缘襟翼放下
  if (p.phase !== 'cat' || p.dk !== 'hook') return null;
  const t = p.dkT || 0, c = t < .5 ? -.35 * Math.sin(t / .5 * Math.PI) : t < 1 ? .25 * Math.sin((t - .5) / .5 * Math.PI) : 0, r = t >= 1 && t < 1.7 ? .22 * Math.sin((t - 1) / .7 * Math.PI * 2) : 0;
  const y = t >= 1.7 && t < 2.4 ? .3 * Math.sin((t - 1.7) / .7 * Math.PI * 2) : 0, f = sm01((t - 2.2) / 1.2);   // 方向舵左右摆一遍；检查完放襟翼、前缘襟翼（起飞构型）
  return { de: c + V3D_TOTRIM * sm01((t - 1.5) / .5), da: r, dr: y, df: f * V3D_FLAP, dl: f * .6 * V3D_LEF };
}
// 3 × 3 旋转（与 v3units.js 实例着色器同一约定：先绕 x 滚转、再绕 y 俯仰（机头抬起为正）、再绕 z 转向；GL 坐标 y 取反）
const v3dRx = r => { const c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const v3dRy = p => { const c = Math.cos(p), s = Math.sin(p); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const v3dRz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const v3dMul = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
// 甲板上的飞行员（用户给的士兵模型）：跑到登机梯、顺梯子爬上去；进了座舱就不再画（用户的飞机模型座舱盖不透明，看不见里面）
function v3dPilot(p, key, sz, z0, h, at) {
  const P = p.dk === 'brd' && typeof cvPilotPose === 'function' ? cvPilotPose(p) : null;
  if (!P || !(P.run || P.clb < .62) || typeof v3gMan !== 'function') return;
  const [x, y] = at(P.u, P.v);
  v3gMan('pilot', P.run ? 'r' + (Math.floor(P.ph / .7854) & 7) : 'cl' + (Math.floor(P.clb / .62 * 13) & 7), x, y, z0 + P.z, h + P.a, V3_PIL, 0);
}
// v3fx.js：这一帧算好的仰角（加力尾焰的方向）
const v3dPitchOf = (o, sd) => { const P = V3D_PT.get((sd ? 'e' : 'p') + o.id); return P && P.S === S ? P.pt : 0; };

// ———————————————— 发动机尾焰：喷口发热 → 加力点火的小火 → 变色的大火 ————————————————
//   喷口里的发动机后端是实体网格、尾焰是专门的着色器（js/v3jet.js），这里按每个喷口算位置、热度、加力程度交给它；扁平喷口（歼-50）照旧用发光线条
//   照加力式涡扇的结构画：涡轮后面是尾锥、涡轮后机匣的支板与喷油杆，再往后两圈同心的 V 形火焰稳定器，外面是隔热衬套和收敛扩散喷管的调节片。
//   推油门时这些从里往外热起来：暗红 → 橙 → 橙黄（喷口里发动机变热的纹路）；开加力先在稳定器上点着一小团火（分区加力一区一区点），
//   根部蓝紫、尖上橙红；其余几区接连点着，火舌变长、变成白芯黄焰；全加力时喷流欠膨胀，喷口后约一个直径起一串激波马赫环，间隔约 1.2 个直径，越往后越暗、越偏橙粉
// 一架飞机的喷口（世界单位，相对锚点：空中是机身中线，ground 时是机轮着地点）：{ x, y, z, r 半径, w、hh 半宽、半高, d 喷管深 }——
//   用户给的模型里量的（tools/v3gmodels.json 的 noz，米，模型坐标 x 机头、y 左、z 离着地点高；[x, y, z, 半径, 喷管深] 圆喷口，后面再跟 [半宽, 半高] 是扁平的二元喷口），按画面尺寸缩放；模型还没加载完就不画尾焰
function v3dNoz(key, sz, ground) {
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key], M = mk && typeof V3G === 'object' && V3G.M[mk], N = [];
  const NZ = M && ((typeof modNozOf === 'function' && modNozOf(mk)) || M.meta.noz);   // 编辑器在模型上点的尾喷口（mod.js）优先
  if (!M || !M.ready || !NZ) return N;
  const s = sz / M.meta.len, z0 = ground ? 0 : M.meta.zc, PC = typeof V3G_PIT === 'object' && V3G_PIT[mk], T = (typeof v3nzThr === 'function' && v3nzThr(mk)) || (PC && PC.thr);   // 换了真实喷口（v3noz.js）：发动机后段放到收敛段入口
  // an：模型的调节片会开合（出口半径跟着变；整圈开合 noz、一片片的调节片 pet）；t：喷口里的发动机后段放在喉道（出口前 u、半径 r、深 d），没有就放在出口；
  //   fc：喷口里装了现成的发动机内腔（歼-16：Su-30 的涡轮面、火焰稳定器）——不再画程序的发动机后段，只在内腔前面画热光（离出口多深）；
  //   PC.pet.c：左右发动机轴心分别量的（模型左右不完全对称），比按 noz 的 y 左右镜像准
  const C2 = NZ === M.meta.noz && PC && PC.pet && PC.pet.c;
  for (const n of NZ) for (const sg of n[1] ? [1, -1] : [1]) N.push(n[5] ? { x: n[0] * s, y: n[1] * sg * s, z: (n[2] - z0) * s, r: 0, d: n[4] * s, w: n[5] * s, hh: n[6] * s }   // 扁平的二元喷口：n[5] 半宽、n[6] 半高
    : { x: n[0] * s, y: (C2 ? C2[sg > 0 ? 0 : 1][0] : n[1] * sg) * s, z: ((C2 ? C2[sg > 0 ? 0 : 1][1] : n[2]) - z0) * s, r: n[3] * s, d: n[4] * s, w: n[3] * s, hh: n[3] * s, an: !!(PC && (PC.noz || PC.pet)),
      t: T ? { u: -T.u * s, r: T.r * s, d: T.d * s } : null, fc: PC && PC.face ? PC.face * s : 0 });
  return N;
}
// 炽热金属的颜色（近似黑体）：t 0 暗红 → .5 橙 → 1 淡黄；a 不透明度
const V3D_HOT = [[.4, .03, .01], [.85, .13, .03], [1, .3, .06], [1, .5, .15], [1, .7, .32], [1, .87, .58]];
function v3dHot(t, a) {
  const f = clamp(t, 0, 1) * 5, i = Math.min(4, f | 0), u = f - i, A = V3D_HOT[i], B = V3D_HOT[i + 1];
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, a];
}
// AI 开的喷气机的尾喷口开合（画面用，v3units.js 画飞机时传给 v3gPlane）：照真实的收敛扩散喷口——慢车张开、巡航中间、不开加力的最大推力收到最小、
//   开加力张到最大（加力燃烧后燃气体积大得多，喷口不张大发动机会喘振）；与玩家开的（v3pilot.js FP_NOZ）同一套，按 v3dEng 记的热度、加力
//   幅度按真实收敛扩散喷口：出口半径军推 0.8、加力 1.38（比 1.7 倍，F100 喷口模型两个形态之比 1.66）、慢车 1.18——原来 0.87–1.24，追尾镜头里只差一两个像素，看着像不会动（用户：喷口加力还是不会收缩）
const NZ_LO = -.2, NZ_HI = .38, NZ_IDLE = .18;
const v3dNozK = E => E.b > .02 ? lerp(NZ_LO, NZ_HI, sm01(E.b)) : E.h < .65 ? lerp(NZ_IDLE, 0, clamp((E.h - .3) / .35, 0, 1)) : lerp(0, NZ_LO, clamp((E.h - .65) / .35, 0, 1));
function v3dNozAI(o, sd) {
  const E = V3D_ENG.get((sd ? 'e' : 'p') + o.id);
  return !E || E.S !== S ? 0 : v3dNozK(E);
}
// 发动机（画面用）：h 热度（0 冷、.3 慢车、.65 巡航、1 最大推力），b 加力（0 关 – 1 全加力）；th、tb 是此刻该有的值——
//   hard 时直接用（甲板上按时间轴），否则按速率追：推油门约 1.2 秒热起来、收油门约 8 秒才凉；加力约 .5 秒点满、.6 秒熄（火舌缩回小火再灭）
//   tL：加力点着的时刻（画点火那一下的闪光）
const V3D_ENG = new Map();
function v3dEng(id, th, tb, hard) {
  let E = V3D_ENG.get(id);
  if (!E || E.S !== S || S.t < E.t || S.t - E.t > 1.5) { E = { h: th, b: tb, t: S.t, tL: -99, S }; V3D_ENG.set(id, E); }
  const dt = S.t - E.t, b0 = E.b;
  if (hard) { E.h = th; E.b = tb; }
  else { E.h += clamp(th - E.h, -dt / 8, dt / 1.2); E.b += clamp(tb - E.b, -dt / .6, dt / .5); }
  if (b0 <= .02 && E.b > .02) E.tL = S.t;
  E.t = S.t;
  if (V3D_ENG.size > 300) for (const [k, v] of V3D_ENG) if (v.S !== S || S.t - v.t > 5) V3D_ENG.delete(k);
  return E;
}
// 甲板上的舰载机（cvdeck.js）：启动后慢车，喷口深处微微发红；挂上弹射杆后边做舵面检查边推到最大推力，喷口从里往外热透；
//   弹射前 CVD.ab 秒点加力：先一小团火（.3 → .38），约 .7 秒后其余四区每隔 .2 秒点着一区，涨到全加力，稳住约 .6 秒弹射。返回 [热度, 加力]
function v3dDeckEng(p) {
  if (p.phase === 'roll') return [1, 1];
  if (p.phase !== 'cat' || p.dk === 'brd' || p.dk === 'lift') return [0, 0];
  if (p.dk === 'eng') return [.3 * sm01((p.dkT || 0) / 2.5), 0];
  if (p.dk !== 'hook') return [.3, 0];
  const t = p.dkT || 0, lo = CVD.hook - CVD.ab, u = t - lo;
  let b = 0;
  if (u >= 0) { b = .3 * sm01(u / .12) + .08 * sm01((u - .12) / .6); for (let z = 0; z < 4; z++) b += .155 * sm01((u - .7 - z * .2) / .15); }
  return [lerp(.3, 1, sm01((t - .4) / (lo - .4))), Math.min(1, b)];
}
// 画一架喷气机的喷口与尾焰。o：锚点 x、y、z（ground 时是机轮着地点，否则是机身中线），朝向 h、俯仰 pt、滚转 rl；E = v3dEng(...)
//   喷口坐标：u 沿喷流向后（出口截面 u = 0，喷管里为负），v、w 在喷口平面里向右、向上；离镜头远了只画光，不画纹路
function v3dBurner(out, C, p, key, sz, o, E) {
  if (!E || !V3D_JET[key] || (E.h < .03 && E.b < .02)) return;
  const N = v3dNoz(key, sz, o.ground);
  if (!N.length) return;
  const R = v3dMul(v3dMul(v3dRz(-o.h), v3dRy(o.pt || 0)), v3dRx(o.rl || 0)), Ey = C.E, id = p.id || 0;
  // 编辑器的尾焰参数（mod.js modFxOf，按模型）：长度、亮度、马赫环数、粗细、热浪，序列帧尾焰（导入的贴图）、体渲染尾焰开关
  const FX = (typeof modFxOf === 'function' && modFxOf(typeof V3G_AIR === 'object' && V3G_AIR[key])) || {}, fn = (k, d) => typeof FX[k] === 'number' && isFinite(FX[k]) ? FX[k] : d;
  const fL = fn('len', 1), fB = fn('bri', 1), fW = fn('wid', 1), fH = fn('haze', 1), fV = FX.vol !== false, fS = FX.spr && typeof v3vReady === 'function' && v3vReady() ? FX.spr : null;
  const ht = E.h, ab = E.b, s1 = Math.min(1, ab / .3), g = sm01((ab - .38) / .62), fsh = Math.exp(-(S.t - E.tL) / .15);   // s1 小火、g 大火的程度，fsh 点火的闪光
  const hk = dl => clamp((ht - dl) / (1 - dl), 0, 1);   // 从里往外热：越靠外的部件热得越晚
  for (const n of N) {
    const c = [o.x + R[0] * n.x + R[1] * n.y + R[2] * n.z, -o.y + R[3] * n.x + R[4] * n.y + R[5] * n.z, o.z + R[6] * n.x + R[7] * n.y + R[8] * n.z];
    const P = (u, v, w) => [c[0] - R[0] * u + R[1] * v + R[2] * w, c[1] - R[3] * u + R[4] * v + R[5] * w, c[2] - R[6] * u + R[7] * v + R[8] * w];
    const r = n.r || Math.min(n.w, n.hh * 1.6), d = n.d, w0 = r * .075;
    const q = 1 - sm01((Math.hypot(c[0] - Ey[0], c[1] - Ey[1], c[2] - Ey[2]) / Math.max(r, .05) - 120) / 100);   // 纹路：离镜头近才画
    const rib = (a, b, w, c0, c1) => v3fRib(out, Ey, a, b, w, c0, c1 || c0);
    const U = [-R[0], -R[3], -R[6]], Vv = [R[1], R[4], R[7]];   // 喷流方向（向后）、喷口平面里的一个方向
    // —— 喷口里：圆喷口画实体的发动机后端（v3jet.js：涡轮、尾锥、支板、喷油杆、火焰稳定器、衬套，按热度发光）；远处只画一团光；扁平喷口画几道导流片 ——
    if (n.r && n.fc) { if (ht > .03 || ab > .02) v3fSpark(out, C, P(-n.fc, 0, 0), r * .9, v3dHot(Math.max(hk(0), .9 * s1), Math.min(.9, .55 * hk(0) + .3 * s1))); }   // 装了现成内腔的（歼-16）：内腔前面一团热光，推油门从暗红到橙黄、开加力更亮
    else if (n.r) {
      if (q > .01 && (ht > .03 || ab > .02) && typeof v3jEng === 'function') { if (n.t) v3jEng(P(n.t.u, 0, 0), U, Vv, n.t.r, n.t.d / n.t.r, ht, ab); else v3jEng(c, U, Vv, r, Math.max(1.2, d / r), ht, ab); }
      else if (ht > .03) v3fSpark(out, C, P(-d * .8, 0, 0), r * .9, v3dHot(hk(0), .5 * hk(0)));   // 远处：喷管深处的光
    } else if (ht > .03) {
      v3fSpark(out, C, P(-d * .8, 0, 0), Math.max(n.w, n.hh) * .9, v3dHot(hk(0), .5 * hk(0)));
      if (q > .01) { const cs = v3dHot(Math.max(hk(.1), .92 * s1), (.5 * hk(.1) + .4 * s1) * q); for (const f of [-.5, 0, .5]) rib(P(-d * .5, -n.w * .88, f * n.hh), P(-d * .5, n.w * .88, f * n.hh), w0, cs); }
    }
    if (typeof v3dHazeAdd === 'function' && fH > 0) v3dHazeAdd(c, R, (n.r || Math.max(n.w, n.hh)) * 1.3 * fW, 2 * (n.r || n.w) * (7 + 10 * ab) * fL, Math.max(ab * 1.6, ht * 1.1) * fH, { ...V3DH_JET, seed: (id * 7.31) % 50 });   // 喷口后方的热浪（v3dHaze 画；各架的湍流错开）
    if (ab <= .02) continue;
    // —— 加力：小火 → 大火（扁平喷口按宽度分几股） ——
    const K = n.r ? 1 : clamp(Math.round(n.w / (n.hh * 1.6)), 1, 3), ka = n.an ? 1 + v3dNozK(E) : 1;   // 调节片开合的模型：出口半径跟着变（加力时张大）
    for (let j = 0; j < K; j++) {
      const v0 = n.r ? 0 : -n.w + (2 * j + 1) * n.w / K, rf = (n.r ? r * ka : Math.min(n.w / K, n.hh * 1.6)) * fW, D2 = rf * 2, F = u => P(u, v0, 0);
      const fk = 1 + .1 * Math.sin(S.t * 37 + id * 1.7 + v0 * 5 + n.y * 3) + .06 * Math.sin(S.t * 61 + id + j);   // 火舌抖动
      const cone = (u0, u1, wa, wb, ca, cb, ns) => { for (let i = 0; i < ns; i++) { const f0 = i / ns, f1 = (i + 1) / ns, cm = f => ca.map((x, m) => x + (cb[m] - x) * f); rib(F(lerp(u0, u1, f0)), F(lerp(u0, u1, f1)), lerp(wa, wb, (f0 + f1) / 2), cm(f0), cm(f1)); } };
      if (fsh > .02) v3fSpark(out, C, F(rf * .4), rf * 1.8, [1, .72, .4, .6 * fsh]);   // 点火那一下
      // 尾焰（v3jet.js 的着色器画）：小火时短短一截、根部蓝白；全加力约五个直径长、一串激波马赫环
      const pL = D2 * (1 + 1.2 * s1 + 5.6 * g) * fk * fL;
      if (fV && typeof v3jPlume === 'function') v3jPlume(F(0), U, rf, pL, Math.min(1, ab * 1.3 * fB), Math.round(fn('dia', 5) * g), id * 1.7 + j * 2.3 + n.y * 3, g);   // 全加力约八个直径长，看得见的亮焰约五个直径
      if (fS) { const sz = rf * 1.6 * fn('sprS', 1), asp = Math.max(1, pL / (2 * sz)); v3vAdd(fS, F(sz * asp), sz, (S.t * 30 + id * 7 + j * 11) % ((V3V_TEX[fS] || { f: 64 }).f), Math.min(1, ab * 1.3) * Math.min(1.5, fB), 1, [1, 1, 1], U, 0, 1, asp); }   // 导入的序列帧尾焰：顺着喷流立着，底边贴着喷口
      v3fSpark(out, C, F(rf * .8), rf * (2.2 + 1.1 * g) + .2, [1, lerp(.5, .6, g), lerp(.2, .3, g), (.05 + .06 * g) * Math.min(1, ab * 3)]);   // 映亮周围
    }
  }
}


// ———————————————— 甲板车辆（只是画面）：挂弹车、导弹挂载架、牵引车 ————————————————
//   挂弹车、牵引车、导弹挂载架用 Sketchfab 上的模型（v3x.js 的 loader、tug、rack，CC-BY），还没加载完时画代码建的；车辆按米画（航母是 1 比 1）
//   每个机位内侧停一辆挂弹车，旁边一个导弹挂载架（架上摆着各型导弹）。飞机着舰停好后整备 45 秒（carrier.js 的 rearm）：
//   挂弹车一趟一枚，从架子上取弹、开到飞机机腹下举升挂好，按这架满载的枚数来回（弹舱门挂弹时开着）
//   着舰后的飞机滑到机位前：牵引车从内侧开过来，用拖杆挂上前起落架；原地转向、倒进机位都是它推着，停好后脱钩开走
//   出动前：牵引车倒到机头前挂上拖杆，启动后把飞机拖出机位约 20 米再脱钩
// 挂弹分趟（整备进度 r 0–1 分成 N 趟）：第 i 趟、这一趟里走到 q；已经挂上几枚（这一趟过了推进挂点 q .56 才算）；
//   停着整备时的弹舱门开度：第一趟伸进机腹（q .25）开、最后一趟退出来（q .7）关
const v3dArmQ = (r, N) => { const x = clamp(r, 0, 1) * N, i = Math.min(N - 1, Math.floor(x)); return { i, q: x - i }; };
const v3dArmLoaded = (r, N) => !N ? 0 : r >= 1 ? N : (({ i, q }) => i + (q >= .56 ? 1 : 0))(v3dArmQ(r, N));
const v3dArmBay = (r, N) => !N || r <= 0 || r >= 1 ? 0 : clamp((r * N - .25) / .07, 0, 1) * clamp((N - .3 - r * N) / .07, 0, 1);
const v3dLerp2 = (P, Q, k) => [P[0] + (Q[0] - P[0]) * k, P[1] + (Q[1] - P[1]) * k];
// 停在甲板上的飞机（机轮着地在 top）模型上一点的世界位置（v3g.js v3gAt 按机身中线算）
function v3dGndAt(key, sz, x, y, top, hd, v, fold = 0) {   // fold：外翼折着（外翼上的点跟着翻上去）
  const M = typeof V3G === 'object' && typeof V3G_AIR === 'object' && V3G.M[V3G_AIR[key] || 'j31'];
  return M && M.ready && typeof v3gAt === 'function' ? v3gAt(key, sz, x, y, top + M.meta.zc * sz / M.meta.len, hd, 0, 0, v, fold) : null;
}
// 停在机位上的飞机外翼折起程度（有折翼的模型，v3g.js V3G_FOLD）：平时折着；整备时先展开（外翼下的挂点挂弹车才够得着，2.4 秒，与 cvdeck.js 滑行时折、展同速），挂完再折起来
function v3dParkFold(w, key, r, N) {
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key];
  if (!mk || typeof V3G_FOLD !== 'object' || !V3G_FOLD[mk] || !w || w.state !== 'rearm' || !(N > 0)) return 1;
  return 1 - sm01(Math.min(r, 1 - r) / (2.4 / AIR_REARM));
}
// 导弹挂载架（js/mdl/rack.js：Sketchfab 上 CC-BY 的「Industrial Storage Rack」，原尺寸 6 米长、5.2 米高；按 0.62 倍画——约 3.7 米长、3.2 米高、三层搁板）：
//   搁板高 z（原尺寸）、每层四条槽 y（缩放后），长弹一条槽一枚、短弹（飞腾-8 一类）前后两枚；deco：要挂的弹之外另摆的几枚
const V3D_RACK = { k: .62, z: [.28, 1.89, 3.43], y: [-.33, -.11, .11, .33], deco: ['pl10', 'sdb', 'ld10', 'sdb', 'pl15', 'kd88'] };
function v3dRack(x, y, z, a) { const X = typeof v3xMesh === 'function' ? v3xMesh('rack') : null; v3mAdd(X ? 'x:rack' : 'cvsvc:rack', X ? () => X : v3mRackFb, x, y, z, a, X ? V3D_RACK.k : 1, 3); }
function v3mRackFb() {   // 架子模型还没加载完：立柱 + 三层搁板
  const M = mbNew(), k = V3D_RACK.k, L = 2.95 * k, D = .76 * k, Ht = 5.18 * k;
  for (const x of [-L, 0, L]) for (const y of [-D, D]) mbBox(M, x - .05, x + .05, y - .05, y + .05, 0, Ht, .5);
  for (const z of V3D_RACK.z) mbBox(M, -L, L, -D, D, z * k - .05, z * k, .55);
  return M;
}
// 架上每一枚的位置（架子坐标：x 顺着架子、y 横着、z 离甲板高）：先按挂的顺序摆这架要挂的（i = 序号），再摆别的弹（i = −1）
function v3dRackSpots(LD) {
  const k = V3D_RACK.k, out = [], cells = [];
  for (let s = 0; s < 3; s++) for (const y of V3D_RACK.y) cells.push({ s, y, n: 0, short: false });
  const put = (ms, i) => {
    const sh = (typeof V3MS === 'object' && V3MS[ms]) || { L: 3, d: .2 }, short = sh.L <= 2.4, c = cells.find(c => c.n === 0 || (short && c.short && c.n === 1));
    if (!c) return;
    out.push({ ms, i, x: short ? (c.n ? -.88 : .88) : 0, y: c.y, z: V3D_RACK.z[c.s] * k + sh.d * .45 + .03 });
    c.n++; c.short = short;
  };
  LD.forEach((e, i) => put(e.ms, i));
  for (const ms of V3D_RACK.deco) put(ms, -1);
  return out;
}
const V3D_LOAD = { cradle: [1.75, .55], bayZ: 1.15 };   // 托架（挂弹车坐标：离车中心前方、离甲板高）、弹舱口离甲板高
// 驾驶位（车的坐标，米：前、右、脚下踏板离甲板高）与司机马甲颜色：牵引车左前方的下沉驾驶舱，蓝马甲（飞机调运）；挂弹车尾部的操作位，红马甲（弹药）
const V3D_SEAT = { tug: [1.15, -.5, .05, '#2d5fb0'], loader: [-1.55, 0, .3, '#b23a2e'] };
function v3dVeh(key, fb, x, y, z, a) {
  const X = typeof v3xMesh === 'function' ? v3xMesh(key) : null;
  v3mAdd(X ? 'x:' + key : 'cvsvc:' + key, X ? () => X : fb, x, y, z, a, 1, 3);
  v3dDrv(key, x, y, z, a);
}
function v3dDrv(key, x, y, z, a) {
  const St = V3D_SEAT[key];   // 有人开：司机（用户给的士兵模型）站在驾驶位上
  if (St && typeof v3gMan === 'function') {
    const c = Math.cos(a), s = Math.sin(a);
    v3gMan('deck' + (St[3] || ''), 'sit', x + St[0] * c - St[1] * s, y + St[0] * s + St[1] * c, z + St[2], a, typeof V3_PIL === 'number' ? V3_PIL : .95, 0);   // 马甲颜色按车种（牵引车蓝、挂弹车红）
  }
}
function v3dDeckVeh(cv, C, live, wing, top, h, at) {
  if (typeof cvPark !== 'function' || typeof AIR_REARM !== 'number') return;
  const msl = typeof v3gMsl === 'function', K = .86;   // 导弹（用户给的模型，js/v3g.js）跟飞机同一比例
  // 机位 j 旁的挂弹车与导弹挂载架（v3dRack）：w 这个机位上的飞机（空机位为 null）、r 整备进度（0 开始 – 1 挂完）。这架满载要挂 N 枚（fpwpn.js fwLoadout，按挂的顺序），
  //   r 分成 N 趟、一趟挂一枚：两名弹药兵从架上抬一枚放上托架 → 挂弹车开到飞机侧面、慢慢伸进机腹下 → 举升臂抬起 → 把弹送进挂点（弹舱里、翼下挂架）→
  //   放下举升臂 → 倒出来开回原位；弹舱门第一趟伸进机腹时打开、最后一趟退出来后关上（v3dArmBay）；挂上的弹留在飞机上（v3units.js 按 v3dArmLoaded 画）。
  //   挂弹车、架子的原位只看机位（换了机型、空着都在同一个地方，不会跳）；T：整个整备多少秒（弹药兵走 / 跑）
  const loader = (j, w, key, sz, r, T) => {
    const sl = C.slots[j];
    if (!sl) return;
    const LD = w && typeof fwLoadout === 'function' ? fwLoadout(w.type, w.v) : [], N = LD.length, busy = N > 0 && r > 0 && r < 1;
    const a = sl[2], ca = Math.cos(a), sa = Math.sin(a), lat = ca * sl[1] < 0 ? [-sa, ca] : [sa, -ca], la = Math.atan2(-lat[1], -lat[0]);   // lat：朝甲板内侧；挂弹车车头朝飞机
    const D = w && typeof AIRD === 'object' && AIRD[key], bx = D && D.bay ? (D.bay[0] + D.bay[1]) / 2 * sz / 21 : 0, B = [sl[0] + ca * bx, sl[1] + sa * bx];   // 弹舱中点
    const { i: ci, q: q0 } = busy ? v3dArmQ(r, N) : { i: r >= 1 ? N : 0, q: 1 }, q = busy ? q0 : 1;   // 第几趟、这一趟走到哪儿（没在挂：停在原位）
    const d0 = 7.5, d1 = 3.6, d2 = 2.35, Tc = T / Math.max(1, N);   // 原位离机腹 7.5 米：再往舷内就到了右舷滑行车道
    const at2 = (P, d, s = 0) => [P[0] + lat[0] * d + ca * s, P[1] + lat[1] * d + sa * s];
    const H = at2(sl, d0), A = at2(B, d1), Ub = at2(B, d2);   // 原位、飞机侧面、机腹下
    const L = q < .1 ? H : q < .3 ? v3dLerp2(H, A, sm01((q - .1) / .2)) : q < .38 ? v3dLerp2(A, Ub, sm01((q - .3) / .08)) : q < .62 ? Ub : q < .7 ? v3dLerp2(Ub, A, sm01((q - .62) / .08)) : q < .92 ? v3dLerp2(A, H, sm01((q - .7) / .22)) : H;
    const lift = q < .38 ? 0 : q < .48 ? sm01((q - .38) / .1) : q < .56 ? 1 : q < .62 ? 1 - sm01((q - .56) / .06) : 0, pitch = lerp(-.12, .1, lift);   // 举升臂：平时压低，举升时抬起
    const [lx, ly] = at(L[0], L[1]), fu = Math.cos(la), fv = Math.sin(la);
    const U = typeof v3uOn === 'function' ? v3uOn('u_loaderx') : null;
    if (U && U.vars.has('arm')) {   // 带举升臂的外部模型（v3utex.js）：车体 + 绕铰点俯仰的举升臂；后部操作位坐着红马甲
      v3uAdd('u_loaderx', 'hull', lx, ly, top + .02, h + la, 1, 3);
      const [hx, hy] = at(L[0] - fu * .32, L[1] - fv * .32);
      v3uAdd('u_loaderx', 'arm', hx, hy, top + .64, h + la, 1, 3, 0, pitch);
      v3dDrv('loader', lx, ly, top + .02, h + la);
    } else v3dVeh('loader', v3mDeckCart, lx, ly, top + .02, h + la);
    // 导弹挂载架：挂弹车原位旁边、顺着机位方向；架上按顺序摆着这架要挂的弹（前几趟已经取走的不画），顶层另摆几枚别的弹
    const R0 = [sl[0] + lat[0] * (d0 + .3) + ca * 4.6, sl[1] + lat[1] * (d0 + .3) + sa * 4.6], rh = h + a;
    const rackAt = s => { const [x, y] = at(R0[0] + ca * s.x - sa * s.y, R0[1] + sa * s.x + ca * s.y); return [x, y, top + .02 + s.z]; };
    const [rx, ry] = at(R0[0], R0[1]);
    v3dRack(rx, ry, top + .02, rh);
    const SP = v3dRackSpots(LD), pk0 = [R0[0] - lat[0] * .9, R0[1] - lat[1] * .9];   // 弹药兵在架子朝挂弹车那一面取弹
    if (msl) for (const s of SP) if (s.i < 0 || s.i > ci || (s.i === ci && !(busy && q >= .02))) { const [x, y, z] = rackAt(s); v3gMsl(s.ms, x, y, z, rh, K, 0); }
    // 托架在举升臂前端（铰点前 2.32 米、高 0.3 米），随臂抬起；这一趟的弹：q .02–.1 从架上抬到托架上，.48–.56 推进挂点，之后托架空着
    const cx = 2.32 * Math.cos(pitch) - .3 * Math.sin(pitch), cz = 2.32 * Math.sin(pitch) + .3 * Math.cos(pitch);
    const [cxw, cyw] = at(L[0] + fu * (cx - .32), L[1] + fv * (cx - .32)), Cz = top + .64 + cz + .13;
    const E = busy ? LD[ci] : null, S0 = E ? SP.find(s => s.i === ci) : null;
    let M3 = null;
    if (E && q >= .02 && q < .1 && S0) { const P0 = rackAt(S0), k = sm01((q - .02) / .08); M3 = [lerp(P0[0], cxw, k), lerp(P0[1], cyw, k), lerp(P0[2], Cz, k) + Math.sin(k * Math.PI) * .5]; }
    else if (E && q >= .1 && q < .48) M3 = [cxw, cyw, Cz];
    else if (E && q >= .48 && q < .56) {   // 推进挂点（弹舱里 / 翼下挂架）
      const k = sm01((q - .48) / .08), [wx, wy] = at(sl[0], sl[1]), P1 = E.v ? v3dGndAt(key, sz, wx, wy, top, h + a, E.v) : null, [bxw, byw] = at(B[0], B[1]);
      const T1 = P1 || [bxw, byw, top + V3D_LOAD.bayZ + .25];
      M3 = [lerp(cxw, T1[0], k), lerp(cyw, T1[1], k), lerp(Cz, T1[2], k)];
    }
    if (M3 && msl) v3gMsl(E.ms, M3[0], M3[1], M3[2], h + a, K, 0);
    // 两名弹药兵（红马甲）：在架子旁抬弹放上托架 → 跟着挂弹车走到飞机旁 → 跪在机腹下两侧扶正导弹、对准挂钩 → 跟车退出来 → 走回原位
    if (busy || v3mHi()) for (const s of [-1, 1]) {
      const sH = at2(sl, d0, s * 1.55), sA = at2(B, d2, s * 1.55), kn = at2(B, 1.15, s * 1.05), pk = [pk0[0] + ca * s * .7, pk0[1] + sa * s * .7];
      let u, v, f = la, pose = 'st';
      const walk = (P0, P1, k, q0, q1, face, cr) => {   // 从 P0 走到 P1（走完 k 0–1，这段占这一趟的 q0–q1，按速度选走 / 跑的步频）
        const Lw = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), run = !cr && Lw / Math.max(.1, (q1 - q0) * Tc) > 2.8, st = run ? .55 : .3;
        u = lerp(P0[0], P1[0], k); v = lerp(P0[1], P1[1], k); f = face ?? Math.atan2(P1[1] - P0[1], P1[0] - P0[0]);
        pose = Lw < .05 ? 'st' : (cr ? 'y' : run ? 'r' : 'w') + (Math.floor(k * Lw / st) & 7);
      };
      if (!busy) [u, v] = sH;
      else if (q < .02) walk(sH, pk, q / .02, 0, .02);
      else if (q < .1) walk(pk, sH, sm01((q - .02) / .08), .02, .1, null, true);   // 抬着弹走到托架旁
      else if (q < .38) walk(sH, sA, sm01((q - .1) / .28), .1, .38, la);
      else if (q < .42) walk(sA, kn, (q - .38) / .04, .38, .42);
      else if (q < .58) { [u, v] = kn; pose = 'kw'; }
      else if (q < .62) walk(kn, sA, (q - .58) / .04, .58, .62);
      else walk(sA, sH, sm01((q - .62) / .3), .62, .92, la);
      const [mx, my] = at(u, v);
      v3gMan('deck#b23a2e', pose, mx, my, top, h + f, V3_PIL, 0);   // 红马甲：弹药兵
    }
  };
  // 每个机位都画挂弹车和导弹挂载架（空着、飞机刚走也在原位，不会突然没了）：机位上停着的（待命 / 整备）、正要停进来的（着舰后滑过来：架子先摆好它要挂的弹）
  const park = cvPark(cv, wing), byJ = new Map();
  for (const [id, j] of park) { const w = wing.find(o => o.id === id); if (w) byJ.set(j, { w, r: w.state === 'rearm' ? 1 - clamp(w.rearmT / AIR_REARM, 0, 1) : 1, park: true }); }
  for (const p of live) if (p.phase === 'trap' && p.rsv != null && p.rsv >= 0 && !byJ.has(p.rsv)) byJ.set(p.rsv, { w: { type: p.kind, v: p.v }, r: 0 });
  C.slots.forEach((sl, j) => {
    const E = byJ.get(j), w = E ? E.w : null, key = w && typeof airSilKey === 'function' ? airSilKey(w.type, w.v) : 'j35', sz = (w && typeof airMdl === 'function' && airMdl(w.type, w.v).size) || 15;
    loader(j, w, key, sz, E ? E.r : 1, AIR_REARM);
    const N = E && E.park && typeof fwLoadout === 'function' ? fwLoadout(w.type, w.v).length : 0, nL = N ? v3dArmLoaded(E.r, N) : 0;
    if (nL > 0) { const [wx, wy] = at(sl[0], sl[1]); v3dPins(key, sz, wx, wy, top, h + sl[2], w, nL, v3dParkFold(w, key, E.r, N)); }   // 弹挂上了：插着保险销
  });
  // 出动：停着的时候已经挂好（机库里的也挂好了）；保险销一直插到偏流板后解除保险时
  for (const p of live) {
    if (p.phase !== 'cat' || !p.arm || p.dk === 'brd') continue;
    const key = v3dKey(p), sz = v3dSz(p);
    if ((p.dk !== 'hold' || (p.dkT || 0) < V3D_ARM.pull) && p.dk !== 'line' && p.dk !== 'hook') v3dPins(key, sz, p.x, p.y, top - C.hang * (typeof cvDeckSink === 'function' ? cvDeckSink(p) : 0), p.heading, { type: p.kind, v: p.v }, 99, p.fold ?? 0);
  }
  v3dArmCrew(live, top, h, at);   // 偏流板后解除保险的挂弹组
  v3dTugs(cv, live, top, h, at);   // 牵引车
}
// 解除保险的时间线（秒，进入 'hold' 起算）：走到机腹下 → 跪着拔销（pull 时刻销子离机）→ 走到机头前 → 举销给飞行员看 → 退到一旁
const V3D_ARM = { in: 1.3, pull: 2.2, kn: 2.7, out: 3.7, show: 4.7, away: 5.5 };
// 保险销的红飘带（机型坐标，与机体同一原点）：每个弹舱两根、侧弹舱和每个外挂点各一根，从机腹 / 挂架下垂下来，被甲板风吹得往后飘
function v3mdPins(key) {
  const M = mbNew(), D = typeof AIRD === 'object' && AIRD[key];
  if (!D || typeof v3AirSec !== 'function') return M;
  const sec = v3AirSec(D), hw0 = D.body ? Math.max(...D.body.map(b => b[1])) : 1.4, zb = V3_AIRZ - hw0 * sec.kb * .9, zw = D.hi ? V3_AIRZ + hw0 * sec.kt * .82 : V3_AIRZ - hw0 * sec.kb * .35;
  const flag = (x, y, z) => { mbBox(M, x - .05, x + .05, y - .04, y + .04, z - .08, z + .02, .75); mbQuad(M, [x, y - .06, z - .06], [x, y + .06, z - .06], [x - .32, y + .06, z - .62], [x - .32, y - .06, z - .62], V3_PINC); };   // 销子 + 斜飘的飘带
  if (D.bay) { const [x0, x1, hw, yc] = D.bay, dx = (x0 - x1) * .22; for (const sg of yc ? [1, -1] : [0]) { flag((x0 + x1) / 2 + dx, yc * sg + hw * .5, zb); flag((x0 + x1) / 2 - dx, yc * sg - hw * .5, zb); } }
  if (D.sbay) { const [x0, x1, y] = D.sbay; for (const sg of [1, -1]) flag((x0 + x1) / 2, y * sg, zb + .2); }
  for (const [x, y] of D.st || []) for (const sg of y ? [1, -1] : [1]) flag(x - .2, y * sg, zw - .34);
  if (!D.bay && !D.sbay && !(D.st || []).length) flag(0, 0, zb);
  return M;
}
function v3dPins(key, sz, x, y, top, a, w = null, n = 99, fold = 0) {   // w：哪一型（{ type, v }），n：挂上了几枚，fold：外翼折起程度
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key];
  if (w && mk && typeof V3G_FOLD === 'object' && V3G_FOLD[mk]) { v3dPinsMdl(w, key, sz, x, y, top, a, n, fold); return; }
  v3mAdd('pins:' + key, () => v3mdPins(key), x, y, top + V3_GEAR * sz / 21, a, sz / 21, 3);
}
// 有折翼的用户模型（歼-15）：保险销插在模型的外挂点上（fpwpn.js 满载清单的前 n 枚），外翼折着时跟着翻上去；飘带照样往下垂、被风吹向后
function v3dPinsMdl(w, key, sz, x, y, top, a, n, fold) {
  if (typeof fwLoadout !== 'function') return;
  const LD = fwLoadout(w.type, w.v);
  for (let i = 0; i < Math.min(n, LD.length); i++) {
    const e = LD[i];
    if (!e.v || e.bay !== 'ext') continue;
    const p = v3dGndAt(key, sz, x, y, top, a, [e.v[0] - .3, e.v[1], e.v[2] + .2], fold);   // 弹的上方、挂架下沿
    if (p) v3mAdd('pin1', v3mPin1, p[0], p[1], p[2], a, sz / 21, 3);
  }
}
function v3mPin1() { const M = mbNew(); mbBox(M, -.05, .05, -.04, .04, -.08, .02, .75); mbQuad(M, [0, -.06, -.06], [0, .06, -.06], [-.32, .06, -.62], [-.32, -.06, -.62], V3_PINC); return M; }
// 挂弹组两人（左右各一）：从飞机两侧走到机腹下弹舱旁 → 跪着拔掉保险销 → 走到机头前方、举起销子给飞行员看 → 退到两侧；滑上弹射器到弹射时站在一旁
const V3D_ARMP = new Map();   // 飞机 id → 退开后站的位置（甲板坐标）
function v3dArmCrew(live, top, h, at) {
  const now = new Set();
  for (const p of live) {
    if (!p.arm || p.lu == null || !((p.phase === 'cat' && (p.dk === 'hold' || p.dk === 'line' || p.dk === 'hook')) || (p.phase === 'roll' && (p.cs || 0) < 30))) continue;
    now.add(p.id);
    const key = v3dKey(p), k = v3dK(p), D = typeof AIRD === 'object' && AIRD[key], bx = D && D.bay ? (D.bay[0] + D.bay[1]) / 2 * k : 0, nose = v3dNose(key, k);
    const c = Math.cos(p.lh), sn = Math.sin(p.lh), P = (f, r) => [p.lu + c * f - sn * r, p.lv + sn * f + c * r], t = p.dk === 'hold' ? p.dkT || 0 : 99;
    if (t < V3D_ARM.away) V3D_ARMP.set(p.id, [-1, 1].map(s => [...P(bx - 3, s * 11), p.lh + s * Math.PI / 2]));   // 退到两侧 11 米、偏流板后面（弹射前加力时不在尾流里）
    const E = V3D_ARMP.get(p.id);
    if (!E) continue;
    [-1, 1].forEach((s, i) => {
      const S0 = P(bx - 1, s * 7.5), K0 = P(bx, s * 1.25), F0 = P(nose + 4, s * 2.2), A = V3D_ARM;
      let u, v, f, pose;
      const walk = (P0, P1, q, face) => { u = lerp(P0[0], P1[0], q); v = lerp(P0[1], P1[1], q); f = face ?? Math.atan2(P1[1] - P0[1], P1[0] - P0[0]); pose = 'w' + (Math.floor(q * Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) / .3) & 7); };
      if (t < A.in) walk(S0, K0, t / A.in);
      else if (t < A.kn) { [u, v] = K0; f = p.lh - s * Math.PI / 2; pose = 'kw'; }
      else if (t < A.out) walk(K0, F0, (t - A.kn) / (A.out - A.kn));
      else if (t < A.show) { [u, v] = F0; f = p.lh + Math.PI; pose = 'hp'; }
      else if (t < A.away) walk(F0, E[i], (t - A.show) / (A.away - A.show));
      else { [u, v, f] = E[i]; f += Math.PI; pose = 'st'; }   // 站在一旁看着飞机
      const [x, y] = at(u, v);
      v3gMan('deck#b23a2e', pose, x, y, top, h + f, V3_PIL, 0);   // 红马甲：挂弹组拔保险销
    });
  }
  for (const id of V3D_ARMP.keys()) if (!now.has(id)) V3D_ARMP.delete(id);
}
// 牵引车：每艘航母 4 辆，平时停在甲板边的待命位（V3D_TUGH）；有飞机要拖就派最近的空车开过去，开到机头前方再倒过去挂上前起落架的拖杆——
//   出动：登机快好时开过来挂钩，启动后把飞机拖出机位约 20 米（cvdeck.js p.tow）；回收：飞机滑到机位前时从内侧开过来挂上，原地转向、推着倒进机位；
//   完事脱钩：先朝侧面拐开让出飞机的去路（飞机等它让开才滑走），再开回待命位停好
const V3D_TUGH = [[-1, 31, -Math.PI / 2], [3.5, 31, -Math.PI / 2], [-57, 21.5, Math.PI], [-57, 26, Math.PI]];   // 待命位 [u, v, 车头朝向]：舰岛前、舰岛后各两辆，在滑行车道外侧
const V3D_TUGS = new Map();   // 航母 → { t, list: [{ u, v, a, home, job: { id, ph 'go' / 'hook' / 'away' / 'back' } }] }
// 这架飞机现在要不要牵引车：挂钩点（甲板坐标，车头朝向 a）；soon：还没开始拖（车先开过去就位）；不要返回 null
function v3dTugReq(p) {
  if (p.lu == null) return null;
  const kk = v3dK(p), nose = v3dNose(v3dKey(p), kk), c = Math.cos(p.lh), sn = Math.sin(p.lh), hook = { u: p.lu + c * (nose + 2.66), v: p.lv + sn * (nose + 2.66), a: p.lh };   // 拖杆一头挂在前起落架上（车尾拖杆端在车后 2.66 米）
  if (p.phase === 'cat') {
    const tw = p.tw || p.fpBrd, tb = p.dk === 'brd' && tw && typeof cvBrdT === 'function' ? cvBrdT(p) : 0;   // fpBrd：玩家坐着的（v3pilot.js），从升降机上来的也拖
    if (tb && (p.dkT || 0) > tb - 12) return Object.assign(hook, { soon: true });   // 登机快好时开过来等着
    return (p.dk === 'eng' && tw) || (p.dk === 'taxi' && p.tow) ? hook : null;
  }
  if (p.phase !== 'trap' || !Array.isArray(p.path) || !p.path.length) return null;
  const s0 = p.path[0];
  if (s0[0] === 'P' || s0[0] === 'R') return hook;   // 原地转向、倒进机位
  if (!(p.path[1] && p.path[1][0] === 'P')) return null;
  const f = sm01(1 - clamp(Math.hypot(s0[0] - p.lu, s0[1] - p.lv) / 25, 0, 1)), q = (p.lv > 0) === (c > 0) ? [sn, -c] : [-sn, c], a0 = Math.atan2(-q[1], -q[0]);   // 还在往机位前滑：在内侧 10 米处跟着，飞机停下时正好挂上
  return { u: lerp(hook.u + q[0] * 10, hook.u, f), v: lerp(hook.v + q[1] * 10, hook.v, f), a: a0 + airAng(p.lh - a0) * sm01((f - .6) / .4), soon: true, fol: true };
}
function v3dTugs(cv, live, top, h, at) {
  let F = V3D_TUGS.get(cv);
  if (!F || F.S !== S || S.t < F.t - 1) { F = { t: S.t, S, list: V3D_TUGH.map((q, i) => ({ u: q[0], v: q[1], a: q[2], home: i, job: null })) }; V3D_TUGS.set(cv, F); }
  const dt = clamp(S.t - F.t, 0, .5); F.t = S.t;
  const req = new Map();
  for (const p of live) { const r = v3dTugReq(p); if (r) req.set(p.id, r); }
  for (const [id, r] of req) {   // 没派车的派最近的空车（正在开回去的也算空车）
    if (F.list.some(T => T.job && T.job.id === id)) continue;
    let best = null, bd = 1e9;
    for (const T of F.list) { if (T.job && T.job.ph !== 'back') continue; const d = Math.hypot(T.u - r.u, T.v - r.v); if (d < bd) { bd = d; best = T; } }
    if (best) best.job = { id, ph: 'go' };
  }
  // 朝 (tu, tv) 开（车头朝前进方向；rev 倒车：车尾朝前进方向；快到时转到 ta）；到了返回 true
  const drive = (T, tu, tv, sp, ta, rev) => {
    const dx = tu - T.u, dy = tv - T.v, d = Math.hypot(dx, dy);
    if (d < .05) { if (ta != null) T.a = ta; return true; }
    const step = Math.min(d, sp * dt), mv = Math.atan2(dy, dx) + (rev ? Math.PI : 0), want = ta != null && d < 3 ? ta : mv;
    T.u += dx / d * step; T.v += dy / d * step; T.a += airAng(want - T.a) * Math.min(1, dt * 5);
    return d - step < .05;
  };
  for (const T of F.list) {
    const J = T.job, r = J && req.get(J.id), H = V3D_TUGH[T.home];
    if (J && r && (J.ph === 'go' || J.ph === 'hook')) {
      if (J.ph === 'go') {
        if (r.fol) drive(T, r.u, r.v, 9, r.a);   // 跟着往机位滑的飞机
        else {
          const c = Math.cos(r.a), sn = Math.sin(r.a);
          if (!J.pre) { if (drive(T, r.u + c * 7, r.v + sn * 7, 7)) J.pre = true; }   // 先开到挂钩点前方 7 米
          else if (drive(T, r.u, r.v, 1.6, r.a, true)) J.ph = 'hook';   // 倒过去挂上
        }
        if (!r.soon) {   // 飞机已经动了：车还没到就加速开过去追上（不瞬移），到了跟前再挂上
          if (Math.hypot(T.u - r.u, T.v - r.v) < 1.5) J.ph = 'hook';
          else if (!r.fol) drive(T, r.u, r.v, 12, r.a);
        }
      }
      if (J.ph === 'hook') { const k = Math.min(1, dt * 8); T.u += (r.u - T.u) * k; T.v += (r.v - T.v) * k; T.a += airAng(r.a - T.a) * k; }   // 挂着：跟着飞机走（挂上那一下平滑靠过去）
    } else if (J && !r && J.ph !== 'back') {   // 拖完了：先朝侧面（待命位那边）拐开 9 米，让出飞机的去路
      if (J.ph !== 'away') { const sg = Math.cos(T.a) * (H[1] - T.v) - Math.sin(T.a) * (H[0] - T.u) >= 0 ? 1 : -1, ax = T.a + sg * Math.PI / 2; J.ph = 'away'; J.au = T.u + Math.cos(ax) * 9 + Math.cos(T.a) * 4; J.av = T.v + Math.sin(ax) * 9 + Math.sin(T.a) * 4; }
      if (drive(T, J.au, J.av, 5)) J.ph = 'back';
    } else if (J && J.ph === 'back') { if (drive(T, H[0], H[1], 6, H[2])) T.job = null; }
    else if (!J) { T.u = H[0]; T.v = H[1]; T.a = H[2]; }
    const [x, y] = at(T.u, T.v);
    v3dVeh('tug', v3mDeckTractor, x, y, top + .02, h + T.a);
  }
}

// ———————————————— 拦阻索 ————————————————
//   着舰区横着四道钢索（两头接甲板下的拦阻机）。着舰时尾钩挂住第一道还没越过的钢索，钢索被拉成 V 字、跟着尾钩往前滑，
//   飞机停稳、往后退一点松开尾钩（cvdeck.js 'arr' 停稳 0.7 秒后转去滑行），钢索弹回原位
const V3D_HOOK = .42;   // 尾钩离机身中心多远（乘飞机画面尺寸）
function v3mdWire(L) { const M = mbNew(); mbBox(M, 0, L, -.03, .03, 0, .06, .32); return typeof mbMetal === 'function' ? mbMetal(M, .7) : M; }
function v3dWires(live, top, h, at) {
  if (typeof CVG !== 'object' || !CVG.wires || typeof CV_LLEN !== 'number') return;
  const L = CVG.land, a = Math.atan2(L.v1 - L.v0, L.u1 - L.u0), nx = -Math.sin(a), ny = Math.cos(a), o = L.hw + 1.5, P = t => [lerp(L.u0, L.u1, t), lerp(L.v0, L.v1, t)];
  const p = live.find(q => q.phase === 'trap' && q.dk === 'arr' && q.tl != null), hd = p ? v3dSz(p) * V3D_HOOK / CV_LLEN : 0, ht = p ? p.tl - hd : -1;
  const wi = p ? CVG.wires.findIndex(t => t >= CVG.td - hd - .002) : -1;   // 尾钩着舰时前面的第一道
  const seg = (A, B) => { const du = B[0] - A[0], dv = B[1] - A[1], n = Math.max(1, Math.round(Math.hypot(du, dv) * 2)), [x, y] = at(A[0], A[1]); v3mAdd('cvwire:' + n, () => v3mdWire(n / 2), x, y, top + .01, h + Math.atan2(dv, du), 1, 3); };
  CVG.wires.forEach((t, i) => {
    const [u, v] = P(t), A = [u + nx * o, v + ny * o], B = [u - nx * o, v - ny * o];
    if (i === wi && ht > t) { const H = P(ht); seg(A, H); seg(B, H); }   // 挂住了：两头到尾钩拉成 V 字
    else seg(A, B);
  });
}

// v3fx.js 每帧调用：本文件各部分的发光与烟
function v3dFx(out, C, inB, seen) {
  v3dCatFx(out, C, inB);
}
