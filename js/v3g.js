'use strict';
// 用户给的 3D 模型（tools/v3gbake.js 烘焙成 js/mdl/<键>.js；来源、署名见 docs/credits.md）：几何、贴图、材质原样，带贴图画出来。
//   js/mdl/<键>.js 用到时才加载（插 script 标签，本地 file:// 打开也能用），解码后建顶点 / 索引缓冲、解码贴图，全部就绪才开始画（不闪一下白模）。
//   模型坐标 x 前、y 左、z 上，单位米（v3units.js 按游戏里的尺寸缩放、摆放，实例参数与 v3mAdd 相同）；
//   能动的部件（坦克炮塔、旋翼、起落架）在顶点着色器里绕自己的轴整块转 / 收起（不改网格），每个实例各自的角度。
//   远处换烘焙时减好的简化网格（只是另外的三角形索引，顶点、贴图还是原来的）——屏幕上看得清的时候画的永远是原模型。
//   光照：太阳（V3_SUN）+ 天光 / 地面反光 + 高光，地形投影、爆炸火光、雾与其它模型一致；模型只显示它原来的颜色（不加敌我色）
const V3G = { def: {}, M: {}, want: new Set(), fail: new Set(), tried: false, ok: false, pr: null, a: {}, u: {}, inst: new Map(), ib: null, ext: null, u32: null, aniso: null, der: false, upq: [] };
V3G.add = (key, meta, b64) => { V3G.def[key] = { meta, b64 }; };

function v3gLoad(key) {
  if (typeof document === 'undefined') { V3G.fail.add(key); return; }
  const s = document.createElement('script'), v = typeof window === 'object' && window.DS_BUILD ? '?v=' + encodeURIComponent(window.DS_BUILD) : '';
  s.src = 'js/mdl/' + key + '.js' + v; s.async = true;
  s.onerror = () => { V3G.fail.add(key); console.warn('3D 模型没加载上：' + key); };
  document.head.appendChild(s);
}
// 预先加载（开局时把这一局会用到的模型先下载、解码，免得单位出现时才开始加载）
function v3gPreload(keys) { for (const k of keys) if (k && !V3G.M[k] && !V3G.def[k] && !V3G.want.has(k) && !V3G.fail.has(k)) { V3G.want.add(k); v3gLoad(k); } }

