// 离线模型转换：免费可商用的 glTF/glb 模型（CC0 / CC BY，来源与署名记在 sources.json）→ 游戏用的紧凑网格 assets/models/<id>.bin
// 用法：cd tools/mdl && npm i && node build.mjs <id> [glb 路径] [--preview 预览图.png]
// 做的事：
//  · 摊平场景（每个节点的世界变换）、只取三角形；按 sources.json 的轴映射换成游戏的模型坐标（x 向前、y 向右、z 向上），按长度缩放、船按水线放到 z = 0
//  · 颜色烘进每个三角形：材质底色 × 贴图（三角形内取几处平均）× 顶点色，换成 sRGB，再归并成不超过 255 色的调色板；半透明材质记成玻璃
//  · 按位置 + 颜色焊接顶点，meshoptimizer 减面到目标三角形数（颜色交界当接缝保留）
//  · 算棱线：两面夹角大、颜色明显不同、开放边——每个三角形三条边各 1 位，游戏里黑绿画风的发光棱线、写实画风的暗棱线就画这些边
// 文件格式（小端）：'DSM1'、顶点数 u32、三角形数 u32、调色板色数 u32、包围盒最小 / 最大 6 × f32、调色板 n × RGB u8（补齐到 4 字节）、
//   顶点 nv × 3 × u16（包围盒内量化）、索引 nt × 3 × u16 / u32（顶点数 ≥ 65536 时）、每个三角形 u8 颜色号 + u8 标记（位 0–2 棱线、位 3 玻璃）
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../..');
const args = process.argv.slice(2), id = args[0];
const SRC = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8')), C = SRC[id];
if (!C) { console.error('sources.json 里没有', id); process.exit(1); }
const glb = args[1] && !args[1].startsWith('--') ? args[1] : path.join(here, 'src', C.file || id + '.glb');
const pvi = args.indexOf('--preview'), preview = pvi >= 0 ? args[pvi + 1] : null;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(glb);
const R = doc.getRoot();

// —— 贴图：解码一次，缩到 ≤ 256 方便取平均色 ——
const TEX = new Map();
for (const t of R.listTextures()) {
  try {
    const { data, info } = await sharp(Buffer.from(t.getImage())).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    TEX.set(t, { d: data, w: info.width, h: info.height });
  } catch (e) { console.warn('贴图解不开', t.getName(), e.message); }
}
const lin = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4, srgb = c => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
function sample(T, u, v) {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(T.w - 1, Math.floor(u * T.w)), y = Math.min(T.h - 1, Math.floor(v * T.h)), i = (y * T.w + x) * 4;
  return [lin(T.d[i] / 255), lin(T.d[i + 1] / 255), lin(T.d[i + 2] / 255), T.d[i + 3] / 255];
}

// —— 轴映射：'x' / '-z' 之类，游戏的 x、y、z 各取模型的哪个分量 ——
const AX = (C.axes || ['x', 'y', 'z']).map(s => ({ i: 'xyz'.indexOf(s.replace('-', '')), k: s[0] === '-' ? -1 : 1 }));
const drop = C.drop ? new RegExp(C.drop, 'i') : null;

