'use strict';
// 导入的 3D 模型（Sketchfab 上 CC0 / CC-BY 授权的模型，tools/sfmodel.js 转换；署名见 docs/credits.md）：
//   js/mdl/<键>.js 用到时才加载（插 script 标签，本地 file:// 打开也能用），解码成与代码建模同一种网格——暗色实体 + 按棱角算好的发光棱线，
//   建模坐标 x 船头 / 机头、y 右、z 上，单位米（v3units.js 画的时候按游戏里的尺寸缩放）；还没加载完、加载失败时照旧画代码建的模型
const V3X = { def: {}, mesh: {}, want: new Set(), fail: new Set() };
V3X.add = (key, meta, b64) => { V3X.def[key] = { meta, b64 }; };
function v3xLoad(key) {
  if (typeof document === 'undefined') { V3X.fail.add(key); return; }
  const s = document.createElement('script'), v = typeof window === 'object' && window.DS_BUILD ? '?v=' + encodeURIComponent(window.DS_BUILD) : '';
  s.src = 'js/mdl/' + key + '.js' + v; s.async = true;
  s.onerror = () => { V3X.fail.add(key); console.warn('3D 模型没加载上：' + key); };
  document.head.appendChild(s);
}
// 模型的网格（mbNew 格式）；没有就去加载、先返回 null
function v3xMesh(key) {
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
  for (let t = 0; t < m.nt; t++) { const e = E[t]; mbTri(M, p(I[t * 3]), p(I[t * 3 + 1]), p(I[t * 3 + 2]), SH[t] / 127.5 - 1, [e & 1, e >> 1 & 1, e >> 2 & 1]); }
  for (let l = 0; l < m.nl; l++) { const a = rd(), b = rd(); mbLine(M, p(a), p(b), .55); }
  M.len = m.len; M.vls = m.vls || null;   // 垂发块（米，v3fx.js v3VlsOrigin 用）
  return M;
}