// 模型：就绪返回它，否则开始加载 / 解码、先返回 null
function v3gModel(key) {
  if (V3G.fail.has(key) && typeof V3G_ALT === 'object' && V3G_ALT[key]) return v3gModel(V3G_ALT[key]);
  const M = V3G.M[key];
  if (M) return M.ready ? M : null;
  if (!V3G.ok) return null;
  const D = V3G.def[key];
  if (!D) { if (!V3G.want.has(key) && !V3G.fail.has(key)) { V3G.want.add(key); v3gLoad(key); } return null; }
  V3G.M[key] = { key, meta: D.meta, ready: false };
  v3gDecode(key, D).catch(e => { console.warn('3D 模型解码失败：' + key, e); V3G.fail.add(key); });
  return null;
}
async function v3gBytes(b64) {
  try { const r = await fetch('data:application/octet-stream;base64,' + b64); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (e) { /* 有的环境不让 fetch data: 地址，下面逐字节解 */ }
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function v3gDecode(key, D) {
  const gl = V3G.gl, m = D.meta, M = V3G.M[key], bin = await v3gBytes(D.b64);
  delete D.b64;   // 几十兆的字符串，解完就放掉
  if (m.it === 4 && !V3G.u32) throw new Error('显卡不支持 32 位索引');
  const VB = new Float32Array(bin.buffer, bin.byteOffset + m.vb[0], m.vb[1] / 4), IB = m.it === 4 ? new Uint32Array(bin.buffer, bin.byteOffset + m.ib[0], m.ib[1] / 4) : new Uint16Array(bin.buffer, bin.byteOffset + m.ib[0], m.ib[1] / 2);
  M.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, VB, gl.STATIC_DRAW);
  M.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IB, gl.STATIC_DRAW);
  // 包围球半径（选远近网格、远处带本方颜色用）、影子用的包围盒（v3light.js 的格式：x0 x1 y0 y1 z0 z1）
  const b = m.bb;
  M.rad = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2; M.sbb = [b[0], b[3], b[1], b[4], b[2], b[5]];
  // 贴图：原图字节解码后上传；全部好了才算就绪
  M.tex = await Promise.all(m.imgs.map(I => v3gImage(bin.subarray(I.o, I.o + I.n), I.m)));
  M.mats = m.mats.map(x => Object.assign({}, x));
  // 部件转轴单位化
  M.parts = (m.parts || []).map(p => { const l = Math.hypot(...p.a) || 1; return { ...p, a: p.a.map(v => v / l) }; });
  M.ready = true;
}
// 图片 → 贴图（等到下一帧再上传，免得几十张图挤在同一帧）
async function v3gImage(bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  let img;
  if (typeof createImageBitmap === 'function') {
    try { img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { img = null; }
  }
  if (!img) img = await new Promise((ok, no) => { const u = URL.createObjectURL(blob), I = new Image(); I.onload = () => { URL.revokeObjectURL(u); ok(I); }; I.onerror = no; I.src = u; });
  return new Promise(ok => V3G.upq.push(() => ok(v3gUpload(img))));
}
function v3gUpload(img) {
  const gl = V3G.gl, t = gl.createTexture(), max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, 4096);
  let src = img, w = img.width, h = img.height;
  const pot = n => 2 ** Math.round(Math.log2(Math.max(1, n)));
  // WebGL1：非 2 的幂的图不能生成多级渐远、不能平铺——画到 2 的幂大小的画布上再传（超过显卡上限的同样缩一下）
  if ((w & (w - 1)) || (h & (h - 1)) || w > max || h > max) {
    const W2 = Math.min(pot(w), max), H2 = Math.min(pot(h), max), cv = document.createElement('canvas');
    cv.width = W2; cv.height = H2; cv.getContext('2d').drawImage(img, 0, 0, W2, H2); src = cv; w = W2; h = H2;
  }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (V3G.aniso) gl.texParameterf(gl.TEXTURE_2D, V3G.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(V3G.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
  if (img.close) try { img.close(); } catch (e) { /* 已经关了 */ }
  return t;
}

// ———————————————— 着色器 ————————————————
// 实例：iA = (x, y, z, 朝向)，iB = (比例, 阵营, 滚转, 俯仰)，与 v3units.js 的 v3mAdd 相同（GL 坐标，y 向北）；iC = 四个部件的角度（收起的部件 > .5 就收）
const V3G_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 uv; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
uniform mat4 uM; uniform vec3 uEye; uniform float uPk, uPm, uRad, uPx; uniform vec3 uPp, uPa;
varying vec3 vN, vV, vP; varying vec2 vUv, vW; varying float vSide, vD;
vec3 rotA(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1. - c); }
void main() {
  vec3 q = p, m = n;
  if (uPk > -.5) {
    float ang = uPk < .5 ? iC.x : uPk < 1.5 ? iC.y : uPk < 2.5 ? iC.z : iC.w;
    if (uPm > .5) { if (ang > .5) q = uPp; }
    else { q = uPp + rotA(q - uPp, uPa, ang); m = rotA(m, uPa, ang); }
  }
  q *= iB.x;
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z), cp = cos(iB.w), sp = sin(iB.w);
  q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr); q = vec3(q.x * cp - q.z * sp, q.y, q.x * sp + q.z * cp);
  m = vec3(m.x, m.y * cr - m.z * sr, m.y * sr + m.z * cr); m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vUv = uv; vSide = iB.y; vV = uEye - w; vD = length(vV); vW = w.xy; vP = w;
  gl_Position = uM * vec4(w, 1.);
}`;
const V3G_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}${typeof V3_PREC === 'string' ? V3_PREC : 'precision mediump float;'}
uniform vec4 uC, uSG, uTf, uTf2; uniform vec2 uMR; uniform vec3 uE; uniform float uNs, uAm, uAc;
uniform sampler2D uTb, uTn, uTm, uTe, uTo, uLm;
uniform vec2 uFog, uWorld; uniform vec3 uBg; uniform float uLmOn;
varying vec3 vN, vV, vP; varying vec2 vUv, vW; varying float vSide, vD;
${typeof V3L_BOOM_GLSL === 'string' ? V3L_BOOM_GLSL : 'vec3 boomLight(vec2 w) { return vec3(0.); }'}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec4 base = uC;
  if (uTf.x > .5) { vec4 t = texture2D(uTb, vUv); base *= vec4(lin(t.rgb), t.a); }
  if (uAm > .5 && uAm < 1.5 && base.a < uAc) discard;
  vec3 N = normalize(vN), V = normalize(vV);
  if (dot(N, V) < 0.) N = -N;   // 背面朝着镜头（双面的薄片、法线朝里的面）：翻过来照
#ifdef DER
  if (uTf.y > .5) {   // 法线贴图：不用切线，按屏幕导数现算切空间
    vec3 tn = texture2D(uTn, vUv).xyz * 2. - 1.; tn.xy *= uNs;
    vec3 d1 = dFdx(vP), d2 = dFdy(vP); vec2 t1 = dFdx(vUv), t2 = dFdy(vUv);
    vec3 p2 = cross(d2, N), p1 = cross(N, d1), T = p2 * t1.x + p1 * t2.x, B = p2 * t1.y + p1 * t2.y;
    float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
    vec3 Nn = normalize(T * im * tn.x + B * im * tn.y + N * tn.z);
    if (dot(Nn, Nn) > .5) N = Nn;
  }
#endif
  float metal = uMR.x, rough = uMR.y;
  vec3 F0;
  if (uSG.w >= 0.) {   // 镜面光泽流程：高光颜色 + 光泽度（贴图 RGB 高光、A 光泽）
    vec3 sc = uSG.rgb; float g = uSG.w;
    if (uTf.z > .5) { vec4 t = texture2D(uTm, vUv); sc *= lin(t.rgb); g *= t.a; }
    F0 = sc; rough = 1. - g; metal = 0.;
  } else {
    if (uTf.z > .5) { vec4 t = texture2D(uTm, vUv); rough *= t.g; metal *= t.b; }
    F0 = mix(vec3(.04), base.rgb, metal);
  }
  rough = clamp(rough, .04, 1.);
  vec3 diff = base.rgb * (1. - metal);
  float ao = uTf2.y > .5 ? texture2D(uTo, vUv).r : 1.;
  vec3 L = ${V3_SUNG}, H = normalize(L + V);
  float ndl = max(dot(N, L), 0.), ndv = max(dot(N, V), 0.);
  float shd = uLmOn > .5 ? mix(.45, 1., texture2D(uLm, vec2(vW.x, -vW.y) / uWorld).r) : 1.;
  float a2 = rough * rough, sh = clamp(2. / max(a2 * a2, 1e-4) - 2., 1., 4096.);
  float spec = pow(max(dot(N, H), 0.), sh) * (sh + 2.) / 8.;
  vec3 Fr = F0 + (1. - F0) * pow(1. - max(dot(H, V), 0.), 5.);
  vec3 sunC = vec3(1., .96, .9) * 2.6, sky = mix(vec3(.05, .055, .055), vec3(.3, .32, .34), N.z * .5 + .5);
  vec3 env = mix(vec3(.04, .045, .045), vec3(.34, .36, .38), clamp(reflect(-V, N).z * .5 + .5, 0., 1.));   // 金属反射的环境：上亮下暗
  vec3 c = diff * (sky * ao + sunC * ndl * shd) + Fr * spec * sunC * ndl * shd + env * (F0 + (1. - F0) * pow(1. - ndv, 5.) * (1. - rough)) * ao * (.35 + .65 * metal);
  c += uE * (uTf2.x > .5 ? lin(texture2D(uTe, vUv).rgb) : vec3(1.));
  c += boomLight(vec2(vW.x, -vW.y)) * diff * (.4 + .6 * ndl);   // 近处爆炸的火光
  if (vSide > 1.5 && vSide < 2.5) c *= .2;   // 残骸：烧黑
  c = pow(max(c, 0.), vec3(1. / 2.2));
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), uAm > 1.5 ? base.a : 1.);
}`;
function v3gInit(gl) {
  V3G.tried = true; V3G.gl = gl;
  try {
    V3G.ext = gl.getExtension('ANGLE_instanced_arrays');
    V3G.u32 = gl.getExtension('OES_element_index_uint');
    V3G.der = !!gl.getExtension('OES_standard_derivatives');
    V3G.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (!V3G.ext) throw new Error('没有实例化扩展');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3G_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3G_FS(V3G.der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3G.pr = pr;
    for (const k of ['p', 'n', 'uv', 'iA', 'iB', 'iC']) V3G.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uPk', 'uPm', 'uPp', 'uPa', 'uRad', 'uPx', 'uC', 'uSG', 'uTf', 'uTf2', 'uMR', 'uE', 'uNs', 'uAm', 'uAc', 'uTb', 'uTn', 'uTm', 'uTe', 'uTo', 'uLm', 'uFog', 'uWorld', 'uBg', 'uLmOn', 'uBm']) V3G.u[k] = gl.getUniformLocation(pr, k);
    V3G.ib = gl.createBuffer();
    V3G.ok = true;
  } catch (e) { V3G.ok = false; console.warn('贴图模型不可用', e); }
}

// ———————————————— 每帧：收集实例 → 画 ————————————————
// 一帧开始（v3units.js v3Units 开头）
function v3gBegin(C) {
  if (!V3G.tried && typeof V3 === 'object' && V3.gl) v3gInit(V3.gl);
  for (const L of V3G.inst.values()) L.n = 0;
  V3G.C = C; V3G.frame = (V3G.frame || 0) + 1;
  V3G.px = (typeof CAM === 'object' ? CAM.vh : 768) / 2 / Math.tan((typeof V3_FOV === 'number' ? V3_FOV : .8) / 2);   // 1 米在 1 米外占多少像素
  for (let i = 0; i < 6 && V3G.upq.length; i++) V3G.upq.shift()();   // 每帧最多上传几张贴图
}
// 一个实例。模型还没好返回 false。parts：四个部件角度（坦克炮塔相对车身的转角、旋翼转角、起落架收起 1 …）
function v3gAdd(key, x, y, z, a, k, side, roll = 0, pitch = 0, parts = null) {
  const M = v3gModel(key);
  if (!M) return false;
  const C = V3G.C, E = C ? C.E : [x, -y, z + 100], d = Math.hypot(x - E[0], -y - E[1], z - E[2]), px = M.rad * k / Math.max(d, 1) * V3G.px;
  const lod = Math.min(M.meta.lod.length - 1, px > 70 ? 0 : px > 22 ? 1 : 2), ik = key + '#' + lod;
  let L = V3G.inst.get(ik);
  if (!L) V3G.inst.set(ik, L = { M, lod, d: new Float32Array(12 * 16), n: 0 });
  if ((L.n + 1) * 12 > L.d.length) { const d2 = new Float32Array(L.d.length * 2); d2.set(L.d); L.d = d2; }
  const o = L.n * 12;
  L.d[o] = x; L.d[o + 1] = -y; L.d[o + 2] = z; L.d[o + 3] = -a; L.d[o + 4] = k; L.d[o + 5] = side; L.d[o + 6] = roll; L.d[o + 7] = pitch;
  L.d[o + 8] = parts ? parts[0] || 0 : 0; L.d[o + 9] = parts ? parts[1] || 0 : 0; L.d[o + 10] = parts ? parts[2] || 0 : 0; L.d[o + 11] = parts ? parts[3] || 0 : 0;
  L.n++;
  return true;
}
// 地面软阴影（v3light.js）：v3Units 收集完其它模型的影子后调用
function v3gShadows() {
  if (typeof v3ShadowAdd !== 'function') return;
  for (const L of V3G.inst.values()) { if (V3G_NOSH.test(L.M.key)) continue; for (let i = 0; i < L.n; i++) { const o = i * 12; v3ShadowAdd(L.d[o], -L.d[o + 1], L.d[o + 2], -L.d[o + 3], L.d[o + 4], L.M.sbb, false); } }
}
// 画：先画不透明、镂空的，再画半透明的（不写深度）
function v3gDraw(C) {
  if (!V3G.ok) return;
  let any = false;
  for (const L of V3G.inst.values()) if (L.n) { any = true; break; }
  if (!any) return;
  const gl = V3G.gl, A = V3G.a, U = V3G.u, X = V3G.ext;
  gl.useProgram(V3G.pr);
  gl.uniformMatrix4fv(U.uM, false, C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof V3_BG === 'object' ? V3_BG : [.63, .69, .75])); gl.uniform2f(U.uWorld, W, H); gl.uniform1f(U.uPx, V3G.px);
  const lmOn = typeof v3LightBind === 'function' && v3LightBind(gl);
  gl.uniform1i(U.uLm, lmOn ? V3L.unit : 0); gl.uniform1f(U.uLmOn, lmOn ? 1 : 0);
  if (U.uBm && typeof V3L_BM === 'object') gl.uniform4fv(U.uBm, V3L_BM);
  gl.uniform1i(U.uTb, 0); gl.uniform1i(U.uTn, 1); gl.uniform1i(U.uTm, 2); gl.uniform1i(U.uTe, 3); gl.uniform1i(U.uTo, 4);
  const tex = (u, t) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t || null); };
  const wrap = (t, w) => { if (!t) return; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); const m = [gl.REPEAT, gl.CLAMP_TO_EDGE, gl.MIRRORED_REPEAT]; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, m[w[1]] || gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, m[w[2]] || gl.REPEAT); };
  for (const pass of [0, 1]) {
    if (pass) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    for (const L of V3G.inst.values()) {
      if (!L.n) continue;
      const M = L.M, m = M.meta, st = m.st * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, M.vb);
      gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, st, 24);
      gl.bindBuffer(gl.ARRAY_BUFFER, V3G.ib); gl.bufferData(gl.ARRAY_BUFFER, L.d.subarray(0, L.n * 12), gl.DYNAMIC_DRAW);
      for (const [k, o] of [['iA', 0], ['iB', 16], ['iC', 32]]) { gl.enableVertexAttribArray(A[k]); gl.vertexAttribPointer(A[k], 4, gl.FLOAT, false, 48, o); X.vertexAttribDivisorANGLE(A[k], 1); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
      gl.uniform1f(U.uRad, M.rad);
      const it = m.it === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      for (const [mi, pi, i0, cnt] of m.lod[L.lod]) {
        const T = M.mats[mi];
        if ((T.am === 2) !== !!pass) continue;
        const P = pi >= 0 ? M.parts[pi] : null;
        gl.uniform1f(U.uPk, P ? pi : -1);
        if (P) { gl.uniform1f(U.uPm, P.k === 'hide' ? 1 : 0); gl.uniform3f(U.uPp, P.p[0], P.p[1], P.p[2]); gl.uniform3f(U.uPa, P.a[0], P.a[1], P.a[2]); }
        const tb = T.t && M.tex[T.t[0]], tn = T.nt && M.tex[T.nt[0]], tm = (T.sg ? T.sgt : T.mrt) && M.tex[(T.sg ? T.sgt : T.mrt)[0]], te = T.et && M.tex[T.et[0]], to = T.ot && M.tex[T.ot[0]];
        if (tb) wrap(tb, T.t);
        tex(0, tb); tex(1, tn); tex(2, tm); tex(3, te); tex(4, to);
        gl.uniform4f(U.uTf, tb ? 1 : 0, tn ? 1 : 0, tm ? 1 : 0, 0); gl.uniform4f(U.uTf2, te ? 1 : 0, to ? 1 : 0, 0, 0);
        gl.uniform4f(U.uC, T.c[0], T.c[1], T.c[2], T.c[3]); gl.uniform2f(U.uMR, T.mr[0], T.mr[1]); gl.uniform3f(U.uE, T.e[0], T.e[1], T.e[2]);
        if (T.sg) gl.uniform4f(U.uSG, T.sg[0], T.sg[1], T.sg[2], T.sg[3]); else gl.uniform4f(U.uSG, 0, 0, 0, -1);
        gl.uniform1f(U.uNs, T.ns ?? 1); gl.uniform1f(U.uAm, T.am); gl.uniform1f(U.uAc, T.ac ?? .5);
        X.drawElementsInstancedANGLE(gl.TRIANGLES, cnt, it, i0 * m.it, L.n);
      }
      for (const k of ['iA', 'iB', 'iC']) { X.vertexAttribDivisorANGLE(A[k], 0); gl.disableVertexAttribArray(A[k]); }
    }
    if (pass) { gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  for (const k of ['p', 'n', 'uv']) gl.disableVertexAttribArray(A[k]);
  for (let u = 4; u >= 0; u--) tex(u, null);
}

