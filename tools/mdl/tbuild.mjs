// 带贴图的模型转换（地图物件：树木、岩石、楼房、机场设施）：glb → assets/models/<id>.bin + 贴图 assets/models/<id>_<n>.webp / .jpg
// 用法：cd tools/mdl && node tbuild.mjs <id> [--preview 预览.png] [--list]
//   --list：只列出模型里可拆的部件（名字、面数、尺寸），用来写 sources.json 的 parts
// sources.json 里 mode: "tex" 的条目：
//   file 源文件（src/ 下）；unit 每单位多少米；axes 游戏 x（正面朝向）、y（右）、z（上）取 glTF 的哪个轴（默认 ["z", "-x", "y"]）
//   parts：{ 变体名: 部件名正则 / 部件序号数组 }，不写就是整个模型一个变体；drop：丢掉的部件 / 材质名正则
//   tex 贴图最长边（默认 512）；tris 每个变体减面上限（不写不减；树叶这类插片不要减）；cut 透明裁剪阈值（默认用材质的）
// 每个变体：原点在底面中心（x、y 居中，最低点 z = 0），单位米；按材质分组（一组一张贴图、一次绘制）
// 文件格式（小端，4 字节对齐）：'DSM2'、变体数、材质数、贴图数（u32 × 3）；
//   贴图：每张 u8 格式（0 jpg、1 webp），补齐；材质：每个 u8 贴图号（255 无）、u8 透明（0 不透明、1 裁剪、2 玻璃）、u8 双面、u8 0、f32 底色 RGBA、f32 裁剪阈值；
//   变体：u8 名字长度 + 名字（补齐）、f32 包围盒 min[3] max[3]、u32 组数；每组：u32 材质号、u32 顶点数、u32 索引数，
//   位置 u16 × 3（包围盒内量化）、法线 i8 × 3（补齐）、UV f32 × 2、索引 u16、每个三角形 u8 棱线位（位 0–2：对着第 k 个顶点的边是棱线）
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../..');
const args = process.argv.slice(2), id = args[0];
const SRC = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8')), C = SRC[id];
if (!C) { console.error('sources.json 里没有', id); process.exit(1); }
const pvi = args.indexOf('--preview'), preview = pvi >= 0 ? args[pvi + 1] : null, listOnly = args.includes('--list');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(here, 'src', C.file));
const R = doc.getRoot(), scene = R.getDefaultScene() || R.listScenes()[0];

// —— 部件：根下第一层分叉处的各个子树（模型包里一个部件就是一棵树 / 一栋楼）——
const hasMesh = n => !!n.getMesh() || n.listChildren().some(hasMesh);
let tops = scene.listChildren().filter(hasMesh);
while (tops.length === 1 && tops[0].listChildren().filter(hasMesh).length >= 1 && !tops[0].getMesh()) tops = tops[0].listChildren().filter(hasMesh);
const triCount = n => { let t = 0; n.traverse(x => { const m = x.getMesh(); if (m) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } }); return Math.round(t); };
if (listOnly) {
  tops.forEach((n, i) => { const b = getBounds(n); console.log(i, JSON.stringify(n.getName()), triCount(n), 'tris', b.max.map((v, k) => +((v - b.min[k]) * (C.unit || 1)).toFixed(2)).join('×'), '@', b.min.map((v, k) => +((v + b.max[k]) / 2).toFixed(1)).join(',')); });
  process.exit(0);
}
const drop = C.drop ? new RegExp(C.drop, 'i') : null;
const PARTS = C.parts ? Object.entries(C.parts).map(([nm, sel]) => [nm, Array.isArray(sel) ? sel.map(i => tops[i]).filter(Boolean) : tops.filter(n => new RegExp(sel, 'i').test(n.getName()))]) : [[id, tops]];

// —— 轴映射、单位 ——
const AX = (C.axes || ['z', '-x', 'y']).map(s => ({ i: 'xyz'.indexOf(s.replace('-', '')), k: s[0] === '-' ? -1 : 1 })), U = C.unit || 1;
const mul = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const mulN = (m, n) => [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]];
const toG = w => AX.map(a => w[a.i] * a.k);

