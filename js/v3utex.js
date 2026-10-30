'use strict';
// 3D 里带贴图的精细舰艇模型：免费可商用的真实模型（CC BY，作者与来源见 V3U_LIST，设置面板「素材致谢」里列出）——坦克装甲车、飞机、导弹、士兵换成了用户给的模型（js/v3g.js）
//   用 tools/mdl/tbuild.mjs 离线转换成 assets/models/<id>.bin + 贴图（格式同地图物件，v3props.js v3pParse 解析）；
//   车辆拆成车体 hull、炮塔 tur 两个变体（炮塔绕转轴 piv 转，坐标原点是整车底面中心）；
//   第一次用到时后台下载，下载好之前（或下载失败、设置里关掉、离得远）仍画游戏自己的模型（v3units.js）
// 实例参数与 v3units.js 的模型完全一样（位置、朝向、比例、阵营、滚转、俯仰），着色也照它：黑绿画风按贴图深浅调暗实体 + 发光棱线，写实画风用贴图本色
const V3U_LIST = {
  u_t054a: { name: '054A 型护卫舰', title: "Type-054A Class Frigate", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/type-054a-class-frigate-948cca64a5274644a35e4600e023d61d' },
  u_ddg125: { name: '阿利·伯克级驱逐舰（Flight III）', title: "USS Jack H. Lucas DDG-125", author: "SB-129", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/uss-jack-h-lucas-ddg-125-1c9229b49915454c8ff22605f8cc7b66' },
  u_cg47: { name: '提康德罗加级巡洋舰', title: "Ticonderoga Missile Cruiser", author: "waelXcm", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/ticonderoga-missile-cruiser-397bd2b7bcd946e4b508869f4ca1e1cf' },
  u_lcs2: { name: '独立级濒海战斗舰', title: "USS INDEPENDENCE  LCS-2", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/uss-independence-lcs-2-7db04398d9524a36a6e08bead0050b76' },
  u_t055f: { name: '055 型驱逐舰', title: 'CN TYPE 055 Nanchang v3.0', author: 'FeriseCAT', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/cn-type-055-nanchang-v30-8850f8cf1eee409abe08519fd54809cd' },
  u_lcac: { name: '726 型气垫登陆艇（用 LCAC 外形代替）', title: 'LCAC Hovercraft croqui', author: 'LM3D', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/lcac-hovercraft-croqui-14ad629070db445eaf2364eda019192f' },
  u_lcu: { name: '271 型登陆艇（用 LCU 外形代替）', title: 'US Marine Landing Craft Utility', author: 'LM3D', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/us-marine-landing-craft-utility-726157b72da347549dab62e590f4d06c' },
  u_lcvp: { name: '人员登陆艇（用 LCVP 外形代替）', title: 'LCVP Higgins Boat', author: 'Thomas Visonà', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/lcvp-higgins-boat-e2edab27282d415db2351a47d164744b' },
  u_ssn: { name: '弗吉尼亚级攻击核潜艇', title: 'USS Virginia SSN-774', author: 'Art Blender', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/uss-virginia-ssn-774-339f9731013e4b41b87557f261a9892f' },
};
// 舰艇：舰型（v3units.js：我方 vls.js vlsCls 的 052D / 054A……，守方 navy.js NV_CLS 的 ddg / cg……）→ 外部模型；原点在水线、x 向船头；dz：水线再往下压多少（米）
const V3U_SHIP = { '054A': { id: 'u_t054a', dz: -.9 }, '055': { id: 'u_t055f' }, ddg: { id: 'u_ddg125' }, ddg3: { id: 'u_ddg125' }, cg: { id: 'u_cg47' }, lcs: { id: 'u_lcs2' },
  ssn: { id: 'u_ssn' }, lcac: { id: 'u_lcac' }, lcu: { id: 'u_lcu' }, lcvp: { id: 'u_lcvp' } };   // ssn：原点在耐压壳轴线；lcac：原点在气垫底面（上滩时贴地）；登陆艇按水线
const V3U = { tried: false, ok: false, pr: null, a: {}, u: {}, packs: new Map(), inst: new Map(), ib: null, fr: 0 };
// 多远以内画精细模型（再远就画自带的简化模型：省三角形，远处也看不出差别）
const V3U_NEAR = () => (typeof V3 === 'object' && V3.coarse ? 220 : typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low' ? 260 : 420) * clamp(Math.sqrt(typeof v3RD === 'function' ? v3RD() : 1), .8, 1.4);

const V3U_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t; attribute vec3 b; attribute vec4 iA; attribute vec4 iB;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vN, vB, vV; varying vec2 vT; varying float vSide, vD;
${typeof V3_SHV === 'string' ? V3_SHV : ''}
void main() {
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z), cp = cos(iB.w), sp = sin(iB.w);
  vec3 q = p * iB.x; q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr); q = vec3(q.x * cp - q.z * sp, q.y, q.x * sp + q.z * cp);
  vec3 m = vec3(n.x, n.y * cr - n.z * sr, n.y * sr + n.z * cr); m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vB = b; vT = t; vSide = iB.y; vV = uEye - w; vD = length(vV);
  ${typeof V3_SHV === 'string' ? 'vSh = uShM * vec4(w, 1.);' : ''}
  gl_Position = uM * vec4(w, 1.);
}`;
const V3U_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform sampler2D uTex; uniform vec4 uCol; uniform float uCut, uGlass, uMode, uHl; uniform vec3 uHlC;
uniform vec2 uFog; uniform vec3 uBg, uBody0, uBody1, uBody2, uGlow0, uGlow1, uGlow2;
varying vec3 vN, vB, vV; varying vec2 vT; varying float vSide, vD;
${typeof V3_SHF === 'string' ? V3_SHF : 'float shadowAt() { return 1.; }'}
void main() {
  vec4 tx = texture2D(uTex, vT) * uCol;
  if (tx.a < uCut) discard;
  float hl = step(7.5, vSide), sd = vSide - hl * 8.;   // 阵营号 + 8：选中编队的成员（selfx.js），全身发光
  bool ours = sd < .5 || (sd > 2.5 && sd < 3.5), dead = sd > 1.5 && sd < 2.5;   // 0 / 3 我方、1 / 4 敌方、2 残骸
  vec3 body = ours ? uBody0 : dead ? uBody2 : uBody1, glow = ours ? uGlow0 : dead ? uGlow2 : uGlow1;
  vec3 N = normalize(vN), V = normalize(vV);
  if (dot(N, V) < -.2 && !gl_FrontFacing) N = -N;   // 双面材质的背面
  float lit = clamp(dot(N, ${typeof V3_SUNG === 'string' ? V3_SUNG : 'normalize(vec3(-.45, .55, .7))'}), 0., 1.), up = clamp(N.z, 0., 1.);
  float e = min(min(vB.x, vB.y), vB.z);
#ifdef DER
  float w = max(fwidth(e), 1e-4), ed = 1. - smoothstep(w * .6, w * 1.9, e);
#else
  float ed = 1. - smoothstep(.015, .06, e);
#endif
  float rim = pow(1. - clamp(abs(dot(N, V)), 0., 1.), 3.);
  vec3 c;
  if (uMode < .5) {   // 黑绿：深色实体（按贴图深浅）+ 发光棱线 + 边缘光；玻璃发光
    float l = dot(tx.rgb, vec3(.3, .59, .11));
    c = body * (.45 + .95 * lit + .25 * up) * (.5 + 1.1 * l) + glow * ed * .75 + glow * rim * .22;
    if (uGlass > .5) c += glow * .6;
  } else {   // 写实：贴图本色受日光、半球天光，残骸烧黑；边缘描一道很淡的阵营色
    vec3 alb = dead ? tx.rgb * .16 + vec3(.025, .022, .02) : tx.rgb;
    c = alb * (mix(vec3(.3, .29, .27), vec3(.45, .5, .58), N.z * .5 + .5) + vec3(1., .95, .86) * lit * .82 * shadowAt()) * (1. - ed * .12) + (dead ? vec3(0.) : glow * rim * .1);
    if (uGlass > .5) c = mix(c, vec3(.36, .48, .56), .55) + vec3(.5, .55, .6) * rim * .5;
  }
  if (hl > .5) c += uHlC * uHl * (.28 + .9 * rim + .55 * ed);
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
function v3uInit(gl) {
  V3U.tried = true;
  try {
    const der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3U_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3U_FS(der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3U.pr = pr; V3U.gl = gl; V3U.ext = gl.getExtension('ANGLE_instanced_arrays');
    for (const k of ['p', 'n', 't', 'b', 'iA', 'iB']) V3U.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uTex', 'uCol', 'uCut', 'uGlass', 'uMode', 'uHl', 'uHlC', 'uFog', 'uBg', 'uBody0', 'uBody1', 'uBody2', 'uBody3', 'uBody4', 'uGlow0', 'uGlow1', 'uGlow2', 'uShM', 'uShT', 'uShOn', 'uShP']) V3U.u[k] = gl.getUniformLocation(pr, k);
    V3U.ib = gl.createBuffer();
    V3U.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, V3U.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    V3U.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    V3U.ok = !!V3U.ext && typeof v3pParse === 'function';   // 没有实例化扩展的老设备：仍画自带模型
  } catch (e) { V3U.ok = false; console.warn('3D 精细兵种模型不可用', e); }
}
// 资源包：下载、解析、上传（每组：位置 3、法线 3、UV 2、棱线坐标 3 = 11 个浮点）、贴图；好了 st = 1，失败 st = -1
function v3uPack(id) {
  let P = V3U.packs.get(id);
  if (P) return P.st === 1 ? P : null;
  P = { id, st: 0, vars: new Map(), mats: [], tex: [] };
  V3U.packs.set(id, P);
  const gl = V3U.gl, v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '';
  if (typeof fetch !== 'function') { P.st = -1; return null; }
  fetch('assets/models/' + id + '.bin' + v).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
    const D = v3pParse(buf);
    P.mats = D.mats;
    for (const V of D.vars) P.vars.set(V.name, { bb: V.bb, groups: V.groups.map(g => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW); return { mi: g.mi, b, n: g.data.length / 11 }; }) });
    if (/^u_(su33|h6m|f35|f22|b2b|x47b)$/.test(id)) {   // 飞机：留一份收起落架时的顶点位置（量机翼下表面、机腹的高度，挂架、弹舱门贴上去，v3uArm）
      const V = D.vars.find(q => q.name === 'fly') || D.vars.find(q => q.name === 'hull') || D.vars[0], n = V.groups.reduce((a, g) => a + g.data.length / 11, 0), pts = new Float32Array(n * 3);
      let o = 0; for (const g of V.groups) for (let i = 0; i < g.data.length; i += 11) { pts[o++] = g.data[i]; pts[o++] = g.data[i + 1]; pts[o++] = g.data[i + 2]; }
      P.pts = pts;
    }
    let left = D.tex.length;
    const done = () => { if (--left <= 0) P.st = 1; };
    if (!left) P.st = 1;
    D.tex.forEach((fmt, k) => {
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        const pot = !(img.width & (img.width - 1)) && !(img.height & (img.height - 1));
        if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); if (V3U.aniso) gl.texParameterf(gl.TEXTURE_2D, V3U.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4); }
        else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        P.tex[k] = t; done();
      };
      img.onerror = () => { P.tex[k] = null; done(); };
      img.src = 'assets/models/' + id + '_' + k + '.' + (fmt ? 'webp' : 'jpg') + v;
    });
  }).catch(e => { P.st = -1; console.warn('精细模型 ' + id + ' 没载入，用自带模型', e); });
  return null;
}
// 这个外部模型现在能画吗（设置开着、着色器可用、已经载入）：能就返回资源包，否则 null（第一次问的时候开始下载）
function v3uOn(id) {
  if (!id || (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.extMdl === false) || !V3.gl) return null;
  if (!V3U.tried) v3uInit(V3.gl);
  return V3U.ok ? v3uPack(id) : null;
}
function v3uShip(cls, x, y, z, h, len, side) {
  const E = V3U_SHIP[cls];
  if (!E) return false;
  if (V3U.E && Math.hypot(x - V3U.E[0], -y - V3U.E[1], z - V3U.E[2]) > V3U_NEAR() * 4) return false;   // 船大：远一些才换回简化模型
  const P = v3uOn(E.id), hn = P && P.vars.keys().next().value, H = hn && P.vars.get(hn);
  if (!H) return false;
  if (!E.L) E.L = H.bb[1][0] - H.bb[0][0];
  v3uAdd(E.id, hn, x, y, z + (E.dz || 0) * len / E.L, h, len / E.L, side);
  return true;
}
function v3uClear(C) { for (const L of V3U.inst.values()) L.d.length = 0; V3U.fr++; V3U.E = C && C.E; }   // 每帧开头（v3units.js v3mCollect）；记下眼睛位置（远处的飞机画自带模型）
// 一个实例：参数同 v3units.js v3mAdd（x、y 世界坐标，z 高度，a 世界朝向，k 比例，side 阵营，roll 滚转，pitch 俯仰）
function v3uAdd(id, vn, x, y, z, a, k, side, roll = 0, pitch = 0) {
  const key = id + ':' + vn;
  let L = V3U.inst.get(key);
  if (!L) { L = { id, vn, d: [] }; V3U.inst.set(key, L); }
  L.d.push(x, -y, z, -a, k, side, roll, pitch);
}
// 画（阴影图那一遍 LM 是光源矩阵；v3units.js v3mDraw 末尾调用，两遍都画）
function v3uDraw(C, LM) {
  if (!V3U.ok || !V3U.inst.size) return;
  const gl = V3U.gl, A = V3U.a, U = V3U.u, X = V3U.ext;
  let any = false;
  for (const L of V3U.inst.values()) if (L.d.length) { any = true; break; }
  if (!any) return;
  gl.useProgram(V3U.pr);
  gl.uniformMatrix4fv(U.uM, false, LM || C.M);
  gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.004, .02, .011]));
  if (typeof v3mPalette === 'function') v3mPalette(gl, U);
  if (typeof v3ShUni === 'function') v3ShUni(gl, U, !LM);
  gl.uniform1i(U.uTex, 0); gl.activeTexture(gl.TEXTURE0);
  for (const L of V3U.inst.values()) {
    const n = L.d.length / 8, P = n && V3U.packs.get(L.id), V = P && P.st === 1 && P.vars.get(L.vn);
    if (!V) continue;
    if (L.fr !== V3U.fr) { L.fr = V3U.fr; L.f = new Float32Array(L.d); }   // 这一帧的实例数据只转一次（两遍共用）
    gl.bindBuffer(gl.ARRAY_BUFFER, V3U.ib); gl.bufferData(gl.ARRAY_BUFFER, L.f, gl.DYNAMIC_DRAW);
    for (const g of V.groups) {
      const M = P.mats[g.mi], t = M && M.ti !== 255 ? P.tex[M.ti] : null, bf = M ? M.bf : [1, 1, 1, 1];
      gl.bindTexture(gl.TEXTURE_2D, t || V3U.white);
      gl.uniform1f(U.uCut, M && M.mode === 1 ? Math.max(.3, Math.min(.6, M.cut)) : -1);
      gl.uniform1f(U.uGlass, M && M.mode === 2 ? 1 : 0);
      gl.uniform4f(U.uCol, bf[0], bf[1], bf[2], bf[3]);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.b);
      gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 44, 0);
      gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 44, 12);
      gl.enableVertexAttribArray(A.t); gl.vertexAttribPointer(A.t, 2, gl.FLOAT, false, 44, 24);
      gl.enableVertexAttribArray(A.b); gl.vertexAttribPointer(A.b, 3, gl.FLOAT, false, 44, 32);
      gl.bindBuffer(gl.ARRAY_BUFFER, V3U.ib);
      gl.enableVertexAttribArray(A.iA); gl.vertexAttribPointer(A.iA, 4, gl.FLOAT, false, 32, 0); X.vertexAttribDivisorANGLE(A.iA, 1);
      gl.enableVertexAttribArray(A.iB); gl.vertexAttribPointer(A.iB, 4, gl.FLOAT, false, 32, 16); X.vertexAttribDivisorANGLE(A.iB, 1);
      X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, g.n, n);
      X.vertexAttribDivisorANGLE(A.iA, 0); X.vertexAttribDivisorANGLE(A.iB, 0);
      gl.disableVertexAttribArray(A.iA); gl.disableVertexAttribArray(A.iB);
    }
  }
  for (const k of ['p', 'n', 't', 'b']) gl.disableVertexAttribArray(A[k]);
  if (V3.tex) gl.bindTexture(gl.TEXTURE_2D, V3.tex);   // 地形的俯视贴图在 0 号纹理单元
}
