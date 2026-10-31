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
  const R = v3gPrep(key, m, M, VB, IB);   // 座舱显示屏、平显外框、尾喷口、舵面、弹舱（v3gPrep）：上传缓冲区之前改顶点、索引；切弹舱会换成更长的新数组
  if (R && R.it === 4 && !V3G.u32) throw new Error('显卡不支持 32 位索引');
  M.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, R ? R.VB : VB, gl.STATIC_DRAW);
  M.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, R ? R.IB : IB, gl.STATIC_DRAW);
  // 包围球半径（选远近网格、远处带本方颜色用）、影子用的包围盒（v3light.js 的格式：x0 x1 y0 y1 z0 z1）
  const b = m.bb;
  M.rad = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2; M.sbb = [b[0], b[3], b[1], b[4], b[2], b[5]];
  // 贴图：原图字节解码后上传；全部好了才算就绪
  M.tex = await Promise.all(m.imgs.map(I => v3gImage(bin.subarray(I.o, I.o + I.n), I.m)));
  M.mats = m.mats.map(x => Object.assign({}, x));
  // 部件转轴单位化
  const un = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
  M.parts = (m.parts || []).map(p => ({ ...p, a: un(p.a), ...(p.a2 ? { a2: un(p.a2) } : {}), ...(p.r ? { r: un(p.r) } : {}), ...(p.a3 ? { a3: un(p.a3) } : {}) }));
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
  const gl = V3G.gl, t = gl.createTexture(), max = V3G.maxT || (V3G.maxT = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, 4096));   // 显卡参数只查一次：getParameter 要等显卡把手头的活干完（每张贴图查一次，加载时一卡一卡）
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
  if (V3G.aniso) gl.texParameterf(gl.TEXTURE_2D, V3G.aniso.TEXTURE_MAX_ANISOTROPY_EXT, V3G.anMax || (V3G.anMax = Math.min(8, gl.getParameter(V3G.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1)));
  if (img.close) try { img.close(); } catch (e) { /* 已经关了 */ }
  return t;
}