// —— 材质、贴图 ——
const MATS = [], matIdx = new Map(), TEXS = [], texIdx = new Map();
async function texOf(t, alpha) {
  if (texIdx.has(t)) return texIdx.get(t);
  const img = Buffer.from(t.getImage()), S0 = C.tex || 512;
  const meta = await sharp(img).metadata();
  const big = Math.max(meta.width || S0, meta.height || S0), sc = Math.min(1, S0 / big);
  const p2 = v => 2 ** Math.max(2, Math.round(Math.log2(Math.max(4, v))));   // 边长取 2 的幂：WebGL1 才能重复平铺、生成多级渐远纹理
  const w = Math.min(S0, p2((meta.width || S0) * sc)), h = Math.min(S0, p2((meta.height || S0) * sc));
  // 透明贴图：边缘像素往外扩一圈颜色（缩小、mipmap 时叶子边不发黑）；不透明的压成 jpg
  let out, fmt;
  if (alpha) {
    const { data, info } = await sharp(img).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    bleed(data, info.width, info.height);
    out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 88, alphaQuality: 100 }).toBuffer(); fmt = 1;
  } else { out = await sharp(img).resize(w, h, { fit: 'fill' }).flatten({ background: '#808080' }).jpeg({ quality: 84 }).toBuffer(); fmt = 0; }
  const k = TEXS.length; TEXS.push({ out, fmt, w, h }); texIdx.set(t, k);
  return k;
}
function bleed(d, w, h) {   // 透明像素的颜色取周围不透明像素的平均（迭代几轮）
  for (let it = 0; it < 6; it++) {
    const src = Buffer.from(d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; if (src[i + 3] > 8) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = (yy * w + xx) * 4; if (src[j + 3] > 8 || (it > 0 && (src[j] | src[j + 1] | src[j + 2]))) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; } }
      if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    }
  }
}
async function matOf(m) {
  if (matIdx.has(m)) return matIdx.get(m);
  const bf = m ? m.getBaseColorFactor() : [1, 1, 1, 1], t = m && m.getBaseColorTexture(), am = m ? m.getAlphaMode() : 'OPAQUE';
  let mode = am === 'MASK' ? 1 : am === 'BLEND' ? (t ? 1 : 2) : 0;
  if (m && /glass|window_glass/i.test(m.getName()) && am === 'BLEND') mode = 2;
  let ti = 255;
  if (t) { let alpha = mode === 1; if (alpha) { const { data } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); let lo = 0; for (let i = 3; i < data.length; i += 4) if (data[i] < 200) lo++; alpha = lo > data.length / 4 * .002; if (!alpha) mode = 0; } ti = await texOf(t, alpha); }
  const o = { ti, mode, two: m ? m.getDoubleSided() : false, bf: [bf[0], bf[1], bf[2], bf[3]], cut: C.cut ?? (m && am === 'MASK' ? m.getAlphaCutoff() : .5) };
  const k = MATS.length; MATS.push(o); matIdx.set(m, k);
  return k;
}

// —— 收集每个变体的三角形（按材质分组）——
const VARS = [];
for (const [vname, nodes] of PARTS) {
  const G = new Map();   // 材质号 → { p: [], n: [], uv: [] }
  for (const top of nodes) {
    const list = [];
    top.traverse(nd => list.push(nd));
    for (const nd of list) {
      const mesh = nd.getMesh();
      if (!mesh || (drop && (drop.test(nd.getName()) || drop.test(mesh.getName())))) continue;
      const W = nd.getWorldMatrix(), det = W[0] * (W[5] * W[10] - W[6] * W[9]) - W[4] * (W[1] * W[10] - W[2] * W[9]) + W[8] * (W[1] * W[6] - W[2] * W[5]);
      for (const pr of mesh.listPrimitives()) {
        if (pr.getMode() !== 4) continue;
        const mat = pr.getMaterial();
        if (mat && drop && drop.test(mat.getName())) continue;
        const mi = await matOf(mat), P = pr.getAttribute('POSITION'), N = pr.getAttribute('NORMAL'), I = pr.getIndices();
        const ti = mat && mat.getBaseColorTextureInfo(), UV = pr.getAttribute('TEXCOORD_' + (ti ? ti.getTexCoord() : 0));
        let g = G.get(mi); if (!g) G.set(mi, g = { p: [], n: [], uv: [] });
        const cnt = I ? I.getCount() : P.getCount(), a = [0, 0, 0], u = [0, 0];
        for (let t = 0; t + 2 < cnt; t += 3) {
          let ix = [0, 1, 2].map(k => I ? I.getScalar(t + k) : t + k);
          if (det < 0) ix = [ix[0], ix[2], ix[1]];
          for (const j of ix) {
            P.getElement(j, a); g.p.push(...toG(mul(W, a)).map(v => v * U));
            if (N) { N.getElement(j, a); const n = toG(mulN(W, a)), l = Math.hypot(...n) || 1; g.n.push(n[0] / l, n[1] / l, n[2] / l); } else g.n.push(0, 0, 0);
            if (UV) { UV.getElement(j, u); g.uv.push(u[0], u[1]); } else g.uv.push(0, 0);
          }
        }
      }
    }
  }
  // 原点：底面中心
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const g of G.values()) for (let i = 0; i < g.p.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], g.p[i]); mx[k] = Math.max(mx[k], g.p[i]); }
  const off = [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]];
  for (const g of G.values()) for (let i = 0; i < g.p.length; i++) g.p[i] += off[i % 3];
  VARS.push({ name: vname, G });
}

