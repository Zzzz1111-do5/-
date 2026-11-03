'use strict';
// 气动特效（用户：飞机的超音速云爆过于敷衍，气动特效这些）——三维体渲染的白雾（不是一团团贴片），玩家开的、AI 开的喷气机都画：
//   蒸汽锥：跨音速（马赫 0.9–1.07）时机翼前缘往后张开的一圈凝结云——前沿是激波，一道清楚的边，往后被气流拉成一条条、淡掉；空气越湿（越低）越浓，飞越快越往后缩；
//   音爆：刚越过 1 马赫那一下，一层白雾激波壳从机身往外炸开，0.9 秒散尽（闷响在 fptgp.js）；
//   机翼水汽：拉大过载、大迎角时机翼上表面一层贴着的白雾，前缘最浓、往后散，过载越大越厚；
//   翼尖涡流：大过载时两个翼尖拖出两道细白线（AI 的飞机也有；玩家开的那架在 v3pilot.js fpFx）。
//   画法同 v3jet.js 的尾焰：每团雾一个包围盒（只画背面，镜头在里面也画得出），片元里沿视线积分，三维噪声顺着气流往后流；太阳照的一面白、背光的一面灰蓝，雾里淡掉。
//   v3fx.js 画飞机灯光那一段每架飞机调 v3aeroPlane 登记，v3Fx 末尾 v3aeroDraw 画；编辑器「画面」页的「气动特效」可以调强弱、关掉
const V3AE = { tried: false, ok: false, q: [], prev: new Map(), boom: [], vtx: new Map(), S: null };
const V3AE_VS = `attribute vec3 p; attribute vec4 iO; attribute vec4 iU; attribute vec4 iV; attribute vec4 iW; attribute vec4 iX;
uniform mat4 uM; uniform vec3 uEye, uSun; varying vec3 vRo, vLp, vSun, vE; varying vec4 vX; varying float vT, vD;
void main() {
  vec3 U = iU.xyz, V = iV.xyz, Wd = iW.xyz; float L = iU.w, R = iV.w, H = iW.w;
  vE = vec3(L, R, H); vT = iO.w; vX = iX;
  vLp = vec3(p.x * L, p.y * R, p.z * H);   // 包围盒：x 0–L（顺着气流往后）、y ±R（左右）、z ±H（上下）
  vec3 e = uEye - iO.xyz; vRo = vec3(dot(e, U), dot(e, V), dot(e, Wd)); vD = length(e);
  vSun = vec3(dot(uSun, U), dot(uSun, V), dot(uSun, Wd));
  gl_Position = uM * vec4(iO.xyz + U * vLp.x + V * vLp.y + Wd * vLp.z, 1.);
}`;
const V3AE_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uT, uN; uniform vec2 uFog;
varying vec3 vRo, vLp, vSun, vE; varying vec4 vX; varying float vT, vD;
float h3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1., 0., 0.)), f.x), mix(h3(i + vec3(0., 1., 0.)), h3(i + vec3(1., 1., 0.)), f.x), f.y),
    mix(mix(h3(i + vec3(0., 0., 1.)), h3(i + vec3(1., 0., 1.)), f.x), mix(h3(i + vec3(0., 1., 1.)), h3(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }
float fbm(vec3 p) { return .62 * n3(p) + .38 * n3(p * 2.07 + 5.3); }
void main() {
  vec3 ro = vRo, rd = normalize(vLp - vRo), lo = vec3(0., -vE.y, -vE.z), hi = vE;
  vec3 ia = 1. / (rd + vec3(1e-6)), ta = (lo - ro) * ia, tb = (hi - ro) * ia, tmn = min(ta, tb), tmx = max(ta, tb);
  float t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.), t1 = min(min(tmx.x, tmx.y), tmx.z);
  if (t1 <= t0) discard;
  float L = vE.x, R = vE.y, H = vE.z, a = vX.x, sd = vX.y, dt = (t1 - t0) / uN, jt = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  vec3 acc = vec3(0.); float den = 0.;
  for (int k = 0; k < 12; k++) {
    if (float(k) >= uN) break;
    vec3 q = ro + rd * (t0 + (float(k) + jt) * dt);
    float d = 0., lam = .5;
    if (vT < .5) {   // 蒸汽锥：钟形的一层壳，前沿是激波（锐利），往后张开、被拉成一条条、淡掉
      float s = q.x / L, rho = length(q.yz) / (R * .72), Rs = mix(vX.z, 1., pow(clamp(s, 0., 1.), .65)), th = .06 + .2 * s;
      float sh = exp(-pow((rho - Rs) / th, 2.)) * (1. + 1.4 * exp(-s * 26.)), inner = .22 * (1. - smoothstep(Rs * .35, Rs, rho)) * (1. - s);
      float nz = fbm(vec3(q.x / R * 1.1 - uT * 7.5, q.y / R * 3.4, q.z / R * 3.4) + sd);
      d = (sh + inner) * smoothstep(0., .03, s) * pow(max(1. - s, 0.), 1.35) * (.25 + 1.5 * nz * nz) * a;
      vec3 nr = normalize(vec3(0., q.y, q.z) + vec3(1e-5)); lam = .5 + .5 * dot(nr, vSun);
    } else if (vT < 1.5) {   // 机翼上表面的水汽：前缘最浓，往后散开、往上鼓；翼根贴着机身的那一段、翼尖淡掉
      float ay = abs(q.y) / R, le = vX.w * ay * L, ch = L * mix(1., vX.z, ay), xs = (q.x - le) / ch, zz = q.z / H;
      float sp = smoothstep(.06, .16, ay) * (1. - smoothstep(.78, 1., ay));
      float sh = smoothstep(-.02, .05, xs) * (1. - smoothstep(.55, 1.15, xs)) * smoothstep(-.08, .1, zz) * (1. - smoothstep(.15 + .7 * xs, .45 + .9 * xs, zz));
      float nz = fbm(vec3(q.x / ch * 2.4 - uT * 5.5, q.y / R * 9., q.z / H * 2.5) + sd);
      d = sh * sp * (.35 + 1.1 * exp(-max(xs, 0.) * 2.4)) * (.2 + 1.6 * nz * nz) * a;
      lam = .55 + .45 * vSun.z;
    } else {   // 音爆：从机身往外炸开的一层激波壳（压扁的球，前后略长），越往外越薄越淡
      vec3 c = vec3(q.x - L * .5, q.y, q.z) / (R * .82); float r = length(vec3(c.x * .8, c.y, c.z));
      float nz = fbm(c * 3.2 + vec3(uT * 2., 0., 0.) + sd);
      d = exp(-pow((r - 1.) / (.05 + .05 * vX.z), 2.)) * (.35 + 1.3 * nz) * a;
      lam = .55 + .45 * dot(normalize(c + vec3(1e-5)), vSun);
    }
    if (d <= .001) continue;
    vec3 col = mix(vec3(.6, .66, .76), vec3(1., .995, .985), clamp(lam, 0., 1.));
    acc += col * d * dt; den += d * dt;
  }
  float k = 2.4 / max(R, .5), al = 1. - exp(-den * k), fog = 1. - smoothstep(uFog.x, uFog.y, vD);
  if (al < .003) discard;
  vec3 col = acc / max(den, 1e-5);
  gl_FragColor = vec4(col * al * fog, al * fog);
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
    for (const n of ['p', 'iO', 'iU', 'iV', 'iW', 'iX']) A[n] = gl.getAttribLocation(pr, n);
    for (const n of ['uM', 'uEye', 'uSun', 'uT', 'uN', 'uFog']) U[n] = gl.getUniformLocation(pr, n);
    const mesh = v3aBox(), mb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    Object.assign(V3AE, { ext, pr, A, U, mb, mn: mesh.length / 3, ib: gl.createBuffer(), ok: true });
  } catch (e) { console.warn('气动特效着色器没编译过：', e); }
}
const v3aK = () => typeof SETTINGS === 'object' && SETTINGS && SETTINGS.aero != null ? clamp(+SETTINGS.aero, 0, 2) : 1;   // 强弱（编辑器「画面」页）
// 登记一团雾：c 原点、U 顺着气流往后、V 左、W 上（GL，单位向量），L / R / H 包围盒的长、半宽、半高（米），ty 类型（0 蒸汽锥、1 机翼水汽、2 音爆），x 参数
function v3aAdd(ty, c, U, V, W, L, R, H, a, sd, p1, p2) { if (a > .01 && L > .1 && R > .1) V3AE.q.push(c[0], c[1], c[2], ty, U[0], U[1], U[2], L, V[0], V[1], V[2], R, W[0], W[1], W[2], H, a, sd, p1, p2); }
// 一架飞机（v3fx.js 画灯光那一段调）：o 飞机、key 剪影键、sz 尺寸、own 我方、R 机体 → GL 的旋转、P 机身中线（GL）、k 外形数据的比例、D AIRD 外形、jet 是不是喷气战斗机
function v3aeroPlane(o, key, sz, own, R, P, k, D, jet, C) {
  if (!jet || !D || !D.wing || !(v3aK() > 0) || (typeof v3Mx === 'function' && v3Mx())) return;
  if (V3AE.S !== S) { V3AE.S = S; V3AE.prev.clear(); V3AE.boom.length = 0; V3AE.vtx.clear(); }
  const F = own && o.fl, id = (own ? 'p' : 'e') + o.id, Ka = v3aK();
  const M = F ? F.M || 0 : (o.spd || 0) / 330, nz = F ? F.nz || 1 : 1 / Math.max(.2, Math.cos(o.bank || 0)), aoa = F ? Math.abs(F.a || 0) : 0, Va = F ? F.Va || 0 : o.spd || 0;
  const alt = F ? -F.P[2] : P[2], hum = clamp(1.15 - alt / 9000, .25, 1);   // 空气越湿（越低）凝结越多
  const fw = [R[0], R[3], R[6]], U = [-fw[0], -fw[1], -fw[2]], V = [R[1], R[4], R[7]], W = [R[2], R[5], R[8]];
  const Wp = (u, v, w) => [P[0] + (R[0] * u + R[1] * v + R[2] * w) * k, P[1] + (R[3] * u + R[4] * v + R[5] * w) * k, P[2] + (R[6] * u + R[7] * v + R[8] * w) * k];
  const xs = D.wing.map(q => q[0]), wx0 = Math.min(...xs), wx1 = Math.max(...xs), tip = D.wing.reduce((m, q) => q[1] > m[1] ? q : m, D.wing[0]), hs = tip[1];
  const bx = D.body ? D.body.map(q => q[0]) : [wx1 + 6, wx0 - 4], bmin = Math.min(...bx), sd = (o.id * .7919) % 1 * 50;
  const dE = C ? Math.hypot(P[0] - C.E[0], P[1] - C.E[1], P[2] - C.E[2]) : 0;
  if (dE > 9000) return;
  // 蒸汽锥：马赫 0.9–1.07；越过 1 马赫往后缩、变细
  const vc = smooth(.9, .975, M) * smooth(1.075, 1.005, M) * hum * Ka * (.85 + .15 * Math.sin(S.t * 9 + sd));
  if (vc > .02) {
    const x0 = wx1 + (wx1 - wx0) * .12 - Math.max(0, M - 1) * 30, L = (x0 - bmin) * 1.1 * k, Rr = hs * (.92 - Math.max(0, M - .99) * 4) * k;
    v3aAdd(0, Wp(x0, 0, .2), U, V, W, L, Rr * 1.5, Rr * 1.5, vc, sd, .32, 0);
  }
  // 音爆：刚越过 1 马赫
  const Mp = V3AE.prev.get(id);
  V3AE.prev.set(id, M);
  if (Mp != null && Mp < 1 && M >= 1) V3AE.boom.push({ c: Wp((wx0 + wx1) / 2, 0, 0), U, V, W, r0: hs * 1.3 * k, t0: S.t, sd, hum });
  // 机翼水汽：过载 4 g 以上、迎角大，速度够（高亚音速最明显）
  const wv = clamp(smooth(4, 7.5, nz) + smooth(.3, .55, aoa) * .7, 0, 1.2) * smooth(110, 200, Va) * (.55 + .45 * hum) * Ka;
  if (wv > .02) {
    const ch = (wx1 - wx0) * k, taper = .32, sweep = clamp((wx1 - tip[0]) / Math.max(.1, wx1 - wx0), 0, 1.2), Hh = (.55 + .12 * nz) * k * 1.6;
    v3aAdd(1, Wp(wx1 + .2, 0, .15), U, V, W, ch * 1.25, hs * k, Hh, wv, sd, taper, sweep);
  }
  // 翼尖涡流（AI 的飞机；玩家开的那架 v3pilot.js 画）：最近 0.8 秒翼尖走过的点
  if (!(own && typeof fpDriving === 'function' && fpDriving(o))) {
    const vi = smooth(3.5, 6.5, nz) * smooth(100, 180, Va) * Ka;
    let T = V3AE.vtx.get(id);
    if (vi > .02 || (T && T.length)) {
      if (!T) V3AE.vtx.set(id, T = []);
      if (vi > .02 && (!T.length || S.t - T[T.length - 1][2] > .03)) { T.push([Wp(tip[0] - .4, tip[1], 0), Wp(tip[0] - .4, -tip[1], 0), S.t, vi]); if (T.length > 40) T.shift(); }
      while (T.length && (S.t - T[0][2] > .8 || S.t < T[0][2])) T.shift();
    }
  }
}
// 每帧：音爆壳、翼尖涡流的细线（烟那一组 sm，v3fx.js 画）
function v3aeroFx(sm, C) {
  if (!S || V3AE.S !== S) return;
  for (let i = V3AE.boom.length - 1; i >= 0; i--) {
    const B = V3AE.boom[i], u = (S.t - B.t0) / .9;
    if (u < 0 || u > 1) { V3AE.boom.splice(i, 1); continue; }
    const r = B.r0 * (1 + 7 * Math.sqrt(u)), a = (1 - u) ** 1.6 * B.hum * v3aK() * 1.2;
    v3aAdd(2, [B.c[0] - B.U[0] * r * 1.25, B.c[1] - B.U[1] * r * 1.25, B.c[2] - B.U[2] * r * 1.25], B.U, B.V, B.W, r * 2.5, r * 1.15, r * 1.15, a, B.sd, u, 0);
  }
  if (typeof v3fRib !== 'function') return;
  for (const [id, T] of V3AE.vtx) {
    if (!T.length) { V3AE.vtx.delete(id); continue; }
    for (let i = 1; i < T.length; i++) {
      const a0 = S.t - T[i - 1][2], a1 = S.t - T[i][2], i0 = T[i - 1][3] * (1 - a0 / .8), i1 = T[i][3] * (1 - a1 / .8);
      if (i0 + i1 < .02) continue;
      for (const s of [0, 1]) v3fRib(sm, C.E, T[i - 1][s], T[i][s], .35 + a0 * .5, [.95, .96, .97, .5 * i0], [.95, .96, .97, .5 * i1]);
    }
  }
}
function v3aeroDraw(C) {
  const Q = V3AE.q;
  if (!Q.length) return;
  const gl = V3.gl;
  if (!V3AE.tried) v3aInit(gl);
  if (!V3AE.ok) { Q.length = 0; return; }
  const X = V3AE.ext, A = V3AE.A, U = V3AE.U, fog = typeof v3FogR === 'function' ? v3FogR(C) : C.fog || [1e5, 2e5], SU = typeof V3_SUN === 'object' ? V3_SUN : [-.45, .55, .7], sl = Math.hypot(...SU) || 1;
  gl.useProgram(V3AE.pr);
  gl.uniformMatrix4fv(U.uM, false, C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]); gl.uniform3f(U.uSun, SU[0] / sl, SU[1] / sl, SU[2] / sl);
  gl.uniform1f(U.uT, (S ? S.t : 0) % 1000); gl.uniform1f(U.uN, typeof SETTINGS === 'object' && SETTINGS.quality === 'low' ? 6 : 12); gl.uniform2f(U.uFog, fog[0], fog[1]);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3AE.mb);
  gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 12, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3AE.ib); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);
  ['iO', 'iU', 'iV', 'iW', 'iX'].forEach((n, i) => { const l = A[n]; if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 80, i * 16); X.vertexAttribDivisorANGLE(l, 1); });
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);   // 只画包围盒的背面：每个像素积分一次，镜头在雾里面也画得出
  X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, V3AE.mn, Q.length / 20);
  gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND);
  ['iO', 'iU', 'iV', 'iW', 'iX'].forEach(n => { const l = A[n]; if (l >= 0) { X.vertexAttribDivisorANGLE(l, 0); gl.disableVertexAttribArray(l); } });
  gl.disableVertexAttribArray(A.p);
  Q.length = 0;
}
