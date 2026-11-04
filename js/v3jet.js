'use strict';
// 喷气发动机：喷口里看得见的发动机后端 + 加力尾焰（v3det.js v3dBurner 每帧收集，v3fx.js v3Fx 末尾调 v3jDraw 画）——
//   ① 喷口内部是实体网格，照加力式涡扇的后段结构建（单位半径，喷口出口截面 u = 0，喷管里 u < 0）：
//      涡轮最后一级的一圈叶片和轮毂、尾锥、涡轮后机匣的支板、加力喷油杆，两圈同心的 V 形火焰稳定器加径向稳定器（从后面看是一张亮的「网格」）、隔热衬套；
//      金属按热度发出黑体色的光：慢车深处暗红，推油门从里往外热透（涡轮、尾锥先热，衬套最后），最大推力橙黄；
//      开加力时火挂在火焰稳定器上（白黄），涡轮、尾锥被映成蓝白，衬套整圈映亮
//   ② 加力尾焰是立体的：包住火柱的十二棱柱，着色器里每个像素沿视线穿过火柱积分 16 步（体渲染）——侧面、斜后方、正后方看都对，
//      镜头钻进火里也照样画（画包围体的背面）。火的分布：焰身横截面中间浓边上淡、沿程先略胀后收、边缘随湍流抖；
//      全加力：根部蓝白芯 → 黄白焰身 → 橙 → 红淡出；喷流欠膨胀，喷口后约一个直径起一串激波马赫环（三维的菱形亮结：两头尖、中间粗，一个接一个，间隔约 1.2 个直径，越往后越弱、越偏橙）；
//      加力程度小（只点着内圈几区）时只有短短一截半透明的蓝紫色小火。
//      积分出来的亮度按色调保持的方式压到 1 以内（正对着看进加力燃烧室是刺眼的黄白，不会糊成纯白）；混合用预乘透明度（ONE, ONE_MINUS_SRC_ALPHA）：
//      白天亮天空前面纯相加会糊成一道白，现在火的颜色盖得住背景，暗处照样是发光的
const V3J = { tried: false, ok: false, eng: [], plm: [] };
const V3J_HOT = 'vec3 hot(float t) { t = clamp(t, 0., 1.); return mix(mix(vec3(.4, .03, .01), vec3(1., .3, .06), smoothstep(0., .45, t)), vec3(1., .88, .62), smoothstep(.45, 1., t)); }';
// 这一帧：一个喷口的内部（c 出口中心，U 沿喷流向后，Vv 右，r 半径，D 喷管深 / 半径，h 热度，b 加力）；一股尾焰（L 长度，b 亮度，ns 马赫环个数，g 大火的程度）
function v3jBegin() { V3J.eng.length = 0; V3J.plm.length = 0; }
function v3jEng(c, U, Vv, r, D, h, b) { V3J.eng.push(c[0], c[1], c[2], r, U[0], U[1], U[2], D, Vv[0], Vv[1], Vv[2], h, b, 0, 0, 0); }
function v3jPlume(c, U, r, L, b, ns, seed, g) { V3J.plm.push(c[0], c[1], c[2], r, U[0], U[1], U[2], L, b, ns, seed, g || 0); }