// —— 每组：焊接（位置 + UV + 法线）、补法线、可选减面、算棱线 ——
await MeshoptSimplifier.ready;
const OUT = [];
for (const V of VARS) {
  const groups = [];
  let tot = 0; for (const g of V.G.values()) tot += g.p.length / 9;
  for (const [mi, g] of V.G) {
    const nt0 = g.p.length / 9, M = MATS[mi];
    // 没有法线的面：用面法线
    for (let t = 0; t < nt0; t++) {
      if (g.n[t * 9] || g.n[t * 9 + 1] || g.n[t * 9 + 2]) continue;
      const a = g.p.slice(t * 9, t * 9 + 3), b = g.p.slice(t * 9 + 3, t * 9 + 6), c = g.p.slice(t * 9 + 6, t * 9 + 9);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[2] * v[1] - u[1] * v[2], u[0] * v[2] - u[2] * v[0], u[1] * v[0] - u[0] * v[1]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l);   // 左手坐标里叉积取反
      for (let k = 0; k < 3; k++) g.n.splice(t * 9 + k * 3, 3, ...n);
    }
    const map = new Map(), pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i < g.p.length / 3; i++) {
      const key = g.p.slice(i * 3, i * 3 + 3).map(v => Math.round(v * 2000)).join(',') + '|' + g.uv.slice(i * 2, i * 2 + 2).map(v => Math.round(v * 4096)).join(',') + '|' + g.n.slice(i * 3, i * 3 + 3).map(v => Math.round(v * 60)).join(',');
      let j = map.get(key);
      if (j == null) { map.set(key, j = pos.length / 3); pos.push(...g.p.slice(i * 3, i * 3 + 3)); nor.push(...g.n.slice(i * 3, i * 3 + 3)); uv.push(...g.uv.slice(i * 2, i * 2 + 2)); }
      idx.push(j);
    }
    let I = new Uint32Array(idx);
    if (C.tris && tot > C.tris && M.mode !== 1) {   // 透明裁剪的插片（树叶）不减
      const target = Math.min(nt0, Math.max(12, Math.round(nt0 * C.tris / tot))) * 3;
      if (target < I.length) { const [o2] = MeshoptSimplifier.simplify(I, new Float32Array(pos), 3, target, C.err ?? .01, []); I = o2; }
    }
    groups.push({ mi, pos, nor, uv, idx: Array.from(I) });
  }
  // 棱线：同一变体内按位置焊接找相邻面（只给不透明材质）
  const eps = 1e-3, pk = (p, i) => Math.round(p[i * 3] / eps) + ',' + Math.round(p[i * 3 + 1] / eps) + ',' + Math.round(p[i * 3 + 2] / eps);
  const E = new Map(), fns = [];
  groups.forEach((g, gi) => {
    const nt = g.idx.length / 3; g.fl = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) {
      const A = g.idx.slice(t * 3, t * 3 + 3), P = A.map(i => g.pos.slice(i * 3, i * 3 + 3));
      const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], v = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
      fns.push([gi, t, n.map(x => x / l)]);
      if (MATS[g.mi].mode === 1) continue;
      for (let e = 0; e < 3; e++) {
        const a = pk(g.pos, A[(e + 1) % 3]), b = pk(g.pos, A[(e + 2) % 3]), k = a < b ? a + '_' + b : b + '_' + a;
        let L = E.get(k); if (!L) E.set(k, L = []); L.push([gi, t, e, n.map(x => x / l)]);
      }
    }
  });
  // 棱线只留够长的（瓦片、栏杆这类细碎的边在黑绿画风里会糊成一片亮网）
  const cosA = Math.cos((C.crease ?? 40) * Math.PI / 180), minE = C.minEdge ?? .4;
  for (const [key, L] of E) {
    let feat = L.length !== 2;
    if (!feat) { const d = L[0][3][0] * L[1][3][0] + L[0][3][1] * L[1][3][1] + L[0][3][2] * L[1][3][2]; feat = d < cosA; }
    if (feat) { const [a, b] = key.split('_').map(q => q.split(',').map(Number)); feat = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * eps >= minE; }
    if (feat) for (const [gi, t, e] of L) groups[gi].fl[t] |= 1 << e;
  }
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const g of groups) for (let i = 0; i < g.pos.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], g.pos[i]); mx[k] = Math.max(mx[k], g.pos[i]); }
  // 每组顶点数不超过 65535（u16 索引）：超了就按三角形拆成几组
  const split = [];
  for (const g of groups) {
    if (g.pos.length / 3 < 65536) { split.push(g); continue; }
    for (let t0 = 0; t0 < g.idx.length; ) {
      const rm = new Map(), p2 = [], n2 = [], u2 = [], i2 = [], f2 = [];
      while (t0 < g.idx.length && rm.size < 65000) { for (let k = 0; k < 3; k++) { const i = g.idx[t0 + k]; let j = rm.get(i); if (j == null) { rm.set(i, j = p2.length / 3); p2.push(...g.pos.slice(i * 3, i * 3 + 3)); n2.push(...g.nor.slice(i * 3, i * 3 + 3)); u2.push(...g.uv.slice(i * 2, i * 2 + 2)); } i2.push(j); } f2.push(g.fl[t0 / 3]); t0 += 3; }
      split.push({ mi: g.mi, pos: p2, nor: n2, uv: u2, idx: i2, fl: Uint8Array.from(f2) });
    }
  }
  OUT.push({ name: V.name, mn, mx, groups: split });
  console.log('变体', V.name, '尺寸', mx.map((v, i) => (v - mn[i]).toFixed(2)).join(' × '), '米', '组', split.length, '三角形', split.reduce((a, g) => a + g.idx.length / 3, 0));
}

