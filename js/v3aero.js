'use strict';
// 气动特效（用户：飞机的超音速云爆过于敷衍，气动特效这些）——三维的白雾（不是一团团贴片），玩家开的、AI 开的喷气机都画：
//   蒸汽锥：跨音速（马赫 0.9–1.07）时从座舱往后张开的一层钟形凝结云（照片里 F/A-18 那样）——后缘是激波，一道清楚的边，往前渐渐淡进去，
//     纹理是顺着气流的一条条；空气越湿（越低）越浓；越过 1 马赫激波往后移、锥变小，然后消失；
//   音爆：刚越过 1 马赫那一下，蒸汽锥的后缘脱开留在原地，往外扩一圈、0.55 秒散尽（闷响在 fptgp.js）；
//   机翼水汽：拉大过载、大迎角时机翼上表面一层贴着的白雾，前缘后面一点最浓、往后变厚、拖出后缘散开；
//   翼尖涡流：大过载时两个翼尖拖出两道细白线（AI 的飞机也有；玩家开的那架在 v3pilot.js fpFx）。
//   画法：每团雾一个包围盒。蒸汽锥、音爆是一层薄壳（抛物面），片元里直接解出视线和壳的两个交点，按视线斜穿壳的长度算浓淡——边上浓、正对着淡，
//     轮廓清楚（原来沿视线只积分 12 步，薄壳采样不到，看着是一层均匀的玻璃）；机翼水汽沿视线积分。
//     机身（圆柱）、机翼（梯形）在着色器里挡雾：壳在飞机后面那一半被机身、机翼挡住，翼面下看不见上表面的水汽。
//     镜头在盒子外面画正面、做深度测试（前面的东西挡得住它，飞机前面那一半壳盖在飞机上）；在盒子里面画背面、不做深度测试（同 v3det.js 热浪）
//     ——原来只画背面：盒子的背面在飞机后面，被飞机挡住的像素整条视线都不画，机翼水汽在机翼上方根本看不见。
//   v3fx.js 画飞机灯光那一段每架飞机调 v3aeroPlane 登记，v3Fx 末尾 v3aeroDraw 画；编辑器「画面」页的「气动特效」可以调强弱、关掉
const V3AE = { tried: false, ok: false, q: [], prev: new Map(), boom: [], vtx: new Map(), S: null }, V3AE_NF = 28;   // 每团雾 7 个 vec4
const V3AE_VS = `attribute vec3 p; attribute vec4 iO; attribute vec4 iU; attribute vec4 iV; attribute vec4 iW; attribute vec4 iX; attribute vec4 iY; attribute vec4 iZ;
uniform mat4 uM; uniform vec3 uEye, uSun; varying vec3 vRo, vLp; varying vec4 vE, vS, vX, vY, vZ;
void main() {
  vec3 U = iU.xyz, V = iV.xyz, Wd = iW.xyz; float L = iU.w, R = iV.w, H = iW.w, ty = iO.w;
  vE = vec4(L, R, H, ty); vX = iX; vY = iY; vZ = iZ;
  float z0 = abs(ty - 1.) < .5 ? -.08 : -1.;   // 机翼水汽只在翼面上方：盒子从翼面稍下到 H
  vLp = vec3(p.x * L, p.y * R, mix(z0, 1., p.z * .5 + .5) * H);   // 包围盒：x 0–L（顺着气流往后）、y ±R（左右）、z（上下）
  vec3 e = uEye - iO.xyz; vRo = vec3(dot(e, U), dot(e, V), dot(e, Wd));
  vS = vec4(dot(uSun, U), dot(uSun, V), dot(uSun, Wd), length(e));
  gl_Position = uM * vec4(iO.xyz + U * vLp.x + V * vLp.y + Wd * vLp.z, 1.);
}`;
const V3AE_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uT, uN; uniform vec2 uFog;
varying vec3 vRo, vLp; varying vec4 vE, vS, vX, vY, vZ;
float h3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1., 0., 0.)), f.x), mix(h3(i + vec3(0., 1., 0.)), h3(i + vec3(1., 1., 0.)), f.x), f.y),
    mix(mix(h3(i + vec3(0., 0., 1.)), h3(i + vec3(1., 0., 1.)), f.x), mix(h3(i + vec3(0., 1., 1.)), h3(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }
float fbm(vec3 p) { return .62 * n3(p) + .38 * n3(p * 2.07 + 5.3); }
// 机身（沿 x 轴的圆柱：半径 vY.x，x 在 vY.y–vY.z）、机翼（z = 0 上的梯形：半翼展 vY.w，前缘 / 后缘的 x 在翼根 vZ.x / vZ.y、翼尖 vZ.z / vZ.w）：视线最先碰到飞机的地方
float occ(vec3 ro, vec3 rd) {
  float t = 1e9, rf = vY.x;
  if (rf > .01) {
    float a = dot(rd.yz, rd.yz), b = dot(ro.yz, rd.yz), c = dot(ro.yz, ro.yz) - rf * rf, dc = b * b - a * c;
    if (a > 1e-6 && dc > 0.) { float tf = (-b - sqrt(dc)) / a, xf = ro.x + rd.x * tf; if (tf > 0. && xf > vY.y && xf < vY.z) t = tf; }
  }
  if (vY.w > .01 && abs(rd.z) > 1e-5) {
    float tw = -ro.z / rd.z; vec2 w = ro.xy + rd.xy * tw; float u = clamp(abs(w.y) / vY.w, 0., 1.);
    if (tw > 0. && abs(w.y) < vY.w && w.x > mix(vZ.x, vZ.z, u) && w.x < mix(vZ.y, vZ.w, u)) t = min(t, tw);
  }
  return t;
}
void main() {
  vec3 ro = vRo, rd = normalize(vLp - vRo), sun = vS.xyz;
  float L = vE.x, R = vE.y, H = vE.z, ty = vE.w, a = vX.x, sd = vX.y, tO = occ(ro, rd);
  vec3 col = vec3(0.); float ws = 0., od = 0.;
  if (abs(ty - 1.) > .5) {   // 蒸汽锥（0）/ 音爆（2）：抛物面薄壳 r² = r0² + (r1² − r0²)·x / L，直接解视线和它的两个交点
    float r1 = R * .8, r0 = r1 * vX.z, B = (r1 * r1 - r0 * r0) / L, s0 = vX.w;
    float qa = dot(rd.yz, rd.yz), qb = 2. * dot(ro.yz, rd.yz) - B * rd.x, qc = dot(ro.yz, ro.yz) - r0 * r0 - B * ro.x, ta = -1., tb = -1.;
    if (qa < 1e-6) { if (abs(qb) > 1e-6) ta = -qc / qb; }
    else { float dc = qb * qb - 4. * qa * qc; if (dc < 0.) discard; float sq = sqrt(dc); ta = (-qb - sq) / (2. * qa); tb = (-qb + sq) / (2. * qa); }
    float fm = 0., fs = 0., fn = 0.;   // 两个交点都在：中间那段是锥里面（也有一层薄雾）
    for (int i = 0; i < 2; i++) {
      float t = i == 0 ? ta : tb;
      if (t <= 0. || t > tO) continue;   // 在镜头后面，或者被机身、机翼挡住
      vec3 q = ro + rd * t; float s = q.x / L;
      if (s < 0. || s > 1.05) continue;
      vec2 cs = q.yz / max(length(q.yz), 1e-4);
      float n1 = fbm(vec3(cs * 2.6, s * 1.6 - uT * 1.1) + sd), n2 = n3(vec3(cs * 11., s * 4. - uT * 2.7) + sd * 1.7), n4 = n3(vec3(cs * 27., s * 9. - uT * 4.) + sd * 2.3);
      float se = 1. - .1 * n1 - .05 * n2;   // 后缘（激波）那一圈起伏、破碎
      float m = smoothstep(s0, s0 + .45, s) * (1. - smoothstep(se - .07, se, s));
      float dn = m * (.2 + 1.7 * n1 * n1) * (.45 + .75 * n2) * (.7 + .5 * n4) * mix(.5, 1.25, s);
      vec3 nr = normalize(vec3(-B, 2. * q.y, 2. * q.z));
      float o = dn * a / max(abs(dot(rd, nr)), .22);   // 斜穿薄壳的长度：边上浓，正对着淡
      fm += t; fs += s; fn += 1.;
      if (o < .001) continue;
      float lam = .55 + .45 * dot(vec3(0., cs), sun), fw = pow(max(dot(rd, sun), 0.), 6.);   // 逆着太阳看：水滴往前散射，发亮
      col += mix(vec3(.6, .66, .76), vec3(1., .995, .985), clamp(lam, 0., 1.)) * (1. + .5 * fw) * o; ws += o;
    }
    if (fn > 1.5 && tb > ta && ta > 0.) {   // 锥里面：两交点之间按长度加一点雾
      float s = fs * .5, f = (min(tb, tO) - ta) * .045 * smoothstep(s0, s0 + .5, s) * (1. - smoothstep(.8, 1., s)) * a * (.5 + fbm(vec3(ro + rd * fm * .5) * .35 + sd));
      col += vec3(.9, .92, .95) * f; ws += f;
    }
    od = ws * .5;
  } else {   // 机翼水汽：沿视线积分；翼面挡住下面的视线，机身挡住另一边机翼
    vec3 lo = vec3(0., -R, -.08 * H), hi = vec3(L, R, H), ia = 1. / (rd + vec3(1e-6)), ta = (lo - ro) * ia, tb = (hi - ro) * ia, tmn = min(ta, tb), tmx = max(ta, tb);
    float t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.), t1 = min(min(min(tmx.x, tmx.y), tmx.z), tO);
    if (t1 <= t0) discard;
    float dt = (t1 - t0) / uN, jt = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))), hs = max(vY.w, .1), lam = .55 + .45 * sun.z;
    for (int k = 0; k < 12; k++) {
      if (float(k) >= uN) break;
      vec3 q = ro + rd * (t0 + (float(k) + jt) * dt);
      float ay = min(abs(q.y) / hs, 1.), le = mix(vZ.x, vZ.z, ay), ch = max(mix(vZ.y, vZ.w, ay) - le, .3), xs = (q.x - le) / ch, zz = q.z / H;
      float th = .16 + .5 * clamp(xs, 0., 1.4);   // 水汽层的厚度：往后变厚
      float sp = smoothstep(.12, .24, ay) * (1. - smoothstep(.82, 1., ay));
      float sh = smoothstep(.01, .08, xs) * (1. - smoothstep(.95, 1.4, xs)) * smoothstep(-.04, .03, zz) * (1. - smoothstep(th * .45, th, zz));
      float nz = fbm(vec3(q.x / ch * 2.2 - uT * 5.5, q.y / hs * 9., zz * 2.5) + sd);
      float d = sh * sp * (.45 + 1.1 * exp(-max(xs, 0.) * 2.6)) * (.15 + 1.9 * nz * nz) * (.6 + .6 * n3(vec3(q.x / ch * 7. - uT * 9., q.y / hs * 26., zz * 6.) + sd)) * a;
      if (d <= .001) continue;
      col += mix(vec3(.6, .66, .76), vec3(1., .995, .985), clamp(lam, 0., 1.)) * d * dt; ws += d * dt;
    }
    od = ws * 2.6 / max(H, .3);
  }
  float al = 1. - exp(-od), fog = 1. - smoothstep(uFog.x, uFog.y, vS.w);
  if (al < .003) discard;
  gl_FragColor = vec4(col / max(ws, 1e-5) * al * fog, al * fog);   // 预乘透明度
}`;
// 包围盒：x 0–1、y −1–1、z −1–1
function v3aBox() {
  const P = [[0, -1, -1], [1, -1, -1], [1, 1, -1], [0, 1, -1], [0, -1, 1], [1, -1, 1], [1, 1, 1], [0, 1, 1]], F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]], V = [];
  for (const [a, b, c, d] of F) V.push(...P[a], ...P[c], ...P[b], ...P[a], ...P[d], ...P[c]);   // 朝外绕（同 v3jet.js 的包围体），画的时候剔掉正面
  return new Float32Array(V);
}
function v3aInit(gl) {
  V3AE.tried = true;
  try {
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) return;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3AE_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3AE_FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const A = {}, U = {};
    for (const n of ['p', 'iO', 'iU', 'iV', 'iW', 'iX', 'iY', 'iZ']) A[n] = gl.getAttribLocation(pr, n);
    for (const n of ['uM', 'uEye', 'uSun', 'uT', 'uN', 'uFog']) U[n] = gl.getUniformLocation(pr, n);
    const mesh = v3aBox(), mb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    Object.assign(V3AE, { ext, pr, A, U, mb, mn: mesh.length / 3, ib: gl.createBuffer(), ok: true });
  } catch (e) { console.warn('气动特效着色器没编译过：', e); }
}
const v3aK = () => typeof SETTINGS === 'object' && SETTINGS && SETTINGS.aero != null ? clamp(+SETTINGS.aero, 0, 2) : 1;   // 强弱（编辑器「画面」页）
// 登记一团雾：c 原点、U 顺着气流往后、V 右、W 上（GL，单位向量，右手系），L / R / H 包围盒的长、半宽、半高（米），ty 类型（0 蒸汽锥、1 机翼水汽、2 音爆），
//   x 参数（蒸汽锥 / 音爆：p1 前端半径比、p2 从哪儿开始有雾），Y、Z 挡雾的机身、机翼（局部坐标，见着色器 occ；没有就全 0）
const V3AE_0 = [0, 0, 0, 0];
function v3aAdd(ty, c, U, V, W, L, R, H, a, sd, p1, p2, Y, Z) {
  if (!(a > .01 && L > .1 && R > .1)) return;
  Y = Y || V3AE_0; Z = Z || V3AE_0;
  V3AE.q.push(c[0], c[1], c[2], ty, U[0], U[1], U[2], L, V[0], V[1], V[2], R, W[0], W[1], W[2], H, a, sd, p1, p2, Y[0], Y[1], Y[2], Y[3], Z[0], Z[1], Z[2], Z[3]);
}
// 机翼平面形状（AIRD 外形，机体坐标 x 朝前）：翼根 / 翼尖的前缘、后缘，半翼展；机身头尾、半宽
function v3aGeo(D) {
  if (D.__ae) return D.__ae;
  const Wg = D.wing, ys = Wg.map(q => q[1]), y1 = Math.max(...ys), y0 = Math.min(...ys), tipP = Wg.filter(q => q[1] >= y1 * .9), rootP = Wg.filter(q => q[1] <= y0 + (y1 - y0) * .3);
  const bx = D.body ? D.body.map(q => q[0]) : [Math.max(...Wg.map(q => q[0])) + 6, Math.min(...Wg.map(q => q[0])) - 4], bw = D.body ? Math.max(...D.body.map(q => q[1])) : 1.6;
  return (D.__ae = { hs: y1, rLE: Math.max(...Wg.map(q => q[0])), rTE: Math.min(...rootP.map(q => q[0])), tLE: Math.max(...tipP.map(q => q[0])), tTE: Math.min(...tipP.map(q => q[0])), nose: Math.max(...bx), tail: Math.min(...bx), bw });
}
// 一架飞机（v3fx.js 画灯光那一段调）：o 飞机、key 剪影键、sz 尺寸、own 我方、R 机体 → GL 的旋转、P 机身中线（GL）、k 外形数据的比例、D AIRD 外形、jet 是不是喷气战斗机
function v3aeroPlane(o, key, sz, own, R, P, k, D, jet, C) {
  if (!jet || !D || !D.wing || !(v3aK() > 0) || (typeof v3Mx === 'function' && v3Mx())) return;
  if (V3AE.S !== S) { V3AE.S = S; V3AE.prev.clear(); V3AE.boom.length = 0; V3AE.vtx.clear(); }
  const F = own && o.fl, id = (own ? 'p' : 'e') + o.id, Ka = v3aK();
  const M = F ? F.M || 0 : (o.spd || 0) / 330, nz = F ? F.nz || 1 : 1 / Math.max(.2, Math.cos(o.bank || 0)), aoa = F ? Math.abs(F.a || 0) : 0, Va = F ? F.Va || 0 : o.spd || 0;
  const alt = F ? -F.P[2] : P[2], hum = clamp(1.15 - alt / 9000, .25, 1);   // 空气越湿（越低）凝结越多
  const U = [-R[0], -R[3], -R[6]], V = [-R[1], -R[4], -R[7]], W = [R[2], R[5], R[8]];   // 往后、往右、往上：右手系（包围盒的绕向才对，正面朝外）
  const Wp = (u, v, w) => [P[0] + (R[0] * u + R[1] * v + R[2] * w) * k, P[1] + (R[3] * u + R[4] * v + R[5] * w) * k, P[2] + (R[6] * u + R[7] * v + R[8] * w) * k];
  const G = v3aGeo(D), len = G.nose - G.tail, sd = (o.id * .7919) % 1 * 50;
  const occY = xo => [G.bw * .8 * k, (xo - G.nose) * k, (xo - G.tail) * k, G.hs * k], occZ = xo => [(xo - G.rLE) * k, (xo - G.rTE) * k, (xo - G.tLE) * k, (xo - G.tTE) * k];   // 挡雾的机身、机翼（以 xo 为原点的局部坐标，x 朝后）
  const dE = C ? Math.hypot(P[0] - C.E[0], P[1] - C.E[1], P[2] - C.E[2]) : 0;
  if (dE > 9000) return;
  // 蒸汽锥：马赫 0.9–1.07；前端在座舱一带，后缘（激波）在机翼后缘稍后；越过 1 马赫激波往后移、锥变小
  const vc = smooth(.9, .975, M) * smooth(1.075, 1.005, M) * hum * Ka * (.88 + .12 * Math.sin(S.t * 9 + sd));
  const ov = Math.max(0, M - .99), x0 = G.rLE + (G.nose - G.rLE) * .35 - ov * len * 3, xr = Math.max(G.tail - len * .3, G.rTE - (G.rTE - G.tail) * .12 - Math.max(0, M - .96) * len * 1.4);
  const r1 = G.hs * .78 * k * (1 - clamp((M - 1) * 6, 0, .55)), Lc = Math.max(2, (x0 - xr) * k);
  if (vc > .02 && x0 > xr) v3aAdd(0, Wp(x0, 0, 0), U, V, W, Lc, r1 / .8, r1 / .8, vc, sd, clamp(G.bw * 1.15 * k / r1, .1, .6), 0, occY(x0), occZ(x0));
  // 音爆：刚越过 1 马赫——蒸汽锥的后段脱开留在原地
  const Mp = V3AE.prev.get(id);
  V3AE.prev.set(id, M);
  if (Mp != null && Mp < 1 && M >= 1) V3AE.boom.push({ c: Wp(x0, 0, 0), U, V, W, L: Lc, r1, t0: S.t, sd, hum });
  // 机翼水汽：过载大、迎角大，速度够（高亚音速最明显）；AI 的飞机只有坡度换算的过载（最多 5 g），门槛低一些
  const wv = clamp((F ? smooth(4, 7.5, nz) : smooth(2.6, 5, nz) * .8) + smooth(.3, .55, aoa) * .7, 0, 1.2) * smooth(110, 200, Va) * (.55 + .45 * hum) * Ka;
  if (wv > .02) {
    const xo = G.rLE + .2, Hh = (.55 + .12 * nz) * k * 1.6;
    v3aAdd(1, Wp(xo, 0, 0), U, V, W, (xo - Math.min(G.rTE, G.tTE)) * k * 1.45, G.hs * k * 1.02, Hh, wv, sd, 0, 0, occY(xo), occZ(xo));
  }
  // 翼尖涡流（AI 的飞机；玩家开的那架 v3pilot.js 画）：最近 0.45 秒翼尖走过的点
  if (!(own && typeof fpDriving === 'function' && fpDriving(o))) {
    const vi = (F ? smooth(3.5, 6.5, nz) : smooth(2.4, 4.6, nz)) * smooth(100, 180, Va) * Ka, tip = D.wing.reduce((m, q) => q[1] > m[1] ? q : m, D.wing[0]);
    let T = V3AE.vtx.get(id);
    if (vi > .02 || (T && T.length)) {
      if (!T) V3AE.vtx.set(id, T = []);
      if (vi > .02 && (!T.length || S.t - T[T.length - 1][2] > .03)) { T.push([Wp(tip[0] - .4, tip[1], 0), Wp(tip[0] - .4, -tip[1], 0), S.t, vi]); if (T.length > 24) T.shift(); }
      while (T.length && (S.t - T[0][2] > .45 || S.t < T[0][2])) T.shift();
    }
  }
}
// 每帧：音爆脱开的那一圈、翼尖涡流的细线（烟那一组 sm，v3fx.js 画）
function v3aeroFx(sm, C) {
  if (!S || V3AE.S !== S) return;
  for (let i = V3AE.boom.length - 1; i >= 0; i--) {
    const B = V3AE.boom[i], u = (S.t - B.t0) / .55;
    if (u < 0 || u > 1) { V3AE.boom.splice(i, 1); continue; }
    const g = 1 + 1.3 * Math.sqrt(u), a = (1 - u) ** 1.5 * B.hum * v3aK() * 1.3, r = B.r1 * g;
    v3aAdd(2, B.c, B.U, B.V, B.W, B.L * (1 + .35 * u), r / .8, r / .8, a, B.sd, .45, .55);   // 只剩后半截那一圈：从 0.55 往后
  }
  if (typeof v3fRib !== 'function') return;
  for (const [id, T] of V3AE.vtx) {
    if (!T.length) { V3AE.vtx.delete(id); continue; }
    for (let i = 1; i < T.length; i++) {
      const a0 = S.t - T[i - 1][2], a1 = S.t - T[i][2], i0 = T[i - 1][3] * (1 - a0 / .45) ** 1.5, i1 = T[i][3] * (1 - a1 / .45) ** 1.5;
      if (i0 + i1 < .02) continue;
      for (const s of [0, 1]) v3fRib(sm, C.E, T[i - 1][s], T[i][s], .2 + a0 * 1.1, [.95, .96, .97, .26 * i0], [.95, .96, .97, .26 * i1]);
    }
  }
}
function v3aeroDraw(C) {
  const Q = V3AE.q;
  if (!Q.length) return;
  const gl = V3.gl;
  if (!V3AE.tried) v3aInit(gl);
  if (!V3AE.ok) { Q.length = 0; return; }
  // 镜头在盒子外面的、里面的分开画（外面：正面 + 深度测试；里面：背面、不做深度测试）；余量按镜头距离放宽（追尾镜头的近裁剪面离镜头好几米）
  const N = V3AE_NF, E = C.E, G = [[], []];
  for (let i = 0; i < Q.length; i += N) {
    const ex = E[0] - Q[i], ey = E[1] - Q[i + 1], ez = E[2] - Q[i + 2], mg = 2 + .3 * Math.hypot(ex, ey, ez), Hh = Q[i + 15];
    const lx = ex * Q[i + 4] + ey * Q[i + 5] + ez * Q[i + 6], ly = ex * Q[i + 8] + ey * Q[i + 9] + ez * Q[i + 10], lz = ex * Q[i + 12] + ey * Q[i + 13] + ez * Q[i + 14];
    const z0 = Math.abs(Q[i + 3] - 1) < .5 ? -.08 * Hh : -Hh, ins = lx > -mg && lx < Q[i + 7] + mg && Math.abs(ly) < Q[i + 11] + mg && lz > z0 - mg && lz < Hh + mg;
    const D = G[ins ? 1 : 0];
    for (let j = 0; j < N; j++) D.push(Q[i + j]);
  }
  Q.length = 0;
  const X = V3AE.ext, A = V3AE.A, U = V3AE.U, fog = typeof v3FogR === 'function' ? v3FogR(C) : C.fog || [1e5, 2e5], SU = typeof V3_SUN === 'object' ? V3_SUN : [-.45, .55, .7], sl = Math.hypot(...SU) || 1;
  const dt0 = gl.isEnabled(gl.DEPTH_TEST), df0 = gl.getParameter(gl.DEPTH_FUNC), AT = ['iO', 'iU', 'iV', 'iW', 'iX', 'iY', 'iZ'];
  gl.useProgram(V3AE.pr);
  gl.uniformMatrix4fv(U.uM, false, C.M); gl.uniform3f(U.uEye, E[0], E[1], E[2]); gl.uniform3f(U.uSun, SU[0] / sl, SU[1] / sl, SU[2] / sl);
  gl.uniform1f(U.uT, (S ? S.t : 0) % 1000); gl.uniform1f(U.uN, typeof SETTINGS === 'object' && SETTINGS.quality === 'low' ? 6 : 12); gl.uniform2f(U.uFog, fog[0], fog[1]);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3AE.mb);
  gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 12, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.CULL_FACE);
  for (const ins of [0, 1]) {
    const D = G[ins];
    if (!D.length) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, V3AE.ib); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(D), gl.DYNAMIC_DRAW);
    AT.forEach((n, i) => { const l = A[n]; if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, N * 4, i * 16); X.vertexAttribDivisorANGLE(l, 1); });
    if (ins) { gl.disable(gl.DEPTH_TEST); gl.cullFace(gl.FRONT); } else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.cullFace(gl.BACK); }
    X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, V3AE.mn, D.length / N);
  }
  gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND); gl.depthFunc(df0);
  if (dt0) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  AT.forEach(n => { const l = A[n]; if (l >= 0) { X.vertexAttribDivisorANGLE(l, 0); gl.disableVertexAttribArray(l); } });
  gl.disableVertexAttribArray(A.p);
}