// —— 收集三角形 ——
const F = [];   // { p: [9]，c: [r, g, b] 线性，g: 玻璃 }
const mul = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const scene = R.getDefaultScene() || R.listScenes()[0];
scene.traverse(node => {
  const mesh = node.getMesh();
  if (!mesh || (drop && (drop.test(node.getName()) || drop.test(mesh.getName())))) return;
  const W = node.getWorldMatrix();
  for (const pr of mesh.listPrimitives()) {
    if (pr.getMode() !== 4) continue;
    const mat = pr.getMaterial(), P = pr.getAttribute('POSITION'), I = pr.getIndices(), VC = pr.getAttribute('COLOR_0');
    if (mat && drop && drop.test(mat.getName())) continue;
    const bf = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1], bt = mat && mat.getBaseColorTexture(), T = bt && TEX.get(bt);
    const ti = mat && mat.getBaseColorTextureInfo(), UV = T ? pr.getAttribute('TEXCOORD_' + (ti ? ti.getTexCoord() : 0)) : null;
    const xf = ti && ti.getExtension('KHR_texture_transform');
    const blend = mat && mat.getAlphaMode() === 'BLEND', glass = !!mat && ((blend && bf[3] < .9) || /glass|window|canopy|玻璃/i.test(mat.getName()));
    const n = I ? I.getCount() : P.getCount(), tmp = [0, 0, 0, 0], uv = [0, 0];
    const getUV = j => { UV.getElement(j, uv); let [u, v] = uv; if (xf) { const o = xf.getOffset(), s = xf.getScale(), r = xf.getRotation(), c = Math.cos(r), sn = Math.sin(r); u *= s[0]; v *= s[1]; [u, v] = [c * u + sn * v + o[0], -sn * u + c * v + o[1]]; } return [u, v]; };
    for (let t = 0; t + 2 < n; t += 3) {
      const ix = [0, 1, 2].map(k => I ? I.getScalar(t + k) : t + k), p = [];
      for (const j of ix) { P.getElement(j, tmp); const w = mul(W, tmp), q = AX.map(a => w[a.i] * a.k); p.push(...q); }
      let c = [bf[0], bf[1], bf[2]], a = bf[3];   // glTF 底色系数本来就是线性的
      if (T && UV) {   // 三个角、三条边中点、重心，七处平均
        const u3 = ix.map(getUV), pts = [...u3, [(u3[0][0] + u3[1][0]) / 2, (u3[0][1] + u3[1][1]) / 2], [(u3[1][0] + u3[2][0]) / 2, (u3[1][1] + u3[2][1]) / 2], [(u3[2][0] + u3[0][0]) / 2, (u3[2][1] + u3[0][1]) / 2], [(u3[0][0] + u3[1][0] + u3[2][0]) / 3, (u3[0][1] + u3[1][1] + u3[2][1]) / 3]];
        const s = [0, 0, 0, 0]; for (const [u, v] of pts) { const q = sample(T, u, v); for (let k = 0; k < 4; k++) s[k] += q[k] / pts.length; }
        c = [c[0] * s[0], c[1] * s[1], c[2] * s[2]]; a *= s[3];
      }
      if (VC) { const s = [0, 0, 0]; for (const j of ix) { VC.getElement(j, tmp); for (let k = 0; k < 3; k++) s[k] += tmp[k] / 3; } c = [c[0] * s[0], c[1] * s[1], c[2] * s[2]]; }
      if (a < .08 && !glass) continue;
      F.push({ p, c, g: glass });
    }
  }
});
console.log('原始三角形', F.length);

// —— 缩放、摆放：长度（游戏 x 方向）缩到 C.len；船体：水线（C.wl：从最低点往上占总高的比例）放到 z = 0；其它：最低点放到 z = 0 ——
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const f of F) for (let k = 0; k < 9; k++) { const a = k % 3; mn[a] = Math.min(mn[a], f.p[k]); mx[a] = Math.max(mx[a], f.p[k]); }
const sc = (C.len || 1) / (mx[0] - mn[0]), off = [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -(mn[2] + (mx[2] - mn[2]) * (C.wl || 0))];
for (const f of F) for (let k = 0; k < 9; k++) f.p[k] = (f.p[k] + off[k % 3]) * sc + (C.shift ? C.shift[k % 3] : 0);
if (C.clipZ != null) for (let i = F.length; i--;) { const z = Math.max(F[i].p[2], F[i].p[5], F[i].p[8]); if (z < C.clipZ) F.splice(i, 1); }