// —— 写文件 ——
const chunks = [], pad4 = n => (4 - n % 4) % 4;
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); chunks.push(b); };
const raw = b => { chunks.push(b); const p = pad4(b.length); if (p) chunks.push(Buffer.alloc(p)); };
chunks.push(Buffer.from('DSM2')); u32(OUT.length); u32(MATS.length); u32(TEXS.length);
raw(Buffer.from(TEXS.map(t => t.fmt)));
for (const m of MATS) { const b = Buffer.alloc(24); b[0] = m.ti; b[1] = m.mode; b[2] = m.two ? 1 : 0; for (let k = 0; k < 4; k++) b.writeFloatLE(m.bf[k], 4 + k * 4); b.writeFloatLE(m.cut, 20); chunks.push(b); }
for (const V of OUT) {
  const nb = Buffer.from(V.name, 'utf8'); raw(Buffer.concat([Buffer.from([nb.length]), nb]));
  const bb = Buffer.alloc(24); for (let k = 0; k < 3; k++) { bb.writeFloatLE(V.mn[k], k * 4); bb.writeFloatLE(V.mx[k], 12 + k * 4); } chunks.push(bb);
  u32(V.groups.length);
  for (const g of V.groups) {
    const nv = g.pos.length / 3, ni = g.idx.length;
    u32(g.mi); u32(nv); u32(ni);
    const P = Buffer.alloc(nv * 6); for (let i = 0; i < nv * 3; i++) { const k = i % 3, r = (V.mx[k] - V.mn[k]) || 1; P.writeUInt16LE(Math.round((g.pos[i] - V.mn[k]) / r * 65535), i * 2); } raw(P);
    const Nb = Buffer.alloc(nv * 3); for (let i = 0; i < nv * 3; i++) Nb.writeInt8(Math.max(-127, Math.min(127, Math.round(g.nor[i] * 127))), i); raw(Nb);
    const Ub = Buffer.alloc(nv * 8); for (let i = 0; i < nv * 2; i++) Ub.writeFloatLE(g.uv[i], i * 4); raw(Ub);
    const Ib = Buffer.alloc(ni * 2); for (let i = 0; i < ni; i++) Ib.writeUInt16LE(g.idx[i], i * 2); raw(Ib);
    raw(Buffer.from(g.fl));
  }
}
const outDir = path.join(root, 'assets', 'models');
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.startsWith(id + '_') && /\.(webp|jpg)$/.test(f)) fs.unlinkSync(path.join(outDir, f));
const bin = Buffer.concat(chunks);
fs.writeFileSync(path.join(outDir, id + '.bin'), bin);
let tsz = 0; TEXS.forEach((t, k) => { fs.writeFileSync(path.join(outDir, `${id}_${k}.${t.fmt ? 'webp' : 'jpg'}`), t.out); tsz += t.out.length; });
console.log('写出', id + '.bin', (bin.length / 1024).toFixed(0) + 'KB', '贴图', TEXS.length, '张', (tsz / 1024).toFixed(0) + 'KB', '材质', MATS.map(m => ['不透明', '裁剪', '玻璃'][m.mode] + (m.ti < 255 ? '#' + m.ti : '')).join(' '));