// ———————————————— 兵种 → 模型 ————————————————
// 用户给了模型的兵种直接用；没给的先用同类里最接近的一个代替（换模型只改这几张表）。键：车辆是 models.js 的 RLM 型号，飞机是 airSilKey / eair 的机型键
const V3G_VEH = { ztz96b: 'ztz96', ztz96m: 'ztz96', m1a1: 'm1a1', m1a2: 'm1a1' };
const v3gVehKey = (rk, side) => V3G_VEH[rk] || (side === 'e' ? 'm1a1' : 'ztz96');   // 其余装甲车：解放军的用 96 式、美军的用 M1A1 代替
const V3G_AIR = {
  j20: 'j20', j35: 'j31', j16: 'j16', j15: 'j16', z10: 'z10w',   // 有模型（歼-35 用它的原型歼-31）
  j36: 'j20', j50: 'j31', gj11: 'j31', gj2: 'j31', wz7: 'j31', kj600: 'j16', h6k: 'j16', y20: 'j16', transport: 'j16', heli: 'z21',   // 我方其余机型：代替
  f22: 'j20', f35: 'j31', f35b: 'j31', a10: 'j16', mq9: 'j31', b2: 'j20', c17: 'j16', p8: 'j16', ah64: 'z21', uh60: 'z21'   // 美军：还没有模型，先用这几架代替
};
// 导弹（v3msl.js V3MS 的型号）→ 模型：AIM-120C、AIM-9 用单独的精细模型，其余按外形从导弹组合里挑
const V3G_MSL = {
  aim120: 'aim120', aim9: 'aim9', agm65: 'agm65', bomb: 'mk83', agm: 'brimstone', pl15: 'aim120s', pl10: 'asraam', pl17: 'ks172', ld10: 'aim120s', manpad: 'aim9s',
  hhq9: 'ks172', sm6: 'ks172', hhq16: 'aim54', hhq10: 'asraam', yj21: 'ks172', tbm: 'ks172', df15: 'ks172', sdb: 'gbu24', pod: 'gbu24'
};
const v3gMslKey = k => V3G_MSL[k] || 'jsow';   // 反舰、巡航导弹（鹰击、长剑、鱼叉、战斧、LRASM …）：AGM-154 那种带弹翼的弹形
const V3G_NOSH = /^(aim|agm|ks|asraam|gbu|mk8|jsow|brim)/;   // 导弹太小，不投地面影子