// —— 调色板：颜色转 sRGB，按 5 位量化合并；多于 255 色时 k-means 归并 ——
const area = f => { const [a, b, c] = [f.p.slice(0, 3), f.p.slice(3, 6), f.p.slice(6, 9)], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; };
for (const f of F) { f.s = f.c.map(v => Math.round(Math.min(1, Math.max(0, srgb(v))) * 255)); f.a = area(f); }
const qk = s => (s[0] >> 3) << 10 | (s[1] >> 3) << 5 | s[2] >> 3;
let bins = new Map();
for (const f of F) { const k = qk(f.s); let b = bins.get(k); if (!b) bins.set(k, b = { s: [0, 0, 0], w: 0 }); const w = f.a + 1e-9; for (let j = 0; j < 3; j++) b.s[j] += f.s[j] * w; b.w += w; }
let pal = [...bins.values()].map(b => b.s.map(v => v / b.w));
const near = (c, P) => { let bi = 0, bd = 1e9; for (let i = 0; i < P.length; i++) { const d = (c[0] - P[i][0]) ** 2 * .3 + (c[1] - P[i][1]) ** 2 * .59 + (c[2] - P[i][2]) ** 2 * .11; if (d < bd) { bd = d; bi = i; } } return bi; };
const maxC = Math.min(255, C.colors || 255);
if (pal.length > maxC) {
  const B = [...bins.values()], ws = B.map(b => b.w), cs = B.map(b => b.s.map(v => v / b.w));
  pal = cs.map((c, i) => [c, ws[i]]).sort((a, b) => b[1] - a[1]).slice(0, maxC).map(x => x[0].slice());
  for (let it = 0; it < 12; it++) {
    const acc = pal.map(() => [0, 0, 0, 0]);
    cs.forEach((c, i) => { const k = near(c, pal); for (let j = 0; j < 3; j++) acc[k][j] += c[j] * ws[i]; acc[k][3] += ws[i]; });
    pal = acc.map((a, i) => a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : pal[i]);
  }
}
pal = pal.map(c => c.map(v => Math.round(v)));
const pmap = new Map();
for (const f of F) { const k = qk(f.s); let i = pmap.get(k); if (i == null) pmap.set(k, i = near(f.s, pal)); f.ci = i; }
console.log('调色板', pal.length, '色');

// —— 焊接（位置 + 颜色 + 玻璃）→ 带索引网格 ——
mn = [1e9, 1e9, 1e9]; mx = [-1e9, -1e9, -1e9];
for (const f of F) for (let k = 0; k < 9; k++) { const a = k % 3; mn[a] = Math.min(mn[a], f.p[k]); mx[a] = Math.max(mx[a], f.p[k]); }
const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), eps = ext * 2e-5;
function weld(faces, keyAttr) {
  const map = new Map(), pos = [], idx = [];
  for (const f of faces) for (let v = 0; v < 3; v++) {
    const x = f.p[v * 3], y = f.p[v * 3 + 1], z = f.p[v * 3 + 2], k = Math.round(x / eps) + ',' + Math.round(y / eps) + ',' + Math.round(z / eps) + (keyAttr ? '|' + keyAttr(f) : '');
    let i = map.get(k);
    if (i == null) { map.set(k, i = pos.length / 3); pos.push(x, y, z); }
    idx.push(i);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const att = f => f.ci + (f.g ? 'g' : '');
let { pos, idx } = weld(F, att);
const fa = F.map(att);   // 每个三角形的颜色 / 玻璃
// 每个顶点属于哪种颜色（焊接时颜色是键的一部分，所以一个顶点只有一种）
const vAtt = new Array(pos.length / 3);
for (let t = 0; t < F.length; t++) for (let v = 0; v < 3; v++) vAtt[idx[t * 3 + v]] = fa[t];
console.log('焊接后顶点', pos.length / 3);

// —— 减面 ——
await MeshoptSimplifier.ready;
const target = C.tris || 20000;
if (F.length > target) {
  const [out, err] = MeshoptSimplifier.simplify(idx, pos, 3, target * 3, C.err ?? .02, C.lock ? ['LockBorder'] : []);
  console.log('减面', F.length, '→', out.length / 3, '误差', (err * ext).toFixed(3));
  idx = out;
}
// 去掉退化三角形、重排顶点
const keep = [];
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t], b = idx[t + 1], c = idx[t + 2];
  if (a === b || b === c || a === c) continue;
  const f = { p: [...pos.slice(a * 3, a * 3 + 3), ...pos.slice(b * 3, b * 3 + 3), ...pos.slice(c * 3, c * 3 + 3)] };
  if (area(f) < eps * eps) continue;
  keep.push(a, b, c);
}
const remap = new Map(), P2 = [], A2 = [];
const I2 = keep.map(i => { let j = remap.get(i); if (j == null) { remap.set(i, j = P2.length / 3); P2.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); A2.push(vAtt[i]); } return j; });
const nv = P2.length / 3, nt = I2.length / 3;
const tci = new Uint8Array(nt), tfl = new Uint8Array(nt);
for (let t = 0; t < nt; t++) { const a = A2[I2[t * 3]]; tci[t] = parseInt(a); if (a.endsWith('g')) tfl[t] |= 8; }

