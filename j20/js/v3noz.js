'use strict';
// 真实的收敛扩散喷口（歼-20）：Sketchfab「F-15 SE Thrust Vector Nozzle」（F100 发动机的喷口，作者 ACshibu，CC-BY-4.0）——
//   作者在 Blender 里把 15 片调节片、密封片、作动筒的真实联动做好，压成两个形态（收到最小 / 张到最大）；tools/nozbake.js 烘焙成 js/mdl/f100noz.js
//   ① 会收缩：每个顶点在两个形态之间按推力插值——慢车张开、不开加力的最大推力收到最小、开加力张到最大（v3gPlane 的 noz，与 v3det.js v3dNozK 同一套；
//      出口半径与尾焰半径对得上）；作动筒跟着推拉，调节片绕喉道转，出口截面跟着前后挪
//   ② 内部纹路：调节片内壁按部位着色——沿流向的刷纹与热流痕、片与片之间的缝、收敛段一排排冷却孔、喉道附近烧出的回火色（金黄 → 蓝紫）、出口边上的积碳；
//      外表面是烧成橄榄青铜色的钛合金，作动筒、拉杆是钢；喷管深处天光进不去、越往里越暗；推力大时内壁从喉道往外发出暗红到橙的热光，开加力映亮
//   换上它时，模型自带的调节片（V3G_PIT.noz 拆出来的 'noz' 部件）不再画（v3g.js v3gDraw 按 M.nzRep 跳过），喷口里的发动机后段（v3jet.js）挪到收敛段入口（v3nzThr）
// 喷口坐标（烘焙时定好）：u 沿喷流向后（收到最小时出口截面 u = 0，喷管里 u < 0），长度单位 = 收到最小时出口的内半径；喉道在 u ≈ −2.0，收敛段入口 u ≈ −2.7
const V3NZ = { dec: false, ok: false, tried: false, gl: null, fr: -1, near: [], far: [], meta: null };
// 哪型飞机换装（V3G 模型键）：用哪个喷口模型；kmin = v3dNozK 的最小值（不开加力的最大推力，收到最小）——这时出口内半径 = 模型 noz 半径 × (1 + kmin)
const V3NZ_FIT = { j20: { key: 'f100noz', kmin: -.13 } };
const v3nzOn = mk => !!V3NZ_FIT[mk] && V3NZ.ok;
// 收敛段入口（发动机后段 v3jet.js 放在这里）：出口前多远、管道内半径（喷口坐标，乘缩放）
const V3NZ_DUCT = { u: 2.7, r: 1.45, d: 4.6 };

// 数据：用到时才加载 js/mdl/f100noz.js（v3g.js 的加载队列），解码后建缓冲
function v3nzData() {
  if (V3NZ.ok || V3NZ.dec || typeof V3G !== 'object' || !V3G.gl) return;
  const D = V3G.def.f100noz;
  if (!D) { if (!V3G.want.has('f100noz') && !V3G.fail.has('f100noz') && typeof v3gLoad === 'function') { V3G.want.add('f100noz'); v3gLoad('f100noz', true); } return; }
  V3NZ.dec = true;
  v3gBytes(D.b64).then(b => {
    const gl = V3G.gl, m = D.meta, n = m.n, buf = (type, a) => { const o = gl.createBuffer(); gl.bindBuffer(type, o); gl.bufferData(type, a, gl.STATIC_DRAW); return o; };
    const o1 = 6 * n, o2 = 12 * n, o3 = 16 * n, o4 = 20 * n, o5 = o4 + 2 * m.ni0, sub = (a, z) => b.subarray(a, z);
    v3nzInit(gl);
    if (!V3NZ.pr) return;
    Object.assign(V3NZ, { meta: m, gl, bP: buf(gl.ARRAY_BUFFER, sub(0, o1)), bD: buf(gl.ARRAY_BUFFER, sub(o1, o2)), bN0: buf(gl.ARRAY_BUFFER, sub(o2, o3)), bN1: buf(gl.ARRAY_BUFFER, sub(o3, o4)),
      bI0: buf(gl.ELEMENT_ARRAY_BUFFER, sub(o4, o5)), bI1: buf(gl.ELEMENT_ARRAY_BUFFER, sub(o5, o5 + 2 * m.ni1)), ib: gl.createBuffer(), ok: true });
    delete V3G.def.f100noz;
  }).catch(e => { console.warn('喷口模型解码失败', e); V3G.fail.add('f100noz'); });
}