// —— 喷口内部的网格：每个顶点 [u, v, w, nu, nv, nw, 部件]（部件 0 衬套、1 涡轮与尾锥、2 支板与喷油杆、3 火焰稳定器）；u 按喷管深度的比例（−1 最深）——
function v3jMesh() {
  const V = [], tri = (a, b, c, g, n) => { for (const p of [a, b, c]) V.push(p[0], p[1], p[2], n[0], n[1], n[2], g); };
  const quad = (a, b, c, d, g, n) => { tri(a, b, c, g, n); tri(a, c, d, g, n); };
  const cyl = (u, r, a) => [u, Math.cos(a) * r, Math.sin(a) * r];
  // 隔热衬套：r ≈ 0.985 的圆筒内壁（法线朝里），从最深处到出口前一点
  for (let i = 0; i < 28; i++) { const a0 = i / 28 * 6.2832, a1 = (i + 1) / 28 * 6.2832, am = (a0 + a1) / 2; quad(cyl(-1, .985, a0), cyl(-1, .985, a1), cyl(-.06, .985, a1), cyl(-.06, .985, a0), 0, [0, -Math.cos(am), -Math.sin(am)]); }
  // 涡轮最后一级：轮毂盘 + 26 片扭转的叶片（朝喷口的一面）
  for (let i = 0; i < 20; i++) { const a0 = i / 20 * 6.2832, a1 = (i + 1) / 20 * 6.2832; tri([-.97, 0, 0], cyl(-.97, .34, a0), cyl(-.97, .34, a1), 1, [1, 0, 0]); }
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * 6.2832, da = .085, tw = .35;
    quad(cyl(-.97, .33, a - da), cyl(-.97, .33, a + da), cyl(-.95, .93, a + da + tw * .3), cyl(-.95, .93, a - da + tw * .3), 1, [1, 0, 0]);
  }
  // 涡轮后面一级的底盘：叶片之间的缝里看到的是它，不会透出模型里面的空洞
  for (let i = 0; i < 24; i++) { const a0 = i / 24 * 6.2832, a1 = (i + 1) / 24 * 6.2832; tri([-1, 0, 0], cyl(-1, .99, a1), cyl(-1, .99, a0), 1, [1, 0, 0]); }
  // 尾锥：涡轮后面伸到喷管中段的锥
  for (let i = 0; i < 18; i++) { const a0 = i / 18 * 6.2832, a1 = (i + 1) / 18 * 6.2832, am = (a0 + a1) / 2; tri(cyl(-.95, .32, a0), cyl(-.95, .32, a1), [-.52, 0, 0], 1, [.55, Math.cos(am) * .83, Math.sin(am) * .83]); }
  // 涡轮后机匣支板（8 根，正对喷口的窄条）与加力喷油杆（16 根细杆）
  const spoke = (u, r0, r1, a, wd, g) => { const n = [1, 0, 0], ca = Math.cos(a), sa = Math.sin(a), px = -sa * wd, py = ca * wd; quad([u, ca * r0 + px, sa * r0 + py], [u, ca * r0 - px, sa * r0 - py], [u, ca * r1 - px, sa * r1 - py], [u, ca * r1 + px, sa * r1 + py], g, n); };
  for (let i = 0; i < 8; i++) spoke(-.78, .3, .97, i / 8 * 6.2832 + .2, .035, 2);
  for (let i = 0; i < 16; i++) spoke(-.64, .36, .93, i / 16 * 6.2832 + .1, .012, 2);
  // 火焰稳定器：两圈 V 形环（V 的尖朝上游、开口朝喷口）+ 8 根径向 V 形稳定器——加力时火挂在上面
  const vring = (u, r, hw, n) => { for (let i = 0; i < n; i++) { const a0 = i / n * 6.2832, a1 = (i + 1) / n * 6.2832, am = (a0 + a1) / 2;
    quad(cyl(u - .05, r, a0), cyl(u - .05, r, a1), cyl(u + .05, r + hw, a1), cyl(u + .05, r + hw, a0), 3, [.7, Math.cos(am) * -.7, Math.sin(am) * -.7]);
    quad(cyl(u - .05, r, a0), cyl(u - .05, r, a1), cyl(u + .05, r - hw, a1), cyl(u + .05, r - hw, a0), 3, [.7, Math.cos(am) * .7, Math.sin(am) * .7]); } };
  vring(-.5, .52, .055, 36); vring(-.5, .8, .05, 44);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832 + .39, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca, hw = .045;
    for (const s of [1, -1]) quad([-.55, ca * .3, sa * .3], [-.55, ca * .92, sa * .92], [-.45, ca * .92 + px * hw * s, sa * .92 + py * hw * s], [-.45, ca * .3 + px * hw * s, sa * .3 + py * hw * s], 3, [.7, px * -.7 * s, py * -.7 * s]); }
  return new Float32Array(V);
}
// 尾焰包围体：十二棱柱（外接圆半径 1，沿轴 0–1）+ 两头封口，三角形从外面看是逆时针（画的时候剔除正面、只画背面）
function v3jPlumeMesh() {
  const V = [], n = 12, P = (x, a) => [x, Math.cos(a), Math.sin(a)];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * 6.2832, a1 = (i + 1) / n * 6.2832, A = P(0, a0), B = P(1, a0), C = P(1, a1), D = P(0, a1);
    V.push(...A, ...C, ...B, ...A, ...D, ...C, 0, 0, 0, ...D, ...A, 1, 0, 0, ...B, ...C);
  }
  return new Float32Array(V);
}
const V3J_EVS = `attribute vec3 p; attribute vec3 n; attribute float g; attribute vec4 iO; attribute vec4 iU; attribute vec4 iV; attribute vec4 iX;
uniform mat4 uM; uniform vec3 uEye; varying vec3 vN, vV; varying float vG, vU, vH, vB, vD;
void main() {
  vec3 U = iU.xyz, Vv = iV.xyz, Wv = cross(U, Vv);
  vec3 w = iO.xyz + iO.w * (U * p.x * iU.w + Vv * p.y + Wv * p.z);   // u 按喷管深度缩放（p.x −1 = 最深处）
  vN = normalize(U * n.x + Vv * n.y + Wv * n.z); vV = uEye - w; vD = length(vV); vG = g; vU = p.x; vH = iV.w; vB = iX.x;
  gl_Position = uM * vec4(w, 1.);
}`;
const V3J_EFS = `precision mediump float;
uniform vec2 uFog; uniform vec3 uBg; uniform float uMx;
varying vec3 vN, vV; varying float vG, vU, vH, vB, vD;
${V3J_HOT}
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  if (dot(N, V) < 0.) N = -N;
  float deep = clamp(-vU, 0., 1.), amb = mix(.32, .05, deep);   // 越深越暗（喷管壁挡住了天光）
  vec3 L = normalize(vec3(-.45, .55, .7));
  vec3 base = vG < .5 ? vec3(.3, .29, .27) : vG < 1.5 ? vec3(.42, .27, .09) : vG < 2.5 ? vec3(.17, .16, .15) : vec3(.23, .19, .14);   // 冷态金属色：衬套银灰、涡轮与尾锥金铜（耐热合金的回火色）、支板暗钢、稳定器暗铜
  vec3 c = base * (amb + .25 * max(dot(N, L), 0.) * (1. - deep) + .3 * pow(max(dot(N, V), 0.), 6.) * (1. - deep * .8));
  float dl = vG < .5 ? .45 : vG < 1.5 ? 0. : vG < 2.5 ? .1 : .2;   // 从里往外热：涡轮、尾锥最先，支板、稳定器其次，衬套最后
  float t = clamp((vH - dl) / (1. - dl), 0., 1.);
  c += hot(t) * (.12 + 1.9 * t * t) * (vG < .5 ? .55 : 1.);
  if (vB > .01) {   // 加力：火挂在稳定器上，涡轮、尾锥映成蓝白，衬套整圈映亮
    c += vB * (vG > 2.5 ? vec3(1.6, 1.35, .95) : vG > .5 && vG < 1.5 ? vec3(.45, .55, 1.1) : vG < .5 ? vec3(1., .5, .2) * (.5 + .5 * deep) : vec3(1., .7, .4));
  }
  c = pow(max(c, 0.), vec3(1. / 2.2));
  if (uMx > .5) c = vec3(.32, 1., .58) * dot(c, vec3(.3, .59, .11));
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
const V3J_PVS = `attribute vec3 p; attribute vec4 iO; attribute vec4 iU; attribute vec4 iX;
uniform mat4 uM; uniform vec3 uEye; varying vec3 vRo, vLp; varying float vL, vB, vNs, vSeed, vG, vD;
void main() {
  vec3 c = iO.xyz, U = iU.xyz; float r = iO.w, L = iU.w;
  vec3 V = normalize(cross(U, abs(U.z) < .9 ? vec3(0., 0., 1.) : vec3(1., 0., 0.))), Wv = cross(U, V);
  vL = L / r;
  vLp = vec3(p.x * vL, p.y * 1.35, p.z * 1.35);   // 火柱局部坐标，以喷口半径为单位（x 沿喷流）：棱柱外接圆 1.35、内切圆约 1.30，包得住积分用的圆柱
  vec3 e = uEye - c; vRo = vec3(dot(e, U), dot(e, V), dot(e, Wv)) / r;
  vB = iX.x; vNs = iX.y; vSeed = iX.z; vG = iX.w; vD = length(e);
  gl_Position = uM * vec4(c + (U * vLp.x + V * vLp.y + Wv * vLp.z) * r, 1.);
}`;
const V3J_PFS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uFog; uniform float uT, uMx;
varying vec3 vRo, vLp; varying float vL, vB, vNs, vSeed, vG, vD;
void main() {
  vec3 ro = vRo, rd = normalize(vLp - vRo);
  float a = dot(rd.yz, rd.yz), b = dot(ro.yz, rd.yz), cc = dot(ro.yz, ro.yz) - 1.69, t0 = 0., t1 = 1e4;   // 视线与半径 1.3 的圆柱、0 ≤ x ≤ 长度 的两个端面求交
  if (a > 1e-5) { float h = b * b - a * cc; if (h <= 0.) discard; h = sqrt(h); t0 = (-b - h) / a; t1 = (-b + h) / a; }
  else if (cc > 0.) discard;
  if (abs(rd.x) > 1e-5) { float ta = -ro.x / rd.x, tb = (vL - ro.x) / rd.x; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (ro.x < 0. || ro.x > vL) discard;
  t0 = max(t0, 0.);
  if (t1 <= t0) discard;
  float dt = (t1 - t0) / 16., jt = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));   // 每个像素错开起点，16 步也不出条纹
  float bw = mix(.55, 1., vG);
  vec3 acc = vec3(0.); float den = 0.;
  for (int k = 0; k < 16; k++) {
    vec3 q = ro + rd * (t0 + (float(k) + jt) * dt);
    float s = q.x / vL, rho = length(q.yz);
    float fl = .85 + .15 * sin(uT * 41. + q.x * 1.7 + vSeed) * sin(uT * 23. - q.x * 1.1 + q.y * 2. + vSeed * 2.);   // 湍流抖动
    float Rb = (1. + .3 * s) * (1. - .55 * s * s) * (.93 + .07 * sin(uT * 30. + q.x * 2.3 + q.z * 3. + vSeed));   // 焰身半径：先略胀后收，边缘抖
    float eb = (1. - smoothstep(Rb * .4, Rb, rho)) * pow(max(1. - s, 0.), 1.3) * smoothstep(0., .03, s) * fl;
    float ec = exp(-rho * rho / .12) * exp(-q.x / 2.2);   // 根部白芯：约一个直径长
    float ed = 0., fi = floor((q.x - 2.) / 2.4 + .5);   // 马赫环：喷口后一个直径（2 个半径）起，间隔 1.2 个直径
    if (fi >= 0. && fi < vNs) { float d = abs(q.x - 2. - 2.4 * fi); if (d < 1.) { float hw = (.6 - .05 * fi) * pow(1. - d, .75); ed = (1. - smoothstep(hw * .3, hw, rho)) * (1. - .45 * d) * (1. - .15 * fi); } }
    vec3 bb = mix(vec3(.45, .5, 1.), vec3(.72, .42, .95), smoothstep(.1, .6, s));   // 小火：半透明的蓝 → 紫
    vec3 bo = mix(vec3(.6, .66, 1.), vec3(1., .78, .45), smoothstep(0., .1, s));   // 大火：根部蓝白 → 黄白 → 橙 → 红
    bo = mix(bo, vec3(1., .48, .2), smoothstep(.2, .6, s));
    bo = mix(bo, vec3(.95, .3, .22), smoothstep(.6, 1., s));
    vec3 dc = mix(vec3(1., .94, .8), vec3(1., .7, .45), clamp(s * 1.8, 0., 1.));
    acc += (mix(bb, bo, vG) * eb * .9 * bw + vec3(.92, .95, 1.) * ec * 1.6 + dc * ed * 2.8) * dt;   // 侧面看光程只有一个直径：焰身、马赫环要够亮，白天亮天空前面也看得出
    den += (eb * .75 * bw + ec * .5 + ed * .65) * dt;
  }
  float lm = max(acc.r, max(acc.g, acc.b)), fog = 1. - smoothstep(uFog.x, uFog.y, vD);
  vec3 col = acc * ((1. - exp(-lm)) / max(lm, 1e-4)) * vB * fog;   // 保持色调地压到 1 以内
  float al = min((1. - exp(-den)) * vB * fog, .95);
  if (uMx > .5) col = vec3(.32, 1., .58) * dot(col, vec3(.3, .59, .11));
  gl_FragColor = vec4(col, al);
}`;
// 分两步（view3d.js v3pcLink）：第一次只发起编译，编完了才建好；进 3D 几秒后就提前开始（V3PC_WARM），开飞机时不再现编现卡
function v3jInit(gl) {
  if (V3J.ok || V3J.tried) return;   // tried：编不过，不再试
  try {
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) { V3J.tried = true; return; }
    if (!V3J.pc) { V3J.pc = [v3pcLink(gl, V3J_EVS, V3J_EFS), v3pcLink(gl, V3J_PVS, V3J_PFS)]; return; }
    if (!V3J.pc.every(c => c.done())) return;
    const E = V3J.pc[0].check(), P = V3J.pc[1].check();
    const loc = (pr, names, kind) => Object.fromEntries(names.map(n => [n, kind === 'a' ? gl.getAttribLocation(pr, n) : gl.getUniformLocation(pr, n)]));
    const em = v3jMesh(), pm = v3jPlumeMesh();
    Object.assign(V3J, { ext, E, P, eA: loc(E, ['p', 'n', 'g', 'iO', 'iU', 'iV', 'iX'], 'a'), eU: loc(E, ['uM', 'uEye', 'uFog', 'uBg', 'uMx']),
      pA: loc(P, ['p', 'iO', 'iU', 'iX'], 'a'), pU: loc(P, ['uM', 'uEye', 'uFog', 'uT', 'uMx']),
      eb: gl.createBuffer(), en: em.length / 7, pb: gl.createBuffer(), pn: pm.length / 3, ib: gl.createBuffer() });
    gl.bindBuffer(gl.ARRAY_BUFFER, V3J.eb); gl.bufferData(gl.ARRAY_BUFFER, em, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, V3J.pb); gl.bufferData(gl.ARRAY_BUFFER, pm, gl.STATIC_DRAW);
    V3J.ok = true;
  } catch (e) { V3J.tried = true; console.warn('发动机尾焰着色器没编译过：', e); }
}
if (typeof V3PC_WARM === 'object') V3PC_WARM.push(gl => { v3jInit(gl); return V3J.ok || V3J.tried; });
// 画这一帧收集到的喷口内部（不透明，写深度）与尾焰（预乘透明度混合，不写深度）
function v3jDraw(C) {
  if (!V3J.eng.length && !V3J.plm.length) return;
  const gl = V3.gl;
  if (!V3J.ok) { v3jInit(gl); if (!V3J.ok) return; }   // 还在编译：这几帧先不画
  const X = V3J.ext, fog = typeof v3FogR === 'function' ? v3FogR(C) : C.fog, bg = typeof v3Bg === 'function' ? v3Bg() : [.6, .65, .7], mx = typeof v3Mx === 'function' && v3Mx() ? 1 : 0;
  const inst = (A, data, stride, names) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, V3J.ib); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    names.forEach((nm, k) => { const l = A[nm]; if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, stride * 4, k * 16); X.vertexAttribDivisorANGLE(l, 1); });
  };
  const off = (A, names) => names.forEach(nm => { const l = A[nm]; if (l >= 0) { X.vertexAttribDivisorANGLE(l, 0); gl.disableVertexAttribArray(l); } });
  if (V3J.eng.length) {
    const A = V3J.eA, U = V3J.eU;
    gl.useProgram(V3J.E);
    gl.uniformMatrix4fv(U.uM, false, C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]); gl.uniform2f(U.uFog, fog[0], fog[1]); gl.uniform3f(U.uBg, bg[0], bg[1], bg[2]); gl.uniform1f(U.uMx, mx);
    gl.bindBuffer(gl.ARRAY_BUFFER, V3J.eb);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(A.g); gl.vertexAttribPointer(A.g, 1, gl.FLOAT, false, 28, 24);
    inst(A, V3J.eng, 16, ['iO', 'iU', 'iV', 'iX']);
    X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, V3J.en, V3J.eng.length / 16);
    off(A, ['iO', 'iU', 'iV', 'iX']); gl.disableVertexAttribArray(A.p); gl.disableVertexAttribArray(A.n); gl.disableVertexAttribArray(A.g);
  }
  if (V3J.plm.length) {
    const A = V3J.pA, U = V3J.pU;
    gl.useProgram(V3J.P);
    gl.uniformMatrix4fv(U.uM, false, C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]); gl.uniform2f(U.uFog, fog[0], fog[1]); gl.uniform1f(U.uT, (performance.now() / 1000) % 1000); gl.uniform1f(U.uMx, mx);
    gl.bindBuffer(gl.ARRAY_BUFFER, V3J.pb);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 12, 0);
    inst(A, V3J.plm, 12, ['iO', 'iU', 'iX']);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);   // 只画包围体的背面：每个像素只积分一次，镜头在火柱里面也画得出
    X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, V3J.pn, V3J.plm.length / 12);
    gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE);
    gl.depthMask(true); gl.disable(gl.BLEND);
    off(A, ['iO', 'iU', 'iX']); gl.disableVertexAttribArray(A.p);
  }
}