// —— 棱线：只按位置焊接找相邻面 ——
const pk = i => Math.round(P2[i * 3] / eps) + ',' + Math.round(P2[i * 3 + 1] / eps) + ',' + Math.round(P2[i * 3 + 2] / eps);
const pid = new Map(), vp = new Int32Array(nv);
for (let i = 0; i < nv; i++) { const k = pk(i); let j = pid.get(k); if (j == null) pid.set(k, j = pid.size); vp[i] = j; }
const fn = [];
for (let t = 0; t < nt; t++) {
  const a = I2[t * 3] * 3, b = I2[t * 3 + 1] * 3, c = I2[t * 3 + 2] * 3, u = [P2[b] - P2[a], P2[b + 1] - P2[a + 1], P2[b + 2] - P2[a + 2]], v = [P2[c] - P2[a], P2[c + 1] - P2[a + 1], P2[c + 2] - P2[a + 2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
  fn.push([n[0] / l, n[1] / l, n[2] / l]);
}
const E = new Map();
for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {   // 边 e：对着第 e 个顶点
  const a = vp[I2[t * 3 + (e + 1) % 3]], b = vp[I2[t * 3 + (e + 2) % 3]], k = a < b ? a + '_' + b : b + '_' + a;
  let L = E.get(k); if (!L) E.set(k, L = []); L.push([t, e]);
}
const cosA = Math.cos((C.crease ?? 38) * Math.PI / 180), cd = (i, j) => { const a = pal[i], b = pal[j]; return Math.abs((a[0] - b[0]) * .3 + (a[1] - b[1]) * .59 + (a[2] - b[2]) * .11) + (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) * .15; };
let ne = 0;
for (const L of E.values()) {
  let feat = L.length !== 2;
  if (!feat) {
    const [[t0], [t1]] = L, n0 = fn[t0], n1 = fn[t1], d = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    feat = Math.abs(d) < cosA && d < cosA || cd(tci[t0], tci[t1]) > (C.colEdge ?? 34) || (tfl[t0] & 8) !== (tfl[t1] & 8);
  }
  if (feat) { ne++; for (const [t, e] of L) tfl[t] |= 1 << e; }
}
console.log('顶点', nv, '三角形', nt, '棱线', ne);

// —— 写文件 ——
let bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv * 3; i++) { const a = i % 3; bmn[a] = Math.min(bmn[a], P2[i]); bmx[a] = Math.max(bmx[a], P2[i]); }
const big = nv >= 65536, palB = Math.ceil(pal.length * 3 / 4) * 4;
const size = 4 + 12 + 24 + palB + Math.ceil(nv * 6 / 4) * 4 + nt * 3 * (big ? 4 : 2) + nt * 2;
const buf = Buffer.alloc(Math.ceil(size / 4) * 4), dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
let o = 0;
buf.write('DSM1', 0, 'ascii'); o = 4;
dv.setUint32(o, nv, true); dv.setUint32(o + 4, nt, true); dv.setUint32(o + 8, pal.length, true); o += 12;
for (let k = 0; k < 3; k++) { dv.setFloat32(o + k * 4, bmn[k], true); dv.setFloat32(o + 12 + k * 4, bmx[k], true); } o += 24;
pal.forEach((c, i) => { buf[o + i * 3] = c[0]; buf[o + i * 3 + 1] = c[1]; buf[o + i * 3 + 2] = c[2]; }); o += palB;
for (let i = 0; i < nv * 3; i++) { const a = i % 3, q = Math.round((P2[i] - bmn[a]) / ((bmx[a] - bmn[a]) || 1) * 65535); dv.setUint16(o + i * 2, q, true); } o += Math.ceil(nv * 6 / 4) * 4;
for (let i = 0; i < nt * 3; i++) { if (big) dv.setUint32(o + i * 4, I2[i], true); else dv.setUint16(o + i * 2, I2[i], true); } o += nt * 3 * (big ? 4 : 2);
for (let t = 0; t < nt; t++) { buf[o + t * 2] = tci[t]; buf[o + t * 2 + 1] = tfl[t]; }
const outF = path.join(root, 'assets', 'models', id + '.bin');
fs.writeFileSync(outF, buf);
console.log('写出', path.relative(root, outF), (buf.length / 1024).toFixed(0) + 'KB', '尺寸', bmx.map((v, i) => (v - bmn[i]).toFixed(2)).join(' × '), 'z', bmn[2].toFixed(2), '…', bmx[2].toFixed(2));

// —— 预览：侧视（从右舷看，船头朝右）、俯视、正视（从船头看），按颜色 + 光照 + 棱线画 ——
if (preview) {
  const Wd = 1600, views = [['side', p => [p[0], -p[2]]], ['top', p => [p[0], p[1]]], ['front', p => [p[1], -p[2]]], ['back3q', p => [p[0] * .7 + p[1] * .7, -p[2] - (p[0] * .7 - p[1] * .7) * .35]]];
  const depth = { side: p => -p[1], top: p => p[2], front: p => p[0], back3q: p => (p[0] * .7 - p[1] * .7) * .9 + p[2] * .4 };
  const L = (() => { const l = [-.45, .55, .7], n = Math.hypot(...l); return l.map(v => v / n); })();
  const imgs = [];
  for (const [nm, pj] of views) {
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (let i = 0; i < nv; i++) { const q = pj([P2[i * 3], P2[i * 3 + 1], P2[i * 3 + 2]]); a0 = Math.min(a0, q[0]); a1 = Math.max(a1, q[0]); b0 = Math.min(b0, q[1]); b1 = Math.max(b1, q[1]); }
    const s = (Wd - 20) / Math.max(a1 - a0, (b1 - b0) * 1.0), w = Wd, h = Math.ceil((b1 - b0) * s) + 20, img = Buffer.alloc(w * h * 3, 40), zb = new Float32Array(w * h).fill(-1e9);
    const tp = i => { const p = [P2[i * 3], P2[i * 3 + 1], P2[i * 3 + 2]], q = pj(p); return [(q[0] - a0) * s + 10, (q[1] - b0) * s + 10, depth[nm](p)]; };
    for (let t = 0; t < nt; t++) {
      const V = [0, 1, 2].map(k => tp(I2[t * 3 + k])), n = fn[t], li = .35 + .65 * Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), c = pal[tci[t]];
      const x0 = Math.max(0, Math.floor(Math.min(V[0][0], V[1][0], V[2][0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(V[0][0], V[1][0], V[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(V[0][1], V[1][1], V[2][1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(V[0][1], V[1][1], V[2][1])));
      const d = (V[1][1] - V[2][1]) * (V[0][0] - V[2][0]) + (V[2][0] - V[1][0]) * (V[0][1] - V[2][1]);
      if (Math.abs(d) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const l0 = ((V[1][1] - V[2][1]) * (x - V[2][0]) + (V[2][0] - V[1][0]) * (y - V[2][1])) / d, l1 = ((V[2][1] - V[0][1]) * (x - V[2][0]) + (V[0][0] - V[2][0]) * (y - V[2][1])) / d, l2 = 1 - l0 - l1;
        if (l0 < -.01 || l1 < -.01 || l2 < -.01) continue;
        const z = l0 * V[0][2] + l1 * V[1][2] + l2 * V[2][2], j = y * w + x;
        if (z < zb[j]) continue;
        zb[j] = z;
        const bw = [l0, l1, l2], ed = [0, 1, 2].some(e => (tfl[t] >> e & 1) && bw[e] * Math.abs(d) / Math.hypot(V[(e + 1) % 3][0] - V[(e + 2) % 3][0], V[(e + 1) % 3][1] - V[(e + 2) % 3][1]) < .7);
        for (let k = 0; k < 3; k++) img[j * 3 + k] = ed ? 255 * (k === 1) : Math.min(255, c[k] * li * (tfl[t] & 8 ? .6 : 1) + (tfl[t] & 8 && k === 2 ? 60 : 0));
      }
    }
    imgs.push({ img, w, h });
  }
  const H = imgs.reduce((a, b) => a + b.h, 0), all = Buffer.alloc(Wd * H * 3);
  let yy = 0; for (const I of imgs) { I.img.copy(all, yy * Wd * 3); yy += I.h; }
  await sharp(all, { raw: { width: Wd, height: H, channels: 3 } }).png().toFile(preview);
  console.log('预览', preview);
}