const V3NZ_VS = `attribute vec3 p0, dp, n1; attribute vec4 n0; attribute vec4 iO, iU, iV, iX;
uniform mat4 uM; uniform vec3 uEye; uniform vec2 uPD;
${typeof V3_SHV === 'string' ? V3_SHV : 'uniform mat4 uShM; varying vec4 vSh;'}
varying vec3 vN, vV, vQ; varying float vIn, vCls, vD, vHt, vB;
void main() {
  vec3 q = p0 * uPD.x + dp * (uPD.y * iU.w);   // 两个形态之间插值（iU.w：0 收到最小、1 张到最大）
  vec3 nl = normalize(mix(n0.xyz, n1, iU.w));
  vec3 U = iU.xyz, V = iV.xyz, Wd = cross(U, V);
  vec3 w = iO.xyz + iO.w * (U * q.x + V * q.y + Wd * q.z);
  vN = U * nl.x + V * nl.y + Wd * nl.z;
  float r = length(q.yz);
  vIn = r > 1e-3 ? dot(nl.yz, q.yz / r) : 0.;   // 法线的径向分量：< 0 朝着轴线 = 内壁
  vQ = q; vCls = floor(n0.w * 127. + .5); vV = uEye - w; vD = length(vV); vHt = iV.w; vB = iX.x;
  vSh = uShM * vec4(w, 1.);
  gl_Position = uM * vec4(w, 1.);
}`;
const V3NZ_FS = `${typeof V3_PREC === 'string' ? V3_PREC : 'precision mediump float;'}
${typeof V3_SHF === 'string' ? V3_SHF : 'float shadowAt() { return 1.; }'}
uniform vec2 uFog; uniform vec3 uBg; uniform float uMx;
varying vec3 vN, vV, vQ; varying float vIn, vCls, vD, vHt, vB;
float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hs(i), hs(i + vec2(1., 0.)), f.x), mix(hs(i + vec2(0., 1.)), hs(i + vec2(1., 1.)), f.x), f.y); }
vec3 hot(float t) { t = clamp(t, 0., 1.); return mix(mix(vec3(.4, .03, .01), vec3(1., .3, .06), smoothstep(0., .45, t)), vec3(1., .88, .62), smoothstep(.45, 1., t)); }
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  if (dot(N, V) < 0.) N = -N;   // 薄板两面都照
  float u = vQ.x, a = atan(vQ.z, vQ.y), fa = a / 6.2831853 * 15., seg = fract(fa);   // 15 片调节片：seg 一片里的位置
  float inner = vCls > .5 && vCls < 1.5 && vIn < -.25 ? 1. : 0.;
  float st = vn(vec2(a * 95., u * 1.3)) * .6 + vn(vec2(a * 260., u * 3.)) * .4;   // 沿流向的细条纹：绕轴变化快、沿轴变化慢
  vec3 base; float metal, rough;
  if (vCls < .5) { base = vec3(.15, .15, .16); metal = .8; rough = .45; }   // 不动的结构环
  else if (vCls > 1.5) { base = vec3(.44, .44, .45) * (.9 + .2 * st); metal = .95; rough = .26; }   // 作动筒、拉杆：钢
  else if (inner > .5) {   // 调节片、密封片内壁
    float tz = clamp((u + 2.4) / 2.4, 0., 1.);   // 0 喉道上游 – 1 出口
    vec3 tm = mix(vec3(.62, .47, .25), vec3(.33, .29, .5), smoothstep(.15, .45, tz));   // 回火色：喉道附近金黄 → 稍往后蓝紫 → 再往后褪回钢灰
    tm = mix(tm, vec3(.44, .42, .4), smoothstep(.5, .85, tz));
    base = mix(vec3(.5, .49, .47), tm, .6) * (.8 + .32 * st);
    base *= 1. - .55 * smoothstep(.72, 1., tz) * (.55 + .45 * vn(vec2(a * 40., u * 6.)));   // 出口边上的积碳，一道道顺着流向
    base *= .5 + .5 * smoothstep(0., .035, seg) * smoothstep(1., .965, seg);   // 片与片之间的缝
    if (u < -2.05) { vec2 g = fract(vec2(fa * 7., u * 9.)) - .5; base *= .4 + .6 * smoothstep(.1, .19, length(g)); }   // 收敛段：一排排冷却孔
    metal = .7; rough = .5;
  } else { base = vec3(.2, .175, .1) * (.82 + .32 * st); metal = .75; rough = .4; }   // 外表面：烧成橄榄青铜色的钛合金
  vec3 F0 = mix(vec3(.04), base, metal), diff = base * (1. - metal);
  vec3 L = ${typeof V3_SUNG === 'string' ? V3_SUNG : 'normalize(vec3(-.42, .52, .74))'}, H = normalize(L + V);
  float ndl = max(dot(N, L), 0.), ndv = max(dot(N, V), 0.);
  float ao = inner > .5 ? mix(.18, 1., smoothstep(-2.6, -.1, u)) : 1.;   // 喷管里面：天光、阳光越往里越进不去
  float shd = shadowAt() * (inner > .5 ? smoothstep(-2.3, -.4, u) : 1.);
  float a2 = rough * rough, sh = clamp(2. / max(a2 * a2, 1e-4) - 2., 1., 4096.);
  float spec = pow(max(dot(N, H), 0.), sh) * (sh + 2.) / 8.;
  vec3 Fr = F0 + (1. - F0) * pow(1. - max(dot(H, V), 0.), 5.);
  vec3 sunC = vec3(1., .96, .9) * 2.6, sky = mix(vec3(.05, .055, .055), vec3(.3, .32, .34), N.z * .5 + .5);
  vec3 env = mix(vec3(.04, .045, .045), vec3(.34, .36, .38), clamp(reflect(-V, N).z * .5 + .5, 0., 1.));
  vec3 c = diff * (sky * ao + sunC * ndl * shd) + Fr * spec * sunC * ndl * shd + env * (F0 + (1. - F0) * pow(1. - ndv, 5.) * (1. - rough)) * ao * (.35 + .65 * metal);
  // 热光：内壁从喉道往外（大推力暗红 → 开加力橙黄，火挂在喷管里映亮整圈）
  float pf = exp(-max(u + 2.05, 0.) * .9) * smoothstep(-3., -2.2, u);
  c += inner * hot(.25 + .45 * vHt + .3 * vB) * pf * (vHt * vHt * .45 + vB * 1.4);
  c = pow(max(c, 0.), vec3(1. / 2.2));
  if (uMx > .5) c = vec3(.32, 1., .58) * dot(c, vec3(.3, .59, .11)) * .6;
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
function v3nzInit(gl) {
  if (V3NZ.tried) return;
  V3NZ.tried = true;
  try {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3NZ_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3NZ_FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3NZ.pr = pr;
    V3NZ.a = Object.fromEntries(['p0', 'dp', 'n0', 'n1', 'iO', 'iU', 'iV', 'iX'].map(k => [k, gl.getAttribLocation(pr, k)]));
    V3NZ.u = Object.fromEntries(['uM', 'uEye', 'uPD', 'uFog', 'uBg', 'uMx', 'uShM', 'uShT', 'uShOn', 'uShP'].map(k => [k, gl.getUniformLocation(pr, k)]));
  } catch (e) { V3NZ.pr = null; console.warn('喷口着色器没编译过：', e); }
}
// v3g.js v3gPlane 每画一架飞机调一次（ox、oy、oz 模型原点 = 机轮着地处，游戏坐标；k 世界单位 / 米；noz 喷口开合参数）：换装了的机型按每个喷口收集实例
function v3nzPlane(mk, M, ox, oy, oz, h, k, roll, pitch, noz) {
  const F = V3NZ_FIT[mk];
  if (!F) return;
  if (!V3NZ.ok) { v3nzData(); M.nzRep = false; return; }
  M.nzRep = true;
  if (V3NZ.fr !== V3G.frame) { V3NZ.fr = V3G.frame; V3NZ.near.length = 0; V3NZ.far.length = 0; }
  const m = V3NZ.meta, C = V3G.C, E = C ? C.E : null;
  const U = v3dMv3(h, pitch, roll, [-1, 0, 0]), Vv = v3dMv3(h, pitch, roll, [0, 1, 0]);
  // 开合：出口内半径 = 模型 noz 半径 × (1 + noz)；收到最小（noz = kmin）对应形态 0，往上按出口半径线性插值
  const w = clamp(((1 + noz) / (1 + F.kmin) - 1) / (m.r1 - 1), 0, 1);
  const ht = noz < 0 ? clamp(-noz / .13, 0, 1) : 0, ab = clamp((noz - .12) / .12, 0, 1);   // 推力大小（只用来定内壁热光：收得越小推力越大；张过慢车那一档就是开了加力）
  for (const n of M.meta.noz || []) {
    if (n[5]) continue;   // 扁平的二元喷口不换
    const S = n[3] * (1 + F.kmin) * k;
    for (const sg of n[1] ? [1, -1] : [1]) {
      const r = v3dMv3(h, pitch, roll, [n[0] * k, n[1] * sg * k, n[2] * k]), c = [ox + r[0], -oy + r[1], oz + r[2]];
      let L = V3NZ.far;
      if (E) {
        const d = Math.hypot(c[0] - E[0], c[1] - E[1], c[2] - E[2]), px = S * 3 / Math.max(d, 1) * (V3G.px || 600);
        if (px < 1) continue;   // 不到一个像素：不画（模型自带的调节片也不画，这么远看不出来）
        if (px > 40) L = V3NZ.near;
      }
      L.push(c[0], c[1], c[2], S, U[0], U[1], U[2], w, Vv[0], Vv[1], Vv[2], ht, ab, 0, 0, 0);
    }
  }
}
// 喷口里的发动机后段（v3det.js v3dNoz 用）：换装了的机型放到收敛段入口——{ u 出口前多少米、r 管道内半径、d 深 }（模型米）
function v3nzThr(mk) {
  const F = V3NZ_FIT[mk], M = F && typeof V3G === 'object' && V3G.M[mk];
  if (!F || !V3NZ.ok || !M || !M.meta.noz) return null;
  const n = M.meta.noz[0], S = n[3] * (1 + F.kmin);
  return { u: V3NZ_DUCT.u * S, r: V3NZ_DUCT.r * S, d: V3NZ_DUCT.d * S };
}
// 画（v3units.js 在 v3gDraw 之后调；LM：太阳阴影图那一遍，只写深度——喷口也投影）
function v3nzDraw(C, LM) {
  if (!V3NZ.ok || V3NZ.fr !== V3G.frame || (!V3NZ.near.length && !V3NZ.far.length)) return;
  const gl = V3NZ.gl, A = V3NZ.a, U = V3NZ.u, X = V3G.ext, m = V3NZ.meta;
  gl.useProgram(V3NZ.pr);
  gl.uniformMatrix4fv(U.uM, false, LM || C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]); gl.uniform2f(U.uPD, m.ps, m.ds);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.74, .75, .8])); gl.uniform1f(U.uMx, typeof v3Mx === 'function' && v3Mx() ? 1 : 0);
  if (typeof v3ShUni === 'function') v3ShUni(gl, U, !LM); else gl.uniform1f(U.uShOn, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
  const at = (l, b, sz, type, st) => { if (l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, type, true, st, 0); };
  at(A.p0, V3NZ.bP, 3, gl.SHORT, 6); at(A.dp, V3NZ.bD, 3, gl.SHORT, 6); at(A.n0, V3NZ.bN0, 4, gl.BYTE, 4); at(A.n1, V3NZ.bN1, 3, gl.BYTE, 4);
  const I = ['iO', 'iU', 'iV', 'iX'];
  for (const [list, ib, ni] of [[V3NZ.near, V3NZ.bI0, m.ni0], [V3NZ.far, V3NZ.bI1, m.ni1]]) {
    if (!list.length) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, V3NZ.ib); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list), gl.DYNAMIC_DRAW);
    I.forEach((k, j) => { const l = A[k]; if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 64, j * 16); X.vertexAttribDivisorANGLE(l, 1); });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    X.drawElementsInstancedANGLE(gl.TRIANGLES, ni, gl.UNSIGNED_SHORT, 0, list.length / 16);
    I.forEach(k => { const l = A[k]; if (l >= 0) { X.vertexAttribDivisorANGLE(l, 0); gl.disableVertexAttribArray(l); } });
  }
  for (const k of ['p0', 'dp', 'n0', 'n1']) if (A[k] >= 0) gl.disableVertexAttribArray(A[k]);
}
// 游戏里「素材致谢」（v3import.js 汇总 V3G_CRED）
if (typeof V3G_CRED === 'object' && Array.isArray(V3G_CRED) && !V3G_CRED.some(c => c.title === 'F-15 SE Thrust Vector Nozzle'))
  V3G_CRED.push({ name: '歼-20 尾喷口（F100 发动机收敛扩散喷口：调节片、密封片、作动筒开合）', title: 'F-15 SE Thrust Vector Nozzle', author: 'ACshibu', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/f-15-se-thrust-vector-nozzle-46f9e71656f84a509eca268aaddf2cbc' });
