'use strict';
// 导入的 3D 模型（Sketchfab 上 CC0 / CC-BY 授权的模型，tools/sfmodel.js 转换；署名见 docs/credits.md）：
//   js/mdl/<键>.js 用到时才加载（插 script 标签，本地 file:// 打开也能用），解码成与代码建模同一种网格——暗色实体 + 按棱角算好的发光棱线，
//   建模坐标 x 船头 / 机头、y 右、z 上，单位米（v3units.js 画的时候按游戏里的尺寸缩放）；还没加载完、加载失败时照旧画代码建的模型
const V3X = { def: {}, mesh: {}, want: new Set(), fail: new Set() };
V3X.add = (key, meta, b64) => { V3X.def[key] = { meta, b64, key }; };
function v3xLoad(key) {
  if (typeof document === 'undefined') { V3X.fail.add(key); return; }
  const s = document.createElement('script'), v = typeof window === 'object' && window.DS_BUILD ? '?v=' + encodeURIComponent(window.DS_BUILD) : '';
  s.src = 'js/mdl/' + key + '.js' + v; s.async = true;
  s.onerror = () => { V3X.fail.add(key); console.warn('3D 模型没加载上：' + key); };
  document.head.appendChild(s);
}
// 导入模型的金属度（写实画面的金属反光，v3units.js mbMetal）：飞机是漆面金属，地勤车的车身、举升臂更亮
const V3X_METAL = { j35: .22, j20: .22, j36: .22, j50: .22, y20: .18, tug: .3, loader: .32 };   // 隐身涂层、漆面都偏哑：只带一点光泽，太高就成了镀铬
// 设置里「外部精细模型」关掉时不用导入的模型（与 v3import.js 同一个开关）
const v3xOn = () => !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.extMdl === false);
// 模型的网格（mbNew 格式）；没有就去加载、先返回 null
function v3xMesh(key) {
  if (!v3xOn()) return null;
  if (V3X.mesh[key]) return V3X.mesh[key];
  const D = V3X.def[key];
  if (!D) { if (!V3X.want.has(key) && !V3X.fail.has(key)) { V3X.want.add(key); v3xLoad(key); } return null; }
  try { V3X.mesh[key] = v3xBuild(D); } catch (e) { console.warn('3D 模型解码失败：' + key, e); V3X.fail.add(key); delete V3X.def[key]; return null; }
  return V3X.mesh[key];
}
// 解码：位置（包围盒内 16 位量化）、三角形索引、每个三角形的棱线标志与明暗、轮廓线段
function v3xBuild(D) {
  const m = D.meta, s = atob(D.b64), bin = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i);
  const dv = new DataView(bin.buffer), P = new Float32Array(m.nv * 3);
  let o = 0;
  for (let i = 0; i < m.nv * 3; i++) { const a = i % 3; P[i] = m.bb[a] + dv.getUint16(o, true) / 65535 * (m.bb[a + 3] - m.bb[a]); o += 2; }
  const rd = m.idx === 4 ? () => { const v = dv.getUint32(o, true); o += 4; return v; } : () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const I = new Uint32Array(m.nt * 3);
  for (let i = 0; i < I.length; i++) I[i] = rd();
  const E = bin.subarray(o, o + m.nt); o += m.nt;
  const SH = bin.subarray(o, o + m.nt); o += m.nt;
  const M = mbNew(), p = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const LN = []; for (let l = 0; l < m.nl; l++) LN.push(rd(), rd());
  // 涂装色（meta.col）：每个三角形 3 字节 sRGB，编进明暗 s——|s| ≥ 16 时 s − 16 是 7 位 RGB、负数是玻璃（与 v3import.js 同一约定），
  //   写实画面直接用涂装色，黑绿画面按它的深浅调暗实体；没有涂装色的老模型照旧用烘好的明暗
  const CL = m.col ? bin.subarray(o, o + m.nt * 3) : null;
  for (let t = 0; t < m.nt; t++) {
    const e = E[t], s = CL ? (e & 8 ? -1 : 1) * (16 + (CL[t * 3] >> 1) * 16384 + (CL[t * 3 + 1] >> 1) * 128 + (CL[t * 3 + 2] >> 1)) : SH[t] / 127.5 - 1;
    mbTri(M, p(I[t * 3]), p(I[t * 3 + 1]), p(I[t * 3 + 2]), s, [e & 1, e >> 1 & 1, e >> 2 & 1]);
  }
  for (let l = 0; l < LN.length; l += 2) mbLine(M, p(LN[l]), p(LN[l + 1]), .55);
  const met = V3X_METAL[String(D.key || '').split('_')[0]];
  if (met && typeof mbMetal === 'function') mbMetal(M, met);   // 金属反光（写实画面）：飞机漆面、地勤车
  M.len = m.len; M.vls = m.vls || null;   // 垂发块（米，v3fx.js v3VlsOrigin 用）
  M.zc = m.zc || 0; M.parts = m.parts || null;   // 飞机：机身中线离着地点的高度、活动舵面（转轴，米）
  return M;
}
