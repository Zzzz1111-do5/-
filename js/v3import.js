'use strict';
// 3D 里的外部精细模型：免费可商用的真实模型（CC BY / CC0，作者与来源见 V3IM_LIST，设置面板「素材致谢」里列出），
// 用 tools/mdl/build.mjs 离线转换成 assets/models/<id>.bin（颜色烘进三角形、减面、算好棱线）；
// 第一次用到时后台下载，下载好之前（或下载失败、设置里关掉）仍画游戏自己的模型（v3units.js）
// 网格与游戏自己的模型同一种顶点格式（v3units.js mbV）：明暗 s 里编码颜色——|s| ≥ 16 时 s − 16 是 7 位 RGB，负数是玻璃
const V3IM_LIST = {
  // vls：垂发区 [前端 x, 后端 x, 半宽]、vlsZ：盖板离水线高（v3fx.js 导弹从这里冒出来）
  t055: { name: '055 型驱逐舰', title: 'Type-055 Destroyer', author: 'SB-129 (hrd4588)', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/type-055-destroyer-f0a96b2475da407eb6ea2b430ba9ea85',
    vls: [[11, 14.4, 2], [-11.4, -8.6, 2]], vlsZ: 2.42 }
};
const V3IM = { st: new Map() };   // id → { mb: 网格（下载解析好之后）, fail }

// 用外部模型（好了的话）代替游戏自己的模型：返回 [实例键, 建网格函数]
function v3im(id, key, build) {
  if (typeof SETTINGS === 'object' && SETTINGS.extMdl === false) return [key, build];
  let o = V3IM.st.get(id);
  if (!o) { o = { mb: null, fail: false }; V3IM.st.set(id, o); v3imFetch(id, o); }
  return o.mb ? ['im:' + id, () => o.mb] : [key, build];
}
// 这个外部模型现在画着吗（设置开着、已经载入）：画着返回它的说明（V3IM_LIST），否则 null
function v3imOn(id) {
  const o = id && V3IM.st.get(id);
  return o && o.mb && !(typeof SETTINGS === 'object' && SETTINGS.extMdl === false) ? V3IM_LIST[id] : null;
}
function v3imFetch(id, o) {
  if (typeof fetch !== 'function' || !V3IM_LIST[id]) { o.fail = true; return; }
  const v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '';
  fetch('assets/models/' + id + '.bin' + v).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(b => { o.mb = v3imParse(b); }).catch(e => { o.fail = true; console.warn('外部模型 ' + id + ' 没载入，用自带模型', e); });
}

// 解析：量化的顶点、索引、每个三角形的颜色号与棱线位 → 平直三角形顶点（法线按 40° 折角平滑：曲面圆顺、棱角分明）
function v3imParse(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'DSM1') throw new Error('格式不对');
  const nv = dv.getUint32(4, true), nt = dv.getUint32(8, true), nc = dv.getUint32(12, true);
  const mn = [0, 1, 2].map(k => dv.getFloat32(16 + k * 4, true)), mx = [0, 1, 2].map(k => dv.getFloat32(28 + k * 4, true));
  let o = 40;
  const pal = [];
  for (let i = 0; i < nc; i++) { const r = u8[o + i * 3] >> 1, g = u8[o + i * 3 + 1] >> 1, b = u8[o + i * 3 + 2] >> 1; pal.push(16 + r * 16384 + g * 128 + b); }
  o += Math.ceil(nc * 3 / 4) * 4;
  const P = new Float32Array(nv * 3), Q = new Uint16Array(buf, o, nv * 3).slice();   // 量化坐标：同一位置的顶点（不同颜色拆开的）数值完全相同
  for (let i = 0; i < nv * 3; i++) { const a = i % 3; P[i] = mn[a] + Q[i] / 65535 * (mx[a] - mn[a]); }
  o += Math.ceil(nv * 6 / 4) * 4;
  const big = nv >= 65536, I = big ? new Uint32Array(buf.slice(o, o + nt * 12)) : new Uint16Array(buf, o, nt * 3);
  o += nt * 3 * (big ? 4 : 2);
  const T = new Uint8Array(buf, o, nt * 2);
  // 同一位置的顶点归成一个（找相邻面算平滑法线）
  const pid = new Int32Array(nv), seen = new Map();
  for (let i = 0; i < nv; i++) { const k = Q[i * 3] * 4294967296 + Q[i * 3 + 1] * 65536 + Q[i * 3 + 2]; let j = seen.get(k); if (j == null) seen.set(k, j = seen.size); pid[i] = j; }
  const np = seen.size, fn = new Float32Array(nt * 3), cnt = new Int32Array(np + 1);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    // 不归一（按面积加权）；glTF 是逆时针为正面的右手系，换到这里的左手模型坐标（y 向右）后叉积指向里面，取反
    fn[t * 3] = uz * vy - uy * vz; fn[t * 3 + 1] = ux * vz - uz * vx; fn[t * 3 + 2] = uy * vx - ux * vy;
    for (let k = 0; k < 3; k++) cnt[pid[I[t * 3 + k]] + 1]++;
  }
  for (let i = 0; i < np; i++) cnt[i + 1] += cnt[i];
  const adj = new Int32Array(cnt[np]), fill = cnt.slice(0, np);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) adj[fill[pid[I[t * 3 + k]]]++] = t;
  const len = t => Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1e-12, cosC = Math.cos(40 * Math.PI / 180);
  const out = new Float32Array(nt * 30);
  for (let t = 0; t < nt; t++) {
    const lt = len(t), nx = fn[t * 3] / lt, ny = fn[t * 3 + 1] / lt, nz = fn[t * 3 + 2] / lt, fl = T[t * 2 + 1], s = (fl & 8 ? -1 : 1) * pal[T[t * 2]];
    for (let k = 0; k < 3; k++) {
      const vi = I[t * 3 + k], p = pid[vi];
      let sx = 0, sy = 0, sz = 0;
      for (let j = cnt[p]; j < cnt[p + 1]; j++) { const f = adj[j], lf = len(f), d = (fn[f * 3] * nx + fn[f * 3 + 1] * ny + fn[f * 3 + 2] * nz) / lf; if (d > cosC) { sx += fn[f * 3]; sy += fn[f * 3 + 1]; sz += fn[f * 3 + 2]; } }
      const l = Math.hypot(sx, sy, sz) || 1, w = (t * 3 + k) * 10;
      // 与 mbV 相同：y 取反（模型 y 向右，GL 的 y 向北）；棱线坐标：对着第 k 个顶点的边画棱线时该分量趋于 0，不画的边加 1
      out[w] = P[vi * 3]; out[w + 1] = -P[vi * 3 + 1]; out[w + 2] = P[vi * 3 + 2];
      out[w + 3] = sx / l; out[w + 4] = -sy / l; out[w + 5] = sz / l; out[w + 6] = s;
      for (let e = 0; e < 3; e++) out[w + 7 + e] = (e === k ? 1 : 0) + (fl >> e & 1 ? 0 : 1);
    }
  }
  return { t: out, l: [] };
}

// 设置面板里的「素材致谢」
function v3imCredits() {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const all = [...Object.values(V3IM_LIST), ...(typeof V3P_PACKS === 'object' ? Object.values(V3P_PACKS) : [])];
  return all.map(m => `<li>${esc(m.name)}：<a href="${esc(m.url)}" target="_blank" rel="noopener">“${esc(m.title)}”</a> by ${esc(m.author)}，${esc(m.license)}（有改动：格式转换、缩小贴图或减面）</li>`).join('');
}