// ———————————————— 着色器 ————————————————
// 实例：iA = (x, y, z, 朝向)，iB = (比例, 阵营, 滚转, 俯仰)，与 v3units.js 的 v3mAdd 相同（GL 坐标，y 向北）；iC、iD = 八个部件参数（收起的部件 > .5 就收；飞机 iD 是弹舱门开度，坦克 iC.yzw、iD.x 是炸掉的反应装甲块、iD.z 炮管后坐）
const V3G_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 uv; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD;
uniform mat4 uM; uniform vec3 uEye; uniform float uPk, uPm, uRad, uPx, uPl; uniform vec3 uPp, uPa, uPq, uPa2, uPr, uPq3, uPa3; uniform vec4 uPw, uPw2, uPe, uPe2, uPg2;
varying vec3 vN, vV, vP; varying vec2 vUv, vW; varying float vSide, vD;
${typeof V3_SHV === 'string' ? V3_SHV : 'uniform mat4 uShM; varying vec4 vSh;'}
vec3 rotA(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1. - c); }
void main() {
  vec3 q = p, m = n;
  if (uPk > -.5) {
    float ang = dot(iC, uPw) + dot(iD, uPw2);   // 实例的部件参数按权重组合（一般只取自己那一个；舵面 = 俯仰 + 滚转差动；弹舱门 = 开度 × 打开角）
    if (uPm > 4.5) {   // 链式部件（炮管、发射架、炮塔上的雷达，vfn.js）：先绕自己的轴自转（加特林炮管束，uPq3 / uPa3，iD·uPg2），再沿 uPr 平移（后坐 / 举升，iD·uPw2 米），再绕 uPq / uPa2 转（俯仰、起竖、自转），最后随炮塔 / 转台绕 uPp / uPa 转
      if (uPl > 1.5) { float mk = iD.z; for (int i = 0; i < 16; i++) { if (float(i) >= uPl - 2.) break; mk = floor(mk * .5); } if (mk - 2. * floor(mk * .5) > .5) q = vec3(0.); }   // 发射筒里的弹（v3gCaps）：iD.z 的第 uPl − 2 位 = 这一枚打出去了，筒空了
      float g3 = dot(iD, uPg2);
      q = uPq3 + rotA(q - uPq3, uPa3, g3); m = rotA(m, uPa3, g3);
      q -= uPr * dot(iD, uPw2);
      float e2 = dot(iC, uPe) + dot(iD, uPe2);
      q = uPq + rotA(q - uPq, uPa2, e2); m = rotA(m, uPa2, e2);
      float ya = dot(iC, uPw);
      q = uPp + rotA(q - uPp, uPa, ya); m = rotA(m, uPa, ya);
    }
    else if (uPm > 3.5) {   // 反应装甲块（v3gEra）：|y| 里编着块号 t，查 iC.yzw / iD.x 里这块的位（各管 16 块），炸掉了就收成一点（整数运算，全是精确的）
      float t = floor((abs(q.y) - uPp.x) / uPp.y + .5), f = floor((t + .5) / 16.), b = t - f * 16., mk = f < .5 ? iC.y : f < 1.5 ? iC.z : f < 2.5 ? iC.w : iD.x;
      for (int i = 0; i < 16; i++) { if (float(i) >= b) break; mk = floor(mk * .5); }
      if (mk - 2. * floor(mk * .5) > .5) q = vec3(0.);
    }
    else if (uPm > 2.5) {   // 坦克炮管：先顺着炮管往后坐（iD·uPw2 米），再随炮塔转（iC·uPw）
      float ya = dot(iC, uPw); q.x -= dot(iD, uPw2); q = uPp + rotA(q - uPp, uPa, ya); m = rotA(m, uPa, ya);
    }
    else if (uPm > 1.5) {   // 尾喷口调节片：绕前缘铰链张开（ang > 0）/ 收拢（ang < 0）——离铰链越远（越靠出口）径向缩放越多
      vec3 d = q - uPp; float ax = dot(d, uPa); q = uPp + uPa * ax + (d - uPa * ax) * (1. + ang * clamp(-ax / max(uPl, .01), 0., 1.));
    }
    else if (uPm > .5) { if (ang > .5) q = uPp; }
    else { q = uPp + rotA(q - uPp, uPa, ang); m = rotA(m, uPa, ang); }
  }
  q *= iB.x;
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z), cp = cos(iB.w), sp = sin(iB.w);
  q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr); q = vec3(q.x * cp - q.z * sp, q.y, q.x * sp + q.z * cp);
  m = vec3(m.x, m.y * cr - m.z * sr, m.y * sr + m.z * cr); m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vUv = uv; vSide = iB.y; vV = uEye - w; vD = length(vV); vW = w.xy; vP = w; vSh = uShM * vec4(w, 1.);
  gl_Position = uM * vec4(w, 1.);
}`;
const V3G_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}${typeof V3_PREC === 'string' ? V3_PREC : 'precision mediump float;'}
uniform vec4 uC, uSG, uTf, uTf2; uniform vec2 uMR; uniform vec3 uE; uniform float uNs, uAm, uAc;
uniform sampler2D uTb, uTn, uTm, uTe, uTo, uLm;
uniform vec2 uFog, uWorld; uniform vec3 uBg, uHlC; uniform float uLmOn, uMx, uHl;
varying vec3 vN, vV, vP; varying vec2 vUv, vW; varying float vSide, vD;
${typeof V3_SHF === 'string' ? V3_SHF : 'float shadowAt() { return 1.; }'}
${typeof V3L_BOOM_GLSL === 'string' ? V3L_BOOM_GLSL : 'vec3 boomLight(vec2 w) { return vec3(0.); }'}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  float hl = step(7.5, vSide), sd = vSide - 8. * hl;   // 阵营 + 8：选中编队的成员（selfx.js），整个发光
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
  float shd = uLmOn > .5 ? mix(.45, 1., texture2D(uLm, vec2(vW.x, -vW.y) / uWorld).r) : shadowAt();   // 黑绿画面：烘焙的光照贴图（v3light.js）；写实画面：实时太阳阴影（view3d.js）
  float a2 = rough * rough, sh = clamp(2. / max(a2 * a2, 1e-4) - 2., 1., 4096.);
  float spec = pow(max(dot(N, H), 0.), sh) * (sh + 2.) / 8.;
  vec3 Fr = F0 + (1. - F0) * pow(1. - max(dot(H, V), 0.), 5.);
  vec3 sunC = vec3(1., .96, .9) * 2.6, sky = mix(vec3(.05, .055, .055), vec3(.3, .32, .34), N.z * .5 + .5);
  vec3 env = mix(vec3(.04, .045, .045), vec3(.34, .36, .38), clamp(reflect(-V, N).z * .5 + .5, 0., 1.));   // 金属反射的环境：上亮下暗
  vec3 c = diff * (sky * ao + sunC * ndl * shd) + Fr * spec * sunC * ndl * shd + env * (F0 + (1. - F0) * pow(1. - ndv, 5.) * (1. - rough)) * ao * (.35 + .65 * metal);
  c += uE * (uTf2.x > .5 ? lin(texture2D(uTe, vUv).rgb) : vec3(1.));
  c += boomLight(vec2(vW.x, -vW.y)) * diff * (.4 + .6 * ndl);   // 近处爆炸的火光
  if (sd > 1.5 && sd < 2.5) c *= .2;   // 残骸：烧黑
  c = pow(max(c, 0.), vec3(1. / 2.2));
  if (uMx > .5) c = (sd > .5 && sd < 1.5 ? vec3(1., .3, .38) : vec3(.32, 1., .58)) * dot(c, vec3(.3, .59, .11)) * .6;   // 黑绿画面：按明暗换成磷光的单色（敌方红）
  c += uHlC * uHl * hl * (.3 + .7 * pow(1. - ndv, 2.));
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
    for (const k of ['p', 'n', 'uv', 'iA', 'iB', 'iC', 'iD']) V3G.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uPk', 'uPm', 'uPl', 'uPp', 'uPa', 'uPw', 'uPw2', 'uPq', 'uPa2', 'uPr', 'uPe', 'uPe2', 'uPq3', 'uPa3', 'uPg2', 'uRad', 'uPx', 'uC', 'uSG', 'uTf', 'uTf2', 'uMR', 'uE', 'uNs', 'uAm', 'uAc', 'uTb', 'uTn', 'uTm', 'uTe', 'uTo', 'uLm', 'uFog', 'uWorld', 'uBg', 'uLmOn', 'uBm', 'uMx', 'uHl', 'uHlC', 'uShM', 'uShT', 'uShOn', 'uShP']) V3G.u[k] = gl.getUniformLocation(pr, k);
    V3G.ib = gl.createBuffer();
    V3G.ok = true;
  } catch (e) { V3G.ok = false; console.warn('贴图模型不可用', e); }
}

// ———————————————— 每帧：收集实例 → 画 ————————————————
// 一帧开始（v3units.js v3mCollect 开头）
function v3gBegin(C) {
  if (!V3G.tried && typeof V3 === 'object' && V3.gl) v3gInit(V3.gl);
  for (const L of V3G.inst.values()) L.n = 0;
  V3G.C = C; V3G.frame = (V3G.frame || 0) + 1;
  V3G.px = (typeof CAM === 'object' ? CAM.vh : 768) / 2 / Math.tan((typeof V3_FOV === 'number' ? V3_FOV : .8) / 2);   // 1 米在 1 米外占多少像素
  { const t0 = performance.now(); while (V3G.upq.length && performance.now() - t0 < 4) V3G.upq.shift()(); }   // 每帧上传贴图最多约 4 毫秒（至少一张）：大贴图连传六张会卡一下
}
// 一个实例。模型还没好返回 false。parts：四个部件角度（坦克炮塔相对车身的转角、旋翼转角、起落架收起 1 …）
function v3gAdd(key, x, y, z, a, k, side, roll = 0, pitch = 0, parts = null) {
  const M = v3gModel(key);
  if (!M) return false;
  const C = V3G.C, E = C ? C.E : [x, -y, z + 100], d = Math.hypot(x - E[0], -y - E[1], z - E[2]), px = M.rad * k / Math.max(d, 1) * V3G.px;
  const lod = Math.min(M.meta.lod.length - 1, px > 70 ? 0 : px > 22 ? 1 : 2), ik = key + '#' + lod;
  let L = V3G.inst.get(ik);
  if (!L) V3G.inst.set(ik, L = { M, lod, d: new Float32Array(16 * 16), n: 0 });
  if ((L.n + 1) * 16 > L.d.length) { const d2 = new Float32Array(L.d.length * 2); d2.set(L.d); L.d = d2; }
  const o = L.n * 16;
  L.d[o] = x; L.d[o + 1] = -y; L.d[o + 2] = z; L.d[o + 3] = -a; L.d[o + 4] = k; L.d[o + 5] = side; L.d[o + 6] = roll; L.d[o + 7] = pitch;
  for (let i = 0; i < 8; i++) L.d[o + 8 + i] = parts ? parts[i] || 0 : 0;
  L.n++;
  return true;
}
// 画：先画不透明、镂空的，再画半透明的（不写深度）。LM：太阳阴影图的光源矩阵（view3d.js v3ShPass 那一遍只写深度，半透明的不投影）
function v3gDraw(C, LM) {
  if (!V3G.ok) return;
  let any = false;
  for (const L of V3G.inst.values()) if (L.n) { any = true; break; }
  if (!any) return;
  const gl = V3G.gl, A = V3G.a, U = V3G.u, X = V3G.ext;
  gl.useProgram(V3G.pr);
  gl.uniformMatrix4fv(U.uM, false, LM || C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.74, .75, .8])); gl.uniform2f(U.uWorld, W, H); gl.uniform1f(U.uPx, V3G.px);
  const mx = typeof v3Mx === 'function' && v3Mx() ? 1 : 0;
  gl.uniform1f(U.uMx, mx); gl.uniform1f(U.uHl, typeof sfxHl === 'function' ? sfxHl() : 0); gl.uniform3f(U.uHlC, 1, .76, .29);   // 选中编队的发光（琥珀色，与 v3units.js 同一套）
  if (typeof v3ShUni === 'function') v3ShUni(gl, U, !LM); else gl.uniform1f(U.uShOn, 0);
  const lmOn = mx && !LM && typeof v3LightBind === 'function' && v3LightBind(gl);
  gl.uniform1i(U.uLm, lmOn ? V3L.unit : 0); gl.uniform1f(U.uLmOn, lmOn ? 1 : 0);
  if (U.uBm && typeof V3L_BM === 'object') gl.uniform4fv(U.uBm, V3L_BM);
  gl.uniform1i(U.uTb, 0); gl.uniform1i(U.uTn, 1); gl.uniform1i(U.uTm, 2); gl.uniform1i(U.uTe, 3); gl.uniform1i(U.uTo, 4);
  const tex = (u, t) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t || null); };
  const wrap = (t, w) => { if (!t) return; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); const m = [gl.REPEAT, gl.CLAMP_TO_EDGE, gl.MIRRORED_REPEAT]; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, m[w[1]] || gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, m[w[2]] || gl.REPEAT); };
  for (const pass of LM ? [0] : [0, 1]) {
    if (pass) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    for (const L of V3G.inst.values()) {
      if (!L.n) continue;
      const M = L.M, m = M.meta, st = m.st * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, M.vb);
      gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, st, 24);
      gl.bindBuffer(gl.ARRAY_BUFFER, V3G.ib); gl.bufferData(gl.ARRAY_BUFFER, L.d.subarray(0, L.n * 16), gl.DYNAMIC_DRAW);
      for (const [k, o] of [['iA', 0], ['iB', 16], ['iC', 32], ['iD', 48]]) { gl.enableVertexAttribArray(A[k]); gl.vertexAttribPointer(A[k], 4, gl.FLOAT, false, 64, o); X.vertexAttribDivisorANGLE(A[k], 1); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
      gl.uniform1f(U.uRad, M.rad);
      const it = m.it === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      for (const [mi, pi, i0, cnt] of m.lod[L.lod]) {
        const T = M.mats[mi];
        const gh = !!V3G.glass && V3G.glass.key === M.key && V3G.glass.hud === T.n;   // 玩家开着的这型飞机：平显玻璃（模型里是一整块不透明的亮绿色）当透明玻璃画
        if ((T.am === 2 || gh) !== !!pass) continue;
        const P = pi >= 0 ? M.parts[pi] : null;
        gl.uniform1f(U.uPk, P ? pi : -1);
        if (P) {
          const w = P.w || [pi === 0 ? 1 : 0, pi === 1 ? 1 : 0, pi === 2 ? 1 : 0, pi >= 3 ? 1 : 0];
          const w2 = P.w2 || V3G_W0;
          gl.uniform1f(U.uPm, P.k === 'hide' ? 1 : P.k === 'noz' ? 2 : P.k === 'gun' ? 3 : P.k === 'era' ? 4 : P.k === 'chain' ? 5 : 0); gl.uniform1f(U.uPl, P.k === 'chain' ? (P.hb != null ? P.hb + 2 : 0) : P.l || 1); gl.uniform3f(U.uPp, P.p[0], P.p[1], P.p[2]); gl.uniform3f(U.uPa, P.a[0], P.a[1], P.a[2]); gl.uniform4f(U.uPw, w[0], w[1], w[2], w[3]); gl.uniform4f(U.uPw2, w2[0], w2[1], w2[2], w2[3]);
          if (P.k === 'chain') {
            const q = P.q || P.p, a2 = P.a2 || V3G_AY, e = P.e || V3G_W0, e2 = P.e2 || V3G_W0, r = P.r || V3G_AX, q3 = P.q3 || q, a3 = P.a3 || V3G_AX, g2 = P.g2 || V3G_W0;
            gl.uniform3f(U.uPq, q[0], q[1], q[2]); gl.uniform3f(U.uPa2, a2[0], a2[1], a2[2]); gl.uniform3f(U.uPr, r[0], r[1], r[2]); gl.uniform4f(U.uPe, e[0], e[1], e[2], e[3]); gl.uniform4f(U.uPe2, e2[0], e2[1], e2[2], e2[3]);
            gl.uniform3f(U.uPq3, q3[0], q3[1], q3[2]); gl.uniform3f(U.uPa3, a3[0], a3[1], a3[2]); gl.uniform4f(U.uPg2, g2[0], g2[1], g2[2], g2[3]);
          }
        }
        const tb = T.t && M.tex[T.t[0]], tn = T.nt && M.tex[T.nt[0]], tm = (T.sg ? T.sgt : T.mrt) && M.tex[(T.sg ? T.sgt : T.mrt)[0]], te = T.et && M.tex[T.et[0]], to = T.ot && M.tex[T.ot[0]];
        if (tb) wrap(tb, T.t);
        tex(0, tb); tex(1, tn); tex(2, tm); tex(3, te); tex(4, to);
        gl.uniform4f(U.uTf, tb ? 1 : 0, tn ? 1 : 0, tm ? 1 : 0, 0); gl.uniform4f(U.uTf2, te ? 1 : 0, to ? 1 : 0, 0, 0);
        const ga = gh ? .12 : T.am === 2 && V3G.glass && V3G.glass.key === M.key ? V3G.glass.k : 1;   // 座舱盖等玻璃：玩家开着的这型飞机调得更透明（v3pilot.js）
        gl.uniform4f(U.uC, T.c[0], T.c[1], T.c[2], T.c[3] * ga); gl.uniform3f(U.uE, T.e[0] * ga, T.e[1] * ga, T.e[2] * ga);
        gl.uniform2f(U.uMR, T.mr[0], T.mr[1]);
        if (T.sg) gl.uniform4f(U.uSG, T.sg[0], T.sg[1], T.sg[2], T.sg[3]); else gl.uniform4f(U.uSG, 0, 0, 0, -1);
        gl.uniform1f(U.uNs, T.ns ?? 1); gl.uniform1f(U.uAm, gh ? 2 : T.am); gl.uniform1f(U.uAc, T.ac ?? .5);
        X.drawElementsInstancedANGLE(gl.TRIANGLES, cnt, it, i0 * m.it, L.n);
      }
      for (const k of ['iA', 'iB', 'iC', 'iD']) { X.vertexAttribDivisorANGLE(A[k], 0); gl.disableVertexAttribArray(A[k]); }
    }
    if (pass) { gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  for (const k of ['p', 'n', 'uv']) gl.disableVertexAttribArray(A[k]);
  for (let u = 4; u >= 0; u--) tex(u, null);
}

// ———————————————— 兵种 → 模型 ————————————————
// 用户给了模型的兵种直接用；没给的先用同类里最接近的一个代替（换模型只改这几张表）。键：车辆是 models.js 的 RLM 型号，飞机是 airSilKey / eair 的机型键
const V3G_VEH = { ztz96b: 'ztz96', ztz96m: 'ztz96', m1a1: 'm1a1', m1a2: 'm1a1', m2a3: 'm2a3', m109: 'm109', m1134: 'stryker', m1127: 'stryker', mshorad: 'stryker', m903: 'patriot', m163: 'm163',
  m1150: 'm1150', lpws: 'cram', jltv: 'matv', m1117: 'matv', avenger: 'hmmwv',   // 美军（Sketchfab 模型，tools/v3gmodels.json；没有精确型号的用最接近的：JLTV、M1117 用 M-ATV，复仇者用悍马底盘）
  zbd05: 'zbd97', zbd04a: 'zbd97', zbd03: 'zbd97', ztd05: 'zbd97', ptl02: 'ptl02', pgl625: 't625', pgz07: 't625', plz07: 'pzh2000', zsl92b: 'lav25', zbl08: 'lav25', ld2000: 'cram' };   // 解放军：ZBD-05 / 03、ZTD-05 用 ZBD-04，PGZ-07 用 625，PLZ-07 用 PzH 2000，ZSL-92B / 08 式用 LAV-25，LD-2000 用陆基密集阵
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

// 车辆：车体按脚下坡度俯仰、侧倾，炮塔（模型里的 tur 部件）相对车体转到瞄准方向；按游戏里的车长（车体，不算炮管）缩放
function v3gVeh(v, rk, side, len, x, y, z, h, aim, dead, pitch, roll, hl, fs = 99) {   // hl：选中编队的成员（整车发光）；fs：主炮开火后几秒
  const key = v3gVehKey(rk, side), M = v3gModel(key);
  if (!M) return false;
  const k = len / (M.meta.hl || M.meta.len), da = aim == null ? 0 : -Math.atan2(Math.sin(aim - h), Math.cos(aim - h));   // 部件角度在模型坐标里（逆时针为正，世界朝向顺时针为正）
  // 型号功能表（vfn.js）：炮塔、炮管俯仰、发射架起竖、跳板、车轮、雷达按车辆此刻的状态动
  const FP = v && typeof vfnParts === 'function' ? vfnParts(v, key, k, h, aim ?? h, dead, fs, z) : null, FV = FP && VFN[key];
  // 开炮：炮管 0.06 秒内后坐到底（约 0.3 米），约 0.7 秒复进回原位；车体被后坐力推得朝炮口那边翘起、再回弹几下（悬挂），翘的方向跟着炮塔朝向
  const G = V3G_GUN[key] || (FV && FV.rock ? { L: FV.rc || 0, rock: FV.rock } : null), rc = G && !dead && fs < .8 ? G.L * (fs < .06 ? fs / .06 : 1 - sm01((fs - .06) / .7)) : 0;
  if (G && !dead && fs < 1.6) { const r = G.rock * Math.exp(-fs / .38) * Math.sin(fs * 10.5), rel = Math.atan2(Math.sin(aim - h), Math.cos(aim - h)); pitch += r * Math.cos(rel); roll -= r * Math.sin(rel); }
  const P = FP || [dead ? -.6 : da, 0, 0, 0, 0, 0, rc, 0], E = !FP && V3G_ERA[key], U = E && v && v.era && v.era.h;
  if (FP && V3G_CAPS[key] && v && v.samN != null) { const n = (typeof vehSp === 'function' && (vehSp(v).sam || {}).n) || 8; P[6] = 2 ** clamp(n - v.samN, 0, 16) - 1; }   // 打出去几枚，就有几个发射筒空了
  if (U && U.length && typeof rlModelOf === 'function' && E.rl.includes((rlModelOf(v) || {}).key)) for (const i of U) if (i >= 0 && i < 64) P[1 + Math.floor(i / 16)] += 2 ** (i % 16);   // 炸掉的反应装甲块（era.js）：每个数 16 位
  return v3gAdd(key, x, y, z, h, k, (dead ? 2 : side === 'e' ? 1 : 0) + (hl ? 8 : 0), roll, pitch, P);
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
function v3gPlane(key, sz, x, y, z, ground, h, side, roll, pitch, gear, t, noz = 0, ctl = null, bay = null) {   // noz：尾喷口开合（正 = 张开，负 = 收拢）；ctl：舵面 { de 平尾（负 = 后缘上偏、抬头）, da 滚转差动 }（v3det.js v3dPitch 按气动算）；bay：弹舱门开度 { main, side }（fpwpn.js fwBay）
  const mk = V3G_AIR[key] || 'j31', M = v3gModel(mk);
  if (!M) return false;
  const k = sz / M.meta.len;
  let ox = x, oy = y, oz = z;
  if (!ground) { const o = v3dMv3(h, pitch, roll, [0, 0, M.meta.zc * k]); ox -= o[0]; oy += o[1]; oz -= o[2]; }   // 绕机身中线俯仰、滚转（模型原点在机轮着地处）
  const P = [0, 0, 0, 0, bay ? bay.main || 0 : 0, bay ? bay.side || 0 : 0, 0, 0];
  M.parts.forEach((p, i) => { const j = p.slot ?? i; if (j > 3) return; if (p.n === 'gear') P[j] = gear ? 0 : 1; else if (p.n === 'rotor') P[j] = (t || 0) * 22; else if (p.n === 'trotor') P[j] = (t || 0) * 61; else if (p.k === 'noz') P[j] = noz; });
  if (M.ctl) { P[2] = ctl ? ctl.de || 0 : 0; P[3] = ctl ? ctl.da || 0 : 0; }   // 舵面：槽 3 平尾、槽 4 滚转差动
  return v3gAdd(mk, ox, oy, oz, h, k, side, roll, pitch, P);
}
// 飞机模型上一点（模型坐标，米）此刻在世界的哪里（游戏坐标 x、y，高度 z）：和 v3gPlane 同一套变换（绕机身中线俯仰、滚转）——弹舱里的弹、挂点按它放
function v3gAt(key, sz, x, y, z, h, pitch, roll, v) {
  const M = V3G.M[V3G_AIR[key] || 'j31'];
  if (!M || !M.ready) return null;
  const k = sz / M.meta.len, r = v3dMv3(h, pitch, roll, [v[0] * k, v[1] * k, (v[2] - M.meta.zc) * k]);
  return [x + r[0], y - r[1], z + r[2]];
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
// 用户给的模型的署名（tools/v3gmodels.json 的 credit；设置面板「素材致谢」里列出，v3import.js v3imCredits）
const V3G_CRED = [{"name":"96 式主战坦克","title":"ZTZ96","author":"jzmhhhhh","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/ztz96-b0da178e50dc423983445841615d9e80"},{"name":"M1A1 艾布拉姆斯","title":"M1A1 Abrams Main Battle Tank","author":"MirzaArrafiERV_45","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m1a1-abrams-main-battle-tank-1529f5d842cb4f578aa8cb672524f044"},{"name":"歼-20","title":"Chinese Chengdu J-20","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/chinese-chengdu-j-20-b9e81062c94545ffb0232d3ac6b7adc5"},{"name":"歼-16","title":"Shenyang J16 Hidden Dragon","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/shenyang-j16-hidden-dragon-2b950f910677457fbb52b6096f81e70b"},{"name":"歼-31 鹘鹰","title":"Shenyang J31 Gyrfalcon","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/shenyang-j31-gyrfalcon-23dbff530e21491299ac67bbab42b553"},{"name":"直-10","title":"Changhe Z-10W","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/changhe-z-10w-617cb4a91dfd4eaaa59161e06691df7f"},{"name":"直-21","title":"[MW] Z-21","author":"xlisov","license":"CC-BY-NC-4.0","url":"https://sketchfab.com/3d-models/mw-z-21-a2d88447f0904f49b73f94fa88dccea5"},{"name":"士兵","title":"Army Character 2","author":"MirzaArrafiERV_45","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/army-character-2-e3c4da4a33bb42ed8512f423a4319c5a"},{"name":"AIM-120C","title":"AIM-120C AMRAAM","author":"Jeyhun1985","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/aim-120c-amraam-838fa923340a4d108e05c99bf0146ff6"},{"name":"AIM-9","title":"AIM-9 missile","author":"rickslash","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/aim-9-missile-caaf15b49bac4144b6c6be577c2b872a"},{"name":"AIM-54 不死鸟、AIM-9 响尾蛇（组合）、AIM-120（组合）、KS-172、AIM-132 ASRAAM、GBU-24 宝石路、Mk 83 炸弹、AGM-65 小牛、AGM-154 JSOW、硫磺石","title":"300 followers - free aircraft missile set","author":"NETRUNNER_pl","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/300-followers-free-aircraft-missile-set-2e70bc2ea0824897b2ccaea378809c9e"},{"name":"M2A3 布雷德利步兵战车","title":"M2 Bradley IFV","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m2-bradley-ifv-ab022158ab5f4fbfa55d4142db7595ab"},{"name":"M109A7 帕拉丁自行榴弹炮","title":"M109 PALADIN ARTILLERY","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m109-paladin-artillery-3de0572475d54f7b9da18d6ed26b4a10"},{"name":"斯特赖克 8×8 装甲车（M1126 步兵输送车外形）","title":"M1126 Infantry Carrier Vehicle","author":"cenobyte","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m1126-infantry-carrier-vehicle-b0c559a02c1842b0976a241c9a998360"},{"name":"M903 爱国者导弹发射车","title":"MIM-104 Patriot Air Defense System","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/mim-104-patriot-air-defense-system-95e1e402426f4ddcb543af7a0455cf05"},{"name":"M163 火神自行高炮","title":"M163 VADS","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m163-vads-66a6f08ad2d945ccb6e72267e55bc685"},{"name":"C-RAM 陆基密集阵（百人队长）","title":"Centurion C-RAM","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/centurion-c-ram-10ea7349c7574ca7a43991eece92c9a9"},{"name":"M1150 突击破障车","title":"M1150 ABV","author":"Kalibrovshik","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m1150-abv-26eaeb6a7dbf498db16e02b1c232de33"},{"name":"M-ATV 防地雷全地形车（代 JLTV、M1117）","title":"Oshkosh M-ATV","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/oshkosh-m-atv-291dc8f07a494751b318e623b89cf538"},{"name":"M998 悍马（代复仇者防空车底盘）","title":"HMMWV M998A1 (soft top)","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/hmmwv-m998a1-soft-top-ffbc4b053628413fb84acf5b89595d96"},{"name":"ZBD-04 步兵战车（原称 97 式）","title":"ZBD-97","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/zbd-97-b36e44ca383e4ab296e28321167e5ba4"},{"name":"PTL-02 轮式突击炮","title":"Chinese PTL-02","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/chinese-ptl-02-e087eff1ed9b48cabe06d9467fec3311"},{"name":"PGL-625 弹炮结合防空车","title":"Type-625 Anti Aircraft Gun Missile System","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/type-625-anti-aircraft-gun-missile-system-8b7e85f45b954592bd4bb8e72cdd6312"},{"name":"PzH 2000 自行榴弹炮（代 PLZ-07）","title":"PANZERHAUBITZE 2000 ARTILLERY (PzH-2000)","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/panzerhaubitze-2000-artillery-pzh-2000-da078be6bc66461e87034f29600a4982"},{"name":"LAV-25 轮式装甲车（代 ZSL-92B、08 式）","title":"LAV-25","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/lav-25-968b0681119a4b3e82d94bb085a790be"}];
// 授权只允许非商用的模型（直-21）商店版里不带（tools/build_www.mjs --app）：加载不到就换成同类的另一个
const V3G_ALT = { z21: 'z10w' };
// 带座舱内饰的模型（座舱视角坐进模型里看，v3pilot.js）：eye 飞行员眼睛（模型坐标，米：x 前、y 左、z 上）；
//   scr = 仪表板显示屏的材质（去掉和正面重叠的镜像面，见 v3gPitScr）；
//   hud = 平显玻璃的材质（玩家开着这架时当透明的淡绿玻璃画）；hudF = 平显外框（材质、所在范围 x0 x1 y0 y1 z0 z1、玻璃内沿 y0 y1 z0 z1、左右与上边收到原宽的几成，底边坐在遮光罩上不动）
//   noz = 尾喷口调节片（材质、铰链 x、出口 x、离发动机轴线的半径范围）——拆成单独部件，按推力开合（v3gPlane 的 noz）；ctl = 舵面（见下）
const V3G_PIT = { j31: { eye: [4.3, 0, 2.72], scr: 'screen', hud: 'Glowing_green',
  hudF: { mat: 'Darkness', box: [5.1, 5.16, -.105, .105, 2.55, 2.8], inner: [-.076, .076, 2.599, 2.769], k: .3 },
  noz: { mat: 'metal', x0: -6.85, x1: -7.47, r0: .44, r1: .6 },
  // 舵面（模型里本来就是单独的面，边界有错开的顶点）：全动平尾（x、|y| 范围，转轴 x、z，绕 y 轴）、内侧襟副翼与外侧副翼（铰链线两端 [x, |y|]，铰链后面的绕铰链转）；
  //   w：实例参数的组合（第 3 个 = 平尾偏角，第 4 个 = 滚转差动）——左边（模型 y > 0）照抄，右边滚转那一项反号；偏角正 = 后缘下偏
  ctl: { mats: ['Wing_top', 'Wing_bottom'], z: [1.6, 2.1], surf: [
    { n: 'stab', x: [-8.6, -5.2], y: [1.3, 4.25], pv: [-6.55, 1.86], w: [0, 0, 1, .6] },
    { n: 'flap', h: [[-4.12, 1.77], [-3.77, 4.74]], y: [1.7, 4.76], w: [0, 0, 0, 1] },
    { n: 'ail', h: [[-3.745, 4.74], [-3.73, 5.77]], y: [4.7, 5.82], w: [0, 0, 0, 1] }] } } };   // 歼-20 的座舱眼位还没对好：座舱视角放在机头上方，不画自己
// 显示屏的面：模型用镜像修改器做的，左右各多出一片和正面重叠、贴图左右反的镜像面（两层贴图在同一个平面上来回打架闪烁）——
//   只留贴图从左往右（机体 y 由大到小，飞行员看过去从左到右）的面
function v3gPitScr(cf, m, M, VB, IB) {
  const si = cf.scr ? m.mats.findIndex(x => x.n === cf.scr) : -1;
  if (si < 0) return;
  const st = m.st;
  for (const lod of m.lod) for (const [mi, , i0, cnt] of lod) if (mi === si) for (let t = i0; t + 2 < i0 + cnt; t += 3) {
    const P = [0, 1, 2].map(j => { const v = IB[t + j] * st; return [VB[v + 1], VB[v + 2], VB[v + 6]]; });   // y、z、u
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1]], det = e1[0] * e2[1] - e1[1] * e2[0];
    if (Math.abs(det) < 1e-9) continue;
    if (((P[1][2] - P[0][2]) * e2[1] - (P[2][2] - P[0][2]) * e1[1]) / det > 0) { IB[t + 1] = IB[t]; IB[t + 2] = IB[t]; }   // 镜像面：变成退化三角形，不画
  }
}
// 平显外框（围着绿色玻璃的一圈黑框）往玻璃内沿收窄
function v3gPitHud(cf, m, M, VB, IB) {
  const st = m.st, F = cf.hudF, fi = F ? m.mats.findIndex(x => x.n === F.mat) : -1;
  if (fi < 0) return;
  const vs = new Set();
  for (const [k, , i0, cnt] of m.lod[0]) if (k === fi) for (let t = i0; t < i0 + cnt; t++) vs.add(IB[t]);
  const [x0, x1, y0, y1, z0, z1] = F.box, [iy0, iy1, iz0, iz1] = F.inner;
  for (const v of vs) {
    const o = v * st, x = VB[o], y = VB[o + 1], z = VB[o + 2];
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
    if (y > iy1 + .001) VB[o + 1] = iy1 + (y - iy1) * F.k; else if (y < iy0 - .001) VB[o + 1] = iy0 + (y - iy0) * F.k;
    if (z > iz1 + .001) VB[o + 2] = iz1 + (z - iz1) * F.k;   // 底边不动：原来就坐在遮光罩上，收上去就悬空了
  }
}
// 尾喷口与舵面：把这些三角形从原来的绘制段里挑出来（每段按「其余 / 各部件」重排索引、拆成几段），挂成部件——顶点着色器按实例参数转
//   尾喷口（noz）：左右发动机各一个，绕前缘铰链径向开合（参数槽 1）；舵面（rot）：绕铰链轴转，偏角 = 实例参数按权重组合
function v3gPitParts(cf, m, M, VB, IB) {
  const st = m.st, parts = m.parts || (m.parts = []), G = [];   // G：{ mi: 材质集合, test(顶点) → 是否属于, pi: 部件序号 }
  const N = cf.noz, ni = N ? m.mats.findIndex(x => x.n === N.mat) : -1, noz = m.noz && m.noz[0];
  if (ni >= 0 && noz) for (const sg of noz[1] ? [1, -1] : [1]) {
    const pi = parts.push({ n: 'noz', k: 'noz', slot: 1, w: [0, 1, 0, 0], p: [N.x0, noz[1] * sg, noz[2]], a: [1, 0, 0], l: N.x0 - N.x1 }) - 1;
    G.push({ mi: new Set([ni]), pi, test: v => { const o = v * st, x = VB[o], y = VB[o + 1], z = VB[o + 2]; return x <= N.x0 + .02 && x >= N.x1 - .02 && Math.hypot(y - noz[1] * sg, z - noz[2]) >= N.r0 && Math.hypot(y - noz[1] * sg, z - noz[2]) <= N.r1; } });
  }
  const C = cf.ctl;
  if (C) {
    const mis = new Set(C.mats.map(n => m.mats.findIndex(x => x.n === n)).filter(i => i >= 0)), zc = (C.z[0] + C.z[1]) / 2;
    for (const f of C.surf) for (const sg of [1, -1]) {
      const w = [f.w[0], f.w[1], f.w[2], f.w[3] * sg];
      let p, a, inX;
      if (f.h) {   // 铰链线：轴平行于铰链（a.y < 0 使「偏角正 = 后缘下偏」），铰链后面的属于舵面
        const [[x0, y0], [x1, y1]] = f.h, L = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / L, dy = (y1 - y0) / L;
        p = [x0, y0 * sg, zc]; a = sg > 0 ? [-dx, -dy, 0] : [dx, -dy, 0];
        inX = (x, Y) => x <= x0 + (x1 - x0) * (Y - y0) / (y1 - y0) + .015;
      } else { p = [f.pv[0], 1.4 * sg, f.pv[1]]; a = [0, -1, 0]; inX = x => x >= f.x[0] && x <= f.x[1]; }   // 全动平尾：整片绕展向轴转
      const pi = parts.push({ n: f.n, k: 'rot', w, p, a }) - 1;
      G.push({ mi: mis, pi, test: v => { const o = v * st, x = VB[o], y = VB[o + 1], z = VB[o + 2], Y = y * sg; return Y >= f.y[0] && Y <= f.y[1] && z >= C.z[0] && z <= C.z[1] && inX(x, Y); } });
    }
    M.ctl = true;
  }
  if (!G.length) return;
  for (const lod of m.lod) {
    const add = [];
    for (const e of lod) {
      const [mi, p0, i0, cnt] = e;
      if (p0 >= 0 || !G.some(g => g.mi.has(mi))) continue;
      const B = [[], ...G.map(() => [])];
      for (let t = i0; t + 2 < i0 + cnt; t += 3) {
        const v = [IB[t], IB[t + 1], IB[t + 2]], k = G.findIndex(g => g.mi.has(mi) && v.every(g.test));
        B[k + 1].push(v[0], v[1], v[2]);
      }
      if (B.slice(1).every(b => !b.length)) continue;
      let k = i0;
      for (const b of B) for (const v of b) IB[k++] = v;
      e[3] = B[0].length; let o = i0 + B[0].length;
      B.slice(1).forEach((b, j) => { if (b.length) add.push([mi, G[j].pi, o, b.length]); o += b.length; });
    }
    lod.push(...add);
  }
}
function v3gPrep(key, m, M, VB, IB) {
  const cf = V3G_PIT[key];
  if (cf) { v3gPitScr(cf, m, M, VB, IB); v3gPitHud(cf, m, M, VB, IB); v3gPitParts(cf, m, M, VB, IB); }
  if (V3G_GUN[key]) v3gGun(V3G_GUN[key], m, VB, IB);
  if (V3G_CAPS[key]) v3gCaps(V3G_CAPS[key], m, VB, IB);
  if (V3G_ERA[key]) return v3gEra(V3G_ERA[key], m, VB, IB);
  return V3G_BAY[key] ? v3gBays(V3G_BAY[key], m, VB, IB) : null;
}
// —— 反应装甲块（era.js 按块用掉）：模型上原有的块才有——M1A1 裙板外表面就是 TUSK 的 ARAT，左右各 2 排 × 16 列，每块是 |y| = y 那个面上 0.33 × 0.35 米的一格。
//   每块的正面三角形拆出来、复制顶点，|y| 往外挪「块号 × 0.01 毫米」（看不出来）把块号编进顶点，统统挂到一个 'era' 部件上（只多一次绘制）：
//   着色器按块号查实例参数里的位（iC.yzw、iD.x，各管 16 块；v3gVeh 按 v.era.h 填），炸掉的块收成一点；块后面补焦黑的底板和四壁，平时被块的正面挡着看不见。
//   第 1 级细节（中远处）简化过的块面跨了好几格，换成第 0 级拆好的块面；再远的不拆（一块不到一个像素）。
//   x0 / dx / n：列（从后往前）；zr：两排的上下沿（中间那道缝各列高低差一点）；y：块面、yIn：底板（裙板内板 1.818 外面一点）；
//   rl：用这套块的车型（models.js RLE，块号同一套：边 × 32 + 排 × 16 + 列，右边 0）
const V3G_ERA = { m1a1: { x0: -3.224, dx: 5.352 / 16, n: 16, zr: [.795, 1.144, 1.5], y: 1.9756, yIn: 1.83, rl: ['m1a1', 'm1a2'] } };
const V3G_ERA_E = 1e-5;
// —— 弹炮防空车的导弹（vehicles.js vehSam 的 v.samN：剩几枚）：PGL-625 炮塔两侧各一个 2 × 2 的发射筒组，筒里装着弹。模型里这两组筒烘焙在车体（不随炮塔转）——
//   这里把筒组挪到炮塔部件上（随炮塔转），每个筒里的弹（弹身 + 前段）拆成单独的链式部件、只随炮塔转，各带一位（hb，看 iD.z）：打出去一枚，那一筒就空了，再装填时弹回来。
//   打的顺序：两侧轮流、先上排、先外侧。tur：炮塔部件名；box：筒组所在（模型米：x0 x1 |y|0 |y|1 z0 z1）；msl / fr：弹身、前段的长度范围；n：几枚
const V3G_CAPS = { t625: { tur: 'tur', box: [-1.95, 1.45, 1.25, 1.98, 2.75, 3.65], msl: [2.8, 3.2], fr: [.8, 1.1], n: 8 } };
function v3gCaps(cf, m, VB, IB) {
  const parts = m.parts || [], ti = parts.findIndex(p => p.n === cf.tur);
  if (ti < 0) return;
  const st = m.st, T = parts[ti], B = cf.box, ids = [];
  let ctr = null;   // 第 0 级里各枚弹的中心（y、z），按打的顺序
  const q = i => Math.round(VB[i * st] * 1000) + ',' + Math.round(VB[i * st + 1] * 1000) + ',' + Math.round(VB[i * st + 2] * 1000);
  const inBox = b => { const ay0 = Math.min(Math.abs(b[2]), Math.abs(b[3])), ay1 = Math.max(Math.abs(b[2]), Math.abs(b[3])); return b[2] * b[3] > 0 && b[0] >= B[0] && b[1] <= B[1] && ay0 >= B[2] && ay1 <= B[3] && b[4] >= B[4] && b[5] <= B[5]; };
  m.lod.forEach((lod, L) => {
    const add = [];
    for (const e of lod) {
      const [mi, pi, i0, cnt] = e;
      if (pi !== -1) continue;
      const par = new Map(), find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par.set(a, b); };
      for (let t = i0; t + 2 < i0 + cnt; t += 3) { const k = [q(IB[t]), q(IB[t + 1]), q(IB[t + 2])]; for (const x of k) if (!par.has(x)) par.set(x, x); uni(k[0], k[1]); uni(k[1], k[2]); }
      const comp = new Map();
      for (let t = i0; t + 2 < i0 + cnt; t += 3) { const r = find(q(IB[t])); if (!comp.has(r)) comp.set(r, { T: [], b: [1e9, -1e9, 1e9, -1e9, 1e9, -1e9] }); const C = comp.get(r); C.T.push(t); for (let j = 0; j < 3; j++) { const o = IB[t + j] * st; C.b = [Math.min(C.b[0], VB[o]), Math.max(C.b[1], VB[o]), Math.min(C.b[2], VB[o + 1]), Math.max(C.b[3], VB[o + 1]), Math.min(C.b[4], VB[o + 2]), Math.max(C.b[5], VB[o + 2])]; } }
      const pod = [...comp.values()].filter(c => inBox(c.b)).map(c => ({ ...c, c: [(c.b[0] + c.b[1]) / 2, (c.b[2] + c.b[3]) / 2, (c.b[4] + c.b[5]) / 2], dx: c.b[1] - c.b[0], dy: c.b[3] - c.b[2] }));
      if (!pod.length) continue;
      const isM = c => c.dx >= cf.msl[0] && c.dx <= cf.msl[1] && c.dy < .22;
      if (!ctr && L === 0) {
        const M = pod.filter(isM), side = sg => M.filter(c => Math.sign(c.c[1]) === sg).sort((a, b) => (b.c[2] - a.c[2]) || (Math.abs(b.c[1]) - Math.abs(a.c[1])));
        const Lf = side(1), Rt = side(-1), ord = [];
        for (let i = 0; i < Math.max(Lf.length, Rt.length); i++) { if (Lf[i]) ord.push(Lf[i]); if (Rt[i]) ord.push(Rt[i]); }
        ctr = ord.slice(0, cf.n).map(c => [c.c[1], c.c[2]]);
        ctr.forEach((c, k) => ids.push(parts.push({ n: 'msl', k: 'chain', p: T.p.slice(), a: T.a.slice(), w: [1, 0, 0, 0], q: T.p.slice(), a2: [0, -1, 0], e: [0, 0, 0, 0], hb: k }) - 1));
      }
      // 弹身、前段归到同一筒（按 y、z 最近）；简化过的远处网格认不出弹的，整组随炮塔转、不拆
      const grp = (ctr || []).map(() => []), tur = [], taken = new Set();
      for (const c of pod) {
        let bk = -1;
        if (ctr && (isM(c) || (c.dx >= cf.fr[0] && c.dx <= cf.fr[1]))) { let bd = .12; ctr.forEach((p, k) => { const d = Math.hypot(c.c[1] - p[0], c.c[2] - p[1]); if (d < bd) { bd = d; bk = k; } }); }
        for (const t of c.T) { (bk >= 0 ? grp[bk] : tur).push(IB[t], IB[t + 1], IB[t + 2]); taken.add(t); }
      }
      const keep = [];
      for (let t = i0; t + 2 < i0 + cnt; t += 3) if (!taken.has(t)) keep.push(IB[t], IB[t + 1], IB[t + 2]);
      let o = i0;
      IB.set(keep, o); e[3] = keep.length; o += keep.length;
      if (tur.length) { IB.set(tur, o); add.push([mi, ti, o, tur.length]); o += tur.length; }
      grp.forEach((g, k) => { if (!g.length) return; IB.set(g, o); add.push([mi, ids[k], o, g.length]); o += g.length; });
    }
    lod.push(...add);
  });
}
function v3gEra(cf, m, VB, IB) {
  const st = m.st, nv0 = VB.length / st, add = [], E = V3G_ERA_E, n2 = cf.n * 2, X1 = cf.x0 + cf.n * cf.dx;
  const parts = m.parts || (m.parts = []), ei = parts.push({ n: 'era', k: 'era', p: [cf.y, E, 0], a: [1, 0, 0], w: [0, 0, 0, 0] }) - 1;
  // 一个三角形是不是某块的正面：三个顶点都在块面上（同一边）、都落在同一格里
  const cell = (x, z) => [Math.floor((x - cf.x0) / cf.dx), z < cf.zr[1] ? 0 : 1];
  const tile = t => {
    const P = [0, 1, 2].map(j => IB[t + j] * st);
    if (!P.every(o => Math.abs(Math.abs(VB[o + 1]) - cf.y) < .006) || !P.every(o => Math.sign(VB[o + 1]) === Math.sign(VB[P[0] + 1]))) return -1;
    const cx = (VB[P[0]] + VB[P[1]] + VB[P[2]]) / 3, cz = (VB[P[0] + 2] + VB[P[1] + 2] + VB[P[2] + 2]) / 3;
    if (cx < cf.x0 || cx > X1 || cz < cf.zr[0] - .01 || cz > cf.zr[2] + .01) return -1;
    const [col, row] = cell(cx, cz), xa = cf.x0 + col * cf.dx - .006, xb = xa + cf.dx + .012, za = cf.zr[row] - .02, zb = cf.zr[row + 1] + .02;
    if (!P.every(o => VB[o] >= xa && VB[o] <= xb && VB[o + 2] >= za && VB[o + 2] <= zb)) return -2;   // 跨了好几格（简化过的网格）
    return (VB[P[0] + 1] < 0 ? 0 : n2) + row * cf.n + col;   // 模型 y 朝左：y < 0 是右边
  };
  const seen = new Set(), segs = m.lod.map(() => []), fr0 = [];
  m.lod.forEach((lod, L) => {
    for (const [mi, pi, i0, cnt] of lod) {
      const keep = [], fr = [];
      for (let t = i0; t + 2 < i0 + cnt; t += 3) {
        const id = pi < 0 && L < 2 ? tile(t) : -1;
        if (id === -1 || (id === -2 && !L)) { keep.push(IB[t], IB[t + 1], IB[t + 2]); continue; }
        if (L) continue;   // 第 1 级：块面整片去掉，下面换成第 0 级的
        seen.add(id);
        for (let j = 0; j < 3; j++) { const o = IB[t + j] * st, v = Array.from(VB.subarray(o, o + st)); v[1] = Math.sign(v[1]) * (cf.y + id * E); add.push(...v); fr.push(nv0 + add.length / st - 1); }
      }
      segs[L].push([mi, pi, keep]);
      if (fr.length) { const e = [mi, ei, fr]; segs[L].push(e); fr0.push(e); }
    }
  });
  if (segs[1]) segs[1].push(...fr0);
  // 底板 + 四壁（每块各一套，往自己格里收 1 毫米：相邻两块都炸掉时中间留一道隔板，不会两面重合闪烁）
  const wi = m.mats.push({ n: 'era_base', c: [.055, .05, .045, 1], t: null, nt: null, ns: 1, mr: [.2, .95], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: 0 }) - 1, wl = [];
  const push = (p, nn) => { add.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], 0, 0); for (let k = 8; k < st; k++) add.push(0); return nv0 + add.length / st - 1; };
  const quad = (a, b, c, d, nn) => { const i = [a, b, c, d].map(p => push(p, nn)); wl.push(i[0], i[1], i[2], i[0], i[2], i[3]); };
  for (const id of seen) {
    const sd = id < n2 ? -1 : 1, row = Math.floor((id % n2) / cf.n), col = id % cf.n;
    const xa = cf.x0 + col * cf.dx + .001, xb = xa + cf.dx - .002, za = cf.zr[row] + .001, zb = cf.zr[row + 1] - .001, y0 = sd * cf.yIn, y1 = sd * (cf.y - .003);
    quad([xa, y0, za], [xb, y0, za], [xb, y0, zb], [xa, y0, zb], [0, sd, 0]);       // 底板（朝外）
    quad([xa, y0, za], [xa, y1, za], [xa, y1, zb], [xa, y0, zb], [1, 0, 0]);        // 后壁（朝前）
    quad([xb, y0, za], [xb, y0, zb], [xb, y1, zb], [xb, y1, za], [-1, 0, 0]);
    quad([xa, y0, za], [xb, y0, za], [xb, y1, za], [xa, y1, za], [0, 0, 1]);        // 下壁（朝上）
    quad([xa, y0, zb], [xa, y1, zb], [xb, y1, zb], [xb, y0, zb], [0, 0, -1]);
  }
  segs[0].push([wi, -1, wl]);
  if (segs[1]) segs[1].push([wi, -1, wl]);   // 第 1 级细节用同一段块面、底板
  // 重排索引（每级细节各一段；底板那段两级共用）
  const nv = nv0 + add.length / st, it = nv > 65535 ? 4 : m.it, out = [];
  let o = 0;
  const pos = new Map();
  m.lod = segs.map(G => G.map(([mi, pi, I]) => { if (!I.length) return null; if (!pos.has(I)) { pos.set(I, o); out.push(I); o += I.length; } return [mi, pi, pos.get(I), I.length]; }).filter(Boolean));
  const IB2 = it === 4 ? new Uint32Array(o) : new Uint16Array(o);
  o = 0;
  for (const I of out) { IB2.set(I, o); o += I.length; }
  const VB2 = new Float32Array(VB.length + add.length);
  VB2.set(VB); VB2.set(add, VB.length);
  m.it = it;
  return { VB: VB2, IB: IB2, it };
}
// —— 弹舱（fpwpn.js 选中武器时打开）：用户的模型机腹是一整块蒙皮，没有单独的舱门——按真实弹舱的位置把机腹三角形精确切开（多边形裁剪），
//   切出来的几块挂成能绕铰链转的舱门部件（实例参数 iD：0 主弹舱开度、1 侧弹舱开度；乘打开角）；舱口上面补一个深色的弹舱井，开舱时看到的是舱壁和舱里的弹，不是机身里面空的
// 表（模型坐标，米：x 前、y 左、z 上；对着模型机腹的高度量的）：mats 机腹蒙皮材质、z 只切这个高度以下的面；
//   door：b 槽（0 主弹舱 / 1 侧弹舱）、x / y 范围、hy 铰链（舱门绕这条平行机身的线转，开角 A 弧度，自由边往下翻出去）；well：弹舱井 x / y 范围、顶高 top
const V3G_BAY = {
  j20: { mats: ['sd', '__Color_008_7', '_6TOJLMO200AH0001', 'scz', 'wad'], z: 2.0, door: [
    { b: 0, x: [-2.2, 2.5], y: [0, .66], hy: .66, A: 1.75 }, { b: 0, x: [-2.2, 2.5], y: [-.66, 0], hy: -.66, A: 1.75 },   // 主弹舱：中线分开的两扇，铰链在外侧
    { b: 1, x: [-2.3, .9], y: [1.06, 1.42], hy: 1.42, A: 1.6 }, { b: 1, x: [-2.3, .9], y: [-1.42, -1.06], hy: -1.42, A: 1.6 }],   // 侧弹舱：进气道下面斜面上的一扇，铰链在外上沿
  well: [{ x: [-2.2, 2.5], y: [-.66, .66], top: 1.95 }, { x: [-2.3, .9], y: [1.06, 1.42], top: 2.02 }, { x: [-2.3, .9], y: [-1.42, -1.06], top: 2.02 }] },
  j31: { mats: ['side', 'bottom_front', 'Material.002', 'main_body_bottom_front', 'main_body_upper_side'], z: 1.3, door: [   // 两个并列的主弹舱，中间一道龙骨，每舱两扇门（铰链在龙骨边和外侧边）
    { b: 0, x: [-2.1, 2.1], y: [.1, .51], hy: .1, A: 1.75 }, { b: 0, x: [-2.1, 2.1], y: [.51, .92], hy: .92, A: 1.75 },
    { b: 0, x: [-2.1, 2.1], y: [-.51, -.1], hy: -.1, A: 1.75 }, { b: 0, x: [-2.1, 2.1], y: [-.92, -.51], hy: -.92, A: 1.75 }],
  well: [{ x: [-2.1, 2.1], y: [.1, .92], top: 1.52 }, { x: [-2.1, 2.1], y: [-.92, -.1], top: 1.52 }] }
};
const V3G_W0 = [0, 0, 0, 0], V3G_AX = [1, 0, 0], V3G_AY = [0, -1, 0];   // 链式部件默认：沿 −x 后坐（q -= r·d）、绕 −y 转（正角 = 炮口抬起）
// 坦克炮管（v3gVeh 开炮时后坐、复进）：炮塔部件里炮管那一段（模型坐标：x 起点往前、|y| 以内、z 以上的三角形）拆成单独的部件，和炮塔一起转；
//   L 后坐行程（米，125 / 120 毫米坦克炮约 0.3 米）、rock 车体后坐翘起的幅度（弧度）
const V3G_GUN = { ztz96: { x: .85, y: .35, z: 1.5, L: .32, rock: .035 }, m1a1: { x: 1.65, y: .35, z: 1.9, L: .3, rock: .03 } };
function v3gGun(cf, m, VB, IB) {
  const ti = (m.parts || []).findIndex(p => p.n === 'tur');
  if (ti < 0) return;
  const T = m.parts[ti], st = m.st, gi = m.parts.push({ n: 'gun', k: 'gun', p: T.p.slice(), a: T.a.slice(), w: [1, 0, 0, 0], w2: [0, 0, 1, 0] }) - 1;
  const inG = v => { const o = v * st; return VB[o] >= cf.x && Math.abs(VB[o + 1]) <= cf.y && VB[o + 2] >= cf.z; };
  for (const lod of m.lod) {
    const add = [];
    for (const e of lod) {
      const [mi, pi, i0, cnt] = e;
      if (pi !== ti) continue;
      const A = [], B = [];
      for (let t = i0; t + 2 < i0 + cnt; t += 3) (inG(IB[t]) && inG(IB[t + 1]) && inG(IB[t + 2]) ? B : A).push(IB[t], IB[t + 1], IB[t + 2]);
      if (!B.length) continue;
      IB.set(A, i0); IB.set(B, i0 + A.length);
      e[3] = A.length; add.push([mi, gi, i0 + A.length, B.length]);
    }
    lod.push(...add);
  }
}
function v3gBays(cf, m, VB, IB) {
  const st = m.st, mis = new Set(cf.mats.map(n => m.mats.findIndex(x => x.n === n)).filter(i => i >= 0)), nv0 = VB.length / st, add = [];
  const V = i => i < nv0 ? Array.from(VB.subarray(i * st, i * st + st)) : add.slice((i - nv0) * st, (i - nv0) * st + st);
  const push = a => { add.push(...a); return nv0 + add.length / st - 1; };
  const mid = (a, b, t) => { const o = a.map((v, i) => v + (b[i] - v) * t), l = Math.hypot(o[3], o[4], o[5]) || 1; o[3] /= l; o[4] /= l; o[5] /= l; return o; };   // 切点：位置、法线、贴图坐标按比例插
  // 凸多边形（顶点 { i 索引, v 数据 }）被一条直线（f ≥ 0 在里面）分成里外两块
  const split = (P, f) => {
    const I = [], O = [];
    P.forEach((a, k) => {
      const b = P[(k + 1) % P.length], fa = f(a.v), fb = f(b.v);
      (fa >= 0 ? I : O).push(a);
      if ((fa >= 0) !== (fb >= 0)) { const c = { v: mid(a.v, b.v, fa / (fa - fb)) }; I.push(c); O.push(c); }
    });
    return [I, O];
  };
  const idx = c => c.i ?? (c.i = push(c.v));
  const fan = (P, out) => { if (P.length < 3) return; for (let k = 1; k + 1 < P.length; k++) out.push(idx(P[0]), idx(P[k]), idx(P[k + 1])); };
  // 舱门部件：铰链线上的点（高度按舱门边上蒙皮的平均高度）、转轴 x
  const parts = m.parts || (m.parts = []), dp = cf.door.map(d => {
    const w2 = [0, 0, 0, 0]; w2[d.b] = d.A * Math.sign(d.hy - (d.y[0] + d.y[1]) / 2);
    return parts.push({ n: 'door', k: 'rot', w: [0, 0, 0, 0], w2, p: [0, d.hy, 0], a: [1, 0, 0] }) - 1;
  }), hz = cf.door.map(() => [0, 0]);
  const L0 = m.lod[0], out = [], segs = [];
  for (const [mi, pi, i0, cnt] of L0) {
    const keep = [], doors = cf.door.map(() => []);
    for (let t = i0; t + 2 < i0 + cnt; t += 3) {
      const tri = [IB[t], IB[t + 1], IB[t + 2]];
      if (pi >= 0 || !mis.has(mi)) { keep.push(...tri); continue; }
      let rest = [tri.map(i => ({ i, v: V(i) }))];
      if (rest[0].some(c => c.v[2] > cf.z)) { keep.push(...tri); continue; }
      cf.door.forEach((d, k) => {
        const nx = [];
        for (const P of rest) {
          const xs = P.map(c => c.v[0]), ys = P.map(c => c.v[1]);
          if (Math.max(...xs) <= d.x[0] || Math.min(...xs) >= d.x[1] || Math.max(...ys) <= d.y[0] || Math.min(...ys) >= d.y[1]) { nx.push(P); continue; }
          let I = P;
          for (const f of [v => v[0] - d.x[0], v => d.x[1] - v[0], v => v[1] - d.y[0], v => d.y[1] - v[1]]) { const [a, b] = split(I, f); if (b.length >= 3) nx.push(b); I = a; if (I.length < 3) break; }
          if (I.length >= 3) { fan(I, doors[k]); for (const c of I) if (Math.abs(c.v[1] - d.hy) < .06) { hz[k][0] += c.v[2]; hz[k][1]++; } }
        }
        rest = nx;
      });
      if (rest.length === 1 && rest[0].length === 3 && rest[0].every((c, j) => c.i === tri[j])) keep.push(...tri);
      else for (const P of rest) fan(P, keep);
    }
    segs.push([mi, pi, keep]);
    doors.forEach((L, k) => { if (L.length) segs.push([mi, dp[k], L]); });
  }
  cf.door.forEach((d, k) => { parts[dp[k]].p = [0, d.hy, hz[k][1] ? hz[k][0] / hz[k][1] : 1.3]; });
  // 弹舱井：四壁 + 顶，法线朝里；四壁底边贴着蒙皮（按井口四角最近的蒙皮高度），关着舱门时藏在蒙皮里
  const wi = m.mats.push({ n: 'bay_well', c: [.13, .14, .15, 1], t: null, nt: null, ns: 1, mr: [.35, .7], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: 0 }) - 1, wl = [];
  const skin = (x, y) => { let b = null, bd = Infinity; for (let i = 0; i < nv0; i++) { const o = i * st, d = Math.hypot(VB[o] - x, VB[o + 1] - y); if (d < bd && VB[o + 2] < cf.z && VB[o + 5] < -.2) { bd = d; b = VB[o + 2]; } } return b ?? 1.3; };
  for (const w of cf.well) {
    const [x0, x1] = w.x, [y0, y1] = w.y, z00 = skin(x0, y0) + .01, z01 = skin(x0, y1) + .01, z10 = skin(x1, y0) + .01, z11 = skin(x1, y1) + .01, T = w.top;
    const q = (a, b, c, d, n) => { const i = [a, b, c, d].map(p => push([...p, ...n, 0, 0])); wl.push(i[0], i[1], i[2], i[0], i[2], i[3]); };
    q([x0, y0, z00], [x1, y0, z10], [x1, y0, T], [x0, y0, T], [0, 1, 0]);    // 右壁（y0 那边，法线朝 +y）
    q([x1, y1, z11], [x0, y1, z01], [x0, y1, T], [x1, y1, T], [0, -1, 0]);
    q([x0, y1, z01], [x0, y0, z00], [x0, y0, T], [x0, y1, T], [1, 0, 0]);    // 后壁（法线朝前）
    q([x1, y0, z10], [x1, y1, z11], [x1, y1, T], [x1, y0, T], [-1, 0, 0]);
    q([x0, y0, T], [x1, y0, T], [x1, y1, T], [x0, y1, T], [0, 0, -1]);      // 顶
  }
  segs.push([wi, -1, wl]);
  // 重排索引：第 0 级细节换成切过的，其余各级照旧挪到后面
  const nI = segs.reduce((a, s) => a + s[2].length, 0) + m.lod.slice(1).reduce((a, L) => a + L.reduce((b, e) => b + e[3], 0), 0), nv = nv0 + add.length / st, it = nv > 65535 ? 4 : m.it;
  const IB2 = it === 4 ? new Uint32Array(nI) : new Uint16Array(nI);
  let o = 0;
  m.lod[0] = segs.map(([mi, pi, L]) => { const e = [mi, pi, o, L.length]; IB2.set(L, o); o += L.length; return e; }).filter(e => e[3]);
  for (const L of m.lod.slice(1)) for (const e of L) { const a = IB.subarray(e[2], e[2] + e[3]); e[2] = o; IB2.set(a, o); o += e[3]; }
  const VB2 = new Float32Array(VB.length + add.length);
  VB2.set(VB); VB2.set(add, VB.length);
  m.it = it;
  return { VB: VB2, IB: IB2, it };
}
// 开局就把一定会用到的模型先下载、解码（士兵、双方坦克），别的等单位第一次出现时再加载
if (typeof HOOK === 'object' && HOOK.newGame) HOOK.newGame.push(() => v3gPreload(['army', 'ztz96', 'm1a1', 'zbd97', 'm2a3']));
// 士兵：用户给的士兵模型原样摆放（T 字站姿，不改模型）；卧倒、匍匐、阵亡时整个放平（脸朝下），别的姿势都站着。k 比例（V3_MAN 一类），side 0 我 / 1 敌 / 2 遗体
const v3gLying = p => p === 'pr' || p === 'dead' || p[0] === 'c' && p !== 'cl0' && p !== 'cl1' || (p[0] === 'L' && +p.slice(1) >= 12);
function v3gMan(kind, pose, x, y, z, a, k, side, roll = 0) {
  const M = v3gModel('army');
  if (!M) return false;
  if (!v3gLying(pose || 'st')) return v3gAdd('army', x, y, z, a, k, side, roll, 0);
  const b = M.meta.bb, h = (b[5] - b[2]) * k, c = Math.cos(a), s = Math.sin(a);   // 放平：绕横轴转 −90°（头朝前、背朝上），身体中点放在原地
  return v3gAdd('army', x - c * h / 2, y - s * h / 2, z + b[3] * k, a, k, side, 0, -Math.PI / 2);
}