// 车辆：车体按脚下坡度俯仰、侧倾，炮塔（模型里的 tur 部件）相对车体转到瞄准方向；按游戏里的车长（车体，不算炮管）缩放
function v3gVeh(v, rk, side, len, x, y, z, h, aim, dead, pitch, roll) {
  const key = v3gVehKey(rk, side), M = v3gModel(key);
  if (!M) return false;
  const k = len / (M.meta.hl || M.meta.len), da = aim == null ? 0 : -Math.atan2(Math.sin(aim - h), Math.cos(aim - h));   // 部件角度在模型坐标里（逆时针为正，世界朝向顺时针为正）
  return v3gAdd(key, x, y, z, h, k, dead ? 2 : side === 'e' ? 1 : 0, roll, pitch, [dead ? -.6 : da, 0, 0, 0]);
}
// 飞机（机型键 key，游戏里的尺寸 sz）：ground 时 z 是地面 / 甲板（机轮着地），否则 z 是机身中线；起落架只在 gear 时放下；直升机旋翼转
const v3dMv3 = (h, p, r, v) => {   // 先滚转（绕 x）、再俯仰（绕 y，机头抬起为正）、再转朝向（GL：绕 z 转 -h），与着色器同一约定
  let [x, y, z] = v, c = Math.cos(r), s = Math.sin(r);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(p); s = Math.sin(p);
  [x, z] = [x * c - z * s, x * s + z * c];
  c = Math.cos(-h); s = Math.sin(-h);
  return [x * c - y * s, x * s + y * c, z];
};
function v3gPlane(key, sz, x, y, z, ground, h, side, roll, pitch, gear, t) {
  const mk = V3G_AIR[key] || 'j31', M = v3gModel(mk);
  if (!M) return false;
  const k = sz / M.meta.len;
  let ox = x, oy = y, oz = z;
  if (!ground) { const o = v3dMv3(h, pitch, roll, [0, 0, M.meta.zc * k]); ox -= o[0]; oy += o[1]; oz -= o[2]; }   // 绕机身中线俯仰、滚转（模型原点在机轮着地处）
  const P = [0, 0, 0, 0];
  M.parts.forEach((p, i) => { if (p.n === 'gear') P[i] = gear ? 0 : 1; else if (p.n === 'rotor') P[i] = (t || 0) * 22; else if (p.n === 'trotor') P[i] = (t || 0) * 61; });
  return v3gAdd(mk, ox, oy, oz, h, k, side, roll, pitch, P);
}
// 导弹：model 型号键（V3MS），sc 世界单位 / 米（v3MslK 等）；按这一型的真实长度缩放模型
function v3gMsl(mk, x, y, z, h, sc, side, pitch = 0) {
  const key = v3gMslKey(mk), M = v3gModel(key);
  if (!M) return false;
  const L = typeof V3MS === 'object' && V3MS[mk] ? V3MS[mk].L : M.meta.len;
  return v3gAdd(key, x, y, z, h, sc * L / M.meta.len, side, 0, pitch);
}
const V3G_HELI = { z10: 1, heli: 1, ah64: 1, uh60: 1 };   // 直升机（不按航迹抬头）
// 飞机机身中线离机轮着地处多高（世界单位）
function v3gPlaneZc(key, sz) { const M = V3G.M[V3G_AIR[key] || 'j31']; return M && M.ready ? M.meta.zc * sz / M.meta.len : sz * .12; }
// 授权只允许非商用的模型（直-21）商店版里不带（tools/build_www.mjs --app）：加载不到就换成同类的另一个
const V3G_ALT = { z21: 'z10w' };
// 开局就把一定会用到的模型先下载、解码（士兵、双方坦克），别的等单位第一次出现时再加载
if (typeof HOOK === 'object' && HOOK.newGame) HOOK.newGame.push(() => v3gPreload(['army', 'ztz96', 'm1a1']));
// 士兵：用户给的士兵模型原样摆放（T 字站姿，不改模型）；卧倒、匍匐、阵亡时整个放平（脸朝下），别的姿势都站着。k 比例（V3_MAN 一类），side 0 我 / 1 敌 / 2 遗体
const v3gLying = p => p === 'pr' || p === 'dead' || p[0] === 'c' && p !== 'cl0' && p !== 'cl1' || (p[0] === 'L' && +p.slice(1) >= 12);
function v3gMan(kind, pose, x, y, z, a, k, side, roll = 0) {
  const M = v3gModel('army');
  if (!M) return false;
  if (!v3gLying(pose || 'st')) return v3gAdd('army', x, y, z, a, k, side, roll, 0);
  const b = M.meta.bb, h = (b[5] - b[2]) * k, c = Math.cos(a), s = Math.sin(a);   // 放平：绕横轴转 −90°（头朝前、背朝上），身体中点放在原地
  return v3gAdd('army', x - c * h / 2, y - s * h / 2, z + b[3] * k, a, k, side, 0, -Math.PI / 2);
}
