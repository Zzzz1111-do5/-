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
const V3X_METAL = { j35: .06, j20: .06, j36: .06, j50: .06, y20: .12, tug: .3, loader: .32 };   // 战斗机是隐身涂层（吸波材料，偏哑光）：只在掠射角有一层淡淡的光泽，高了就成了银色；运输机、地勤车是漆面
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
// 平滑法线：减过面的模型每个三角形一个法线，打上光像揉皱的锡纸；按位置焊接顶点（量化后同一格就是同一点），
//   每个角取周围折角小于 V3X_CREASE 度的面、按面积加权平均——机身、座舱盖、进气道唇口变圆，机翼前后缘、尾翼、隐身机的棱线照旧是硬边；
//   涂装色同理：同一块平滑面上、颜色相差不到 V3X_CTOL 的面在顶点上取平均（贴图烘到每个三角形的色差不再像马赛克），红星、舷号这类差得多的照旧分明
const V3X_CREASE = 42, V3X_CTOL = 12;
function v3xSmooth(dv, m, P, I, CL, E) {
  const nt = m.nt, Wv = new Uint32Array(m.nv), wm = new Map();
  for (let i = 0; i < m.nv; i++) {
    const k = dv.getUint16(i * 6, true) * 4294967296 + dv.getUint16(i * 6 + 2, true) * 65536 + dv.getUint16(i * 6 + 4, true);
    let w = wm.get(k); if (w === undefined) { w = wm.size; wm.set(k, w); } Wv[i] = w;
  }
  const nW = wm.size, st = new Uint32Array(nW + 1), FA = new Float64Array(nt * 3), FU = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    FA[t * 3] = x; FA[t * 3 + 1] = y; FA[t * 3 + 2] = z; FU[t * 3] = x / l; FU[t * 3 + 1] = y / l; FU[t * 3 + 2] = z / l;
    for (let j = 0; j < 3; j++) st[Wv[I[t * 3 + j]] + 1]++;
  }
  for (let i = 0; i < nW; i++) st[i + 1] += st[i];
  const adj = new Uint32Array(nt * 3), fp = st.slice(0, nW);
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) adj[fp[Wv[I[t * 3 + j]]]++] = t;
  const cosC = Math.cos(V3X_CREASE * Math.PI / 180), NC = new Float32Array(nt * 9), CC = CL ? new Float32Array(nt * 9) : null;
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
    const w = Wv[I[t * 3 + j]], o = t * 9 + j * 3;
    let x = 0, y = 0, z = 0, r = 0, g = 0, b = 0, wc = 0;
    for (let k = st[w]; k < st[w + 1]; k++) {
      const u = adj[k];
      if (FU[t * 3] * FU[u * 3] + FU[t * 3 + 1] * FU[u * 3 + 1] + FU[t * 3 + 2] * FU[u * 3 + 2] < cosC) continue;
      x += FA[u * 3]; y += FA[u * 3 + 1]; z += FA[u * 3 + 2];
      if (CL && (E[u] & 8) === (E[t] & 8) && Math.max(Math.abs(CL[u * 3] - CL[t * 3]), Math.abs(CL[u * 3 + 1] - CL[t * 3 + 1]), Math.abs(CL[u * 3 + 2] - CL[t * 3 + 2])) <= V3X_CTOL) {
        const a = Math.hypot(FA[u * 3], FA[u * 3 + 1], FA[u * 3 + 2]) + 1e-12; r += CL[u * 3] * a; g += CL[u * 3 + 1] * a; b += CL[u * 3 + 2] * a; wc += a;
      }
    }
    const l = Math.hypot(x, y, z);
    if (l > 1e-12) { NC[o] = x / l; NC[o + 1] = y / l; NC[o + 2] = z / l; } else { NC[o] = FU[t * 3]; NC[o + 1] = FU[t * 3 + 1]; NC[o + 2] = FU[t * 3 + 2]; }
    if (CC) { if (wc > 0) { CC[o] = r / wc; CC[o + 1] = g / wc; CC[o + 2] = b / wc; } else { CC[o] = CL[t * 3]; CC[o + 1] = CL[t * 3 + 1]; CC[o + 2] = CL[t * 3 + 2]; } }
  }
  return { NC, CC };
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
  const { NC, CC } = v3xSmooth(dv, m, P, I, CL, E), c7 = v => Math.min(127, Math.round(v) >> 1);
  for (let t = 0; t < m.nt; t++) {   // 每个角各自的法线与涂装色（顶点着色器里解码，三角形内部平滑过渡）
    const e = E[t], k = [e & 1 ? 0 : 1, e >> 1 & 1 ? 0 : 1, e >> 2 & 1 ? 0 : 1];
    for (let j = 0; j < 3; j++) {
      const o = t * 9 + j * 3, s = CC ? (e & 8 ? -1 : 1) * (16 + c7(CC[o]) * 16384 + c7(CC[o + 1]) * 128 + c7(CC[o + 2])) : SH[t] / 127.5 - 1;
      mbV(M, p(I[t * 3 + j]), [NC[o], NC[o + 1], NC[o + 2]], s, [k[0] + (j === 0), k[1] + (j === 1), k[2] + (j === 2)]);
    }
  }
  for (let l = 0; l < LN.length; l += 2) mbLine(M, p(LN[l]), p(LN[l + 1]), .55);
  const met = V3X_METAL[String(D.key || '').split('_')[0]];
  if (met && typeof mbMetal === 'function') mbMetal(M, met);   // 金属反光（写实画面）：飞机漆面、地勤车
  M.len = m.len; M.vls = m.vls || null;   // 垂发块（米，v3fx.js v3VlsOrigin 用）
  M.zc = m.zc || 0; M.parts = m.parts || null;   // 飞机：机身中线离着地点的高度、活动舵面（转轴，米）
  return M;
}
