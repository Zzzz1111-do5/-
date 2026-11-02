'use strict';
// 用户给的 3D 模型（tools/v3gbake.js 烘焙成 js/mdl/<键>.js；来源、署名见 docs/credits.md）：几何、贴图、材质原样，带贴图画出来。
//   js/mdl/<键>.js 用到时才加载（网页版、安卓版 fetch 取文本直接解析，本地 file:// 打开、电脑版插 script 标签：v3gPump），解码后建顶点 / 索引缓冲、解码贴图，全部就绪才开始画（不闪一下白模）。
//   模型坐标 x 前、y 左、z 上，单位米（v3units.js 按游戏里的尺寸缩放、摆放，实例参数与 v3mAdd 相同）；
//   能动的部件（坦克炮塔、旋翼、起落架）在顶点着色器里绕自己的轴整块转 / 收起（不改网格），每个实例各自的角度。
//   远处换烘焙时减好的简化网格（只是另外的三角形索引，顶点、贴图还是原来的）——屏幕上看得清的时候画的永远是原模型。
//   光照：太阳（V3_SUN）+ 天光 / 地面反光 + 高光，地形投影、爆炸火光、雾与其它模型一致；模型只显示它原来的颜色（不加敌我色）
const V3G = { def: {}, M: {}, want: new Set(), fail: new Set(), tried: false, ok: false, pr: null, a: {}, u: {}, inst: new Map(), ib: null, ext: null, u32: null, aniso: null, der: false, upq: [] };
V3G.add = (key, meta, b64) => { V3G.def[key] = { meta, b64 }; };

// 下载排队：同时最多两个（一个模型几兆到几十兆，一起下会和字体、界面抢带宽，脚本解析也会挤在同一时刻卡一下）；画面上马上要用的插到队首，预加载的排在后面
function v3gLoad(key, pre) {
  if (typeof document === 'undefined') { V3G.fail.add(key); return; }
  const Q = V3G.lq || (V3G.lq = []);
  if (pre) Q.push(key); else Q.unshift(key);
  v3gPump();
}
// http(s)（网页版、安卓版）：fetch 取文本，切出「键、元数据 JSON、base64」直接交给 V3G.add，不当脚本执行——
//   当脚本加载时 V8 会一直留着几十兆的源码和字符串字面量（菜单阶段就多占一百多兆内存，手机上容易卡、被系统杀掉）；
//   file://（本地打开、电脑版）浏览器不让 fetch 本地文件，照旧插 script 标签；文本格式不对时也退回 script 标签
const V3G_FETCH = typeof fetch === 'function' && typeof location === 'object' && /^https?:$/.test(location.protocol);
function v3gParse(txt) {
  const a = txt.indexOf('V3G.add('), q = txt.lastIndexOf(", '"), e = txt.lastIndexOf("')");
  if (a < 0 || q < a || e < q) return false;
  const head = txt.slice(a + 8, q), c = head.indexOf(',');
  try { V3G.add(JSON.parse(head.slice(0, c)), JSON.parse(head.slice(c + 1)), txt.slice(q + 3, e)); return true; } catch (err) { return false; }
}
function v3gPump() {
  const Q = V3G.lq || [];
  while ((V3G.ln || 0) < 2 && Q.length) {
    const key = Q.shift(), v = typeof window === 'object' && window.DS_BUILD ? '?v=' + encodeURIComponent(window.DS_BUILD) : '', url = 'js/mdl/' + key + '.js' + v;
    V3G.ln = (V3G.ln || 0) + 1;
    const done = () => { V3G.ln--; v3gPump(); }, fail = () => { V3G.ln--; V3G.fail.add(key); console.warn('3D 模型没加载上：' + key); v3gPump(); };
    const tag = () => { const s = document.createElement('script'); s.src = url; s.async = true; s.onload = done; s.onerror = fail; document.head.appendChild(s); };
    if (!V3G_FETCH) { tag(); continue; }
    fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error(r.status))).then(t => { if (v3gParse(t)) done(); else tag(); }, fail);
  }
}
// 预先加载（开局时把这一局会用到的模型先下载、解码，免得单位出现时才开始加载）
function v3gPreload(keys) { for (const k of keys) if (k && !V3G.M[k] && !V3G.def[k] && !V3G.want.has(k) && !V3G.fail.has(k)) { V3G.want.add(k); v3gLoad(k, true); } }

