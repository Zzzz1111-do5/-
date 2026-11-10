'use strict';
// 夜间（S.night，写实画面）：v3neb.js v3Night 把画好的地形、建筑、模型整幅乘上月光色之后调这里——
//   ① 夜空：只画在天空像素上（深度测试：没画过东西的地方深度还是 1）——星星（大部分很暗、少数亮，微微闪）、一条银河、月亮（月面明暗、
//      周围一圈光晕；月亮就在白天太阳的方向，地形的明暗、阴影都对得上）；地平线的颜色和远处的雾接上
//   ② 地面光斑：车灯照出的光锥、燃烧的残骸、爆炸、炮口焰、火箭点火、刚发射的导弹把附近的地面照亮。乘过月光色的画面再用
//      「目标色 ×（1 + 光）」混合（blendFunc DST_COLOR, ONE）提亮：照亮的地方保留本来的颜色和纹理（草是绿的、路是灰的），不是一片白；
//      强光（爆炸、火箭）一遍最多提亮一倍，分几遍叠。光斑网格贴着地形（每格按地面高度），被车辆、房屋挡住的地方照样挡住
//   ③ 灯具本身（v3fx.js v3Fx 调 v3ntLamps，发光的亮点、加法混合）：车辆前大灯、尾灯、车灯在夜空气里照出的淡淡光束，
//      舰艇的桅灯、舷灯（左红右绿）、尾灯，直升机顶上一闪一闪的红色防撞灯
const NT = { tried: false, ok: false, sky: null, dc: null, buf: null, v: [null, null, null], n: 0 };
const NT_MAXL = 72;   // 一帧最多多少个光源（按亮度 / 离镜头远近挑）
const nightOn = () => !!(typeof S === 'object' && S && S.night);
const ntReal = () => nightOn() && !(typeof v3Mx === 'function' && v3Mx()) && !(typeof TER === 'object' && TER && TER.flat);

