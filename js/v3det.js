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
const V3D_JET = { j35: 1, j20: 1, j15: 1, j15t: 1, j16: 1, j16d: 1, j36: 1, j50: 1, f35: 1, f22: 1, f35b: 1 };   // 有加力的喷气机
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
// ———————————————— 热浪：喷口后面的空气被烤得发虚（抓屏折射）————————————————
//   v3dBurner 每帧登记一段段热气柱（喷口中心、喷流方向、长度、强度）；v3fx.js 画加法特效之前调 v3dHaze：先把屏幕上热气柱所在的一块拷进贴图，
//   再按热气柱画面向镜头的面片，片元里按顺着喷流滚动的噪声把取样位置错开几个像素——后面的甲板、海面、飞机看起来在抖；离镜头远的、低画质不画
const V3DH = { list: [], tried: false, ok: false, pr: null, a: {}, u: {}, buf: null, tex: null, tw: 0, th: 0 };
function v3dHazeAdd(c, R, r, len, k) { v3dHazeD(c, [-R[0], -R[3], -R[6]], r, len, k); }   // 喷口：顺着机身往后
// 一段热气柱（GL 坐标：起点 c、单位方向 d、半径 r、长度 len、强度 k）；一帧最多收 240 段，画的时候只留离镜头最近的 96 段（手机 40 段）
function v3dHazeD(c, d, r, len, k) {
  if (!(k > .05) || V3DH.list.length > 240) return;
  V3DH.list.push({ c: c.slice(), d, r, len, k });
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
  let X = V3D_VEXH[key] || V3D_VEXH[M.run === 't' ? 't' : 'w'];
  if (typeof X === 'string') X = V3D_VEXH[X];
  const k = len / M.L, Lh = M.L * k, B = M.B * k, Hh = M.B * .6 * k, c = Math.cos(h), s = Math.sin(h), n = Math.hypot(...X.d), dx = X.d[0] / n, dy = X.d[1] / n, dz = X.d[2] / n;
  const d = [dx * c - dy * s, -(dx * s + dy * c), dz], kk = X.k * (v.moving ? 1.25 : .85);   // 走着的发动机转速高
  for (const [px, py, pz] of X.p) { const lx = px * Lh, ly = py * B; v3dHazeD([v.x + lx * c - ly * s, -(v.y + lx * s + ly * c), z + pz * Hh], d, X.r * k, X.len * k, kk); }
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
  for (const [x, y, z, r, kk] of P) { const yy = y * cr - z * sr, zz = y * sr + z * cr; v3dHazeD([o.x + (x * c - yy * s) * k, -(o.y + (x * s + yy * c) * k), o.z + zz * k], d, r * k * 1.3, r * k * 13, kk * k0 * 1.6); }
}
// 舰艇烟囱上方的热气（往上冒）：x、y 舰的位置，h 航向，L 画面舰长，f 烟囱离舰中心多远（按舰长）、zt 烟囱口高
function v3dFunnel(x, y, h, L, f, zt, k = .5) {
  const c = Math.cos(h), s = Math.sin(h);
  v3dHazeD([x + c * f * L, -(y + s * f * L), zt], [0, 0, 1], L * .05, L * .55, k * 1.6);
}
const V3DH_VS = `attribute vec3 p; attribute vec3 q; uniform mat4 uM; uniform vec3 uEye; varying vec3 vQ; varying float vD;
void main() { vQ = q; vD = length(uEye - p); gl_Position = uM * vec4(p, 1.); }`;
const V3DH_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex; uniform vec2 uSz; uniform float uT; varying vec3 vQ; varying float vD;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1., 0.)), u.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), u.x), u.y); }
void main() {
  float a = vQ.x, b = vQ.y, f = min(1.3, smoothstep(0., .08, a) * (1. - smoothstep(.6, 1., a)) * (1. - b * b) * vQ.z);   // 喷口处最强、往后散开变弱
  vec2 nq = vec2(a * 7. - uT * 9., b * 2.2 + uT * .7), nr = vec2(a * 17. - uT * 23., b * 5. - uT * 1.3);
  vec2 off = vec2(vn(nq), vn(nq + 17.3)) - .5 + (vec2(vn(nr + 3.1), vn(nr + 9.7)) - .5) * .5;   // 大的波纹慢慢滚、小的碎纹抖得快
  vec2 px = off * clamp(560. / vD, 4., 34.) * uSz.y / 1080. * f, uv = (gl_FragCoord.xy + px) / uSz, ca = px * .18 / uSz;   // 错开十几个像素（离得近扭得多），按画面高度缩放
  vec3 c = vec3(texture2D(uTex, uv + ca).r, texture2D(uTex, uv).g, texture2D(uTex, uv - ca).b);   // 一点点色散：热空气的折射边缘
  float sh = (vn(nr * 1.7 + 5.3) - .5) * .08 * f;   // 折光的明暗闪动（轻一点：成片的海面上原来是一层闪烁的颗粒）
  c *= 1. + sh;
  c += vec3(.05, .025, 0.) * f * f * smoothstep(.35, 0., a) * min(vQ.z, 1.5);   // 喷口附近的热流微微发暖
  gl_FragColor = vec4(c, smoothstep(0., .18, f));
}`;
function v3dHazeInit(gl) {
  V3DH.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3DH_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3DH_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3DH.pr = pr; V3DH.a = { p: gl.getAttribLocation(pr, 'p'), q: gl.getAttribLocation(pr, 'q') };
    for (const k of ['uM', 'uEye', 'uTex', 'uSz', 'uT']) V3DH.u[k] = gl.getUniformLocation(pr, k);
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
  if (L.length > NMAX) { const E = C.E, d2 = h => (h.c[0] - E[0]) ** 2 + (h.c[1] - E[1]) ** 2 + (h.c[2] - E[2]) ** 2; L = L.sort((a, b) => d2(a) - d2(b)).slice(0, NMAX); }   // 只留最近的
  const gl = V3.gl;
  if (!V3DH.tried) v3dHazeInit(gl);
  if (!V3DH.ok) return;
  const E = C.E, M = C.M, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, out = [];
  const prj = p => { const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15]; return w > .01 ? [(x / w * .5 + .5) * W, (y / w * .5 + .5) * H] : null; };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, full = false;
  for (const h of L) {   // 热气柱：从喷口往后，越往后越宽（面向镜头）；顶点 = 位置 3 + (沿喷流 0–1、横向 −1–1、强度)
    const p0 = h.c, d = h.d, p1 = [p0[0] + d[0] * h.len, p0[1] + d[1] * h.len, p0[2] + d[2] * h.len];
    if (Math.hypot(p0[0] - E[0], p0[1] - E[1], p0[2] - E[2]) > RMAX) continue;
    const m = [(p0[0] + p1[0]) / 2 - E[0], (p0[1] + p1[1]) / 2 - E[1], (p0[2] + p1[2]) / 2 - E[2]];
    let sv = [d[1] * m[2] - d[2] * m[1], d[2] * m[0] - d[0] * m[2], d[0] * m[1] - d[1] * m[0]];
    const l = Math.hypot(sv[0], sv[1], sv[2]);
    if (l < 1e-6) continue;
    sv = [sv[0] / l, sv[1] / l, sv[2] / l];
    const w0 = h.r * 2, w1 = h.r * 5, A = [[p0, -w0, 0, -1], [p0, w0, 0, 1], [p1, w1, 1, 1], [p1, -w1, 1, -1]].map(([p, w, a, b]) => [p[0] + sv[0] * w, p[1] + sv[1] * w, p[2] + sv[2] * w, a, b, h.k]);
    let vis = false;
    for (const q of A) { const sc = prj(q); if (!sc) { full = vis = true; continue; } vis = true; x0 = Math.min(x0, sc[0]); x1 = Math.max(x1, sc[0]); y0 = Math.min(y0, sc[1]); y1 = Math.max(y1, sc[1]); }   // 有角落跑到镜头后面：整屏都拷
    if (vis) for (const i of [0, 1, 2, 0, 2, 3]) for (const v of A[i]) out.push(v);
  }
  if (!out.length) return;
  // 抓屏：只拷热气柱所在的一块（外扩一圈：错开取样也不出界）
  const mg = Math.ceil(40 * H / 1080) + 8;
  const cx0 = full ? 0 : Math.max(0, Math.floor(x0 - mg)), cy0 = full ? 0 : Math.max(0, Math.floor(y0 - mg)), cx1 = full ? W : Math.min(W, Math.ceil(x1 + mg)), cy1 = full ? H : Math.min(H, Math.ceil(y1 + mg));
  if (cx1 <= cx0 || cy1 <= cy0) return;
  gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, V3DH.tex);
  if (V3DH.tw !== W || V3DH.th !== H) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, W, H, 0, gl.RGB, gl.UNSIGNED_BYTE, null); V3DH.tw = W; V3DH.th = H; }
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, cx0, cy0, cx0, cy0, cx1 - cx0, cy1 - cy0);
  gl.useProgram(V3DH.pr);
  gl.uniformMatrix4fv(V3DH.u.uM, false, M); gl.uniform3f(V3DH.u.uEye, E[0], E[1], E[2]);
  gl.uniform1i(V3DH.u.uTex, 13); gl.uniform2f(V3DH.u.uSz, W, H); gl.uniform1f(V3DH.u.uT, S.t % 600);   // 时间取模：打久了噪声坐标不至于大到丢精度
  gl.bindBuffer(gl.ARRAY_BUFFER, V3DH.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
  const A = V3DH.a;
  gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(A.q); gl.vertexAttribPointer(A.q, 3, gl.FLOAT, false, 24, 12);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, out.length / 6);
  gl.depthMask(true); gl.disable(gl.BLEND);
  gl.disableVertexAttribArray(A.p); gl.disableVertexAttribArray(A.q);
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
const V3_WS = { j35: 500, j20: 450, j15: 470, j36: 480, j50: 480, h6k: 520, y20: 620, kj600: 380 };   // 翼载（公斤 / 平方米，公开估算）：算迎角
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
  P.t = S.t; P.pt = pt;
  return pt;
}
// 甲板上的舰载机：挂杆后先做舵面检查（杆前后左右推一遍，平尾上下摆、左右差动），之后停在起飞配平（后缘上偏约 10°）直到弹射
const V3D_TOTRIM = -.18;
function v3dDeckSurf(p) {
  if (p.phase === 'roll') return { de: V3D_TOTRIM, da: 0 };
  if (p.phase !== 'cat' || p.dk !== 'hook') return null;
  const t = p.dkT || 0, c = t < .5 ? -.35 * Math.sin(t / .5 * Math.PI) : t < 1 ? .25 * Math.sin((t - .5) / .5 * Math.PI) : 0, r = t >= 1 && t < 1.7 ? .22 * Math.sin((t - 1) / .7 * Math.PI * 2) : 0;
  return { de: c + V3D_TOTRIM * sm01((t - 1.5) / .5), da: r };
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
//   照加力式涡扇的结构画：涡轮后面是尾锥、涡轮后机匣的支板与喷油杆，再往后两圈同心的 V 形火焰稳定器，外面是隔热衬套和收敛扩散喷管的调节片。
//   推油门时这些从里往外热起来：暗红 → 橙 → 橙黄（喷口里发动机变热的纹路）；开加力先在稳定器上点着一小团火（分区加力一区一区点），
//   根部蓝紫、尖上橙红；其余几区接连点着，火舌变长、变成白芯黄焰；全加力时喷流欠膨胀，喷口后约一个直径起一串激波马赫环，间隔约 1.2 个直径，越往后越暗、越偏橙粉
// 一架飞机的喷口（世界单位，相对锚点：空中是机身中线，ground 时是机轮着地点）：{ x, y, z, r 半径, w、hh 半宽、半高, d 喷管深 }——
//   用户给的模型里量的（tools/v3gmodels.json 的 noz，米，模型坐标 x 机头、y 左、z 离着地点高），按画面尺寸缩放；模型还没加载完就不画尾焰
function v3dNoz(key, sz, ground) {
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key], M = mk && typeof V3G === 'object' && V3G.M[mk], N = [];
  if (!M || !M.ready || !M.meta.noz) return N;
  const s = sz / M.meta.len, z0 = ground ? 0 : M.meta.zc;
  for (const n of M.meta.noz) for (const sg of n[1] ? [1, -1] : [1]) N.push({ x: n[0] * s, y: n[1] * sg * s, z: (n[2] - z0) * s, r: n[3] * s, d: n[4] * s, w: n[3] * s, hh: n[3] * s });
  return N;
}
// 炽热金属的颜色（近似黑体）：t 0 暗红 → .5 橙 → 1 淡黄；a 不透明度
const V3D_HOT = [[.4, .03, .01], [.85, .13, .03], [1, .3, .06], [1, .5, .15], [1, .7, .32], [1, .87, .58]];
function v3dHot(t, a) {
  const f = clamp(t, 0, 1) * 5, i = Math.min(4, f | 0), u = f - i, A = V3D_HOT[i], B = V3D_HOT[i + 1];
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, a];
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
  const ht = E.h, ab = E.b, s1 = Math.min(1, ab / .3), g = sm01((ab - .38) / .62), fsh = Math.exp(-(S.t - E.tL) / .15);   // s1 小火、g 大火的程度，fsh 点火的闪光
  const hk = dl => clamp((ht - dl) / (1 - dl), 0, 1);   // 从里往外热：越靠外的部件热得越晚
  for (const n of N) {
    const c = [o.x + R[0] * n.x + R[1] * n.y + R[2] * n.z, -o.y + R[3] * n.x + R[4] * n.y + R[5] * n.z, o.z + R[6] * n.x + R[7] * n.y + R[8] * n.z];
    const P = (u, v, w) => [c[0] - R[0] * u + R[1] * v + R[2] * w, c[1] - R[3] * u + R[4] * v + R[5] * w, c[2] - R[6] * u + R[7] * v + R[8] * w];
    const r = n.r || Math.min(n.w, n.hh * 1.6), d = n.d, w0 = r * .075;
    const q = 1 - sm01((Math.hypot(c[0] - Ey[0], c[1] - Ey[1], c[2] - Ey[2]) / Math.max(r, .05) - 120) / 100);   // 纹路：离镜头近才画
    const rib = (a, b, w, c0, c1) => v3fRib(out, Ey, a, b, w, c0, c1 || c0);
    // —— 喷口里发热的纹路 ——
    if (ht > .03) {
      v3fSpark(out, C, P(-d * .8, 0, 0), (n.r ? r : Math.max(n.w, n.hh)) * .9, v3dHot(hk(0), .5 * hk(0)));   // 喷管深处涡轮、尾锥的光（外圈被喷管壁挡住）
      if (q > .01 && n.r) {
        const ring = (u, rr, col) => { for (let i = 0; i < 18; i++) { const a0 = i / 18 * 6.2832, a1 = a0 + .349; rib(P(u, Math.cos(a0) * rr, Math.sin(a0) * rr), P(u, Math.cos(a1) * rr, Math.sin(a1) * rr), w0, col); } };
        v3fSpark(out, C, P(-d * .78, 0, 0), r * .3, v3dHot(hk(0), .75 * hk(0) * q));   // 尾锥
        const cs = v3dHot(hk(.08), .5 * hk(.08) * q);
        for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832 + .3, ca = Math.cos(a), sa = Math.sin(a); rib(P(-d * .62, ca * r * .3, sa * r * .3), P(-d * .62, ca * r * .84, sa * r * .84), w0, cs); }   // 涡轮后机匣支板、喷油杆
        for (const [rr, dl] of [[.5, .15], [.78, .25]]) { const t = Math.max(hk(dl), .92 * s1); ring(-d * .48, r * rr, v3dHot(t, (.55 * hk(dl) + .45 * s1) * q)); }   // 火焰稳定器（点了加力火挂在上面，最亮）
        const cw = v3dHot(hk(.4) * .85, .3 * hk(.4) * q), ce = v3dHot(hk(.4) * .7, .1 * hk(.4) * q);
        for (let i = 0; i < 14; i++) { const a = i / 14 * 6.2832, ca = Math.cos(a), sa = Math.sin(a); rib(P(-d * .42, ca * r * .93, sa * r * .93), P(-d * .04, ca * r * .98, sa * r * .98), w0 * .8, cw, ce); }   // 调节片内壁受热的条纹
        ring(-d * .02, r * .99, v3dHot(hk(.55) * .8, .18 * hk(.55) * q));   // 喷口唇口
      } else if (q > .01) {   // 扁平喷口：几道横的导流片
        const cs = v3dHot(Math.max(hk(.1), .92 * s1), (.5 * hk(.1) + .4 * s1) * q);
        for (const f of [-.5, 0, .5]) rib(P(-d * .5, -n.w * .88, f * n.hh), P(-d * .5, n.w * .88, f * n.hh), w0, cs);
      }
    }
    if (typeof v3dHazeAdd === 'function') v3dHazeAdd(c, R, (n.r || Math.max(n.w, n.hh)) * 1.3, 2 * (n.r || n.w) * (7 + 10 * ab), Math.max(ab * 1.6, ht * 1.1));   // 喷口后方的热浪（v3dHaze 画）
    if (ab <= .02) continue;
    // —— 加力：小火 → 大火（扁平喷口按宽度分几股） ——
    const K = n.r ? 1 : clamp(Math.round(n.w / (n.hh * 1.6)), 1, 3);
    for (let j = 0; j < K; j++) {
      const v0 = n.r ? 0 : -n.w + (2 * j + 1) * n.w / K, rf = n.r ? r : Math.min(n.w / K, n.hh * 1.6), D2 = rf * 2, F = u => P(u, v0, 0);
      const fk = 1 + .1 * Math.sin(S.t * 37 + id * 1.7 + v0 * 5 + n.y * 3) + .06 * Math.sin(S.t * 61 + id + j);   // 火舌抖动
      const cone = (u0, u1, wa, wb, ca, cb, ns) => { for (let i = 0; i < ns; i++) { const f0 = i / ns, f1 = (i + 1) / ns, cm = f => ca.map((x, m) => x + (cb[m] - x) * f); rib(F(lerp(u0, u1, f0)), F(lerp(u0, u1, f1)), lerp(wa, wb, (f0 + f1) / 2), cm(f0), cm(f1)); } };
      if (fsh > .02) v3fSpark(out, C, F(rf * .4), rf * 1.8, [1, .72, .4, .6 * fsh]);   // 点火那一下
      const Ls = D2 * (.6 + 1.1 * s1) * fk, k1 = s1 * (1 - .6 * g);   // 小火：一截半透明的火舌，根部蓝紫、中段粉橙、尖上橙红（大火起来后并进去）
      cone(0, Ls * .45, rf * 1.3, rf * 1.05, [.45, .48, 1, .3 * k1], [1, .5, .42, .22 * k1], 2);
      cone(Ls * .45, Ls, rf * 1.05, rf * .55, [1, .5, .42, .22 * k1], [1, .32, .12, 0], 2);
      cone(0, Ls * .4, rf * .65, rf * .35, [.8, .8, 1, .3 * k1], [1, .7, .5, 0], 2);
      const Lb = D2 * (1.3 + 3.1 * g) * fk;
      if (g > .01) {   // 大火（收着画，半透明）：外层橙红的混合层、黄色的焰身、白芯（根部带蓝紫），焰身里一串激波马赫环；火色随加力加大从橙变到白黄
        const hu = .5 + .5 * Math.sin(S.t * 4.3 + id + j);
        cone(0, Lb, rf * 1.7, rf * 1, [1, lerp(.32, .42, g), lerp(.12, .2, g), .2 * g], [1, .22, .1, 0], 3);   // 外焰
        cone(0, Lb * .85, rf * 1.15, rf * .6, [1, lerp(.55, .72, g) - .06 * hu, lerp(.22, .4, g), .26 * g], [1, .42, .2, 0], 3);   // 焰身
        cone(0, D2 * (.7 + .4 * g), rf * .85, rf * .4, [lerp(1, .86, g), lerp(.8, .92, g), lerp(.55, 1, g), .5 * g], [1, .85, .65, .08 * g], 2);   // 白芯
        v3fSpark(out, C, F(rf * .15), rf * 1.1, [.55, .45, 1, .2 * g]);   // 根部蓝紫
        for (let i = 0; i < 5; i++) {   // 激波马赫环：喷口后约一个直径起、间隔约 1.2 个直径，越往后越暗、越偏橙粉
          const u = D2 * (1 + 1.2 * i) * (1 + .03 * Math.sin(S.t * 23 + i + id)), a = .2 * sm01((g - .2 - i * .12) / .3) * (1 - i * .17) * fk;
          if (a < .02 || u > Lb * .85) continue;
          const cd = [[1, .93, .82], [1, .82, .66], [1, .7, .58], [1, .64, .56], [1, .6, .55]][i], w = rf * (.9 - .07 * i);
          cone(u - rf * .6, u, w * .3, w, [...cd, 0], [...cd, a], 2);
          cone(u, u + rf * .45, w, w * .3, [...cd, a], [...cd, 0], 2);
        }
      }
      // 立体感：一团团小火舌顺着喷流往后流、绕着轴心错开（有前有后、互相遮叠），越往后越小、越偏红、越淡
      const nl = Math.round(8 + 22 * Math.max(s1 * .5, g)), aL = Math.max(.6 * s1, g);   // 团数多、团大、每团淡：叠成一整条有起伏的火，不是一串珠子
      for (let i = 0; i < nl; i++) {
        const ph = (S.t * (1.6 + .5 * g) + i / nl + id * .37 + j * .21) % 1, an = i * 2.39996 + S.t * 3.1 + id, rr = rf * .5 * (1 - ph * .45) * (.45 + .55 * Math.abs(Math.sin(i * 12.99 + S.t * 7.3)));
        const L2 = (g > .01 ? Lb : Ls) * .92, o = P(ph * L2, v0 + Math.cos(an) * rr, Math.sin(an) * rr), cl = ph < .35 ? [1, .86, .62] : ph < .7 ? [1, .55, .22] : [1, .32, .12];
        v3fSpark(out, C, o, rf * (.95 - .45 * ph) * (.85 + .3 * fk), [...cl, .11 * aL * (1 - ph) * (1 - ph)]);
      }
      v3fSpark(out, C, F(rf * .8), rf * (2.2 + 1.1 * g) + .2, [1, lerp(.5, .6, g), lerp(.2, .3, g), (.09 + .1 * g) * Math.min(1, ab * 3)]);   // 映亮周围
    }
  }
}


// ———————————————— 甲板车辆（只是画面）：挂弹车、弹药拖车、牵引车 ————————————————
//   挂弹车、牵引车用 Sketchfab 上的模型（v3x.js 的 loader、tug，CC-BY），还没加载完时画代码建的；车辆按米画（航母是 1 比 1）
//   每个停着飞机的机位内侧停一辆挂弹车，旁边一辆弹药拖车（两枚霹雳-15）。飞机着舰停好后整备 45 秒（carrier.js 的 rearm）：
//   挂弹车托着导弹开到飞机侧面，举升、把导弹送进弹舱，再倒回原位，拖车上再取一枚放上托架
//   着舰后的飞机滑到机位前：牵引车从内侧开过来，用拖杆挂上前起落架；原地转向、倒进机位都是它推着，停好后脱钩开走
//   出动前：带武器的飞机在机位上登机时挂弹车同样把弹送进弹舱；快好时牵引车倒到机头前挂上拖杆，启动后把飞机拖出机位约 20 米再脱钩
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
    v3gMan('deck', 'sit', x + St[0] * c - St[1] * s, y + St[0] * s + St[1] * c, z + St[2], a, typeof V3_PIL === 'number' ? V3_PIL : .95, 0);
  }
}
function v3dDeckVeh(cv, C, live, wing, top, h, at) {
  if (typeof cvPark !== 'function' || typeof AIR_REARM !== 'number') return;
  const msl = typeof v3gMsl === 'function', K = .86;   // 导弹（用户给的模型，js/v3g.js）跟飞机同一比例
  // 机位 j 旁的挂弹车与弹药拖车：r = 挂弹进度（0 开始 – 1 挂完；挂弹车开过去、举升把弹送进弹舱、倒回原位，拖车上再取一枚放上托架）
  // 挂弹（r 进度 0–1）：挂弹车托着导弹从原位开到飞机侧面 → 慢慢伸进机腹下 → 举升臂抬起 → 把弹推进弹舱（舱门这时开着）→ 放下举升臂 → 倒出来开回原位 →
  //   地勤从拖车上抬一枚放上托架；bay(开度)：画这架飞机的弹舱门；T：整个过程多少秒（弹药兵走 / 跑）
  const loader = (j, key, sz, r, bay, T) => {
    const sl = C.slots[j];
    if (!sl) return;
    const a = sl[2], ca = Math.cos(a), sa = Math.sin(a), lat = ca * sl[1] < 0 ? [-sa, ca] : [sa, -ca], la = Math.atan2(-lat[1], -lat[0]);   // lat：朝甲板内侧；挂弹车车头朝飞机
    const D = typeof AIRD === 'object' && AIRD[key], bx = D && D.bay ? (D.bay[0] + D.bay[1]) / 2 * sz / 21 : 0, B = [sl[0] + ca * bx, sl[1] + sa * bx];   // 弹舱中点
    const d0 = 9.5, d1 = 3.6, d2 = 2.35;
    const dlAt = r => r < .08 ? d0 : r < .26 ? lerp(d0, d1, sm01((r - .08) / .18)) : r < .34 ? lerp(d1, d2, sm01((r - .26) / .08)) : r < .62 ? d2 : r < .7 ? lerp(d2, d1, sm01((r - .62) / .08)) : r < .86 ? lerp(d1, d0, sm01((r - .7) / .16)) : d0, dl = dlAt(r);
    const lift = r < .34 ? 0 : r < .46 ? sm01((r - .34) / .12) : r < .54 ? 1 : r < .62 ? 1 - sm01((r - .54) / .08) : 0, pitch = lerp(-.12, .1, lift);   // 举升臂：平时压低，举升时抬起
    const Lu = B[0] + lat[0] * dl, Lv = B[1] + lat[1] * dl, [lx, ly] = at(Lu, Lv), fu = Math.cos(la), fv = Math.sin(la);
    const U = typeof v3uOn === 'function' ? v3uOn('u_loaderx') : null;
    if (U && U.vars.has('arm')) {   // 带举升臂的外部模型（v3utex.js）：车体 + 绕铰点俯仰的举升臂；后部操作位坐着红马甲
      v3uAdd('u_loaderx', 'hull', lx, ly, top + .02, h + la, 1, 3);
      const [hx, hy] = at(Lu - fu * .32, Lv - fv * .32);
      v3uAdd('u_loaderx', 'arm', hx, hy, top + .64, h + la, 1, 3, 0, pitch);
      v3dDrv('loader', lx, ly, top + .02, h + la);
    } else v3dVeh('loader', v3mDeckCart, lx, ly, top + .02, h + la);
    if (bay) bay(r < .22 ? 0 : r < .3 ? sm01((r - .22) / .08) : r < .6 ? 1 : r < .68 ? 1 - sm01((r - .6) / .08) : 0);
    // 弹药拖车：挂弹车原位旁边、顺着飞机方向；车上的弹（取走一枚后少一枚）
    const Tu = B[0] + lat[0] * (d0 + .3) + ca * 4.6, Tv = B[1] + lat[1] * (d0 + .3) + sa * 4.6, [tx, ty] = at(Tu, Tv), su = Tu - sa * .45, sv = Tv + ca * .45;
    v3mAdd('cvsvc:cart', v3mDeckCart, tx, ty, top + .02, h + a, 1, 3);
    // 托架在举升臂前端（铰点前 2.32 米、高 0.3 米），随臂抬起；托架上的弹推进弹舱（r .46–.52）后托架空着，回原位后两名弹药兵从拖车上抬一枚放上去（r .88–.97）
    const cx = 2.32 * Math.cos(pitch) - .3 * Math.sin(pitch), cz = 2.32 * Math.sin(pitch) + .3 * Math.cos(pitch);
    const Cu = Lu + fu * (cx - .32), Cv = Lv + fv * (cx - .32), Cz = top + .64 + cz + .13;
    let M3 = [Cu, Cv, Cz];
    if (r >= .46 && r < .52) { const q = sm01((r - .46) / .06); M3 = [lerp(Cu, B[0], q), lerp(Cv, B[1], q), lerp(Cz, top + V3D_LOAD.bayZ + .25, q)]; }
    else if (r >= .52 && r < .88) M3 = null;
    else if (r >= .88 && r < .97) { const q = sm01((r - .88) / .09); M3 = [lerp(su, Cu, q), lerp(sv, Cv, q), lerp(top + 1.1, Cz, q) + Math.sin(q * Math.PI) * .5]; }
    // 两名弹药兵（红马甲）：跟着挂弹车走到飞机旁 → 跪在机腹下两侧用手扶正导弹、对准挂钩 → 跟车退出来 → 走到拖车旁，一左一右抬起一枚放上托架
    if (r < .99 || v3mHi()) for (const s of [-1, 1]) {
      const side = d => [B[0] + lat[0] * d + ca * s * 1.55, B[1] + lat[1] * d + sa * s * 1.55], kn = [B[0] + lat[0] * 1.15 + ca * s * 1.05, B[1] + lat[1] * 1.15 + sa * s * 1.05];
      const pk = [su + lat[0] * s * .6, sv + lat[1] * s * .6], pc = [Cu + lat[0] * s * .6, Cv + lat[1] * s * .6];
      let u, v, f = la, pose = 'st';
      // 从 P0 走到 P1（走完 q 0–1；r0、r1 这段占的挂弹进度，按速度选走 / 跑的步频）；face：面朝方向（不给就朝前进方向）
      const walk = (P0, P1, q, r0, r1, face, cr) => {
        const D = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), run = !cr && D / Math.max(.1, (r1 - r0) * T) > 2.8, st = run ? .55 : .3;
        u = lerp(P0[0], P1[0], q); v = lerp(P0[1], P1[1], q); f = face ?? Math.atan2(P1[1] - P0[1], P1[0] - P0[0]);
        pose = D < .05 ? 'st' : (cr ? 'y' : run ? 'r' : 'w') + (Math.floor(q * D / st) & 7);
      };
      if (r < .08 || r >= .99) [u, v] = side(d0);
      else if (r < .34) walk(side(d0), side(d2), (d0 - dl) / (d0 - d2), .08, .34, la);
      else if (r < .38) walk(side(d2), kn, (r - .34) / .04, .34, .38);
      else if (r < .58) { [u, v] = kn; pose = 'kw'; }
      else if (r < .62) walk(kn, side(d2), (r - .58) / .04, .58, .62);
      else if (r < .72) walk(side(d2), side(dlAt(.72)), (dl - d2) / (dlAt(.72) - d2), .62, .72);
      else if (r < .88) walk(side(dlAt(.72)), pk, (r - .72) / .16, .72, .88);
      else if (r < .97) walk(pk, pc, sm01((r - .88) / .09), .88, .97, null, true);
      else walk(pc, side(d0), (r - .97) / .02, .97, .99);
      const [mx, my] = at(u, v);
      v3gMan('deck', pose, mx, my, top, h + f, V3_PIL, 0);
    }
    if (!msl) return;
    for (const o of [-.45, .45].slice(0, r < .88 ? 2 : 1)) { const [mx, my] = at(Tu - sa * o, Tv + ca * o); v3gMsl('pl15', mx, my, top + 1.1, h + a, K, 0); }
    if (M3) { const [mx, my] = at(M3[0], M3[1]); v3gMsl('pl15', mx, my, M3[2], h + a, K, 0); }
  };
  const bayAt = () => () => {};   // 弹舱门：用户给的飞机模型没有分开的舱门，不画
  // 停着待命 / 整备的飞机（着舰后整备 45 秒）
  for (const [id, j] of cvPark(cv, wing)) {
    const w = wing.find(o => o.id === id);
    if (!w) continue;
    const key = typeof airSilKey === 'function' ? airSilKey(w.type, w.v) : 'j35', sz = (typeof airMdl === 'function' && airMdl(w.type, w.v).size) || 15;
    const sl = C.slots[j], [wx, wy] = sl ? at(sl[0], sl[1]) : [0, 0];
    const r = w.state === 'rearm' ? 1 - clamp(w.rearmT / AIR_REARM, 0, 1) : 1;
    loader(j, key, sz, r, sl && bayAt(key, sz, wx, wy, h + sl[2]), AIR_REARM);
    if (sl && r >= .52) v3dPins(key, sz, wx, wy, top, h + sl[2]);   // 弹挂上了：插着保险销
  }
  // 出动前挂弹：带武器的飞机在机位上登机的同时，挂弹车把弹送进弹舱（cvdeck.js 'brd'，CVD.arm 秒）；保险销一直插到偏流板后解除保险时
  for (const p of live) {
    if (p.phase !== 'cat' || !p.arm) continue;
    const key = v3dKey(p), sz = v3dSz(p), r = p.dk === 'brd' ? clamp((p.dkT || 0) / CVD.arm, 0, 1) : 1;
    if (p.dk === 'brd' && p.slot != null) loader(p.slot, key, sz, r, bayAt(key, sz, p.x, p.y, p.heading), CVD.arm);
    if (r >= .52 && (p.dk !== 'hold' || (p.dkT || 0) < V3D_ARM.pull) && p.dk !== 'line' && p.dk !== 'hook') v3dPins(key, sz, p.x, p.y, top - C.hang * (typeof cvDeckSink === 'function' ? cvDeckSink(p) : 0), p.heading);
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
function v3dPins(key, sz, x, y, top, a) { v3mAdd('pins:' + key, () => v3mdPins(key), x, y, top + V3_GEAR * sz / 21, a, sz / 21, 3); }
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
      v3gMan('deck', pose, x, y, top, h + f, V3_PIL, 0);
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
        if (!r.soon && (r.fol || Math.hypot(T.u - r.u, T.v - r.v) < 1.5 || Math.hypot(T.u - r.u, T.v - r.v) > 25)) J.ph = 'hook';   // 飞机已经动了：就地挂上（太远就直接到位）
      }
      if (J.ph === 'hook') { T.u = r.u; T.v = r.v; T.a = r.a; }   // 挂着：跟着飞机走
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