// 模型：就绪返回它，否则开始加载 / 解码、先返回 null
function v3gModel(key) {
  if (key && key.endsWith('~')) return v3gPlain(key);
  if (key === 'podm') return V3G.M.podm || (V3G.ok ? v3gPodModel() : null);
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
// 替身模型（'e2d~'：拿美军的 E-2D 外形代空警-600 这一类）：和原模型共用顶点、贴图，只是不贴底色贴图——原机的国籍标志、舷号都画在底色贴图里，
//   代我方机型时不能带着美军标志；法线贴图留着（板块线、铆钉还在），漆成统一的海军灰。玻璃（半透明材质）照旧
function v3gPlain(key) {
  const M = V3G.M[key];
  if (M) return M;
  const B = v3gModel(key.slice(0, -1));
  if (!B) return null;
  return (V3G.M[key] = Object.assign({}, B, { key, mats: B.mats.map(T => T.am === 2 ? T : Object.assign({}, T, { t: null, c: [.58, .6, .62, T.c[3]], e: [0, 0, 0] })) }));
}
// 吊舱（电子战、干扰吊舱；Sketchfab 上没有能单独用的）：程序化的回转体，沿 x、长 1、中点为原点、直径 0.1 倍长——
//   尖头（介质天线罩）、圆柱段、收尾到一个小平底；只有一种灰漆材质，v3gMsl 按 V3MS 的真实长度缩放
function v3gPodModel() {
  const gl = V3G.gl, R = .05, NS = 18, P = [[.5, 0], [.485, .3], [.46, .55], [.41, .8], [.34, .95], [.27, 1], [-.33, 1], [-.4, .93], [-.47, .72], [-.5, .5], [-.5, 0]];
  const V = [], I = [];
  for (let j = 0; j + 1 < P.length; j++) {   // 每段一条带子，法线按这一段母线的斜率（相邻两段斜率差得不多时取平均，看着是光滑的）
    const sn = k => { const a = P[k], b = P[k + 1], dx = b[0] - a[0], dr = (b[1] - a[1]) * R, l = Math.hypot(dx, dr) || 1; return [dr / l, -dx / l]; };   // (法线 x, 法线 r)：母线从头到尾 x 递减，朝外是 (dr, -dx)
    const n0 = sn(j), nP = j > 0 ? sn(j - 1) : n0, nN = j + 2 < P.length ? sn(j + 1) : n0;
    const sm = (a, b) => a[0] * b[0] + a[1] * b[1] > .85 ? (q => { const l = Math.hypot(q[0], q[1]); return [q[0] / l, q[1] / l]; })([a[0] + b[0], a[1] + b[1]]) : a;
    const ends = [[P[j], sm(n0, nP)], [P[j + 1], sm(n0, nN)]], b0 = V.length / 8;
    for (const [[x, r], [nx, nr]] of ends) for (let i = 0; i <= NS; i++) { const a = i / NS * Math.PI * 2, c = Math.cos(a), si = Math.sin(a); V.push(x, r * R * c, r * R * si, nx, nr * c, nr * si, i / NS, x + .5); }
    for (let i = 0; i < NS; i++) { const a = b0 + i, b = a + NS + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  const M = { key: 'podm', ready: true, tex: [], parts: [], rad: Math.hypot(1, 2 * R, 2 * R) / 2, sbb: [-.5, .5, -R, R, -R, R],
    meta: { len: 1, st: 8, it: 2, zc: 0, bb: [-.5, -R, -R, .5, R, R], lod: [0, 1, 2].map(() => [[0, -1, 0, I.length]]) },
    mats: [{ n: 'pod', c: [.5, .53, .55, 1], e: [0, 0, 0], mr: [.15, .5], t: null, nt: null, am: 0, ns: 1, ac: .5 }] };
  M.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
  M.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
  return (V3G.M.podm = M);
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
  const PTg = V3G_PAINT[key];
  if (PTg && PTg.glow) M.glowS = v3gGlowSeg(m, R ? R.VB : VB, R ? R.IB : IB, PTg.glow);   // 发光灯带的线段（v3fx.js 沿着画发光的光带）
  if (key === 'army' && typeof v3manImgs === 'function') v3manImgs(m, bin);   // 士兵贴图原图留一份（甲板人员、飞行员换装时重新着色）
  if (R && R.it === 4 && !V3G.u32) throw new Error('显卡不支持 32 位索引');
  M.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, R ? R.VB : VB, gl.STATIC_DRAW);
  M.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, R ? R.IB : IB, gl.STATIC_DRAW);
  // 包围球半径（选远近网格、远处带本方颜色用）、影子用的包围盒（v3light.js 的格式：x0 x1 y0 y1 z0 z1）
  const b = m.bb;
  M.rad = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2; M.sbb = [b[0], b[3], b[1], b[4], b[2], b[5]];
  // 贴图：原图字节解码后上传；全部好了才算就绪
  // 重新涂装的模型（V3G_PAINT）：换掉的照片贴图不再解码、上传（省下几十兆显存），涂装材质贴一张淡淡的漆面斑驳纹理
  const mats = m.mats.map(x => Object.assign({}, x)), PT = V3G_PAINT[key], nT = m.imgs.length;
  if (PT) for (const T of mats) { const c = PT.m[T.n] || (T.t && !PT.keep.includes(T.n) ? PT.def : null); if (c) Object.assign(T, { c: [c[0], c[1], c[2], T.c[3]], t: c[4] ? null : [nT, 0, 0], mr: c[3] || PT.mr, e: [0, 0, 0] }); }   // c[4]：不贴漆面纹理（金属件）
  if (PT && PT.glow) for (const T of mats) { const g = PT.glow[T.n]; if (g) T.e = T.e.map(v => v * g); }   // 自发光加亮（歼-20 的绿色编队灯带：原来的亮度白天几乎看不出来）
  const used = new Set(); for (const T of mats) for (const k of ['t', 'nt', 'mrt', 'sgt', 'et', 'ot']) if (T[k]) used.add(T[k][0]);
  M.tex = await Promise.all(m.imgs.map((I, i) => used.has(i) ? v3gImage(bin.subarray(I.o, I.o + I.n), I.m) : null));
  if (PT) M.tex.push(PT.tex === 'panel' ? v3gPaintTexPanel() : v3gPaintTex());
  M.mats = mats;
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
const V3G_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 uv; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD; attribute vec4 iE;
uniform mat4 uM; uniform vec3 uEye; uniform float uPk, uPm, uRad, uPx, uPl; uniform vec3 uPp, uPa, uPq, uPa2, uPr, uPq3, uPa3; uniform vec4 uPw, uPw2, uPw3, uPe, uPe2, uPg2;
varying vec3 vN, vV, vP; varying vec2 vUv, vW; varying float vSide, vD;
${typeof V3_SHV === 'string' ? V3_SHV : 'uniform mat4 uShM; varying vec4 vSh;'}
vec3 rotA(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1. - c); }
void main() {
  vec3 q = p, m = n;
  if (uPk > -.5) {
    float ang = dot(iC, uPw) + dot(iD, uPw2) + dot(iE, uPw3);   // 实例的部件参数按权重组合（一般只取自己那一个；舵面 = 俯仰、滚转、偏航、襟翼、前缘、减速几个通道按权重；弹舱门 = 开度 × 打开角）
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
    for (const k of ['p', 'n', 'uv', 'iA', 'iB', 'iC', 'iD', 'iE']) V3G.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uPk', 'uPm', 'uPl', 'uPp', 'uPa', 'uPw', 'uPw2', 'uPw3', 'uPq', 'uPa2', 'uPr', 'uPe', 'uPe2', 'uPq3', 'uPa3', 'uPg2', 'uRad', 'uPx', 'uC', 'uSG', 'uTf', 'uTf2', 'uMR', 'uE', 'uNs', 'uAm', 'uAc', 'uTb', 'uTn', 'uTm', 'uTe', 'uTo', 'uLm', 'uFog', 'uWorld', 'uBg', 'uLmOn', 'uBm', 'uMx', 'uHl', 'uHlC', 'uShM', 'uShT', 'uShOn', 'uShP']) V3G.u[k] = gl.getUniformLocation(pr, k);
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
// 每个实例 20 个数：位置、朝向（iA）、缩放、敌我、滚转、俯仰（iB）、部件参数 12 个（iC、iD、iE：iE 是舵面的偏航、襟翼、前缘襟翼、减速板通道）
const V3G_IST = 20;
function v3gAdd(key, x, y, z, a, k, side, roll = 0, pitch = 0, parts = null) {
  const M = v3gModel(key);
  if (!M) return false;
  const C = V3G.C, E = C ? C.E : [x, -y, z + 100], d = Math.hypot(x - E[0], -y - E[1], z - E[2]), px = M.rad * k / Math.max(d, 1) * V3G.px;
  const lod = Math.min(M.meta.lod.length - 1, px > 70 ? 0 : px > 22 ? 1 : 2), ik = key + '#' + lod;
  let L = V3G.inst.get(ik);
  if (!L) V3G.inst.set(ik, L = { M, lod, d: new Float32Array(16 * V3G_IST), n: 0 });
  if ((L.n + 1) * V3G_IST > L.d.length) { const d2 = new Float32Array(L.d.length * 2); d2.set(L.d); L.d = d2; }
  const o = L.n * V3G_IST;
  L.d[o] = x; L.d[o + 1] = -y; L.d[o + 2] = z; L.d[o + 3] = -a; L.d[o + 4] = k; L.d[o + 5] = side; L.d[o + 6] = roll; L.d[o + 7] = pitch;
  for (let i = 0; i < 12; i++) L.d[o + 8 + i] = parts ? parts[i] || 0 : 0;
  L.n++;
  return true;
}
// 视锥的六个面（GL 坐标，列主序的视图投影矩阵；平面已归一化，点到面的距离 < −半径 就整个在外面）
function v3gFrustum(M) {
  const P = new Float32Array(24), row = r => [M[r], M[4 + r], M[8 + r], M[12 + r]], w = row(3);
  [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]].forEach(([r, sg], i) => { const q = row(r), a = w.map((v, j) => v + sg * q[j]), l = Math.hypot(a[0], a[1], a[2]) || 1; for (let j = 0; j < 4; j++) P[i * 4 + j] = a[j] / l; });
  return P;
}
// 模型离原点最远能到多远（米，按包围盒、留两成余量：旋翼转起来、外翼折起、起落架补高都在里面）
const v3gRadO = M => M.radO || (M.radO = M.meta.bb ? 1.25 * Math.hypot(...[0, 1, 2].map(i => Math.max(Math.abs(M.meta.bb[i]), Math.abs(M.meta.bb[i + 3])))) : 2 * (M.rad || 1));
// 正常那一遍只画视锥里的实例（阴影那一遍照画全部：视野外的东西影子会落进画面）：每帧每个列表筛一次，挤到 L.vd
function v3gCull(L, P, key) {
  const d = L.d, R0 = v3gRadO(L.M);
  if (!L.vd || L.vd.length < d.length) L.vd = new Float32Array(d.length);
  let n = 0;
  for (let i = 0; i < L.n; i++) {
    const o = i * V3G_IST, x = d[o], y = d[o + 1], z = d[o + 2], r = -R0 * d[o + 4];
    let ok = true;
    for (let j = 0; j < 24; j += 4) if (P[j] * x + P[j + 1] * y + P[j + 2] * z + P[j + 3] < r) { ok = false; break; }
    if (ok) { L.vd.set(d.subarray(o, o + V3G_IST), n * V3G_IST); n++; }
  }
  L.vn = n; L.vk = key;
}
// 画：先画不透明、镂空的，再画半透明的（不写深度）。LM：太阳阴影图的光源矩阵（view3d.js v3ShPass 那一遍只写深度，半透明的不投影）——
//   阴影那一遍用简化一级的网格（飞机模型最精细一级五万到二十多万个面，影子贴图分辨率有限，看不出差别），航母上空一群飞机时显卡的活少一大截
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
  const FR = LM ? null : v3gFrustum(C.M);
  for (const pass of LM ? [0] : [0, 1]) {
    if (pass) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    for (const L of V3G.inst.values()) {
      if (!L.n) continue;
      if (FR && (L.vk !== C.M || L.vf !== V3G.frame)) { v3gCull(L, FR, C.M); L.vf = V3G.frame; }
      const N = FR ? L.vn : L.n, Dt = FR ? L.vd : L.d;
      if (!N) continue;
      const M = L.M, m = M.meta, st = m.st * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, M.vb);
      gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, st, 24);
      gl.bindBuffer(gl.ARRAY_BUFFER, V3G.ib); gl.bufferData(gl.ARRAY_BUFFER, Dt.subarray(0, N * V3G_IST), gl.DYNAMIC_DRAW);
      for (const [k, o] of [['iA', 0], ['iB', 16], ['iC', 32], ['iD', 48], ['iE', 64]]) { if (A[k] < 0) continue; gl.enableVertexAttribArray(A[k]); gl.vertexAttribPointer(A[k], 4, gl.FLOAT, false, V3G_IST * 4, o); X.vertexAttribDivisorANGLE(A[k], 1); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
      gl.uniform1f(U.uRad, M.rad);
      const it = m.it === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      for (const [mi, pi, i0, cnt] of m.lod[LM ? Math.min(m.lod.length - 1, L.lod + 1) : L.lod]) {
        const T = M.mats[mi];
        const gh = !!V3G.glass && V3G.glass.key === M.key && V3G.glass.hud === T.n;   // 玩家开着的这型飞机：平显玻璃（模型里是一整块不透明的亮绿色）当透明玻璃画
        if ((T.am === 2 || gh) !== !!pass) continue;
        const P = pi >= 0 ? M.parts[pi] : null;
        if (P && P.k === 'noz' && M.nzRep) continue;   // 换上了真实喷口模型（v3noz.js）：模型自带的调节片不画
        gl.uniform1f(U.uPk, P ? pi : -1);
        if (P) {
          const w = P.w || [pi === 0 ? 1 : 0, pi === 1 ? 1 : 0, pi === 2 ? 1 : 0, pi >= 3 ? 1 : 0];
          const w2 = P.w2 || V3G_W0;
          gl.uniform1f(U.uPm, P.k === 'hide' ? 1 : P.k === 'noz' ? 2 : P.k === 'gun' ? 3 : P.k === 'era' ? 4 : P.k === 'chain' ? 5 : 0); gl.uniform1f(U.uPl, P.k === 'chain' ? (P.hb != null ? P.hb + 2 : 0) : P.l || 1); gl.uniform3f(U.uPp, P.p[0], P.p[1], P.p[2]); gl.uniform3f(U.uPa, P.a[0], P.a[1], P.a[2]); gl.uniform4f(U.uPw, w[0], w[1], w[2], w[3]); gl.uniform4f(U.uPw2, w2[0], w2[1], w2[2], w2[3]); const w3 = P.w3 || V3G_W0; gl.uniform4f(U.uPw3, w3[0], w3[1], w3[2], w3[3]);
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
        X.drawElementsInstancedANGLE(gl.TRIANGLES, cnt, it, i0 * m.it, N);
      }
      for (const k of ['iA', 'iB', 'iC', 'iD', 'iE']) { if (A[k] < 0) continue; X.vertexAttribDivisorANGLE(A[k], 0); gl.disableVertexAttribArray(A[k]); }
    }
    if (pass) { gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  for (const k of ['p', 'n', 'uv']) gl.disableVertexAttribArray(A[k]);
  for (let u = 4; u >= 0; u--) tex(u, null);
}

// ———————————————— 兵种 → 模型 ————————————————
// 用户给了模型的兵种直接用；没给的先用同类里最接近的一个代替（换模型只改这几张表）。键：车辆是 models.js 的 RLM 型号，飞机是 airSilKey / eair 的机型键
const V3G_VEH = { ztz99a: 'ztz99', ztz96b: 'ztz96', ztz96m: 'ztz96', m1a1: 'm1a1', m1a2: 'm1a2v3', m2a3: 'm2a3', m109: 'm109', m1134: 'stryker', m1127: 'stryker', mshorad: 'stryker', m903: 'patriot', m163: 'm163',
  m1150: 'm1150', lpws: 'cram', jltv: 'matv', m1117: 'matv', avenger: 'hmmwv',   // 美军（Sketchfab 模型，tools/v3gmodels.json；没有精确型号的用最接近的：JLTV、M1117 用 M-ATV，复仇者用悍马底盘）
  zbd05: 'zbd97', zbd04a: 'zbd97', zbd03: 'zbd97', ztd05: 'zbd97', ptl02: 'ptl02', pgl625: 't625', pgz07: 't625', plz07: 'pzh2000', zsl92b: 'lav25', zbl08: 'lav25', ld2000: 'cram' };   // 解放军：ZBD-05 / 03、ZTD-05 用 ZBD-04，PGZ-07 用 625，PLZ-07 用 PzH 2000，ZSL-92B / 08 式用 LAV-25，LD-2000 用陆基密集阵
const v3gVehKey = (rk, side) => V3G_VEH[rk] || (side === 'e' ? 'm1a1' : 'ztz96');   // 其余装甲车：解放军的用 96 式、美军的用 M1A1 代替
const V3G_AIR = {
  j20: 'j20', j35: 'j31', j16: 'j16', j16b: 'j16', j16m: 'j16', j15: 'j15', z10: 'z10w', j50: 'j50', h6k: 'h6k', y20: 'y20', transport: 'y20', heli: 'z21',   // 我方（歼-35 用它的原型歼-31；歼-15T 用歼-15，歼-16D 用歼-16）
  kj600: 'e2d~', gj11: 'x47b~', gj2: 'mq9~', wz7: 'rq4~',   // 我方没有模型的：外形最接近的美军机代替（攻击-11 用同是飞翼的 X-47B），去掉原机涂装（v3gPlain：不带美军标志）
  f22: 'f22', f35: 'f35', f35b: 'f35', a10: 'a10', mq9: 'mq9', b2: 'b2', c17: 'c17', p8: 'p8', ah64: 'ah64', uh60: 'uh60'   // 美军（Sketchfab，CC-BY）
};
// 直升机旋翼转速（弧度 / 秒）：主旋翼按真实额定转速——AH-64 289 转 / 分、UH-60 258 转 / 分（公开资料的常见值）；
//   直-10 没有公开数据：按旋翼直径 13 米、与前两型相同的桨尖速度（约 220 米 / 秒）估算，约 325 转 / 分；
//   尾桨真实约 1200–1400 转 / 分，画面上每帧转过的角超过桨叶间隔就会看着倒转、频闪，按 60 画
const V3G_ROTOR = { ah64: [30.3, 60], uh60: [27, 60], z10w: [34, 60] };
// 导弹（v3msl.js V3MS 的型号）→ 模型：AIM-120C、AIM-9 用单独的精细模型，其余按外形从导弹组合里挑
const V3G_MSL = {
  aim120: 'aim120', aim9: 'aim9', agm65: 'agm65', bomb: 'mk83', agm: 'brimstone', pl15: 'aim120s', pl10: 'asraam', pl17: 'ks172', ld10: 'aim120s', manpad: 'aim9s',
  hhq9: 'ks172', sm6: 'ks172', hhq16: 'aim54', hhq10: 'asraam', yj21: 'ks172', tbm: 'ks172', df15: 'ks172', sdb: 'gbu24', pod: 'podm', tpod: 'podm', jpod: 'podm'   // 吊舱：程序化的回转体（v3gPodModel）
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
function v3gPlane(key, sz, x, y, z, ground, h, side, roll, pitch, gear, t, noz = 0, ctl = null, bay = null, fold = 0) {   // noz：尾喷口开合（正 = 张开，负 = 收拢）；ctl：舵面 { de 平尾（负 = 后缘上偏、抬头）, da 滚转差动 }（v3det.js v3dPitch 按气动算）；bay：弹舱门开度 { main, side }（fpwpn.js fwBay）；fold：外翼折起程度（V3G_FOLD，甲板上）
  const mk = V3G_AIR[key] || 'j31', M = v3gModel(mk);
  if (!M) return false;
  const k = sz / M.meta.len;
  let ox = x, oy = y, oz = z;
  if (!ground) { const o = v3dMv3(h, pitch, roll, [0, 0, M.meta.zc * k]); ox -= o[0]; oy += o[1]; oz -= o[2]; }   // 绕机身中线俯仰、滚转（模型原点在机轮着地处）
  const P = [0, 0, 0, 0, bay ? bay.main || 0 : 0, bay ? bay.side || 0 : 0, fold || 0, 0, 0, 0, 0, 0];
  M.parts.forEach((p, i) => { const j = p.slot ?? i; if (j > 3) return; if (p.n === 'gear') P[j] = gear ? 0 : 1; else if (p.n === 'rotor') P[j] = (t || 0) * (V3G_ROTOR[mk] || [22])[0]; else if (p.n === 'trotor') P[j] = (t || 0) * (V3G_ROTOR[mk] || [0, 61])[1]; else if (p.k === 'noz') P[j] = noz; });
  if (M.ctl && ctl) { P[2] = ctl.de || 0; P[3] = ctl.da || 0; P[8] = ctl.dr || 0; P[9] = ctl.df || 0; P[10] = ctl.dl || 0; P[11] = ctl.sb || 0; }   // 舵面（弧度）：俯仰、滚转、偏航、后缘襟翼、前缘襟翼、减速板
  if (typeof v3nzPlane === 'function') v3nzPlane(mk, M, ox, oy, oz, h, k, roll, pitch, noz);   // 换装了真实喷口模型的机型（v3noz.js：会收缩的收敛扩散喷口）
  return v3gAdd(mk, ox, oy, oz, h, k, side, roll, pitch, P);
}
// 飞机模型上一点（模型坐标，米）此刻在世界的哪里（游戏坐标 x、y，高度 z）：和 v3gPlane 同一套变换（绕机身中线俯仰、滚转）——弹舱里的弹、挂点按它放
function v3gAt(key, sz, x, y, z, h, pitch, roll, v, fold = 0) {   // fold：外翼折着的（甲板上），外翼上的点跟着翻上去
  const mk = V3G_AIR[key] || 'j31', M = V3G.M[mk];
  if (!M || !M.ready) return null;
  if (fold > 0) v = v3gFoldPt(mk, v, fold);
  const k = sz / M.meta.len, r = v3dMv3(h, pitch, roll, [v[0] * k, v[1] * k, (v[2] - M.meta.zc) * k]);
  return [x + r[0], y - r[1], z + r[2]];
}
// 导弹：model 型号键（V3MS），sc 世界单位 / 米（v3MslK 等）；按这一型的真实长度缩放模型；roll：挂在折起的外翼下面时跟着翻
function v3gMsl(mk, x, y, z, h, sc, side, pitch = 0, roll = 0) {
  const key = v3gMslKey(mk), M = v3gModel(key);
  if (!M) return false;
  const L = typeof V3MS === 'object' && V3MS[mk] ? V3MS[mk].L : M.meta.len;
  return v3gAdd(key, x, y, z, h, sc * L / M.meta.len, side, roll, pitch);
}
const V3G_HELI = { z10: 1, heli: 1, ah64: 1, uh60: 1 };   // 直升机（不按航迹抬头）
// 飞机机身中线离机轮着地处多高（世界单位）
function v3gPlaneZc(key, sz) { const M = V3G.M[V3G_AIR[key] || 'j31']; return M && M.ready ? M.meta.zc * sz / M.meta.len : sz * .12; }
// 用户给的模型的署名（tools/v3gmodels.json 的 credit；设置面板「素材致谢」里列出，v3import.js v3imCredits）
const V3G_CRED = [{"name":"96 式主战坦克","title":"ZTZ96","author":"jzmhhhhh","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/ztz96-b0da178e50dc423983445841615d9e80"},{"name":"M1A1 艾布拉姆斯","title":"M1A1 Abrams Main Battle Tank","author":"MirzaArrafiERV_45","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m1a1-abrams-main-battle-tank-1529f5d842cb4f578aa8cb672524f044"},{"name":"歼-20","title":"Chinese Chengdu J-20","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/chinese-chengdu-j-20-b9e81062c94545ffb0232d3ac6b7adc5"},{"name":"歼-16","title":"Shenyang J16 Hidden Dragon","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/shenyang-j16-hidden-dragon-2b950f910677457fbb52b6096f81e70b"},{"name":"歼-31 鹘鹰","title":"Shenyang J31 Gyrfalcon","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/shenyang-j31-gyrfalcon-23dbff530e21491299ac67bbab42b553"},{"name":"直-10","title":"Changhe Z-10W","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/changhe-z-10w-617cb4a91dfd4eaaa59161e06691df7f"},{"name":"直-21","title":"[MW] Z-21","author":"xlisov","license":"CC-BY-NC-4.0","url":"https://sketchfab.com/3d-models/mw-z-21-a2d88447f0904f49b73f94fa88dccea5"},{"name":"士兵","title":"Army Character 2","author":"MirzaArrafiERV_45","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/army-character-2-e3c4da4a33bb42ed8512f423a4319c5a"},{"name":"AIM-120C","title":"AIM-120C AMRAAM","author":"Jeyhun1985","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/aim-120c-amraam-838fa923340a4d108e05c99bf0146ff6"},{"name":"AIM-9","title":"AIM-9 missile","author":"rickslash","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/aim-9-missile-caaf15b49bac4144b6c6be577c2b872a"},{"name":"AIM-54 不死鸟、AIM-9 响尾蛇（组合）、AIM-120（组合）、KS-172、AIM-132 ASRAAM、GBU-24 宝石路、Mk 83 炸弹、AGM-65 小牛、AGM-154 JSOW、硫磺石","title":"300 followers - free aircraft missile set","author":"NETRUNNER_pl","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/300-followers-free-aircraft-missile-set-2e70bc2ea0824897b2ccaea378809c9e"},{"name":"M2A3 布雷德利步兵战车","title":"M2 Bradley IFV","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m2-bradley-ifv-ab022158ab5f4fbfa55d4142db7595ab"},{"name":"M109A7 帕拉丁自行榴弹炮","title":"M109 PALADIN ARTILLERY","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m109-paladin-artillery-3de0572475d54f7b9da18d6ed26b4a10"},{"name":"斯特赖克 8×8 装甲车（M1126 步兵输送车外形）","title":"M1126 Infantry Carrier Vehicle","author":"cenobyte","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m1126-infantry-carrier-vehicle-b0c559a02c1842b0976a241c9a998360"},{"name":"M903 爱国者导弹发射车","title":"MIM-104 Patriot Air Defense System","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/mim-104-patriot-air-defense-system-95e1e402426f4ddcb543af7a0455cf05"},{"name":"M163 火神自行高炮","title":"M163 VADS","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m163-vads-66a6f08ad2d945ccb6e72267e55bc685"},{"name":"C-RAM 陆基密集阵（百人队长）","title":"Centurion C-RAM","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/centurion-c-ram-10ea7349c7574ca7a43991eece92c9a9"},{"name":"M1150 突击破障车","title":"M1150 ABV","author":"Kalibrovshik","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/m1150-abv-26eaeb6a7dbf498db16e02b1c232de33"},{"name":"M-ATV 防地雷全地形车（代 JLTV、M1117）","title":"Oshkosh M-ATV","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/oshkosh-m-atv-291dc8f07a494751b318e623b89cf538"},{"name":"M998 悍马（代复仇者防空车底盘）","title":"HMMWV M998A1 (soft top)","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/hmmwv-m998a1-soft-top-ffbc4b053628413fb84acf5b89595d96"},{"name":"ZBD-04 步兵战车（原称 97 式）","title":"ZBD-97","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/zbd-97-b36e44ca383e4ab296e28321167e5ba4"},{"name":"PTL-02 轮式突击炮","title":"Chinese PTL-02","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/chinese-ptl-02-e087eff1ed9b48cabe06d9467fec3311"},{"name":"PGL-625 弹炮结合防空车","title":"Type-625 Anti Aircraft Gun Missile System","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/type-625-anti-aircraft-gun-missile-system-8b7e85f45b954592bd4bb8e72cdd6312"},{"name":"PzH 2000 自行榴弹炮（代 PLZ-07）","title":"PANZERHAUBITZE 2000 ARTILLERY (PzH-2000)","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/panzerhaubitze-2000-artillery-pzh-2000-da078be6bc66461e87034f29600a4982"},{"name":"LAV-25 轮式装甲车（代 ZSL-92B、08 式）","title":"LAV-25","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/lav-25-968b0681119a4b3e82d94bb085a790be"},{"name":"F-22A 猛禽","title":"Lockheed Martin F-22 \"Raptor\"","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/lockheed-martin-f-22-raptor-7e7b3c372e374dda98e70208d09cfdcf"},{"name":"F-35A 闪电 II","title":"Lockheed Martin F35 Lightning II","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/lockheed-martin-f35-lightning-ii-db911de503c74285a8d506951df786d6"},{"name":"A-10C 雷电 II","title":"A-10 Thunderbolt II","author":"AIRMAN Magazine","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/a-10-thunderbolt-ii-9521ff6ba5d448958ea45a89e94ab23d"},{"name":"AH-64D 阿帕奇","title":"Boeing AH-64D Apache Combat Helicopter","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/boeing-ah-64d-apache-combat-helicopter-c3b58008c46b45048fdd7dd283a3c8c8"},{"name":"UH-60M 黑鹰","title":"Sikorsky UH-60M Blackhawk","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/sikorsky-uh-60m-blackhawk-12b4e525676a49678ac3006b360c8750"},{"name":"C-17A 环球霸王 III","title":"C-17 Globemaster III","author":"KOG_THORNS","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/c-17-globemaster-iii-552f88697c7f4aeebf254f7cb9f239ed"},{"name":"B-2A 幽灵","title":"B2 Spirit","author":"dannzjs","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/b2-spirit-d1fb2607daa44dde8efcdcd870655262"},{"name":"P-8A 波塞冬","title":"Boeing P-8 Poseidon","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/boeing-p-8-poseidon-3fc134024b69403bb5df5ab3aff48919"},{"name":"MQ-9A 死神（代攻击-2）","title":"MQ-9","author":"IProZenoN","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/mq-9-fabe963feb354c5584b51f9c470c3f7e"},{"name":"歼-15 飞鲨（代歼-15T）","title":"PLA Navy Shenyang J-15","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/pla-navy-shenyang-j-15-f2bf5c1e2e654ee6819b696b6095a552"},{"name":"歼-50","title":"Shenyang J-50","author":"Chenzoss","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/shenyang-j-50-6b0cb86c094048ea811ef0faf570b4b9"},{"name":"运-20 鲲鹏","title":"Xi'an Y20 \"Kunpeng\"","author":"andertan","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/xian-y20-kunpeng-40ce0195eb07494f83304574aafbb3bc"},{"name":"轰-6","title":"Chinese Xi'an H-6","author":"42manako","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/chinese-xian-h-6-6990848462c54f4397cce71dffa1409f"},{"name":"E-2D 先进鹰眼（代空警-600）","title":"Grumman E-2D Advanced Hawkeye","author":"Muhamad Mirza Arrafi","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/grumman-e-2d-advanced-hawkeye-0082cf8f15044cfd80ebd4e11b96789d"},{"name":"X-47B（代攻击-11）","title":"Northrop Grumman X-47B","author":"yakudami","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/northrop-grumman-x-47b-8d5fa8ab10ba4b8486d40248eeb9332d"},{"name":"RQ-4 全球鹰（代无侦-7）","title":"RQ4_global_hawk","author":"kio","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/rq4-global-hawk-dd87adcff26b46e58639e9256f5301c4"},{"name":"ZTZ-99A 主战坦克","title":"Type 99 MBT","author":"philano","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/type-99-mbt-7075c92c5ef1408497f1530703ff2942"},{"name":"M1A2 SEPv3 艾布拉姆斯","title":"Abrams M1A2 SEPv3","author":"dannzjs","license":"CC-BY-4.0","url":"https://sketchfab.com/3d-models/abrams-m1a2-sepv3-eb6f5560198740269507e9948376414c"}];
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
    { n: 'ail', h: [[-3.745, 4.74], [-3.73, 5.77]], y: [4.7, 5.82], w: [0, 0, 0, 1] }] } },
  // 歼-15：座椅坐垫顶面约 2.79 米高（stof1）、靠背在 x 4.57–4.86；坐姿眼高约坐垫上方 0.78 米，眼睛在头靠前面一点——正好从平显组合玻璃（hud_2，x 5.44–5.61、高 3.44–3.62）中间看出去
  j15: { eye: [4.97, 0, 3.57], hud: 'hud_2' },
  // 歼-20（与歼-15 同一位作者、同一套座舱零件，同样量法）：坐垫顶面 2.44 米（stof1，x 5.05–5.43）、靠背到 x 4.99（seat_buis_1），眼高坐垫上方 0.78 米 = 3.22，
  //   眼睛在头靠前面一点 x 5.12——正好从平显组合玻璃（hud_2，x 5.54–5.72、高 3.11–3.28）中间看出去
  // 歼-20 新模型：平显玻璃本来就是透明的。喷管（模型实测，发动机轴线 y ±0.785、z 0.805）：机身短舱到 x −8.93 收口，扩散段调节片（Material.001，整架飞机很多零件也用这个材质）
  //   从喉道（x −8.95，内半径 0.35）张到出口（x −9.65，内半径 0.50、外半径约 0.57）——按位置、离轴半径挑出来做开合部件，外表面、内锥面各拆成自己的材质（as / asIn，按三角形中心离轴半径 rin 分），好单独上色；
  //   喉道后面原来是平板圆盘和一串粗糙的灰色内部结构（短舱壳里、离轴 0.5 米以内，外面看不见，只从喉道露出来；hole：挖掉），从后面看进去改成 v3jet.js 画的发动机后段（thr：放在出口前 u 米、半径 r、深 d）
  j20: { eye: [5.7, 0, 3.25], noz: { mat: 'Material.001', x0: -8.93, x1: -9.67, r0: .3, r1: .64, as: 'nozzle', rin: .52, asIn: 'nozzle_in' },
    hole: [{ mat: 'grey', x: [-8.97, -7.3], r: .5 }, { mat: 'Material.001', x: [-9.01, -8.9], r: .345 }], thr: { u: .61, r: .35, d: 1.5 } } };   // 歼-50 等模型没有座舱内饰：座舱视角放在机头上方，不画自己
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
  const clone = nm => nm ? m.mats.push({ ...m.mats[ni], n: nm }) - 1 : undefined;   // 拆出来的三角形换成新材质（V3G_PAINT 按名字上色）
  const mo = ni >= 0 && N.as ? clone(N.as) : undefined, mIn = ni >= 0 && N.asIn ? clone(N.asIn) : mo;
  if (ni >= 0 && noz) for (const sg of noz[1] ? [1, -1] : [1]) {
    const pi = parts.push({ n: 'noz', k: 'noz', slot: 1, w: [0, 1, 0, 0], p: [N.x0, noz[1] * sg, noz[2]], a: [1, 0, 0], l: N.x0 - N.x1 }) - 1;
    const rr = v => { const o = v * st; return Math.hypot(VB[o + 1] - noz[1] * sg, VB[o + 2] - noz[2]); };
    const test = v => { const o = v * st, x = VB[o], r = rr(v); return x <= N.x0 + .02 && x >= N.x1 - .02 && r >= N.r0 && r <= N.r1; };
    if (N.rin) {   // 内锥面、外表面分开（按三角形中心离轴半径）：同一个部件，一起开合
      const rc = v => { const o = v.map(i => i * st); return Math.hypot((VB[o[0] + 1] + VB[o[1] + 1] + VB[o[2] + 1]) / 3 - noz[1] * sg, (VB[o[0] + 2] + VB[o[1] + 2] + VB[o[2] + 2]) / 3 - noz[2]); };
      G.push({ mi: new Set([ni]), pi, mo: mIn, tri: v => v.every(test) && rc(v) < N.rin });
      G.push({ mi: new Set([ni]), pi, mo, tri: v => v.every(test) && rc(v) >= N.rin });
    } else G.push({ mi: new Set([ni]), pi, mo, test });
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
        const v = [IB[t], IB[t + 1], IB[t + 2]], k = G.findIndex(g => g.mi.has(mi) && (g.tri ? g.tri(v) : v.every(g.test)));
        B[k + 1].push(v[0], v[1], v[2]);
      }
      if (B.slice(1).every(b => !b.length)) continue;
      let k = i0;
      for (const b of B) for (const v of b) IB[k++] = v;
      e[3] = B[0].length; let o = i0 + B[0].length;
      B.slice(1).forEach((b, j) => { if (b.length) add.push([G[j].mo ?? mi, G[j].pi, o, b.length]); o += b.length; });
    }
    lod.push(...add);
  }
}
// —— 舵面（所有固定翼飞机机翼、尾翼上能动的地方）：按铰链线把网格切开（凸多边形裁剪，位置、法线、贴图坐标按比例插），切出来的那块挂成绕铰链转的部件 ——
//   不管模型的舵面是不是单独的面都能切；舵面两头的边顺着气流（与 x 轴平行的面切），弦向切到 c 米为止（不会切到后面的平尾），离铰链面 th 米以外的三角形不动（不切机身、挂架、弹）。
//   表 V3G_CS[模型键]：mats 只切这些材质（不给就全切）；s 舵面表，每片：
//     n 名字；h 铰链两端 [[x, y, z], [x, y, z]]（模型坐标，米：x 前、y 左、z 上，有补起落架的按抬高后的）；左右对称的写左边（y > 0）一侧，自动镜像（mir: false 不镜像）；
//     d 'aft' 后缘舵面（铰链后面那块转）/ 'fwd' 前缘襟翼（铰链前面那块转）；t 厚度方向（机翼 [0, 0, 1]，垂尾 [0, 1, 0]，外倾的写法线）；c 弦长上限、th 厚度上限（米）；
//     cf 全动舵面（鸭翼、全动平尾、全动垂尾）转轴另一边也要切的弦长（米）；
//   ex：不切的区域 [x0, x1, |y|0, |y|1, z0, z1]（襟翼作动筒整流罩之类挂在翼下的东西：有顶点落在里面的三角形不动）；
//   切口补封口面：铰链处固定的那半、转动的那半各封一面（舵面偏转时看到的是实心的断面，不是机翼里面空的），舵面两头的切口也封上
//     w 各通道的权重 { de 俯仰, da 滚转, dr 偏航, df 后缘襟翼, dl 前缘襟翼, sb 减速板 }：转角 = Σ 权重 × 通道（弧度）；正角 = 转动的那块往 −t 偏（后缘 / 前缘下偏）；镜像那一侧 da、dr 反号
//   通道（v3gPlane 的 ctl）：de 平尾（JSBSim 符号：正 = 后缘下偏 = 低头）、da 滚转（正 = 右滚：左副翼下偏）、dr 方向舵（正 = 机头向左）、df 襟翼放下、dl 前缘襟翼放下、sb 减速板打开
function v3gCtlCut(cf, m, VB, IB) {
  const st = m.st, nv0 = VB.length / st, add = [], parts = m.parts || (m.parts = []);
  const mis = cf.mats ? new Set(cf.mats.map(n => m.mats.findIndex(x => x.n === n)).filter(i => i >= 0)) : null;
  const V = i => i < nv0 ? Array.from(VB.subarray(i * st, i * st + st)) : add.slice((i - nv0) * st, (i - nv0) * st + st);
  const push = a => { add.push(...a); return nv0 + add.length / st - 1; };
  const mid = (a, b, t) => { const o = a.map((v, i) => v + (b[i] - v) * t), l = Math.hypot(o[3], o[4], o[5]) || 1; o[3] /= l; o[4] /= l; o[5] /= l; return o; };
  const split = (P, f) => {
    const I = [], O = [], X = [];
    P.forEach((a, k) => {
      const b = P[(k + 1) % P.length], fa = f(a.v), fb = f(b.v);
      (fa >= 0 ? I : O).push(a);
      if ((fa >= 0) !== (fb >= 0)) { const c = { v: mid(a.v, b.v, fa / (fa - fb)) }; I.push(c); O.push(c); X.push(c); }
    });
    return [I, O, X];
  };
  const idx = c => c.i ?? (c.i = push(c.v));
  const fan = (P, out) => { if (P.length < 3) return; for (let k = 1; k + 1 < P.length; k++) out.push(idx(P[0]), idx(P[k]), idx(P[k + 1])); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const exc = v => cf.ex && cf.ex.some(b => v[0] >= b[0] && v[0] <= b[1] && Math.abs(v[1]) >= b[2] && Math.abs(v[1]) <= b[3] && v[2] >= b[4] && v[2] <= b[5]);
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const G = [];
  for (const s of cf.s) for (const sg of s.mir === false ? [1] : [1, -1]) {
    const P0 = [s.h[0][0], s.h[0][1] * sg, s.h[0][2]], P1 = [s.h[1][0], s.h[1][1] * sg, s.h[1][2]], t0 = s.t || [0, 0, 1];
    const a = nrm(sub(P1, P0)), t = [t0[0], t0[1] * sg, t0[2]], tn = nrm(sub(t, a.map(v => v * dot(t, a))));
    let c = nrm(crs(tn, a));
    if (s.d === 'fwd' ? c[0] < 0 : c[0] > 0) c = c.map(v => -v);
    const sx = nrm([0, a[1], a[2]]), cm = s.c || 1.5, cf = s.cf || 0, th = s.th || .45, W = s.w || {};
    let s0 = dot(P0, sx), s1 = dot(P1, sx);
    if (s0 > s1) [s0, s1] = [s1, s0];
    const pi = parts.push({ n: s.n, k: 'rot', p: P0, a: crs(tn, c), w: [0, 0, W.de || 0, (W.da || 0) * sg], w2: [0, 0, 0, 0], w3: [(W.dr || 0) * sg, W.df || 0, W.dl || 0, W.sb || 0] }) - 1;
    const xs = [P0[0], P1[0], P0[0] + c[0] * cm, P1[0] + c[0] * cm, P0[0] - c[0] * cf, P1[0] - c[0] * cf];
    G.push({ P0, a, c, tn, sx, s0, s1, cm, cf, th, pi, cap: [[], [], []], x0: Math.min(...xs) - .05, x1: Math.max(...xs) + .05 });
  }
  const segs = [];
  for (const [mi, pi, i0, cnt] of m.lod[0]) {
    const keep = [], outp = G.map(() => []);
    for (let t = i0; t + 2 < i0 + cnt; t += 3) {
      const tri = [IB[t], IB[t + 1], IB[t + 2]];
      if (pi >= 0 || (mis && !mis.has(mi))) { keep.push(...tri); continue; }
      let rest = [tri.map(i => ({ i, v: V(i) }))], hit = false;
      if (cf.ex && rest[0].some(q => exc(q.v))) { keep.push(...tri); continue; }
      G.forEach((g, k) => {
        const nx = [];
        for (const P of rest) {
          const xs = P.map(q => q.v[0]);
          if (Math.max(...xs) < g.x0 || Math.min(...xs) > g.x1) { nx.push(P); continue; }
          const dn = P.map(q => dot(sub(q.v, g.P0), g.tn)), sv = P.map(q => dot(q.v, g.sx)), cv = P.map(q => dot(sub(q.v, g.P0), g.c));
          if (dn.some(d => Math.abs(d) > g.th) || Math.max(...sv) <= g.s0 || Math.min(...sv) >= g.s1 || Math.max(...cv) <= -g.cf || Math.min(...cv) >= g.cm) { nx.push(P); continue; }
          let I = P;
          const F = [v => dot(sub(v, g.P0), g.c) + g.cf, v => g.cm - dot(sub(v, g.P0), g.c), v => dot(v, g.sx) - g.s0, v => g.s1 - dot(v, g.sx)];
          for (let j = 0; j < 4; j++) {
            const [A, B, X] = split(I, F[j]);
            if (B.length >= 3) nx.push(B);
            if (X.length === 2 && A.length >= 3 && j !== 1) g.cap[j === 0 ? 0 : j - 1].push([X[0].v, X[1].v, mi]);   // 切口线段（铰链面 / 两头）：最后补封口面
            I = A;
            if (I.length < 3) break;
          }
          if (I.length >= 3) { fan(I, outp[k]); hit = true; }
        }
        rest = nx;
      });
      if (!hit && rest.length === 1 && rest[0].length === 3 && rest[0].every((q, j) => q.i === tri[j])) keep.push(...tri);
      else for (const P of rest) fan(P, keep);
    }
    segs.push([mi, pi, keep]);
    outp.forEach((L, k) => { if (L.length) segs.push([mi, G[k].pi, L]); });
  }
  // 封口面：铰链面上的切口线段连到铰链轴线上（窄长的断面不会画出界），两头的切口扇形连到断面中心；固定的一半、转动的一半各一面，法线朝着缺口
  const capV = (v, n) => { const o = v.slice(); o[3] = n[0]; o[4] = n[1]; o[5] = n[2]; return push(o); };
  G.forEach(g => {
    const byM = new Map(), put = (mi, part, a) => { const kk = mi + '#' + part; if (!byM.has(kk)) byM.set(kk, [mi, part, []]); byM.get(kk)[2].push(...a); };
    for (const [A, B, mi] of g.cap[0]) {
      const O = g.P0.map((v, j) => v - g.c[j] * g.cf), pr = p => { const t = dot(sub(p, O), g.a); return [O[0] + g.a[0] * t, O[1] + g.a[1] * t, O[2] + g.a[2] * t, ...p.slice(3)]; }, qA = pr(A), qB = pr(B);   // 切面所在的那条线（全动舵面切在转轴前 cf 处）
      for (const [n, part] of [[g.c, -1], [g.c.map(v => -v), g.pi]]) { const i = [A, B, qB, qA].map(p => capV(p, n)); put(mi, part, [i[0], i[1], i[2], i[0], i[2], i[3]]); }
    }
    for (const [L, sgn] of [[g.cap[1], 1], [g.cap[2], -1]]) {
      if (!L.length) continue;
      const cen = [0, 1, 2].map(j => L.reduce((sm, q) => sm + q[0][j] + q[1][j], 0) / (2 * L.length)), nOut = g.sx.map(v => v * sgn);
      for (const [A, B, mi] of L) {
        const C = [...cen, ...A.slice(3)];
        for (const [n, part] of [[nOut, -1], [nOut.map(v => -v), g.pi]]) { const i = [A, B, C].map(p => capV(p, n)); put(mi, part, i); }
      }
    }
    for (const q of byM.values()) segs.push(q);
  });
  const nI = segs.reduce((a, q) => a + q[2].length, 0) + m.lod.slice(1).reduce((a, L) => a + L.reduce((b, e) => b + e[3], 0), 0), nv = nv0 + add.length / st, it = nv > 65535 ? 4 : m.it;
  const IB2 = it === 4 ? new Uint32Array(nI) : new Uint16Array(nI);
  let o = 0;
  m.lod[0] = segs.map(([mi, pi, L]) => { const e = [mi, pi, o, L.length]; IB2.set(L, o); o += L.length; return e; }).filter(e => e[3]);
  for (const L of m.lod.slice(1)) for (const e of L) { const a = IB.subarray(e[2], e[2] + e[3]); e[2] = o; IB2.set(a, o); o += e[3]; }
  const VB2 = new Float32Array(VB.length + add.length);
  VB2.set(VB); VB2.set(add, VB.length);
  m.it = it;
  return { VB: VB2, IB: IB2, it };
}
const V3G_CS = {
  // 歼-20（andertan 的模型：机翼、鸭翼是几块大平板，舵面没有单独建，按真机的布局切；坐标按抬高 1.25 米后的）——鸭式三角翼：
  //   全动鸭翼（转轴约在平均气动弦 1/4 处，抬头时前缘上偏）、后缘内侧襟副翼与外侧副翼（升降副翼：俯仰、滚转一起管，起降时襟副翼放下）、
  //   前缘机动襟翼（迎角大了放下）、全动垂尾（外倾约 27°，偏航；降落时两片对着偏当减速板）
  j20: { ex: [[-7.7, -6.1, 3.42, 3.84, 2, 2.5], [-7.5, -6, 5.13, 5.57, 2, 2.5]], s: [
    { n: 'can', h: [[2.4, 1.98, 2.42], [2.4, 4.08, 2.44]], d: 'aft', c: 1.85, cf: 1.6, th: .14, w: { de: -1.2, da: .25 } },
    { n: 'flpr', h: [[-6.3, 2.55, 2.45], [-6.35, 4.35, 2.41]], d: 'aft', c: 1.6, th: .13, w: { de: .8, da: .8, df: 1 } },
    { n: 'ail', h: [[-7.15, 4.45, 2.4], [-7, 6.5, 2.36]], d: 'aft', c: 1.1, th: .13, w: { de: .5, da: 1, df: .3 } },
    { n: 'lef', h: [[-2.3, 2.6, 2.45], [-6.35, 5.7, 2.37]], d: 'fwd', c: .8, th: .13, w: { dl: 1 } },
    { n: 'vt', h: [[-9.25, 1.9, 2.56], [-9.5, 2.88, 4.5]], t: [0, .894, -.447], d: 'aft', c: 1.05, cf: .95, th: .18, w: { dr: -.7, sb: .5 } }] }
};
// 挖洞：喷管喉道后面模型自带的东西（平板圆盘、粗糙的内部结构，从后面看进去是一块亮灰的盘子）——每条规则按材质、x 范围、离两台发动机轴线的半径挑出三角形（三个顶点都在里面），从绘制段里去掉
// 发光灯带（V3G_PAINT 的 glow 材质，歼-20 的绿色电致发光编队灯）：模型里只有几厘米宽，追尾镜头 20 米外就不到一个像素，白天基本看不见——
//   解码时把每条灯带（按位置焊接后的连通块）算成一段线（相距最远的两点、朝外的平均法线）；左右缺了的按对称补上（模型左边机头少一串）。v3fx.js 沿着画发光的光带
function v3gGlowSeg(m, VB, IB, glow) {
  const st = m.st, S = [];
  for (const [mi, , i0, cnt] of m.lod[0]) {
    if (!glow[m.mats[mi].n]) continue;
    const key = v => Math.round(VB[v * st] * 200) + ',' + Math.round(VB[v * st + 1] * 200) + ',' + Math.round(VB[v * st + 2] * 200);
    const par = new Map(), f = a => { while (par.get(a) !== a) { const g = par.get(par.get(a)); par.set(a, g); a = g; } return a; }, T = [];
    for (let t = i0; t + 2 < i0 + cnt; t += 3) { const tr = [IB[t], IB[t + 1], IB[t + 2]]; T.push(tr); for (const v of tr) { const k = key(v); if (!par.has(k)) par.set(k, k); } }
    for (const tr of T) { const a = f(key(tr[0])); for (const v of tr.slice(1)) { const b = f(key(v)); if (a !== b) par.set(b, a); } }
    const C = new Map();
    for (const tr of T) {
      const r = f(key(tr[0]));
      let c = C.get(r);
      if (!c) C.set(r, c = { P: [], n: [0, 0, 0] });
      for (const v of tr) { const o = v * st; c.P.push([VB[o], VB[o + 1], VB[o + 2]]); c.n[0] += VB[o + 3]; c.n[1] += VB[o + 4]; c.n[2] += VB[o + 5]; }
    }
    for (const c of C.values()) {
      const P = c.P, cen = [0, 1, 2].map(j => P.reduce((sm, p) => sm + p[j], 0) / P.length), d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      const far = q => P.reduce((b, p) => d2(p, q) > d2(b, q) ? p : b, P[0]), a = far(cen), b = far(a), nl = Math.hypot(...c.n) || 1;
      S.push({ a, b, n: c.n.map(v => v / nl) });
    }
  }
  const near = (p, q) => Math.abs(p[0] - q[0]) < .12 && Math.abs(p[1] + q[1]) < .12 && Math.abs(p[2] - q[2]) < .12;   // p 是不是 q 的镜像点
  for (const sg of S.slice()) if (Math.abs(sg.a[1]) > .2 && !S.some(o => near(o.a, sg.a) || near(o.b, sg.a)))
    S.push({ a: [sg.a[0], -sg.a[1], sg.a[2]], b: [sg.b[0], -sg.b[1], sg.b[2]], n: [sg.n[0], -sg.n[1], sg.n[2]] });
  return S;
}
function v3gPitHole(cf, m, VB, IB) {
  const noz = m.noz && m.noz[0];
  if (!cf.hole || !noz) return;
  const st = m.st, ax = noz[1] ? [noz[1], -noz[1]] : [0];
  for (const H of [].concat(cf.hole)) {
    const hi = m.mats.findIndex(x => x.n === H.mat);
    if (hi < 0) continue;
    const hit = v => { const o = v * st, x = VB[o]; return x >= H.x[0] && x <= H.x[1] && ax.some(y => Math.hypot(VB[o + 1] - y, VB[o + 2] - noz[2]) < H.r); };
    for (const lod of m.lod) for (const e of lod) {
      if (e[0] !== hi || e[1] >= 0) continue;
      let k = e[2];
      for (let t = e[2]; t + 2 < e[2] + e[3]; t += 3) if (!(hit(IB[t]) && hit(IB[t + 1]) && hit(IB[t + 2]))) { IB[k] = IB[t]; IB[k + 1] = IB[t + 1]; IB[k + 2] = IB[t + 2]; k += 3; }
      e[3] = k - e[2];
    }
  }
}
function v3gPrep(key, m, M, VB, IB) {
  if (key === 'army' && typeof v3manPrep === 'function') return v3manPrep(m, VB, IB);   // 士兵：焊接顶点、平滑法线、算绑骨权重（v3man.js：姿势、着装）
  const mf = V3G_MATFIX[key];
  if (mf) for (const i in mf) { const T = m.mats[i], F = mf[i]; if (!T) continue; if (F.am != null) T.am = F.am; if (F.a != null) T.c = [T.c[0], T.c[1], T.c[2], F.a]; }
  if (V3G_FLIP[key]) v3gFlip(m, VB);
  if (V3G_ROTSPLIT[key]) v3gRotor(V3G_ROTSPLIT[key], m, VB, IB);
  let R = null;
  const use = r => { if (r) { R = r; VB = r.VB; IB = r.IB; } };   // 补了顶点的步骤换成更长的新数组，后面的步骤接着在新数组上做
  if (V3G_GEAR[key]) use(v3gGear(V3G_GEAR[key], m, VB, IB));   // 补起落架（整架抬高）：弹舱、座舱、挂点都按抬高后的坐标
  if (V3G_CS[key]) { use(v3gCtlCut(V3G_CS[key], m, VB, IB)); M.ctl = true; }   // 舵面：按铰链线切开机翼、尾翼，切出来的挂成绕铰链转的部件
  const cf = V3G_PIT[key];
  if (cf) { v3gPitScr(cf, m, M, VB, IB); v3gPitHud(cf, m, M, VB, IB); v3gPitHole(cf, m, VB, IB); v3gPitParts(cf, m, M, VB, IB); }
  if (V3G_GUN[key]) v3gGun(V3G_GUN[key], m, VB, IB);
  if (V3G_CAPS[key]) v3gCaps(V3G_CAPS[key], m, VB, IB);
  if (V3G_FOLD[key]) use(v3gFold(V3G_FOLD[key], m, VB, IB));
  else if (V3G_ERA[key]) use(v3gEra(V3G_ERA[key], m, VB, IB));
  else if (V3G_BAY[key]) use(v3gBays(V3G_BAY[key], m, VB, IB));
  return R;
}
// —— 材质纠正：直-10 原模型四个材质全设成了 25% 不透明的半透明（整架直升机像幽灵）——机身、桨叶改回不透明；主旋翼的残影盘本是半透明，调淡到 8%（原来盖在机身上一大片发暗）——
const V3G_MATFIX = { z10w: { 0: { am: 0, a: 1 }, 1: { am: 0, a: 1 }, 2: { a: .08 } } };
// 重新涂装：歼-31、歼-16、运-20（同一位作者）的「贴图」是把真机照片投影上去的——带着蓝天、跑道背景和照片水印，近看一块块拼起来，
//   歼-31 还是 31001 验证机深蓝底、橙色折线的试飞涂装。改成部队的标准涂装（颜色是线性空间）：m 按材质名给，其余带贴图的材质用 def，keep 里的照原样（座舱显示屏）；
//   歼-35 海军浅灰（下表面更浅）、歼-16D 空军中灰（偏蓝）、运-20 空军浅灰（发动机短舱深一些）；mr 金属度、粗糙度（哑光漆）
const V3G_PAINT = {
  j31: { def: [.17, .19, .21], mr: [.12, .58], keep: ['screen'], m: { Wing_bottom: [.23, .25, .27], main_body_bottom: [.23, .25, .27], main_body_bottom_front: [.23, .25, .27], bottom_front: [.23, .25, .27] } },
  j16: { def: [.1, .12, .15], mr: [.12, .55], keep: [], m: {} },
  y20: { def: [.23, .24, .25], mr: [.1, .55], keep: [], m: { Engine_metal: [.09, .09, .1, [.6, .4]], engine_mat: [.14, .14, .15] } },
  // 歼-20（andertan 的模型没有贴图）：整架用机头那个材质（模型里的 Material.001：深灰微带青、金属度 0.83、粗糙度 0.69）——
//   吸波涂层里掺着金属粉，看上去是带金属感的哑光反光（用户指定：机身、舱门、口盖板全照机头的来，不再叠面板纹理）；喷口、玻璃、灯带另外上色
  j20: { def: [.1888, .1989, .1932, [.83, .686], 1], mr: [.83, .686], keep: [], m: { grey: [.1888, .1989, .1932, [.83, .686], 1], 'grey.001': [.1888, .1989, .1932, [.83, .686], 1], 'grey.003': [.1888, .1989, .1932, [.83, .686], 1],
    'grey.011': [.1888, .1989, .1932, [.83, .686], 1], 'grey.012': [.1888, .1989, .1932, [.83, .686], 1],
    'Material.007': [.1888, .1989, .1932, [.83, .686], 1], 'Material.008': [.1888, .1989, .1932, [.83, .686], 1], 'Material.016': [.1888, .1989, .1932, [.83, .686], 1], 'Material.017': [.1888, .1989, .1932, [.83, .686], 1],
    'Material.025': [.1888, .1989, .1932, [.83, .686], 1], 'Material.010': [.1888, .1989, .1932, [.83, .686], 1],
    // 喷管不涂吸波漆，是裸露的耐热合金：锯齿调节片外表面烧成橄榄青铜色（钛合金、高温合金受热后的回火色），内锥面亮一些的钢灰——与深灰机身明显不同
    nozzle: [.15, .128, .058, [.82, .42], 1], nozzle_in: [.34, .33, .31, [.9, .34], 1] },
    // 绿色电致发光编队灯带（机头两侧座舱下方、两片垂尾上各一条，夜间编队飞行看僚机用）：模型里本来就有，亮度加到白天也看得出、能泛一点光
    glow: { 'Material.009': 4, 'Material.014': 4, 'Material.020': 4, 'Material.022': 4, 'Material.024': 4 } }
};
// 漆面纹理（所有重新涂装的模型共用一张）：256 见方、能平铺的几层平滑噪声，亮度在 0.94–1 之间——不至于一整块纯色，像风吹日晒过的漆面
// 吸波涂层的面板感（歼-20 这类重新涂装、模型又没有贴图的）：大小不一的面板各自深浅只差一点点（真机整架是一种灰，近看才分得出一块块蒙皮）、面板缝淡淡一条、轻微斑驳——
//   照模型自带的贴图坐标铺（一块块展开的面就是一块块蒙皮）；原来零星画的浅色锯齿形胶带真机上没有，去掉
function v3gPaintTexPanel() {
  if (V3G.paintTexP) return V3G.paintTexP;
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), im = g.createImageData(N, N), T = new Float32Array(N * N).fill(.955);
  let sd = 20240511; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const R = [], cut = (x0, y0, x1, y1, d) => {
    const w = x1 - x0, h = y1 - y0;
    if (w < 28 || h < 28 || (w < 150 && h < 150 && rnd() < .5 + d * .08)) { R.push([x0, y0, x1, y1]); return; }
    if (w > h ? rnd() < .8 : rnd() < .2) { const m = Math.round(x0 + w * (.3 + .4 * rnd())); cut(x0, y0, m, y1, d + 1); cut(m, y0, x1, y1, d + 1); }
    else { const m = Math.round(y0 + h * (.3 + .4 * rnd())); cut(x0, y0, x1, m, d + 1); cut(x0, m, x1, y1, d + 1); }
  };
  cut(0, 0, N, N, 0);
  for (const [x0, y0, x1, y1] of R) {
    const t = (rnd() - .5) * .04;   // 这块面板深浅（只差一点点）
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) T[y * N + x] += t;
    for (let x = x0; x < x1; x++) T[y0 * N + x] -= .035;   // 面板缝
    for (let y = y0; y < y1; y++) T[y * N + x0] -= .035;
  }
  const h2 = (i, j, s) => { const v = Math.sin((i % s) * 127.1 + (j % s) * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const vn = (x, y, s) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), a = h2(i, j, s), b = h2(i + 1, j, s), c = h2(i, j + 1, s), d = h2(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = clamp(T[y * N + x] + .02 * (vn(x / 96, y / 96, 6) - .5) + .01 * (vn(x / 12, y / 12, 43) - .5) + .006 * (rnd() - .5), .8, 1), o = (y * N + x) * 4;
    im.data[o] = im.data[o + 1] = im.data[o + 2] = Math.round(255 * v); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return (V3G.paintTexP = v3gUpload(cv));
}
function v3gPaintTex() {
  if (V3G.paintTex) return V3G.paintTex;
  const N = 256, cv = document.createElement('canvas'), g = cv.getContext('2d'), im = g.createImageData(N, N), rnd = (i, j, s) => { const h = Math.sin((i % s) * 127.1 + (j % s) * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const vn = (x, y, s) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), a = rnd(i, j, s), b = rnd(i + 1, j, s), c = rnd(i, j + 1, s), d = rnd(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = .5 * vn(x / 64, y / 64, 4) + .3 * vn(x / 16, y / 16, 16) + .2 * vn(x / 4, y / 4, 64), v = Math.round(255 * (.94 + .06 * n)), o = (y * N + x) * 4;
    im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return (V3G.paintTex = v3gUpload(cv));
}
// —— 机头朝 −x 的模型（烘焙时朝向反了：C-17、运-20、轰-6、X-47B）：解码时绕竖轴转 180°——顶点、法线和部件的支点、转轴、喷口位置一起转（正交旋转，三角形绕向不变）。
//   X-47B 的文件里原来并排放着两架（一架折翼），重新烘焙时已按节点去掉了一架（tools/v3gmodels.json dropNodes）；
//   v3gmodels.json 里这几型的喷口 noz 是烘焙出来的坐标（机头朝 −x），这里跟着转——
const V3G_FLIP = { c17: 1, y20: 1, h6k: 1, x47b: 1 };
function v3gFlip(m, VB) {
  const st = m.st;
  for (let i = 0; i + 5 < VB.length; i += st) { VB[i] = -VB[i]; VB[i + 1] = -VB[i + 1]; VB[i + 3] = -VB[i + 3]; VB[i + 4] = -VB[i + 4]; }
  for (const P of m.parts || []) for (const k of ['p', 'a', 'q', 'a2', 'r', 'q3', 'a3']) if (P[k]) P[k] = [-P[k][0], -P[k][1], P[k][2]];
  if (m.noz) m.noz = m.noz.map(n => [-n[0], -n[1], ...n.slice(2)]);
}
// —— 直升机旋翼：直-10 的桨叶、桨毂和机身烘焙成了一体（没有部件），旋翼不会转（AH-64、UH-60 重新烘焙时已按节点、范围拆成部件，tools/v3gmodels.json）。
//   按连通块（顶点按坐标合并）挑出主旋翼与尾桨，拆成 rotor / trotor 两个部件绕各自的轴转（v3gPlane 按 V3G_ROTOR 的转速给角度）。数据是按块的包围盒量出来的：
//   c：主旋翼桨毂中心（模型米：x 前、y 左、z 上）；z：主旋翼块的高度范围（桨叶、桨毂、桨夹；桨毂下面的旋翼轴、阿帕奇轴顶的雷达不转）；
//   r：块中心离旋翼轴多远以内；tb：尾桨块的范围 [x0, x1, y0, y1, z0, z1]；tc：尾桨中心（绕左右轴转）
const V3G_ROTSPLIT = {
  z10w: { c: [1.21, 0, 2.95], z: [2.78, 3.17], r: 6.1, tb: [-7.2, -3.6, -.6, -.35, 1.3, 4.7], tc: [-5.41, -.46, 3.01] }
};
function v3gRotor(cf, m, VB, IB) {
  const st = m.st, parts = m.parts || (m.parts = []);
  const iR = parts.push({ n: 'rotor', k: 'spin', p: cf.c.slice(), a: [0, 0, 1] }) - 1, iT = parts.push({ n: 'trotor', k: 'spin', p: cf.tc.slice(), a: [0, 1, 0] }) - 1;
  const q = i => Math.round(VB[i * st] * 1000) + ',' + Math.round(VB[i * st + 1] * 1000) + ',' + Math.round(VB[i * st + 2] * 1000), tb = cf.tb;
  for (const lod of m.lod) {
    const add = [];
    for (const e of lod) {
      const [mi, pi, i0, cnt] = e;
      if (pi !== -1) continue;
      const par = new Map(), find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par.set(a, b); };
      for (let t = i0; t + 2 < i0 + cnt; t += 3) { const k = [q(IB[t]), q(IB[t + 1]), q(IB[t + 2])]; for (const x of k) if (!par.has(x)) par.set(x, x); uni(k[0], k[1]); uni(k[1], k[2]); }
      const box = new Map();
      for (let t = i0; t + 2 < i0 + cnt; t += 3) {
        const r = find(q(IB[t]));
        let b = box.get(r);
        if (!b) box.set(r, b = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]);
        for (let j = 0; j < 3; j++) { const o = IB[t + j] * st; b[0] = Math.min(b[0], VB[o]); b[1] = Math.max(b[1], VB[o]); b[2] = Math.min(b[2], VB[o + 1]); b[3] = Math.max(b[3], VB[o + 1]); b[4] = Math.min(b[4], VB[o + 2]); b[5] = Math.max(b[5], VB[o + 2]); }
      }
      const cls = new Map();
      for (const [r, b] of box) {
        const main = b[4] >= cf.z[0] && b[5] <= cf.z[1] && Math.hypot((b[0] + b[1]) / 2 - cf.c[0], (b[2] + b[3]) / 2 - cf.c[1]) < cf.r;
        const tail = b[0] >= tb[0] && b[1] <= tb[1] && b[2] >= tb[2] && b[3] <= tb[3] && b[4] >= tb[4] && b[5] <= tb[5];
        cls.set(r, main ? 1 : tail ? 2 : 0);
      }
      const keep = [], mr = [], tr = [];
      for (let t = i0; t + 2 < i0 + cnt; t += 3) { const c = cls.get(find(q(IB[t]))); (c === 1 ? mr : c === 2 ? tr : keep).push(IB[t], IB[t + 1], IB[t + 2]); }
      if (!mr.length && !tr.length) continue;
      let o = i0;
      IB.set(keep, o); e[3] = keep.length; o += keep.length;
      if (mr.length) { IB.set(mr, o); add.push([mi, iR, o, mr.length]); o += mr.length; }
      if (tr.length) { IB.set(tr, o); add.push([mi, iT, o, tr.length]); o += tr.length; }
    }
    lod.push(...add);
  }
}
// —— 模型里没放起落架的（按飞行状态做的模型：歼-50、F-22、运-20、RQ-4）：停在甲板、跑道上时机腹贴地。整架抬高 lift（真实全高减模型高），补上起落架——
//   支柱（下段活塞细、上段外筒粗，顶端插进机腹：从轮轴往上打一条竖线和网格求交，取最低的交点）、斜撑、轮胎、轮毂、放下时竖在轮舱两边的舱门、舰载机前起落架的弹射杆，
//   合成一个 'gear' 部件（离地后收起：着色器里整块收成一点，与别的模型的起落架同一套）。抬高后机身中线高 zc、喷口、部件支点跟着抬，弹舱、挂点、座舱都按抬高后的坐标标定。
//   legs（米，模型坐标 x 前、y 左；y ≠ 0 的左右各一个）：r 轮半径、w 轮宽、n 每根轴几个轮（1 单轮偏在外侧、2 双轮夹着支柱）、tan 串列双轴的轴距（中间一根摇臂）、
//   br 斜撑往前（+1）/ 往后（−1）、door 舱门 [长, 高]（不给就不画）、bar 弹射杆。数据来源见各行注释（公开照片估计，型号没公布的按同级飞机）
const V3G_GEAR = {
  j50: { lift: 1.3, legs: [{ x: 4.4, y: 0, r: .3, w: .18, n: 2, br: -1, bar: 1, door: [1.1, .5] },   // 歼-50：前起落架双轮（舰载机，带弹射杆）、主起落架单轮——公开照片的说法；主轮在两个机腹弹舱外侧
    { x: -1.4, y: 1.95, r: .42, w: .26, n: 1, br: 1, door: [1.4, .6] }] },
  // 歼-20：全高 4.45 米（模型 3.2）；前起落架单轮，主起落架单轮——位置照模型机腹上画的起落架舱门（前轮舱 x 4.0–5.3，主轮舱 x −6.7 – −5.1）
  j20: { lift: 1.25, legs: [{ x: 4.6, y: 0, r: .31, w: .19, n: 1, br: -1, door: [1.2, .5] }, { x: -5.9, y: 1.7, r: .45, w: .28, n: 1, br: 1, door: [1.5, .6] }] },
  f22: { lift: 1.04, legs: [{ x: 4.3, y: 0, r: .3, w: .19, n: 1, br: -1, door: [1.1, .5] },   // F-22：全高 5.08 米（模型 4.04）；前轮 23.5 × 7.5 英寸、主轮 37 × 11.5 英寸（单轮），主轮在主弹舱外侧
    { x: -1.9, y: 1.6, r: .47, w: .29, n: 1, br: 1, door: [1.5, .6] }] },
  y20: { lift: .5, legs: [{ x: 17.6, y: 0, r: .5, w: .32, n: 2, br: -1, door: [2.2, .7] },   // 运-20：全高 15 米（模型 14.5）；前起落架双轮，主起落架每侧三根轴、每轴双轮，收在机身两侧的整流罩里
    { x: 1.7, y: 2.35, r: .62, w: .38, n: 2 }, { x: 0, y: 2.35, r: .62, w: .38, n: 2 }, { x: -1.7, y: 2.35, r: .62, w: .38, n: 2 }] },
  rq4: { lift: .55, legs: [{ x: 4.6, y: 0, r: .26, w: .14, n: 1, br: -1 }, { x: -.6, y: 1.25, r: .3, w: .16, n: 1, br: 1 }] }   // RQ-4：全高约 4.7 米（模型 4.1），三点式单轮
};
// 竖线 (x, y) 和第 0 级网格（不算部件）交点里最低的高——起落架支柱顶端插进去的机腹蒙皮；打不到返回 null
function v3gRayZ(m, VB, IB, x, y) {
  const st = m.st;
  let best = null;
  for (const [, pi, i0, cnt] of m.lod[0]) {
    if (pi >= 0) continue;
    for (let t = i0; t + 2 < i0 + cnt; t += 3) {
      const a = IB[t] * st, b = IB[t + 1] * st, c = IB[t + 2] * st, ax = VB[a], ay = VB[a + 1], bx = VB[b], by = VB[b + 1], cx = VB[c], cy = VB[c + 1];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || y < Math.min(ay, by, cy) || y > Math.max(ay, by, cy)) continue;
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * VB[a + 2] + l2 * VB[b + 2] + l3 * VB[c + 2];
      if (best == null || z < best) best = z;
    }
  }
  return best;
}
function v3gGear(cf, m, VB, IB) {
  const st = m.st, L = cf.lift, nv0 = VB.length / st;
  for (let i = 2; i < VB.length; i += st) VB[i] += L;   // 1）整架抬高
  m.bb = [m.bb[0], m.bb[1], 0, m.bb[3], m.bb[4], m.bb[5] + L]; m.zc += L;
  for (const P of m.parts || []) for (const k of ['p', 'q', 'q3']) if (P[k]) P[k] = [P[k][0], P[k][1], P[k][2] + L];
  if (m.noz) m.noz = m.noz.map(n => [n[0], n[1], n[2] + L, ...n.slice(3)]);
  // 2）起落架的几何：每个面各用各的顶点（法线按面 / 按圆周），三种材质——轮胎黑、支柱和轮毂浅灰金属、舱门灰
  const add = [], G = { tire: [], metal: [], door: [] };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k], ad = (...v) => v.reduce((o, q) => [o[0] + q[0], o[1] + q[1], o[2] + q[2]], [0, 0, 0]);
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], un = a => sc(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
  const vtx = (p, n) => { add.push(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0); for (let k = 8; k < st; k++) add.push(0); return nv0 + add.length / st - 1; };
  const basis = ax => { const u = un(cr(ax, Math.abs(ax[2]) < .9 ? [0, 0, 1] : [1, 0, 0])); return [u, cr(ax, u)]; };
  const disk = (c, n, r, N, g) => { const [u, v] = basis(n), ci = vtx(c, n); for (let i = 0; i < N; i++) { const a = i / N * 6.2832, b = (i + 1) / N * 6.2832; g.push(ci, vtx(ad(c, sc(u, Math.cos(a) * r), sc(v, Math.sin(a) * r)), n), vtx(ad(c, sc(u, Math.cos(b) * r), sc(v, Math.sin(b) * r)), n)); } };
  const cyl = (c0, c1, r0, r1, N, g, cap = 3) => {   // 圆台：c0 半径 r0 到 c1 半径 r1，侧面法线按圆周平滑；cap 1 / 2 封底 / 顶
    const ax = un(sub(c1, c0)), [u, v] = basis(ax);
    for (let i = 0; i < N; i++) {
      const a = i / N * 6.2832, b = (i + 1) / N * 6.2832, na = ad(sc(u, Math.cos(a)), sc(v, Math.sin(a))), nb = ad(sc(u, Math.cos(b)), sc(v, Math.sin(b)));
      const p = [vtx(ad(c0, sc(na, r0)), na), vtx(ad(c1, sc(na, r1)), na), vtx(ad(c1, sc(nb, r1)), nb), vtx(ad(c0, sc(nb, r0)), nb)];
      g.push(p[0], p[1], p[2], p[0], p[2], p[3]);
    }
    if (cap & 1) disk(c0, sc(ax, -1), r0, N, g);
    if (cap & 2) disk(c1, ax, r1, N, g);
  };
  const box = (c, e, g) => {   // 长方体：中心 c、三个半轴向量 e
    for (const [k, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const n = un(sc(e[k], s)), a = e[(k + 1) % 3], b = e[(k + 2) % 3], f = ad(c, sc(e[k], s));
      const q = [ad(f, sc(a, -1), sc(b, -1)), ad(f, a, sc(b, -1)), ad(f, a, b), ad(f, sc(a, -1), b)].map(p => vtx(p, n));
      g.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  };
  const wheel = (c, r, w) => {   // 轮子（轴沿 y）：胎面 + 胎侧（黑）、两侧轮毂（浅灰，略凸出胎侧）
    cyl([c[0], c[1] - w / 2, c[2]], [c[0], c[1] + w / 2, c[2]], r, r, 18, G.tire);
    for (const s of [-1, 1]) disk([c[0], c[1] + s * (w / 2 + .006), c[2]], [0, s, 0], r * .56, 12, G.metal);
  };
  const skinZ = (x, y) => { const z = v3gRayZ(m, VB, IB, x, y); return z == null ? L + .3 : z; };
  for (const g of cf.legs) for (const sd of g.y ? [1, -1] : [1]) {
    const y = g.y * sd, sr = Math.max(.06, g.r * .2), zt = skinZ(g.x, y) + .05, axles = g.tan ? [g.x + g.tan / 2, g.x - g.tan / 2] : [g.x], zA = g.r;
    for (const xa of axles) {   // 轮：单轮偏在支柱外侧（轴从支柱伸出去），双轮夹着支柱
      const off = g.w / 2 + sr + .03, ws = g.n === 2 ? [-off, off] : [(g.y ? sd : 1) * off];
      for (const o of ws) wheel([xa, y + o, zA], g.r, g.w);
      const yy = ws.map(o => y + o);
      cyl([xa, Math.min(...yy, y), zA], [xa, Math.max(...yy, y), zA], sr * .45, sr * .45, 8, G.metal);   // 轮轴
    }
    if (g.tan) box([g.x, y, zA], [[g.tan / 2 + .12, 0, 0], [0, sr * .8, 0], [0, 0, sr * .7]], G.metal);   // 串列双轴的摇臂
    const zm = zA + (zt - zA) * .45;
    cyl([g.x, y, zA], [g.x, y, zm], sr * .62, sr * .62, 10, G.metal);   // 支柱下段（活塞杆）
    cyl([g.x, y, zm - .04], [g.x, y, zt], sr, sr, 10, G.metal);   // 上段（外筒）
    if (g.br) { const xb = g.x + g.br * Math.max(.6, (zt - zA) * .7), z1 = skinZ(xb, y) + .04; cyl([g.x, y, zA + (zt - zA) * .62], [xb, y, z1], sr * .42, sr * .42, 8, G.metal); }   // 斜撑：从支柱上段斜着撑到机腹
    if (g.bar) cyl([g.x + .08, 0, zA + .05], [g.x + .95, 0, .14], .045, .045, 6, G.metal);   // 弹射杆：往前斜着垂到甲板上方
    if (g.door) {   // 舱门：轮舱两边竖着（侧面的起落架只画外侧一扇），上沿贴着机腹
      const [Ld, Hd] = g.door, dy = (g.n === 2 ? g.w + sr : g.w * 1.5 + sr) + .1;
      for (const s of g.y ? [sd] : [-1, 1]) { const yd = y + s * dy, zd = skinZ(g.x, yd) + .02; box([g.x, yd, zd - Hd / 2], [[Ld / 2, 0, 0], [0, .018, 0], [0, 0, Hd / 2]], G.door); }
    }
  }
  // 3）材质、部件、索引：起落架的三角形接在索引最后，每一级细节都画（几百个三角形）
  const mat = (n, c, mr) => m.mats.push({ n, c, t: null, nt: null, ns: 1, mr, mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: 0 }) - 1;
  const mi = { tire: mat('gear_tire', [.022, .022, .024, 1], [0, .92]), metal: mat('gear_metal', [.6, .61, .63, 1], [.7, .38]), door: mat('gear_door', [.2, .215, .235, 1], [.1, .6]) };
  const parts = m.parts || (m.parts = []), gi = parts.push({ n: 'gear', k: 'hide', p: [0, 0, L], a: [0, 0, 1] }) - 1;
  const nI = G.tire.length + G.metal.length + G.door.length, nv = nv0 + add.length / st, it = nv > 65535 ? 4 : m.it;
  const IB2 = it === 4 ? new Uint32Array(IB.length + nI) : new Uint16Array(IB.length + nI);
  IB2.set(IB);
  let o = IB.length;
  const ents = [];
  for (const k of ['tire', 'metal', 'door']) if (G[k].length) { IB2.set(G[k], o); ents.push([mi[k], gi, o, G[k].length]); o += G[k].length; }
  for (const lod of m.lod) lod.push(...ents.map(e => e.slice()));
  const VB2 = new Float32Array(VB.length + add.length);
  VB2.set(VB); VB2.set(add, VB.length);
  m.it = it;
  return { VB: VB2, IB: IB2, it };
}
// —— 反应装甲块（era.js 按块用掉）：模型上原有的块才有——M1A1 裙板外表面就是 TUSK 的 ARAT，左右各 2 排 × 16 列，每块是 |y| = y 那个面上 0.33 × 0.35 米的一格。
//   每块的正面三角形拆出来、复制顶点，|y| 往外挪「块号 × 0.01 毫米」（看不出来）把块号编进顶点，统统挂到一个 'era' 部件上（只多一次绘制）：
//   着色器按块号查实例参数里的位（iC.yzw、iD.x，各管 16 块；v3gVeh 按 v.era.h 填），炸掉的块收成一点；块后面补焦黑的底板和四壁，平时被块的正面挡着看不见。
//   第 1 级细节（中远处）简化过的块面跨了好几格，换成第 0 级拆好的块面；再远的不拆（一块不到一个像素）。
//   x0 / dx / n：列（从后往前）；zr：两排的上下沿（中间那道缝各列高低差一点）；y：块面、yIn：底板（裙板内板 1.818 外面一点）；
//   rl：用这套块的车型（models.js RLE，块号同一套：边 × 32 + 排 × 16 + 列，右边 0）
const V3G_ERA = { m1a1: { x0: -3.224, dx: 5.352 / 16, n: 16, zr: [.795, 1.144, 1.5], y: 1.9756, yIn: 1.83, rl: ['m1a1'] } };   // M1A2 SEPv3 换了自己的模型（标准配置不挂 TUSK，没有 ARAT）
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
//   door：b 槽（0 主弹舱 / 1 侧弹舱）、x / y 范围、hy 铰链（舱门绕这条平行机身的线转，开角 A 弧度，自由边往下翻出去）、z 这扇门自己的切面高度（不给用 z）；well：弹舱井 x / y 范围、顶高 top、z 找井口蒙皮的高度上限（同那扇门的 z）
const V3G_BAY = {
  // 歼-20（andertan 的模型，补了起落架、整架抬高 1.25 米：高度按抬高后的）：模型机腹上本来就画着弹舱门板——主弹舱在两个进气道之间（门板 3.3 米长，
  //   这里切 4.3 米，装得下 4 米长的霹雳-15），机腹蒙皮里面 0.2 米就是进气道底，弹舱井不能更深；侧弹舱在进气道下侧的斜面上（门板 3.4 米长）
  j20: { mats: ['Material.008', 'Material.016', 'grey'], z: 1.37, door: [
    { b: 0, x: [-2.1, 2.2], y: [0, .78], hy: .78, A: 1.75 }, { b: 0, x: [-2.1, 2.2], y: [-.78, 0], hy: -.78, A: 1.75 },   // 主弹舱：中线分开的两扇，铰链在外侧
    { b: 1, x: [-1.55, 1.89], y: [1.22, 1.57], hy: 1.57, A: 1.6, z: 2.2 }, { b: 1, x: [-1.55, 1.89], y: [-1.57, -1.22], hy: -1.57, A: 1.6, z: 2.2 }],   // 侧弹舱：铰链在外上沿
  well: [{ x: [-2.1, 2.2], y: [-.78, .78], top: 1.47 }, { x: [-1.55, 1.89], y: [1.22, 1.57], top: 2.3, z: 2.2 }, { x: [-1.55, 1.89], y: [-1.57, -1.22], top: 2.3, z: 2.2 }] },
  j31: { mats: ['side', 'bottom_front', 'Material.002', 'main_body_bottom_front', 'main_body_upper_side'], z: 1.3, door: [   // 两个并列的主弹舱，中间一道龙骨，每舱两扇门（铰链在龙骨边和外侧边）
    { b: 0, x: [-2.1, 2.1], y: [.1, .51], hy: .1, A: 1.75 }, { b: 0, x: [-2.1, 2.1], y: [.51, .92], hy: .92, A: 1.75 },
    { b: 0, x: [-2.1, 2.1], y: [-.51, -.1], hy: -.1, A: 1.75 }, { b: 0, x: [-2.1, 2.1], y: [-.92, -.51], hy: -.92, A: 1.75 }],
  well: [{ x: [-2.1, 2.1], y: [.1, .92], top: 1.52 }, { x: [-2.1, 2.1], y: [-.92, -.1], top: 1.52 }] },
  // 歼-50（模型补了起落架、整架抬高过：V3G_GEAR，高度按抬高后的）。公开照片：两个机腹弹舱、中间一道中线凹槽。尺寸没公布，按模型机腹平坦的范围和要装的弹定：
  //   每舱长 4.8 米、宽 1.3 米、深 0.75 米，各两扇门（铰链在内侧边和外侧边）
  j50: { mats: ['Material'], z: 1.8, door: [
    { b: 0, x: [-3.2, 1.6], y: [.45, 1.1], hy: .45, A: 1.75 }, { b: 0, x: [-3.2, 1.6], y: [1.1, 1.75], hy: 1.75, A: 1.75 },
    { b: 0, x: [-3.2, 1.6], y: [-1.1, -.45], hy: -.45, A: 1.75 }, { b: 0, x: [-3.2, 1.6], y: [-1.75, -1.1], hy: -1.75, A: 1.75 }],
  well: [{ x: [-3.2, 1.6], y: [.45, 1.75], top: 2.06 }, { x: [-3.2, 1.6], y: [-1.75, -.45], top: 2.06 }] }
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
  const L0 = m.lod[0], out = [], segs = [], zTop = Math.max(cf.z, ...cf.door.map(d => d.z ?? cf.z));
  for (const [mi, pi, i0, cnt] of L0) {
    const keep = [], doors = cf.door.map(() => []);
    for (let t = i0; t + 2 < i0 + cnt; t += 3) {
      const tri = [IB[t], IB[t + 1], IB[t + 2]];
      if (pi >= 0 || !mis.has(mi)) { keep.push(...tri); continue; }
      let rest = [tri.map(i => ({ i, v: V(i) }))];
      if (rest[0].some(c => c.v[2] > zTop)) { keep.push(...tri); continue; }
      cf.door.forEach((d, k) => {
        const nx = [];
        for (const P of rest) {
          if (P.some(c => c.v[2] > (d.z ?? cf.z))) { nx.push(P); continue; }   // 这扇门只切它那个高度以下的面（d.z：进气道侧面斜着的侧弹舱比机腹高）
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
  // 井口四角的蒙皮高度：只在这个井的切面高度以下找（w.z，进气道下侧斜面上的侧弹舱比机腹高）——原来一律按机腹高度找，侧弹舱井的壁从机腹一直立到井顶，戳出机身侧面一大块
  const skin = (x, y, zl) => { let b = null, bd = Infinity; for (let i = 0; i < nv0; i++) { const o = i * st, d = Math.hypot(VB[o] - x, VB[o + 1] - y); if (d < bd && VB[o + 2] < zl && VB[o + 5] < -.2) { bd = d; b = VB[o + 2]; } } return b ?? 1.3; };
  for (const w of cf.well) {
    const zl = w.z ?? cf.z, [x0, x1] = w.x, [y0, y1] = w.y, z00 = skin(x0, y0, zl) + .01, z01 = skin(x0, y1, zl) + .01, z10 = skin(x1, y0, zl) + .01, z11 = skin(x1, y1, zl) + .01, T = w.top;
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
// —— 舰载机折翼（甲板上停放、滑行时折着：cvdeck.js p.fold；实例参数 iD.z = 折起程度 0–1）：歼-15（苏-33 系）外翼、平尾外段向上折起。
//   模型的外翼本来就在折叠线（|y| ≈ 3.47 米，左右差 2 厘米）处分成内外两块、端面封着口；平尾下表面是跨过折叠线的整块三角形，按线切开（多边形裁剪，位置、法线、贴图坐标按比例插）。
//   折叠线以外的三角形（外翼、翼尖导轨上的弹、补上的挂架）挂到绕铰链转的部件上——铰链平行机身轴线、在上表面；正好落在线上的封口面内外各留一份（折起来两边断面都封着）。
//   fold：y 折叠线 |y|、tol 落在线上的容差、z 铰链高、x / zr 这一组三角形所在的前后、高低范围、A 折起角（弧度）。
//   折起角：外翼向上翻过竖直、翼尖斜向机身（照片估计约 115°），平尾外段约竖直（估计）；折叠线 3.47 米 → 折起后宽约 7.2 米（苏-33 公开数据：翼展 14.7 米，折叠后 7.4 米）
//   pyl：翼下挂架（模型上没有，补上；跟着外翼折）[x 后端, x 前端, |y|, 下沿 z, 上沿 z（伸进翼面里一点）, 宽]；pc：挂架颜色（线性值，取机翼贴图的灰）
//   ax / px：斜铰链（不是平行机身轴线的）——左边的转轴方向、支点 x，右边镜像（转轴 y 分量、转角反号）。
//   E-2D（代空警-600）：格鲁曼「Sto-Wing」式折翼——外翼绕斜轴转 120°，翼尖朝后、前缘朝下、上表面朝外，贴在机身两侧（公开数据：翼展 24.56 米、折叠后宽 8.94 米 → 铰链 |y| ≈ 4.45，
//   正好在发动机短舱外侧）；转轴方向 (−1, 1, 1) 是把「翼展 +y → 朝后 −x、弦向 +x → 朝下 −z」这个转动解出来的。模型外翼不在这里分块，按线切开（断面不封口，翼厚不到半米）
const V3G_FOLD = { j15: { fold: [{ y: 3.47, tol: .03, z: 2.66, x: [-7.5, .6], zr: [1.6, 3.3], A: 2.0 }, { y: 3.47, tol: .03, z: 2.03, x: [-10.6, -5.9], zr: [1.85, 2.12], A: 1.57 }],
  pyl: [[-4.3, -1.9, 3.88, 2.27, 2.53, .13], [-5.5, -3.5, 5.65, 2.3, 2.53, .11]], pc: [.17, .175, .185, 1] },
  e2d: { fold: [{ y: 4.45, tol: .02, z: 3.4, px: .2, x: [-3, 3], zr: [2, 4.8], A: 2.0944, ax: [-1, 1, 1] }] } };
// 模型上一点在哪一组折叠面上（挂的弹比翼面低，高度范围往下放宽）
function v3gFoldG(mk, v) {
  const F = V3G_FOLD[mk], sy = v[1] >= 0 ? 1 : -1;
  return F ? F.fold.find(g => v[1] * sy >= g.y && v[0] >= g.x[0] && v[0] <= g.x[1] && v[2] >= g.zr[0] - .8 && v[2] <= g.zr[1]) || null : null;
}
// 折着翼时这一点跟着转的角（左正右负；不在外翼上 = 0）、转到哪里（挂的弹、保险销按它放）
function v3gFoldA(mk, v, f) { const g = f > 0 && v3gFoldG(mk, v); return g && !g.ax ? g.A * f * (v[1] >= 0 ? 1 : -1) : 0; }   // 斜铰链的（E-2D）翼下不挂弹，不算
function v3gFoldPt(mk, v, f) {
  const g = f > 0 && v3gFoldG(mk, v);
  if (!g) return v;
  const sy = v[1] >= 0 ? 1 : -1, a = g.A * f * sy, c = Math.cos(a), s = Math.sin(a);
  if (g.ax) {   // 斜铰链：绕过支点的斜轴转（罗德里格斯公式）
    const l = Math.hypot(...g.ax), n = [g.ax[0] / l, g.ax[1] * sy / l, g.ax[2] / l], P = [g.px || 0, g.y * sy, g.z], d = [v[0] - P[0], v[1] - P[1], v[2] - P[2]], k = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) * (1 - c);
    return [P[0] + d[0] * c + (n[1] * d[2] - n[2] * d[1]) * s + n[0] * k, P[1] + d[1] * c + (n[2] * d[0] - n[0] * d[2]) * s + n[1] * k, P[2] + d[2] * c + (n[0] * d[1] - n[1] * d[0]) * s + n[2] * k];
  }
  const dy = v[1] - g.y * sy, dz = v[2] - g.z;
  return [v[0], g.y * sy + dy * c - dz * s, g.z + dy * s + dz * c];
}
function v3gFold(cf, m, VB, IB) {
  const st = m.st, nv0 = VB.length / st, add = [], parts = m.parts || (m.parts = []);
  const V = i => i < nv0 ? Array.from(VB.subarray(i * st, i * st + st)) : add.slice((i - nv0) * st, (i - nv0 + 1) * st);
  const push = a => { add.push(...a); for (let k = a.length; k < st; k++) add.push(0); return nv0 + add.length / st - 1; };
  const mid = (a, b, t) => { const o = a.map((v, i) => v + (b[i] - v) * t), l = Math.hypot(o[3], o[4], o[5]) || 1; o[3] /= l; o[4] /= l; o[5] /= l; return o; };
  const idx = c => c.i ?? (c.i = push(c.v));
  const fan = (P, out) => { for (let k = 1; k + 1 < P.length; k++) out.push(idx(P[0]), idx(P[k]), idx(P[k + 1])); };
  // 每组左右各一个部件：绕铰链线（平行 x）转，左边（y > 0）正角向上翻，右边反号
  const G = cf.fold.map(g => [1, -1].map(sg => parts.push({ n: 'fold', k: 'rot', w: [0, 0, 0, 0], w2: [0, 0, g.A * sg, 0], p: [g.px || 0, g.y * sg, g.z], a: g.ax ? [g.ax[0], g.ax[1] * sg, g.ax[2]] : [1, 0, 0] }) - 1));
  // 翼下挂架：前后两端斜切的扁盒子（上沿伸进翼面里，看不见），面各用各的顶点（棱角分明）
  const pmi = cf.pyl ? m.mats.push({ n: 'pylon', c: cf.pc, t: null, nt: null, ns: 1, mr: [0, .6], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: 0 }) - 1 : -1, pyl = [[], []];
  for (const [x0, x1, ys, zb, zt, w] of cf.pyl || []) for (const s of [0, 1]) {
    const sg = s ? -1 : 1, y0 = ys * sg - w / 2, y1 = ys * sg + w / 2, xf = x1 - .4, xr = x0 + .3, L = pyl[s];
    const quad = (a, b, c, d, n) => {   // 按法线定绕序（正面朝外）
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const P = (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0 ? [d, c, b, a] : [a, b, c, d]).map(p => push([...p, ...n, 0, 0]));
      L.push(P[0], P[1], P[2], P[0], P[2], P[3]);
    };
    const nf = Math.hypot(zt - zb, .4), nr = Math.hypot(zt - zb, .3);
    for (const [y, ny] of [[y0, -1], [y1, 1]]) quad([x0, y, zt], [xr, y, zb], [xf, y, zb], [x1, y, zt], [0, ny, 0]);   // 两侧
    quad([xr, y0, zb], [xf, y0, zb], [xf, y1, zb], [xr, y1, zb], [0, 0, -1]);                                       // 底
    quad([xf, y0, zb], [x1, y0, zt], [x1, y1, zt], [xf, y1, zb], [(zt - zb) / nf, 0, -.4 / nf]);                    // 前端斜面
    quad([x0, y0, zt], [xr, y0, zb], [xr, y1, zb], [x0, y1, zt], [-(zt - zb) / nr, 0, -.3 / nr]);                   // 后端斜面
  }
  const segs = m.lod.map(() => []);
  m.lod.forEach((lod, Lv) => {
    for (const [mi, pi, i0, cnt] of lod) {
      const keep = [], fp = G.map(() => [[], []]);
      for (let t = i0; t + 2 < i0 + cnt; t += 3) {
        const tri = [IB[t], IB[t + 1], IB[t + 2]];
        if (pi >= 0) { keep.push(...tri); continue; }   // 已经是部件的（起落架）不动
        const P = tri.map(V);
        let done = false;
        for (let gi = 0; gi < cf.fold.length && !done; gi++) {
          const g = cf.fold[gi];
          if (!P.every(p => p[0] >= g.x[0] && p[0] <= g.x[1] && p[2] >= g.zr[0] && p[2] <= g.zr[1])) continue;
          const sy = P[0][1] + P[1][1] + P[2][1] >= 0 ? 1 : -1, f = P.map(p => p[1] * sy - g.y), O = fp[gi][sy > 0 ? 0 : 1];
          if (!P.every(p => p[1] * sy > -.01)) continue;   // 跨过机身中线的不算
          const out = f.every(v => v >= -g.tol), inn = f.every(v => v <= g.tol);
          if (out && inn) { keep.push(...tri); O.push(...tri); }   // 线上的封口面：两边各一份
          else if (out) O.push(...tri);
          else if (inn) keep.push(...tri);
          else {   // 跨线：沿折叠线切成里外两块
            const I = [], X = [];
            for (let k = 0; k < 3; k++) {
              const a = { i: tri[k], v: P[k] }, b = P[(k + 1) % 3], fa = f[k], fb = f[(k + 1) % 3];
              (fa <= 0 ? I : X).push(a);
              if ((fa <= 0) !== (fb <= 0)) { const c = { v: mid(P[k], b, fa / (fa - fb)) }; I.push(c); X.push(c); }
            }
            if (I.length >= 3) fan(I, keep);
            if (X.length >= 3) fan(X, O);
          }
          done = true;
        }
        if (!done) keep.push(...tri);
      }
      segs[Lv].push([mi, pi, keep]);
      fp.forEach((pr, gi) => pr.forEach((I, s) => { if (I.length) segs[Lv].push([mi, G[gi][s], I]); }));
    }
    if (pmi >= 0) pyl.forEach((I, s) => { if (I.length) segs[Lv].push([pmi, G[0][s], I]); });   // 挂架在外翼上：跟着外翼折
  });
  const nv = nv0 + add.length / st, it = nv > 65535 ? 4 : m.it, out = [];
  let o = 0;
  m.lod = segs.map(S => S.filter(s => s[2].length).map(([mi, pi, I]) => { const e = [mi, pi, o, I.length]; out.push(I); o += I.length; return e; }));
  const IB2 = it === 4 ? new Uint32Array(o) : new Uint16Array(o);
  o = 0;
  for (const I of out) { IB2.set(I, o); o += I.length; }
  const VB2 = new Float32Array(VB.length + add.length);
  VB2.set(VB); VB2.set(add, VB.length);
  m.it = it;
  return { VB: VB2, IB: IB2, it };
}
// 开局就把一定会用到的模型先下载、解码（士兵、双方坦克），别的等单位第一次出现时再加载
// 主菜单背后的那一局（还没开始玩）：等页面先显示出来、空闲几秒再下，不和首屏抢带宽
if (typeof HOOK === 'object' && HOOK.newGame) HOOK.newGame.push(() => { const L = ['army', 'ztz96', 'm1a1', 'zbd97', 'm2a3']; if (typeof MENU === 'object' && !MENU.game && typeof setTimeout === 'function') setTimeout(() => v3gPreload(L), 4000); else v3gPreload(L); });
// 人物：用户给的士兵模型按姿势摆好（v3man.js 程序化绑骨：站、走、跑、跪、卧、匍匐、爬梯、坐、手势……），步兵手里补一支步枪，甲板人员、飞行员换装（kind 'deck#rrggbb' 马甲颜色、'pilot' 飞行服）；
//   趴着的整个放平（脸朝下）。这一帧新姿势生成的份额用完了（v3manGet 返回 false）这一帧先不画，不闪一下 T 字；v3man.js 没加载时照原样（T 字站姿）摆。k 比例（V3_MAN 一类），side 0 我 / 1 敌 / 2 遗体
const v3gLying = p => p === 'pr' || p === 'dead' || /^c\d$/.test(p) || (p[0] === 'L' && +p.slice(1) >= 12);   // 匍匐是 c0–c3（爬梯 cl0–cl7 不躺）
function v3gMan(kind, pose, x, y, z, a, k, side, roll = 0) {
  const V = typeof v3manGet === 'function' ? v3manGet(kind, pose || 'st') : null;   // 程序化绑骨后的姿势与着装（v3man.js）
  if (V === false) return false;
  if (V) {
    if (!V.lie) return v3gAdd(V.key, x, y, z, a, k, side, roll, 0);
    const b = V.bb, m = (b[2] + b[5]) / 2 * k, c = Math.cos(a), s = Math.sin(a);   // 趴着的：绕横轴转 −90°（头朝前、背朝上），身体中点放在原地，最靠前的一点（放平后最低）贴地
    return v3gAdd(V.key, x - c * m, y - s * m, z + b[3] * k, a, k, side, 0, -Math.PI / 2);
  }
  const M = v3gModel('army');
  if (!M) return false;
  if (!v3gLying(pose || 'st')) return v3gAdd('army', x, y, z, a, k, side, roll, 0);
  const b = M.meta.bb, h = (b[5] - b[2]) * k, c = Math.cos(a), s = Math.sin(a);   // 放平：绕横轴转 −90°（头朝前、背朝上），身体中点放在原地
  return v3gAdd('army', x - c * h / 2, y - s * h / 2, z + b[3] * k, a, k, side, 0, -Math.PI / 2);
}