// —— 预览：每个变体正面（从 +x 看）、侧面（从右 +y 看）、俯视，贴图 + 透明裁剪 + 光照 ——
if (preview) {
  const TD = await Promise.all(TEXS.map(async t => { const { data, info } = await sharp(t.out).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; }));
  const cell = 300, views = [[p => [p[1], -p[2]], p => p[0]], [p => [p[0], -p[2]], p => -p[1]], [p => [p[0], p[1]], p => p[2]]];
  const Wd = cell * 3, Hd = cell * OUT.length, img = Buffer.alloc(Wd * Hd * 3, 60);
  const L = [-.45, .55, .7].map(v => v / Math.hypot(-.45, .55, .7));
  OUT.forEach((V, vi) => views.forEach(([pj, dp], wi) => {
    const zb = new Float32Array(cell * cell).fill(-1e9);
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const g of V.groups) for (let i = 0; i < g.pos.length / 3; i++) { const q = pj(g.pos.slice(i * 3, i * 3 + 3)); a0 = Math.min(a0, q[0]); a1 = Math.max(a1, q[0]); b0 = Math.min(b0, q[1]); b1 = Math.max(b1, q[1]); }
    const s = (cell - 16) / Math.max(a1 - a0, b1 - b0, 1e-6), ox = (cell - (a1 - a0) * s) / 2, oy = (cell - (b1 - b0) * s) / 2;
    for (const g of V.groups) {
      const M = MATS[g.mi], T = M.ti < 255 ? TD[M.ti] : null;
      for (let t = 0; t < g.idx.length; t += 3) {
        const I3 = [g.idx[t], g.idx[t + 1], g.idx[t + 2]], Pp = I3.map(i => g.pos.slice(i * 3, i * 3 + 3)), Q = Pp.map(p => { const q = pj(p); return [(q[0] - a0) * s + ox, (q[1] - b0) * s + oy, dp(p)]; });
        const Uv = I3.map(i => g.uv.slice(i * 2, i * 2 + 2)), Nn = I3.map(i => g.nor.slice(i * 3, i * 3 + 3));
        const d = (Q[1][1] - Q[2][1]) * (Q[0][0] - Q[2][0]) + (Q[2][0] - Q[1][0]) * (Q[0][1] - Q[2][1]);
        if (Math.abs(d) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(Q[0][0], Q[1][0], Q[2][0]))), x1 = Math.min(cell - 1, Math.ceil(Math.max(Q[0][0], Q[1][0], Q[2][0])));
        const y0 = Math.max(0, Math.floor(Math.min(Q[0][1], Q[1][1], Q[2][1]))), y1 = Math.min(cell - 1, Math.ceil(Math.max(Q[0][1], Q[1][1], Q[2][1])));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const l0 = ((Q[1][1] - Q[2][1]) * (x - Q[2][0]) + (Q[2][0] - Q[1][0]) * (y - Q[2][1])) / d, l1 = ((Q[2][1] - Q[0][1]) * (x - Q[2][0]) + (Q[0][0] - Q[2][0]) * (y - Q[2][1])) / d, l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const z = l0 * Q[0][2] + l1 * Q[1][2] + l2 * Q[2][2], j = y * cell + x;
          if (z < zb[j]) continue;
          let c = [M.bf[0] * 255, M.bf[1] * 255, M.bf[2] * 255];
          if (T) { let u = l0 * Uv[0][0] + l1 * Uv[1][0] + l2 * Uv[2][0], v = l0 * Uv[0][1] + l1 * Uv[1][1] + l2 * Uv[2][1]; u -= Math.floor(u); v -= Math.floor(v); const k = (Math.min(T.h - 1, Math.floor(v * T.h)) * T.w + Math.min(T.w - 1, Math.floor(u * T.w))) * 4; if (M.mode === 1 && T.d[k + 3] < M.cut * 255) continue; c = [c[0] * T.d[k] / 255, c[1] * T.d[k + 1] / 255, c[2] * T.d[k + 2] / 255]; }
          zb[j] = z;
          const n = [0, 1, 2].map(k => l0 * Nn[0][k] + l1 * Nn[1][k] + l2 * Nn[2][k]), li = .45 + .55 * Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (Math.hypot(...n) || 1);
          const o = ((vi * cell + y) * Wd + wi * cell + x) * 3; for (let k = 0; k < 3; k++) img[o + k] = Math.min(255, c[k] * li);
        }
      }
    }
  }));
  await sharp(img, { raw: { width: Wd, height: Hd, channels: 3 } }).png().toFile(preview);
  console.log('预览', preview);
}