const NT_SKY_VS = `attribute vec2 p; uniform mat4 uInv; uniform vec3 uEye; varying vec3 vR;
void main() { vec4 b = uInv * vec4(p, 1., 1.); vR = b.xyz / b.w - uEye; gl_Position = vec4(p, .99999, 1.); }`;
const NT_SKY_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uMoon, uHz; uniform float uT, uPx;
varying vec3 vR;
float h1(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1., 0., 0.)), f.x), mix(h1(i + vec3(0., 1., 0.)), h1(i + vec3(1., 1., 0.)), f.x), f.y),
             mix(mix(h1(i + vec3(0., 0., 1.)), h1(i + vec3(1., 0., 1.)), f.x), mix(h1(i + vec3(0., 1., 1.)), h1(i + vec3(1., 1., 1.)), f.x), f.y), f.z);
}
// 星星：方向投到立方体的六个面上分格，每格按哈希决定有没有星、偏在格里哪儿、多亮、偏蓝还是偏黄；星点按屏幕像素大小画（远近一样大，不闪烁成噪点）
vec3 stars(vec3 d, float N, float th, float gain) {
  vec3 a = abs(d); vec2 uv; float fc;
  if (a.x > a.y && a.x > a.z) { uv = d.yz / a.x; fc = d.x > 0. ? 1. : 2.; }
  else if (a.y > a.z) { uv = d.xz / a.y; fc = d.y > 0. ? 3. : 4.; }
  else { uv = d.xy / a.z; fc = d.z > 0. ? 5. : 6.; }
  vec2 g = uv * N, c = floor(g), fr = g - c;
  float h = h1(vec3(c, fc * 17.));
  if (h < th) return vec3(0.);
#ifdef DER
  float px = max(length(fwidth(g)), 1e-4);   // 一个像素是几格
#else
  float px = uPx * N * .5;
#endif
  vec2 o = vec2(h1(vec3(c, fc * 17. + 3.)), h1(vec3(c, fc * 17. + 7.))) * .6 + .2;
  float r = length(fr - o) / (px * .85), b = pow(h1(vec3(c, fc * 17. + 11.)), 7.) * 2.6 + .18, t = h1(vec3(c, fc * 17. + 13.));
  b *= .78 + .22 * sin(uT * (1.7 + 3.1 * t) + t * 40.);   // 微微闪
  return mix(vec3(.72, .82, 1.), vec3(1., .86, .7), t) * b * gain * exp(-r * r * 1.6);
}
void main() {
  vec3 d = normalize(vR);
  float el = d.z;
  vec3 c = mix(uHz, vec3(.006, .009, .024), smoothstep(-.02, .45, el));   // 地平线接雾色，往上到深蓝黑
  if (el > -.05) {
    // 银河：一条斜过天空的淡带，里面星星更密
    vec3 nm = normalize(vec3(.42, -.55, .72));
    float bd = dot(d, nm), band = exp(-bd * bd / .028), cl = vn3(d * 7.) * .6 + vn3(d * 17. + 3.) * .4;
    c += vec3(.05, .055, .075) * band * smoothstep(.25, .85, cl) * smoothstep(-.05, .2, el);
    vec3 st = stars(d, 170., .965, 1.) + stars(d, 420., .985 - band * .03, .55);
    c += st * smoothstep(-.03, .12, el);   // 地平线上的雾里看不见星
    // 月亮：白天太阳的位置；月面明暗（几块暗的「海」）、边缘略暗，外面一圈光晕
    float md = dot(d, uMoon), ang = acos(clamp(md, -1., 1.)), R = .021;
    c += vec3(.55, .62, .8) * (.11 * exp(-ang * 22.) + .035 * exp(-ang * 5.));
    if (ang < R) {
      float k = ang / R, mar = smoothstep(.45, .7, vn3(d * 260.) * .7 + vn3(d * 600.) * .3);
      vec3 mc = vec3(1., .98, .93) * (1. - .28 * mar) * (.82 + .18 * sqrt(max(1. - k * k, 0.)));
      c = mix(c, mc, smoothstep(1., .9, k));
    }
  }
  gl_FragColor = vec4(c, 1.);
}`;
// 地面光斑：p 世界坐标（GL）、c 颜色 × 强度（a > .5 是车灯的光锥）、q 光斑里的坐标（点光源 −1…1；车灯 x 往前 0…1、y 横向 −1…1）
const NT_DC_VS = `attribute vec3 p; attribute vec4 c; attribute vec2 q;
uniform mat4 uM; varying vec4 vC; varying vec2 vQ;
void main() { vC = c; vQ = q; gl_Position = uM * vec4(p, 1.); }`;
const NT_DC_FS = `precision mediump float;
varying vec4 vC; varying vec2 vQ;
void main() {
  float f;
  if (vC.a > .5) {   // 车灯：光锥往前越来越宽、越来越暗；车头前一两米最亮
    float w = .16 + .84 * vQ.x;
    f = pow(max(1. - vQ.x, 0.), 1.25) * smoothstep(1., .5, abs(vQ.y) / w) * smoothstep(0., .05, vQ.x) * (1. + .8 * exp(-vQ.x * 9.));
  } else { float r = length(vQ); f = max(1. - r, 0.); f *= f * (1. + 1.5 * exp(-r * r * 9.)); }
  gl_FragColor = vec4(vC.rgb * f, 1.);
}`;

function ntInit(gl) {
  NT.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs, attrs, unis) => {
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      const a = {}, u = {};
      for (const k of attrs) a[k] = gl.getAttribLocation(pr, k);
      for (const k of unis) u[k] = gl.getUniformLocation(pr, k);
      return { pr, a, u };
    };
    const der = !!gl.getExtension('OES_standard_derivatives');
    NT.sky = prog(NT_SKY_VS, NT_SKY_FS(der), ['p'], ['uInv', 'uEye', 'uMoon', 'uHz', 'uT', 'uPx']);
    NT.dc = prog(NT_DC_VS, NT_DC_FS, ['p', 'c', 'q'], ['uM']);
    NT.tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, NT.tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    NT.buf = gl.createBuffer();
    NT.ok = true;
  } catch (e) { NT.ok = false; console.warn('夜空 / 夜间灯光不可用', e); }
}

// —— ① 夜空 ——
function ntSky(C, tint) {
  const gl = V3.gl, inv = typeof v3Inv === 'function' && v3Inv(C.M);
  if (!inv) return;
  const P = NT.sky, bg = typeof v3Bg === 'function' ? v3Bg() : [.74, .75, .8], s = V3_SUN, l = Math.hypot(s[0], s[1], s[2]) || 1;
  gl.useProgram(P.pr);
  gl.uniformMatrix4fv(P.u.uInv, false, inv); gl.uniform3f(P.u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform3f(P.u.uMoon, s[0] / l, s[1] / l, s[2] / l);
  gl.uniform3f(P.u.uHz, bg[0] * tint[0], bg[1] * tint[1], bg[2] * tint[2]);   // 远处地面的雾乘过月光色是这个颜色：地平线接得上
  gl.uniform1f(P.u.uT, (performance.now() / 1000) % 1000);
  gl.uniform1f(P.u.uPx, 2 * Math.tan((typeof V3_FOV === 'number' ? V3_FOV : .9) / 2) / Math.max(1, V3.cv ? V3.cv.height : 720));
  gl.bindBuffer(gl.ARRAY_BUFFER, NT.tri); gl.enableVertexAttribArray(P.a.p); gl.vertexAttribPointer(P.a.p, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.depthFunc(gl.LESS); gl.depthMask(true);
  gl.disableVertexAttribArray(P.a.p);
}

// —— ② 光源：这一帧照亮地面的光 { x, y, r 半径, c [r, g, b], I 强度（相对白天的受光，1 ≈ 白天一样亮）, h 车灯朝向（有就是光锥）} ——
const NT_HEAD = [1, .9, .74], NT_FIRE = [1, .52, .2], NT_FLASH = [1, .74, .42];
function ntLights(C) {
  const L = [], ex = C.E[0], ey = -C.E[1], tw = performance.now() / 1000;
  const near = (x, y, m) => Math.hypot(x - ex, y - ey) < m;
  const seenE = (x, y) => (typeof specAll === 'function' && specAll()) || (typeof R === 'object' && (R.eye === 'all' || R.eye === 'both' || R.eye === 'e')) || (typeof inVision === 'function' && inVision(x, y));   // 同 v3units.js 的 spec
  // 车灯：活着的车（看得见的敌车也算），离镜头 1.6 公里内；开着的时候一直亮（停着的也亮着近光）
  for (const arr of [S.veh || [], S.armor || []]) for (const v of arr) {
    if (v.dead || v.lst || !isFinite(v.x) || !near(v.x, v.y, 1600) || (v.side === 'e' && !seenE(v.x, v.y)) || (arr === S.veh && v.swim)) continue;
    const len = arr === S.veh && typeof vehSp === 'function' ? vehSp(v).len : 18, h = v.heading || 0;
    L.push({ x: v.x + Math.cos(h) * len * .45, y: v.y + Math.sin(h) * len * .45, r: 30 + len * 1.4, c: NT_HEAD, I: .9, h, w: 11 + len * .35 });
  }
  // 燃烧的残骸：火光一跳一跳
  for (const arr of [S.veh || [], S.armor || []]) for (const v of arr) {
    if (!v.dead || !isFinite(v.x) || !near(v.x, v.y, 2500)) continue;
    const age = S.t - (v.deadT ?? -999);
    if (!(age >= 0 && age < 50)) continue;
    const k = (1 - age / 50) * (.75 + .25 * Math.sin(tw * 13 + v.id) * Math.sin(tw * 7.7 + v.id * 3));
    L.push({ x: v.x, y: v.y, r: 26, c: NT_FIRE, I: 1.1 * k });
  }
  // 爆炸：炸开那半秒最亮，火球烧着的两秒里慢慢暗下去
  for (const f of S.fx || []) {
    if (!isFinite(f.x) || !near(f.x, f.y, 3500)) continue;
    if (f.kind === 'boom' || f.kind === 'b2') {
      if (f.life > 2.2 || !(f.r > 0)) continue;
      const u = f.life < .35 ? 1 : Math.pow(1 - (f.life - .35) / 1.85, 2), big = f.kind === 'b2' ? 1.6 : 1;
      L.push({ x: f.x, y: f.y, r: f.r * 6 * big + 25, c: f.life < .2 ? [1, .85, .62] : NT_FIRE, I: 3.2 * u * Math.min(1.5, f.r / 18) * big });
    } else if (f.kind === 'flash' && f.life < .25) L.push({ x: f.x, y: f.y, r: 40, c: NT_FLASH, I: 2.2 * (1 - f.life / .25) });   // 火炮开火的炮口焰
  }
  // 坦克炮、机关炮开火的一瞬
  for (const s of S.vshots || []) if (s.t < .12 && isFinite(s.x0) && near(s.x0, s.y0, 2000)) L.push({ x: s.x0, y: s.y0, r: s.k === 'flame' ? 30 : 22, c: NT_FLASH, I: s.k === 'flame' ? 1.6 : 1.4 * (1 - s.t / .12) });
  // 火箭、导弹刚点火离架：贴地那一段把发射点照得通亮
  for (const m of S.missiles || []) {
    if (m.done || m.t < 0 || m.t > 2.2 || !isFinite(m.x) || m.z3 != null || !near(m.x, m.y, 3000)) continue;
    const k = Math.pow(1 - m.t / 2.2, 1.5);
    L.push({ x: m.x, y: m.y, r: 70, c: [1, .66, .34], I: 2.4 * k });
  }
  if (typeof ntMoreLights === 'function') ntMoreLights(L, C);   // 别处加的光（火箭炮齐射等）
  // 挑亮的、近的
  for (const o of L) o.s = o.I * Math.max(1, o.r / 30) / (1 + Math.hypot(o.x - ex, o.y - ey) / 700);
  L.sort((a, b) => b.s - a.s);
  if (L.length > NT_MAXL) L.length = NT_MAXL;
  return L;
}
// 地面高度：图外按 3D 画面的（延伸的陆地、海面）
const ntGz = (x, y) => Math.max(typeof v3HtX === 'function' ? v3HtX(x, y) : v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)), -2.6) + .15;
// 一个光源 → 贴着地面的网格（三角形），顶点 9 个数：位置 3、颜色 4（a 1 是车灯）、光斑坐标 2
function ntDecal(V, o, s) {
  const cr = o.c[0] * s, cg = o.c[1] * s, cb = o.c[2] * s;
  if (o.h != null) {   // 车灯光锥：车头往前 r，最宽处半宽 w；按 6 × 5 格铺
    const c = Math.cos(o.h), sn = Math.sin(o.h), nu = 6, nv = 5, P = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv * 2 - 1, wu = .16 + .84 * u, a = u * o.r, b = v * o.w * wu * 1.15, x = o.x + c * a - sn * b, y = o.y + sn * a + c * b;
      P.push([x, -y, ntGz(x, y), u, v * wu * 1.15]);   // 横向坐标按最宽处的半宽归一（着色器里再除以这一处的宽度）
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const k = i * (nv + 1) + j, A = P[k], B = P[k + 1], Cc = P[k + nv + 1], D = P[k + nv + 2];
      for (const q of [A, Cc, B, B, Cc, D]) V.push(q[0], q[1], q[2], cr, cg, cb, 1, q[3], q[4]);
    }
    return;
  }
  const n = o.r > 60 ? 10 : 7, P = [];   // 点光源：方格，格子大小跟地形网格差不多
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const u = i / n * 2 - 1, v = j / n * 2 - 1, x = o.x + u * o.r, y = o.y + v * o.r;
    P.push([x, -y, ntGz(x, y), u, v]);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = i * (n + 1) + j, A = P[k], B = P[k + 1], Cc = P[k + n + 1], D = P[k + n + 2];
    for (const q of [A, Cc, B, B, Cc, D]) V.push(q[0], q[1], q[2], cr, cg, cb, 0, q[3], q[4]);
  }
}
function ntDecals(C, tint) {
  const gl = V3.gl, Ls = ntLights(C), T = Math.max(.12, (tint[0] + tint[1] + tint[2]) / 3);
  if (!Ls.length) return;
  // 每个光源要提亮 m = 1 + I / T 倍（画面已经乘过月光色 T）；一遍最多一倍，分 p 遍，每遍 (1 + s)^p = m
  const V = NT.v;
  for (let k = 0; k < 3; k++) { if (!V[k]) V[k] = typeof V3FBuf === 'function' ? new V3FBuf(1 << 15) : []; V[k].length = 0; }
  for (const o of Ls) {
    if (!(o.I > .02)) continue;
    const m = 1 + o.I / T, p = Math.min(3, Math.max(1, Math.ceil(Math.log2(m) - 1e-6))), s = Math.pow(m, 1 / p) - 1;
    for (let k = 0; k < p; k++) ntDecal(V[k], o, Math.min(1, s));
  }
  const P = NT.dc;
  gl.useProgram(P.pr); gl.uniformMatrix4fv(P.u.uM, false, C.M);
  gl.bindBuffer(gl.ARRAY_BUFFER, NT.buf);
  gl.enableVertexAttribArray(P.a.p); gl.enableVertexAttribArray(P.a.c); gl.enableVertexAttribArray(P.a.q);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ONE);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -8);   // 贴着地面画，不和地面打架
  for (const B of V) {
    if (!B.length) continue;
    const data = B.a ? B.a.subarray(0, B.length) : new Float32Array(B);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(P.a.p, 3, gl.FLOAT, false, 36, 0); gl.vertexAttribPointer(P.a.c, 4, gl.FLOAT, false, 36, 12); gl.vertexAttribPointer(P.a.q, 2, gl.FLOAT, false, 36, 28);
    gl.drawArrays(gl.TRIANGLES, 0, B.length / 9);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); gl.depthMask(true);
  gl.disableVertexAttribArray(P.a.p); gl.disableVertexAttribArray(P.a.c); gl.disableVertexAttribArray(P.a.q);
}
// v3neb.js v3Night 乘过月光色之后调：先夜空，再地面光斑
function v3ntDraw(C, tint) {
  if (!ntReal() || !V3.gl) return;
  const gl = V3.gl;
  if (!NT.tried) ntInit(gl);
  if (!NT.ok) return;
  ntSky(C, tint);
  ntDecals(C, tint);
}

// —— ③ 灯具（v3fx.js 调，加法混合的亮点）——
const NT_LAMP = { head: [1, .93, .8, 1], tail: [1, .12, .08, .9], red: [1, .16, .12, 1], green: [.25, 1, .45, 1], white: [1, .97, .9, 1], amber: [1, .7, .3, .95] };
function v3ntLamps(out, C) {
  if (!nightOn() || typeof v3fSpark !== 'function') return;
  const E = C.E, ex = E[0], ey = -E[1], tw = performance.now() / 1000, seenE = (x, y) => (typeof specAll === 'function' && specAll()) || (typeof inVision === 'function' && inVision(x, y));
  const sc = (x, y, z) => Math.max(1, Math.hypot(x - ex, y - ey, z - E[2]) / 260);   // 远处的灯点画大一点（至少一两个像素），不会一闪一闪地消失
  const lamp = (x, y, z, r, c) => v3fSpark(out, C, [x, -y, z], r * sc(x, y, z), c);
  // 车辆：前大灯一对、尾灯一对，前面空气里两束淡淡的光
  for (const arr of [S.veh || [], S.armor || []]) for (const v of arr) {
    if (v.dead || v.lst || !isFinite(v.x) || Math.hypot(v.x - ex, v.y - ey) > 2400 || (v.side === 'e' && !seenE(v.x, v.y)) || (arr === S.veh && v.swim)) continue;
    const len = arr === S.veh && typeof vehSp === 'function' ? vehSp(v).len : 18, h = v.heading || 0, c = Math.cos(h), s = Math.sin(h), z = v3Ht(clamp(v.x, 0, W - 1), clamp(v.y, 0, H - 1));
    const wd = len * .17, hz = z + Math.max(1, len * .11);
    for (const sg of [-1, 1]) {
      const fx = v.x + c * len * .47 - s * wd * sg, fy = v.y + s * len * .47 + c * wd * sg;
      lamp(fx, fy, hz, .55, NT_LAMP.head);
      const bx = fx + c * 16, by = fy + s * 16;   // 光束：从灯往前 16 米，越远越淡
      v3fRib(out, E, [fx, -fy, hz], [bx, -by, hz - 1.4], 2.6, [1, .92, .78, .2], [1, .92, .78, 0]);
      lamp(v.x - c * len * .48 - s * wd * sg * 1.05, v.y - s * len * .48 + c * wd * sg * 1.05, z + Math.max(.9, len * .09), .32, NT_LAMP.tail);
    }
  }
  // 舰艇：桅灯（白）、左舷红、右舷绿、尾灯（白）；大船甲板上几盏照明
  const ship = (x, y, hd, L, Bm, ht) => {
    if (!isFinite(x) || Math.hypot(x - ex, y - ey) > 6000) return;
    const c = Math.cos(hd), s = Math.sin(hd), z0 = -2.6, P = (u, v, z, r, col) => lamp(x + c * u - s * v, y + s * u + c * v, z0 + z, r, col);
    P(L * .1, 0, ht, .9, NT_LAMP.white); P(L * .12, -Bm * .5, ht * .45, .7, NT_LAMP.red); P(L * .12, Bm * .5, ht * .45, .7, NT_LAMP.green); P(-L * .48, 0, ht * .35, .7, NT_LAMP.white);
    if (L > 60) for (let k = -2; k <= 2; k++) P(k * L * .14, 0, ht * .32, .8, NT_LAMP.amber);
  };
  for (const sh of S.ships || []) {
    if (!(typeof alive === 'function' ? alive(sh) : !sh.dead)) continue;
    const d = (typeof SHIP_DIM === 'object' && SHIP_DIM[sh.kind]) || [32, 11], L = sh.kind === 'dd' ? 150 : d[0], Bm = sh.kind === 'dd' ? 19 : d[1];
    ship(sh.x, sh.y, sh.heading ?? -1.57, L, Bm, Math.max(6, L * .16));
  }
  if (S.dd && S.dd.state !== 'sunk') ship(S.dd.x, S.dd.y, S.dd.heading ?? -1.57, 180, 20, 30);
  for (const e of S.eships || []) if (!e.dead && seenE(e.x, e.y)) { const C0 = (typeof NV_CLS === 'object' && NV_CLS[e.cls]) || { L: 46, B: 9 }; ship(e.x, e.y, e.heading ?? -1.57, C0.L, C0.B, Math.max(6, C0.L * .17)); }
  // 直升机：机背上一闪一闪的红色防撞灯（约 1 秒闪一次）
  const blink = id => (tw * 1.1 + (id || 0) * .37) % 1 < .12;
  for (const p of S.planes || []) {
    if (p.dead || !isFinite(p.x) || typeof airMdl !== 'function') continue;
    const M = airMdl(p.kind, p.v);
    if (!(M && (M.sil === 'z10' || p.kind === 'heli' || p.v === 'heli')) || !blink(p.id)) continue;
    const z = typeof v3AirZ === 'function' ? v3AirZ(p) : 120;
    lamp(p.x, p.y, z + 2.2, 1.1, NT_LAMP.red);
  }
}
