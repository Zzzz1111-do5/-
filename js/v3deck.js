'use strict';
// 福建舰飞行甲板（写实画面要电影质感）：甲板顶面不再是一整片平涂的深灰，单独用这个着色器画——纹路全在片元里按甲板坐标（米）现算，
//   远近都清楚、凑多近都不糊：磨砂的防滑涂层（几种尺度的细颗粒、颗粒团、不规则的斑驳与新旧深浅，弹射滑轨两侧被磨平发浅）、着舰区落地段被轮胎磨出的黑色胎迹、
//   弹射器后面尾焰烤出的焦痕、机位上的油渍、舰首舰尾被浪花打湿的水迹（湿处反光：太阳的高光与天空的倒影，掠射角更亮）；
//   光影：日光 + 天光（与 v3units.js 写实画面同一套）、太阳阴影（view3d.js 的阴影图）、舰岛脚下的环境光遮蔽。白、黄标线仍是航母模型里的漆面条带
// 只在高画质（v3mHi）画；航母模型（v3units.js v3mCarrier）在这时不画甲板顶面，免得两层叠在一起闪
const V3DK = { tried: false, ok: false, pr: null, a: {}, u: {}, buf: null, n: 0, sig: null, noTop: false };
const V3DK_VS = () => `attribute vec2 a;
uniform mat4 uM; uniform vec3 uEye; uniform vec4 uCv;
varying vec2 vP; varying vec3 vW; varying float vD;
${V3_SHV}
void main() {
  float c = cos(uCv.w), s = sin(uCv.w);
  vec2 q = vec2(a.x, -a.y);   // 与 v3units.js 实例着色器同一换算：建模坐标 y 取反，再转 −朝向
  vec3 w = vec3(uCv.x + q.x * c - q.y * s, uCv.y + q.x * s + q.y * c, uCv.z);
  vP = a; vW = w; vD = length(uEye - w);
  vSh = uShM * vec4(w, 1.);
  gl_Position = uM * vec4(w, 1.);
}`;
const V3DK_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uEye, uBg, uBody, uGlow; uniform vec2 uFog; uniform float uMode, uLw, uWt; uniform vec4 uLand, uIsl;
uniform vec4 uCat[4]; uniform float uNc; uniform vec3 uSlot[24]; uniform float uNs;
varying vec2 vP; varying vec3 vW; varying float vD;
${V3_SHF}
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1., 0.)), u.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
void main() {
#ifdef DER
  vec2 fw = fwidth(vP); float px = max(max(fw.x, fw.y), 1e-4);   // 一个像素合多少米：比它细的纹路淡掉（不闪、不出摩尔纹）
#else
  float px = vD * .0012;
#endif
  vec3 alb = vec3(.294, .31, .322);   // 深灰防滑涂层（#4b4f52）
  // 磨砂防滑涂层：喷涂的骨料颗粒——1、2.5、6 厘米几种尺度的细颗粒叠在一起（远了按一个像素合多少米逐层淡掉，远处是颗粒平均下来的哑光灰，不闪），
  //   二三十厘米的颗粒团、几米的滚涂斑驳、几十米的新旧深浅都是不规则的噪声——没有格子、没有接缝
  float g1 = 1. - smoothstep(.004, .012, px), g2 = 1. - smoothstep(.01, .03, px), g3 = 1. - smoothstep(.025, .07, px);
  float gr = (vn(vP * 95.) - .5) * .5 * g1 + (vn(vP * 40.) - .5) * .75 * g2 + (vn(vP * 16.) - .5) * .8 * g3;
  // 来回滑行、弹射的地方防滑层被磨平：颜色浅一点、颗粒浅一点（弹射器滑轨两侧）
  float worn = 0.;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uNc) break;
    vec4 C = uCat[i]; vec2 d = vec2(cos(C.z), sin(C.z)), r = vP - C.xy;
    float t = clamp(dot(r, d), -25., C.w), q = length(r - d * t);
    worn = max(worn, exp(-q * q / 18.));
  }
  worn *= .55 + .45 * fbm(vP * .5 + 7.);
  alb *= 1. + gr * .34 * (1. - .55 * worn);
  alb *= .9 + .2 * fbm(vP * 2.2);
  alb *= .88 + .24 * fbm(vP * .35);
  alb *= .88 + .22 * fbm(vP * .045 + 3.7);
  alb *= 1. + worn * .12;
  // 着舰区：落地段（第一道拦阻索前后）被轮胎磨出顺着舰方向的黑色胎迹，中线两侧最密；整段胶迹发黑
  vec2 ax = uLand.zw - uLand.xy; float La = length(ax); vec2 ad = ax / La, an = vec2(-ad.y, ad.x), rp = vP - uLand.xy;
  float sl = dot(rp, ad), tl = dot(rp, an), tz = uWt * La;
  float inL = step(0., sl) * step(sl, La) * (1. - smoothstep(uLw * .8, uLw, abs(tl)));
  float env = inL * exp(-tl * tl / 42.) * smoothstep(tz - 55., tz - 12., sl) * (1. - smoothstep(tz + 25., tz + 120., sl));
  float st = vn(vec2(sl / 9., tl / .2)) * .65 + vn(vec2(sl / 23., tl / .55)) * .35;
  float rub = smoothstep(.45, .78, st) * env;
  alb *= 1. - env * .2;
  alb = mix(alb, vec3(.055, .055, .06), rub * .78);
  // 弹射器后面、偏流板前：加力尾焰烤出的焦痕（发褐）；油渍、焦痕的不规则边共用一层噪声（逐个算太费）
  float nb = fbm(vP * .8), no = fbm(vP * 1.6 + 3.1);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uNc) break;
    vec4 C = uCat[i]; vec2 d = vec2(cos(C.z), sin(C.z)), r = vP - C.xy;
    float a1 = dot(r, d) + 7.5, b1 = dot(r, vec2(-d.y, d.x));
    float bl = exp(-a1 * a1 / 14. - b1 * b1 / 11.) * (.55 + .45 * nb);
    alb = mix(alb, alb * vec3(.5, .45, .4), clamp(bl, 0., 1.) * .85);
  }
  // 机位上的油渍（不规则的暗斑，略带光泽）
  float oil = 0.;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uNs) break;
    vec2 r = vP - uSlot[i].xy;
    float d = length(r * vec2(.75, 1.1)) + (no - .5) * 1.6;
    oil = max(oil, 1. - smoothstep(.9, 2.4, d));
  }
  alb = mix(alb, alb * .58, oil * .6);
  // 水迹：舰首、舰尾被浪花打湿的一片片（湿处颜色深、光滑反光）
  float wz = smoothstep(105., 150., vP.x) + smoothstep(-115., -150., vP.x);
  float wet = clamp(smoothstep(.6, .76, fbm(vP * .06 + 11.)) * (.2 + .4 * wz) + oil * .35, 0., 1.);
  alb *= 1. - wet * .32;
  // 舰岛脚下的环境光遮蔽
  vec2 dq = max(max(uIsl.xz - vP, vP - uIsl.yw), 0.);
  float ao = 1. - .36 * exp(-length(dq) / 2.4);
  // 光照：颗粒让法线细碎抖动（高光碎一点）；日光 + 天光、太阳阴影；高光与天空倒影按湿度变（菲涅耳：掠射角反光更强）
  float e = .008, g0 = vn(vP * 40.), gb = .4 * g2 * (1. - .5 * worn);   // 颗粒的起伏让法线细碎抖动：近看是磨砂的颗粒感
  vec3 N = normalize(vec3((vn(vP * 40. + vec2(e * 40., 0.)) - g0) * gb, -(vn(vP * 40. + vec2(0., e * 40.)) - g0) * gb, 1.));
  vec3 L = ${V3_SUNG}, V = normalize(uEye - vW);
  float sh = shadowAt(), dif = max(dot(N, L), 0.) * sh;
  vec3 col;
  if (uMode > .5) {
    vec3 H = normalize(L + V);
    float shin = mix(10., 140., wet), ks = mix(.035, .32, wet), spec = pow(max(dot(N, H), 0.), shin) * ks * sh * (shin + 8.) / 22.;
    float F = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
    vec3 R = reflect(-V, N), sky = mix(vec3(.74, .75, .8), vec3(.5, .6, .76), clamp(R.z, 0., 1.));
    col = alb * (vec3(.42, .47, .55) + vec3(1., .95, .86) * dif * .86) * ao + vec3(1., .96, .9) * spec + sky * F * mix(.08, .3, wet) * ao;   // 天光略压、日光略提：阴影里更沉、亮处更透（光影反差）
  } else {   // 黑绿画面：深色甲板 + 很淡的钢板缝、系留环发光
    float l = dot(alb, vec3(.3, .59, .11));
    col = uBody * (.45 + 1.25 * l) * (.7 + .95 * dif) * ao;
  }
  gl_FragColor = vec4(mix(col, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
function v3dkInit(gl) {
  V3DK.tried = true;
  try {
    const der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3DK_VS())); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3DK_FS(der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3DK.pr = pr; V3DK.a.a = gl.getAttribLocation(pr, 'a');
    for (const k of ['uM', 'uEye', 'uCv', 'uBg', 'uBody', 'uGlow', 'uFog', 'uMode', 'uLw', 'uWt', 'uLand', 'uIsl', 'uCat', 'uNc', 'uSlot', 'uNs', 'uShM', 'uShT', 'uShOn', 'uShP']) V3DK.u[k] = gl.getUniformLocation(pr, k);
    V3DK.buf = gl.createBuffer();
    V3DK.ok = true;
  } catch (e) { V3DK.ok = false; console.warn('甲板着色器不可用，照旧画平涂甲板', e); }
}
// 航母模型建网格时问：这一档画质由这里画甲板吗（是就不画甲板顶面）
function v3dkOn() {
  if (typeof CVG !== 'object' || typeof V3 !== 'object' || !V3.gl || typeof V3_SHV !== 'string' || !(typeof v3mHi === 'function' && v3mHi())) return false;
  if (!V3DK.tried) v3dkInit(V3.gl);
  return V3DK.ok;
}
// 甲板多边形（CVG.deck，甲板坐标）三角化成顶点缓冲（甲板换了形状才重建）
function v3dkMesh(gl) {
  const D = CVG.deck, sig = JSON.stringify(D);
  if (V3DK.sig === sig) return;
  const T = typeof mbEar === 'function' ? mbEar(D) : [], v = [];
  for (const [a, b, c] of T) for (const i of [a, b, c]) v.push(D[i][0], D[i][1]);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3DK.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  V3DK.n = v.length / 2; V3DK.sig = sig;
}
// view3d.js 每帧（兵种模型之后、弹道之前）：画每艘福建舰的甲板顶面
function v3dkDraw(C) {
  if (!V3DK.noTop || !V3DK.ok || typeof cvAll !== 'function' || !(typeof v3mHi === 'function' && v3mHi())) return;
  const gl = V3.gl, list = cvAll().filter(cv => cv.hp > 0 && cv.x > -999 && !/075/.test(cv.name || ''));
  if (!list.length) return;
  v3dkMesh(gl);
  if (!V3DK.n) return;
  const U = V3DK.u, Cg = CVG, real = typeof realLook === 'function' && realLook() && !(typeof greenLook === 'function' && greenLook());
  gl.useProgram(V3DK.pr);
  gl.uniformMatrix4fv(U.uM, false, C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.74, .75, .8]));
  gl.uniform1f(U.uMode, real ? 1 : 0); gl.uniform3f(U.uBody, .02, .1, .055); gl.uniform3f(U.uGlow, .32, 1, .58);
  if (typeof v3ShUni === 'function') v3ShUni(gl, U, true);
  const L = Cg.land; gl.uniform4f(U.uLand, L.u0, L.v0, L.u1, L.v1); gl.uniform1f(U.uLw, L.hw); gl.uniform1f(U.uWt, Math.min(...(Cg.wires && Cg.wires.length ? Cg.wires : [.2])));
  const [i0, i1, j0, j1] = Cg.isl; gl.uniform4f(U.uIsl, i0, i1, j0, j1);
  const cat = [], nc = Math.min(4, Cg.cats.length); for (let k = 0; k < 4; k++) { const c = Cg.cats[k] || { u: 0, v: 0, a: 0, L: 0 }; cat.push(c.u, c.v, c.a, c.L || 100); }
  gl.uniform4fv(U.uCat, cat); gl.uniform1f(U.uNc, nc);
  const sl = [], ns = Math.min(24, (Cg.slots || []).length); for (let k = 0; k < 24; k++) { const q = (Cg.slots || [])[k] || [0, 0, 0]; sl.push(q[0], q[1], q[2]); }
  gl.uniform3fv(U.uSlot, sl); gl.uniform1f(U.uNs, ns);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3DK.buf);
  gl.enableVertexAttribArray(V3DK.a.a); gl.vertexAttribPointer(V3DK.a.a, 2, gl.FLOAT, false, 8, 0);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);   // 往后让一点：同一高度的漆面标线、升降机平台、偏流板压在上面
  const top = -2.6 + Cg.zd;
  for (const cv of list) {
    const h = cv.heading ?? -1.57;
    gl.uniform4f(U.uCv, cv.x, -cv.y, top, -h);
    gl.drawArrays(gl.TRIANGLES, 0, V3DK.n);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.disableVertexAttribArray(V3DK.a.a);
}
