'use strict';
// 序列帧特效（用户在 Fab 买的虚幻商城特效包「ArmyVFX」里的贴图，assets/vfx/*.webp；从 .uasset 里拆出原图、缩小转成 WebP）：
//   爆炸的火球和翻滚的烟（expl，11 × 11 帧）、燃烧残骸的火（fire，8 × 8，循环）、坦克 / 车炮的炮口焰（mzl，3 × 3）、火炮的炮口焰（mzla，10 × 10）、烟团（puff，8 × 8，带颜色）。
//   前四张是烟火模拟渲出来的分通道序列帧：A 透明度、B 火光（发光）、R / G 烟在两个方向上的受光；puff 是带颜色、带透明度的普通序列帧。
//   v3fx.js 每帧用 v3vAdd 往队列里放精灵，v3vDraw 在烟、发光那两遍之前统一画：按离镜头远近从远到近排、预乘透明度混合、测深度不写深度；
//   相邻两帧按小数部分混合（不一顿一顿）。贴图没载入好（或加载失败）时 v3vReady() 为假，v3fx.js 照旧画程序的火球、烟团
const V3V_TEX = { expl: { n: 11, f: 121 }, fire: { n: 8, f: 64 }, mzl: { n: 3, f: 9 }, mzla: { n: 10, f: 100 }, puff: { n: 8, f: 64, col: 1 } };
const V3V = { tried: false, ok: false, pr: null, tex: {}, nOk: 0, fail: false, q: [], buf: null, a: {}, u: {}, data: null };
const V3V_TEX0 = JSON.parse(JSON.stringify(V3V_TEX)), V3V_N0 = Object.keys(V3V_TEX).length;   // 内置的几张（编辑器导入的另外登记，不算进「全部好了」）
// 编辑器导入的序列帧（modui.js「特效贴图」，mod.js 存在 IndexedDB）：v3vUser 登记成新的贴图键（col：0 分通道（ArmyVFX 的格式）、1 受光的烟、2 发光的火）；
//   v3vSlots 拿它们换掉内置的爆炸、残骸火、炮口焰、烟团——帧号按两张图的总帧数换算（v3fx.js 照内置贴图的帧数算的帧号照样能用）；用到时才解码、上传
const V3V_USR = {}, V3V_SLOT = {};
function v3vUser(key, blob, n, f, col) {
  const U = V3V_USR[key];
  if (U && U.tex && V3.gl) V3.gl.deleteTexture(U.tex);
  V3V_USR[key] = { blob, tex: null, ld: false };
  V3V_TEX[key] = { n: Math.max(1, n | 0), f: Math.max(1, Math.min(f | 0, n * n)), col: col | 0, u: 1 };
}
function v3vSlots(sl) { for (const k in V3V_SLOT) delete V3V_SLOT[k]; for (const k in sl) if (V3V_TEX0[k] && V3V_TEX[sl[k]]) V3V_SLOT[k] = sl[k]; }
function v3vUserTex(key) {
  const U = V3V_USR[key], gl = typeof V3 === 'object' && V3.gl;
  if (!U || !gl) return null;
  if (U.tex || U.ld) return U.tex;
  U.ld = true;
  const up = img => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    let src = img;   // WebGL1：不是 2 的幂的图画到 2 的幂的画布上再传（多级渐远）
    const p2 = n => 2 ** Math.round(Math.log2(Math.max(1, n)));
    if ((img.width & (img.width - 1)) || (img.height & (img.height - 1))) { const cv = document.createElement('canvas'); cv.width = Math.min(4096, p2(img.width)); cv.height = Math.min(4096, p2(img.height)); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); src = cv; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    U.tex = t; };
  (typeof createImageBitmap === 'function' ? createImageBitmap(U.blob) : Promise.reject(new Error())).then(up, () => { const u = URL.createObjectURL(U.blob), I = new Image(); I.onload = () => { URL.revokeObjectURL(u); up(I); }; I.src = u; });
  return null;
}
const V3V_VS = `attribute vec3 p; attribute vec2 uv; attribute vec4 k; attribute vec3 tn;
uniform mat4 uM; uniform vec3 uEye; varying vec2 vUv; varying vec4 vK; varying vec3 vTn; varying float vD;
void main() { vUv = uv; vK = k; vTn = tn; vD = length(p - uEye); gl_Position = uM * vec4(p, 1.); }`;
const V3V_FS = `precision mediump float;
uniform sampler2D uT; uniform float uN, uF, uCol; uniform vec3 uNt, uBg, uSunC, uAmb; uniform vec2 uFog;
varying vec2 vUv; varying vec4 vK; varying vec3 vTn; varying float vD;   // vK：帧号、透明度、火光强度、受光
vec4 at(float f) { float c = mod(f, uN), r = floor(f / uN + .001); return texture2D(uT, (vec2(c, r) + clamp(vUv, .004, .996)) / uN); }
void main() {
  float f0 = floor(vK.x), w = vK.x - f0;
  vec4 t = mix(at(f0), at(min(f0 + 1., uF - 1.)), w);
  vec2 eg = min(vUv, 1. - vUv);
  float fog = smoothstep(uFog.x, uFog.y, vD), a = t.a * vK.y * smoothstep(0., .14, min(eg.x, eg.y));   // 格子边上淡出：个别贴图（车炮口焰）每格的不透明度一直铺到格子边，近处放大成一块圆角方板
  if (a < .003) discard;
  vec3 c;
  if (uCol > 1.5) c = t.rgb * a * (1. - .5 * fog);   // 导入的发光序列帧（火焰、尾焰）：原色发光
  else if (uCol > .5) c = mix(t.rgb * vTn * (uAmb + uSunC * vK.w) * uNt, uBg, fog) * a;   // 带颜色的烟团：按太阳和天光照
  else {
    float l = t.r * .4 + t.g * .6;   // 两个方向的受光合成一个（太阳在上方偏一侧）
    vec3 sm = vTn * (uAmb * (.55 + .45 * l) + uSunC * l * vK.w) * uNt;
    float e = t.b * vK.z * smoothstep(.04, .35, t.a);   // 火光只加在有不透明度的地方：B 通道在透明区里有 WebP 压缩的方块，原来不管透明度直接加，近处放大成一圈锯齿硬边、一块块的黄
    vec3 fire = mix(vec3(.95, .22, .04), vec3(1., .66, .26), smoothstep(.15, .6, t.b)) + vec3(.55, .5, .4) * smoothstep(.72, 1., t.b);
    vec3 fl = fire * e * e * (1. - .6 * fog) * 1.6;
    c = mix(sm, uBg, fog) * a + fl / (1. + .15 * dot(fl, vec3(.333)));   // 火光加在上面（不受透明度压暗）；轻轻压一下高光：近处的大火球中间不再整块冲成平的白
  }
  gl_FragColor = vec4(c, a);
}`;
function v3vInit(gl) {
  V3V.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3V_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3V_FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3V.pr = pr;
    for (const k of ['p', 'uv', 'k', 'tn']) V3V.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uT', 'uN', 'uF', 'uCol', 'uNt', 'uBg', 'uSunC', 'uAmb', 'uFog']) V3V.u[k] = gl.getUniformLocation(pr, k);
    V3V.buf = gl.createBuffer();
    const v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '';
    for (const key in V3V_TEX0) {
      if (typeof Image === 'undefined') { V3V.fail = true; break; }
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        V3V.tex[key] = t; if (++V3V.nOk === V3V_N0) V3V.ok = true;
      };
      img.onerror = () => { V3V.fail = true; };
      img.src = 'assets/vfx/' + key + '.webp' + v;
    }
  } catch (e) { V3V.fail = true; console.warn('序列帧特效不可用', e); }
}
// 贴图都好了（写实画面才用；黑绿 / 数码画面照旧是发光的程序特效）
function v3vReady() {
  if (typeof V3 !== 'object' || !V3.gl || (typeof v3Mx === 'function' && v3Mx()) || (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.vfx === false)) return false;   // 编辑器 / 设置里可以关
  if (!V3V.tried) v3vInit(V3.gl);
  return V3V.ok && !V3V.fail;
}
// 放一个精灵：t 贴图键、p GL 坐标中心、s 半边长（米）、fr 帧号（可带小数）、a 透明度、e 火光强度、tn 烟的颜色、ax 竖直方向（GL 向量，null 就是正对镜头、竖直朝上）、rot 绕视线转
//   asp：沿 ax 方向拉长几倍（尾焰）
function v3vAdd(t, p, s, fr, a, e = 1, tn = [.3, .28, .26], ax = null, rot = 0, lit = 1, asp = 1) {
  const sl = V3V_SLOT[t];
  if (sl) { fr *= V3V_TEX[sl].f / V3V_TEX0[t].f; t = sl; }   // 编辑器换成了导入的贴图
  const T = V3V_TEX[t];
  if (!T || a <= .003 || s <= 0 || (T.u && !v3vUserTex(t))) return;
  V3V.q.push({ t, p, s, fr: clamp(fr, 0, T.f - 1.001), a: Math.min(1, a), e, tn, ax, rot, lit, asp });
}
function v3vDraw(C) {
  const Q = V3V.q;
  if (!Q.length) return;
  if (!V3V.ok) { Q.length = 0; return; }
  const gl = V3.gl, E = C.E, R0 = C.x, U0 = C.y, Z0 = C.z;   // 镜头的右、上、后（GL）
  for (const o of Q) o.d = (o.p[0] - E[0]) ** 2 + (o.p[1] - E[1]) ** 2 + (o.p[2] - E[2]) ** 2;
  Q.sort((a, b) => b.d - a.d);
  const NV = 13, need = Q.length * 6 * NV;
  if (!V3V.data || V3V.data.length < need) V3V.data = new Float32Array(Math.max(need, 6 * NV * 256));
  const D = V3V.data;
  gl.useProgram(V3V.pr);
  gl.uniformMatrix4fv(V3V.u.uM, false, C.M); gl.uniform3f(V3V.u.uEye, E[0], E[1], E[2]);
  const fog = typeof v3FogR === 'function' ? v3FogR(C) : C.fog || [1e5, 2e5], bg = typeof v3Bg === 'function' ? v3Bg() : [.74, .75, .8];
  gl.uniform2f(V3V.u.uFog, fog[0], fog[1]); gl.uniform3f(V3V.u.uBg, bg[0], bg[1], bg[2]);
  const nt = S && S.night ? [.3, .34, .46] : [1, 1, 1];
  gl.uniform3f(V3V.u.uNt, nt[0], nt[1], nt[2]); gl.uniform3f(V3V.u.uSunC, 1.05, .98, .88); gl.uniform3f(V3V.u.uAmb, .5, .53, .58);
  gl.uniform1i(V3V.u.uT, 0); gl.activeTexture(gl.TEXTURE0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3V.buf);
  const A = V3V.a;
  for (const k of ['p', 'uv', 'k', 'tn']) if (A[k] >= 0) gl.enableVertexAttribArray(A[k]);
  // 按贴图一段段画：排好序的队列里相邻同贴图的合成一批
  let i0 = 0;
  while (i0 < Q.length) {
    const tk = Q[i0].t, T = V3V_TEX[tk];
    let i1 = i0, n = 0;
    while (i1 < Q.length && Q[i1].t === tk) {
      const o = Q[i1++];
      let r, u;
      if (o.ax) {   // 沿一个方向立着（炮口焰顺着炮管）：上 = 方向在画面里的投影，右 = 上 × 视线
        const l = Math.hypot(...o.ax) || 1, ux = o.ax.map(v => v / l), dz = ux[0] * Z0[0] + ux[1] * Z0[1] + ux[2] * Z0[2];
        u = [ux[0] - Z0[0] * dz, ux[1] - Z0[1] * dz, ux[2] - Z0[2] * dz];
        const ul = Math.hypot(...u);
        if (ul < .15) { r = R0; u = U0; } else { u = u.map(v => v / ul); r = [u[1] * Z0[2] - u[2] * Z0[1], u[2] * Z0[0] - u[0] * Z0[2], u[0] * Z0[1] - u[1] * Z0[0]]; }
      } else {
        const c = Math.cos(o.rot), s2 = Math.sin(o.rot);
        r = [R0[0] * c + U0[0] * s2, R0[1] * c + U0[1] * s2, R0[2] * c + U0[2] * s2]; u = [U0[0] * c - R0[0] * s2, U0[1] * c - R0[1] * s2, U0[2] * c - R0[2] * s2];
      }
      const s = o.s, su = s * (o.asp || 1), P = o.p;
      const V = (cx, cy) => { const j = n * NV; D[j] = P[0] + r[0] * cx * s + u[0] * cy * su; D[j + 1] = P[1] + r[1] * cx * s + u[1] * cy * su; D[j + 2] = P[2] + r[2] * cx * s + u[2] * cy * su;
        D[j + 3] = (cx + 1) / 2; D[j + 4] = (1 - cy) / 2; D[j + 5] = o.fr; D[j + 6] = o.a; D[j + 7] = o.e; D[j + 8] = o.lit; D[j + 9] = o.tn[0]; D[j + 10] = o.tn[1]; D[j + 11] = o.tn[2]; D[j + 12] = 0; n++; };
      V(-1, -1); V(1, -1); V(1, 1); V(-1, -1); V(1, 1); V(-1, 1);
    }
    gl.bufferData(gl.ARRAY_BUFFER, D.subarray(0, n * NV), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, NV * 4, 0); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, NV * 4, 12);
    gl.vertexAttribPointer(A.k, 4, gl.FLOAT, false, NV * 4, 20); gl.vertexAttribPointer(A.tn, 3, gl.FLOAT, false, NV * 4, 36);
    gl.bindTexture(gl.TEXTURE_2D, T.u ? V3V_USR[tk].tex : V3V.tex[tk]);
    gl.uniform1f(V3V.u.uN, T.n); gl.uniform1f(V3V.u.uF, T.f); gl.uniform1f(V3V.u.uCol, T.col || 0);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    i0 = i1;
  }
  for (const k of ['p', 'uv', 'k', 'tn']) if (A[k] >= 0) gl.disableVertexAttribArray(A[k]);
  gl.depthMask(true); gl.disable(gl.BLEND);
  Q.length = 0;
}
