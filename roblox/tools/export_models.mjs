// 把网页版的原模型（js/mdl/<键>.js，tools/v3gbake.js 烘焙的格式）导出成 Roblox Studio「导入 3D」能直接用的 .glb：
//   node roblox/tools/export_models.mjs            → roblox/models/<槽位>.glb + roblox/models/credits.txt
// 每个 glb：
//   - 坐标换成 Roblox 的（Y 朝上，正前方 −Z），单位是格（stud），按 LIST 里的长度缩放，底面中心在原点；
//   - 按「部件 × 材质」拆成多个网格节点，名字前缀表示用途：Body（车身）、Turret（炮塔连炮管 / 加特林 / 导弹架）、Rotor（主旋翼）、TailRotor（尾桨）；
//     单个网格超过 MAXTRI 个三角形就再切开（Roblox 单个网格有三角形上限）；
//   - 几个小标记网格（一个小四面体）：_Front 车头、_Top 顶上、_PivotTurret 炮塔转轴、_PivotRotor 主旋翼轴、_PivotTail 尾桨轴、_AxisTail 尾桨轴方向——
//     游戏脚本读它们的位置来摆正方向、找转轴，读完就删掉（不管导入时 Studio 怎么转换坐标都能摆对）；
//   - 贴图缩到 1024（Roblox 上限），不透明的存 JPEG、带透明的存 PNG；法线贴图 512。
// 士兵（army）原模型是 T 字站姿：用网页版的 js/v3man.js 蒙皮摆成端枪的姿势，手里补一支步枪。
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.resolve(here, '..', 'models');
const MAXTRI = 10000;

// 槽位 → 原模型：lod 用烘焙时减好的第几级网格（0 原网格），len 是模型沿前后方向的长度（格），h 是高度（士兵按身高缩放）
const LIST = [
  { slot: 'soldier', key: 'army', lod: 1, h: 5.2, pose: 'sa', name: '步兵' },
  { slot: 'ifv', key: 'm2a3', lod: 1, len: 15, name: '步兵战车' },
  { slot: 'tank', key: 'm1a1', lod: 1, len: 22, name: '主战坦克' },
  { slot: 'aa', key: 'm163', lod: 0, len: 12, name: '防空车' },
  { slot: 'arty', key: 'm109', lod: 1, len: 16, name: '自行火炮' },
  // M270 原模型的发射箱朝车体右侧转出、起竖（网页版 v3a82.js 的说明），车体中心在模型 y = 2.84：按车体居中，发射箱朝 +X（车的右边）
  { slot: 'mlrs', key: 'm270', lod: 2, len: 16, cy: 2.84, name: '火箭炮' },
  { slot: 'heli', key: 'ah64', lod: 0, len: 30, name: '武装直升机' },
  // 0.3 新兵种：飞机去掉起落架（drop），轰-6 烘焙出来机头朝 −x（网页版 V3G_FLIP 解码时转 180°），这里也转
  { slot: 'transport', key: 'uh60', lod: 1, len: 30, name: '运兵直升机' },
  { slot: 'drone', key: 'mq9', lod: 0, len: 18, drop: ['gear'], name: '察打无人机' },
  { slot: 'attacker', key: 'a10', lod: 1, len: 24, drop: ['gear'], name: '攻击机' },
  { slot: 'fighter', key: 'j20', lod: 2, len: 30, name: '战斗机' },
  { slot: 'bomber', key: 'h6k', lod: 1, len: 46, drop: ['gear'], flip: true, name: '轰炸机' },
  { slot: 'jeep', key: 'matv', lod: 1, len: 13, name: '机枪车' },
  { slot: 'td', key: 'ptl02', lod: 1, len: 18, name: '突击炮' },
  { slot: 'breacher', key: 'm1150', lod: 1, len: 23, name: '破障车' },
  { slot: 'spaag', key: 't625', lod: 1, len: 20, name: '弹炮防空车' },
  { slot: 'cram', key: 'cram', lod: 1, len: 12, name: '拦截炮' },
  { slot: 'sam', key: 'patriot', lod: 1, len: 22, name: '防空导弹' },
  { slot: 'howitzer', key: 'm777', lod: 2, len: 20, name: '牵引榴弹炮' },
  { slot: 'heavyarty', key: 'pzh2000', lod: 1, len: 24, gain: 2.3, name: '重型自行火炮' },   // 原贴图很暗（平均亮度 28/255），提亮
  // 步兵组手里的道具（摆在士兵旁边）
  { slot: 'prop_javelin', key: 'javl', lod: 1, len: 2.6, name: '标枪（道具）' },
  { slot: 'prop_stinger', key: 'stinger', lod: 1, len: 3.4, name: '毒刺（道具）' },
  { slot: 'prop_mortar', key: 'm224', lod: 1, len: 2.4, name: '迫击炮（道具）' },
  { slot: 'prop_mg', key: 'm240', lod: 1, len: 2.8, name: '机枪（道具）' },
];
const ROLE = { tur: 'Turret', gun: 'Turret', gat: 'Turret', tow: 'Turret', rdr: 'Turret', rotor: 'Rotor', trotor: 'TailRotor' };

function readModel(key) {
  const t = fs.readFileSync(path.join(repo, 'js', 'mdl', key + '.js'), 'utf8');
  const a = t.indexOf('V3G.add('), q = t.lastIndexOf(", '"), e = t.lastIndexOf("')");
  const head = t.slice(a + 8, q), c = head.indexOf(',');
  const meta = JSON.parse(head.slice(c + 1));
  const bin = Buffer.from(t.slice(q + 3, e), 'base64');
  const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length);
  const VB = new Float32Array(ab, meta.vb[0], meta.vb[1] / 4);
  const IB = meta.it === 4 ? new Uint32Array(ab, meta.ib[0], meta.ib[1] / 4) : new Uint16Array(ab, meta.ib[0], meta.ib[1] / 2);
  return { meta, bin, VB, IB };
}

// 士兵：v3man.js 的焊接 + 权重 + 正向运动学蒙皮（和网页版画出来的姿势一模一样）
function poseSoldier(M, pose) {
  const ctx = vm.createContext({ Math, Float32Array, Uint32Array, Uint16Array, Int32Array, Map, Set, Array, Object, Number, console });
  vm.runInContext(fs.readFileSync(path.join(repo, 'js', 'v3man.js'), 'utf8') +
    '\n;globalThis.__x = { V: V3MAN, prep: v3manPrep, spec: v3manSpec, skin: v3manSkin, nRifle: V3MAN_RIFLE.length };', ctx);
  const X = ctx.__x;
  const meta = JSON.parse(JSON.stringify(M.meta));
  const r = X.prep(meta, M.VB, M.IB);
  const S = X.spec(pose, true);
  const { VB } = X.skin(S, true);
  const nv = X.V.nv, add = [];
  for (let b = 0; b < X.nRifle; b++) for (let f = 0; f < 6; f++) { const v0 = nv + b * 24 + f * 4; add.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); }
  const IB = new Uint32Array(r.IB.length + add.length);
  IB.set(r.IB); IB.set(add, r.IB.length);
  const mi = meta.mats.length;
  meta.mats.push({ n: 'rifle', c: [0.075, 0.078, 0.072, 1], t: null, nt: null, mr: [0.55, 0.5], am: 0 });
  meta.lod = meta.lod.map(L => [...L, [mi, -1, r.IB.length, add.length]]);
  meta.parts = [];
  return { meta, bin: M.bin, VB, IB };
}

// 贴图：交给 Python（Pillow）缩放、转格式
function convertImages(jobs, tmp) {
  if (!jobs.length) return;
  const list = path.join(tmp, 'jobs.json');
  fs.writeFileSync(list, JSON.stringify(jobs));
  const py = `
import json, sys
from PIL import Image
for j in json.load(open(sys.argv[1])):
    if 'solid' in j:
        Image.new('RGB', (4, 4), tuple(j['solid'])).save(j['out'], 'PNG')
        continue
    im = Image.open(j['in'])
    im.load()
    if max(im.size) > j['max']:
        k = j['max'] / max(im.size)
        im = im.resize((max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k))), Image.LANCZOS)
    if j.get('gain', 1) != 1:   # 原贴图太暗的（PzH 2000）提亮：颜色通道乘系数，透明通道不动
        g = j['gain']
        bands = im.convert('RGBA').split()
        im = Image.merge('RGBA', [b.point(lambda v: min(255, round(v * g))) for b in bands[:3]] + [bands[3]])
    if j['fmt'] == 'JPEG':
        im.convert('RGB').save(j['out'], 'JPEG', quality=88, optimize=True)
    else:
        im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB').save(j['out'], 'PNG', optimize=True)
`;
  execFileSync('python3', ['-I', '-c', py, list], { stdio: 'inherit' });
}

// 小四面体（标记用）
function tetra(c, s) {
  const [x, y, z] = c;
  const P = [[x, y + s, z], [x - s, y - s * 0.6, z + s * 0.6], [x + s, y - s * 0.6, z + s * 0.6], [x, y - s * 0.6, z - s]];
  return { P, I: [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2] };
}

function exportOne(item, tmp) {
  let M = readModel(item.key);
  if (item.pose) M = poseSoldier(M, item.pose);
  if (item.flip) {   // 绕竖轴转 180°：x、y 取反（法线也是），部件支点跟着转
    const st0 = M.meta.st || 8, VB2 = new Float32Array(M.VB);
    for (let i = 0; i < VB2.length; i += st0) { VB2[i] = -VB2[i]; VB2[i + 1] = -VB2[i + 1]; VB2[i + 3] = -VB2[i + 3]; VB2[i + 4] = -VB2[i + 4]; }
    const meta2 = JSON.parse(JSON.stringify(M.meta));
    const b0 = meta2.bb;
    meta2.bb = [-b0[3], -b0[4], b0[2], -b0[0], -b0[1], b0[5]];
    for (const p of meta2.parts || []) { if (p.p) { p.p[0] = -p.p[0]; p.p[1] = -p.p[1]; } if (p.a) { p.a[0] = -p.a[0]; p.a[1] = -p.a[1]; } }
    M = { ...M, VB: VB2, meta: meta2 };
  }
  const { meta, VB, IB, bin } = M;
  const st = meta.st || 8;
  const lod = meta.lod[Math.min(item.lod, meta.lod.length - 1)];
  // 包围盒（模型坐标 x 前、y 左、z 上，米）
  let bb = meta.bb;
  if (item.pose || item.drop || item.flip) {
    bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const [, pi, i0, cnt] of lod) for (let i = i0; i < i0 + cnt; i++) {
      if (pi >= 0 && item.drop && item.drop.includes(meta.parts[pi].n)) break;
      const o = IB[i] * st;
      for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], VB[o + k]); bb[k + 3] = Math.max(bb[k + 3], VB[o + k]); }
    }
  }
  const s = item.h ? item.h / (bb[5] - bb[2]) : item.len / (bb[3] - bb[0]);
  const cx = (bb[0] + bb[3]) / 2, cy = item.cy ?? (bb[1] + bb[4]) / 2, z0 = bb[2];
  // 模型 (x 前, y 左, z 上) → Roblox (X 右, Y 上, Z 后)：X = −y，Y = z，Z = −x
  const P = (x, y, z) => [-(y - cy) * s, (z - z0) * s, -(x - cx) * s];
  const N = (x, y, z) => [-y, z, -x];

  // 按（用途, 材质）分组
  const groups = new Map();
  for (const [mi, pi, i0, cnt] of lod) {
    const part = pi >= 0 ? meta.parts[pi] : null;
    if (part && item.drop && item.drop.includes(part.n)) continue;   // 不要的部件（起落架）
    const role = part ? (ROLE[part.n] || 'Body') : 'Body';
    const k = role + '|' + mi;
    if (!groups.has(k)) groups.set(k, { role, mi, tris: [] });
    const g = groups.get(k);
    for (let i = i0; i + 2 < i0 + cnt; i += 3) g.tris.push(IB[i], IB[i + 1], IB[i + 2]);
  }

  // 贴图：只导出用到的
  const imgMap = new Map();   // 原图号|用途 → glTF 图号
  const images = [], imageFiles = [], jobs = [];
  const useImg = (idx, kind, alpha) => {
    const k = idx + '|' + kind;
    if (imgMap.has(k)) return imgMap.get(k);
    const I = meta.imgs[idx];
    const ext = I.m.includes('png') ? 'png' : I.m.includes('webp') ? 'webp' : 'jpg';
    const src = path.join(tmp, `${item.slot}_${idx}.${ext}`);
    fs.writeFileSync(src, bin.subarray(I.o, I.o + I.n));
    const fmt = (kind === 'base' && !alpha) ? 'JPEG' : 'PNG';
    const out = path.join(tmp, `${item.slot}_${idx}_${kind}.${fmt === 'JPEG' ? 'jpg' : 'png'}`);
    jobs.push({ in: src, out, max: kind === 'normal' ? 512 : 1024, fmt, gain: kind === 'base' ? item.gain || 1 : 1 });
    const gi = images.length;
    images.push({ mimeType: fmt === 'JPEG' ? 'image/jpeg' : 'image/png' });
    imageFiles.push(out);
    imgMap.set(k, gi);
    return gi;
  };
  const solidImg = c => {
    const srgb = v => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    const rgb = c.slice(0, 3).map(v => Math.max(0, Math.min(255, srgb(Math.max(0, Math.min(1, v))))));
    const k = 'solid|' + rgb.join(',');
    if (imgMap.has(k)) return imgMap.get(k);
    const out = path.join(tmp, `${item.slot}_solid_${rgb.join('_')}.png`);
    jobs.push({ solid: rgb, out, max: 4, fmt: 'PNG' });
    const gi = images.length;
    images.push({ mimeType: 'image/png' });
    imageFiles.push(out);
    imgMap.set(k, gi);
    return gi;
  };
  const matMap = new Map();
  const materials = [];
  const matFor = mi => {
    if (matMap.has(mi)) return matMap.get(mi);
    const T = meta.mats[mi];
    const alpha = (T.am || 0) > 0;
    const m = { name: (T.n || 'mat' + mi).replace(/[^\w.-]/g, '_'), pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, (T.c && T.c[3]) ?? 1],
      metallicFactor: Math.min(1, (T.mr && T.mr[0]) || 0), roughnessFactor: Math.max(0.3, (T.mr && T.mr[1]) ?? 0.6),
    } };
    // 底色：有贴图用贴图；没有贴图的做一张 4×4 的纯色小图（颜色从线性换成 sRGB）——只给颜色系数的话，导入器按线性还是 sRGB 理解说不准
    if (T.t) m.pbrMetallicRoughness.baseColorTexture = { index: useImg(T.t[0], 'base', alpha) };
    else m.pbrMetallicRoughness.baseColorTexture = { index: solidImg(T.c || [0.5, 0.5, 0.5, 1]) };
    if (T.nt) m.normalTexture = { index: useImg(T.nt[0], 'normal', false) };
    if (T.am === 1) { m.alphaMode = 'MASK'; m.alphaCutoff = 0.5; m.doubleSided = true; }
    else if (T.am === 2) { m.alphaMode = 'BLEND'; m.doubleSided = true; }
    const gi = materials.length;
    materials.push(m);
    matMap.set(mi, gi);
    return gi;
  };

  // 网格数据
  const chunks = [];   // { name, pos: Float32Array, nrm, uv, idx: Uint16Array|Uint32Array, mat }
  const counts = {};
  for (const g of groups.values()) {
    const mat = matFor(g.mi);
    for (let t0 = 0, part = 0; t0 < g.tris.length; t0 += MAXTRI * 3, part++) {
      const tri = g.tris.slice(t0, t0 + MAXTRI * 3);
      const remap = new Map(), pos = [], nrm = [], uv = [], idx = [];
      for (const v of tri) {
        let j = remap.get(v);
        if (j === undefined) {
          j = remap.size;
          remap.set(v, j);
          const o = v * st;
          pos.push(...P(VB[o], VB[o + 1], VB[o + 2]));
          const n = N(VB[o + 3], VB[o + 4], VB[o + 5]), l = Math.hypot(...n) || 1;
          nrm.push(n[0] / l, n[1] / l, n[2] / l);
          uv.push(VB[o + 6], VB[o + 7]);
        }
        idx.push(j);
      }
      counts[g.role] = (counts[g.role] || 0) + 1;
      chunks.push({ name: `${g.role}_${counts[g.role]}`, pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv),
        idx: remap.size > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), mat });
    }
  }
  // 标记
  const markMat = materials.length;
  materials.push({ name: 'marker', pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1], metallicFactor: 0, roughnessFactor: 1 } });
  const marks = [];
  const zMid = (bb[2] + bb[5]) / 2;
  marks.push(['_Front', P(bb[3], cy, zMid)]);
  marks.push(['_Top', P(cx, cy, bb[5] + 0.3 / s * 3)]);
  const partBy = n => (meta.parts || []).find(p => p.n === n);
  const pv = (p) => P(p.p[0], p.p[1], p.p[2]);
  if (partBy('tur')) marks.push(['_PivotTurret', pv(partBy('tur'))]);
  if (partBy('rotor')) marks.push(['_PivotRotor', pv(partBy('rotor'))]);
  if (partBy('trotor')) {
    const p = partBy('trotor'), a = p.a, l = Math.hypot(...a) || 1;
    marks.push(['_PivotTail', pv(p)]);
    marks.push(['_AxisTail', P(p.p[0] + a[0] / l * 0.6, p.p[1] + a[1] / l * 0.6, p.p[2] + a[2] / l * 0.6)]);
  }
  for (const [name, c] of marks) {
    const T = tetra(c, 0.15);
    chunks.push({ name, pos: new Float32Array(T.P.flat()), nrm: new Float32Array(T.P.flat().map(() => 0).map((v, i) => i % 3 === 1 ? 1 : 0)),
      uv: new Float32Array(T.P.length * 2), idx: new Uint16Array(T.I), mat: markMat });
  }

  convertImages(jobs, tmp);

  // 组装 glb
  const bufs = [];
  let off = 0;
  const bufferViews = [], accessors = [];
  const pushView = (u8, target) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; }
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: u8.length, ...(target ? { target } : {}) });
    bufs.push(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength));
    off += u8.length;
    return bufferViews.length - 1;
  };
  const meshes = [], nodes = [];
  let triTotal = 0;
  for (const c of chunks) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < c.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c.pos[i + k]); mx[k] = Math.max(mx[k], c.pos[i + k]); }
    const vp = pushView(new Uint8Array(c.pos.buffer), 34962);
    accessors.push({ bufferView: vp, componentType: 5126, count: c.pos.length / 3, type: 'VEC3', min: mn, max: mx });
    const ap = accessors.length - 1;
    const vn = pushView(new Uint8Array(c.nrm.buffer), 34962);
    accessors.push({ bufferView: vn, componentType: 5126, count: c.nrm.length / 3, type: 'VEC3' });
    const an = accessors.length - 1;
    const vu = pushView(new Uint8Array(c.uv.buffer), 34962);
    accessors.push({ bufferView: vu, componentType: 5126, count: c.uv.length / 2, type: 'VEC2' });
    const au = accessors.length - 1;
    const vi = pushView(new Uint8Array(c.idx.buffer, c.idx.byteOffset, c.idx.byteLength), 34963);
    accessors.push({ bufferView: vi, componentType: c.idx instanceof Uint32Array ? 5125 : 5123, count: c.idx.length, type: 'SCALAR' });
    const ai = accessors.length - 1;
    meshes.push({ name: c.name, primitives: [{ attributes: { POSITION: ap, NORMAL: an, TEXCOORD_0: au }, indices: ai, material: c.mat }] });
    nodes.push({ name: c.name, mesh: meshes.length - 1 });
    if (!c.name.startsWith('_')) triTotal += c.idx.length / 3;
  }
  images.forEach((im, i) => { im.bufferView = pushView(new Uint8Array(fs.readFileSync(imageFiles[i]))); });
  const gltf = {
    asset: { version: '2.0', generator: 'darksword roblox/tools/export_models.mjs' },
    scene: 0, scenes: [{ name: item.slot, nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: 0 }],
    ...(images.length ? { images, textures: images.map((_, i) => ({ source: i, sampler: 0 })), samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
  };
  const binBuf = Buffer.concat([...bufs, Buffer.alloc((4 - (off % 4)) % 4)]);
  gltf.buffers[0].byteLength = binBuf.length;
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  const file = path.join(outDir, item.slot + '.glb');
  fs.writeFileSync(file, Buffer.concat([header, jh, json, bh, binBuf]));
  const size = [(bb[4] - bb[1]) * s, (bb[5] - bb[2]) * s, (bb[3] - bb[0]) * s];
  console.log(`${item.slot.padEnd(8)} ← ${item.key.padEnd(7)} ${String(triTotal).padStart(6)} 三角形  ${chunks.length - marks.length} 个网格  ${images.length} 张贴图  ` +
    `${size.map(v => v.toFixed(1)).join(' × ')} 格  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`);
  return { slot: item.slot, name: item.name, key: item.key, title: meta.name, credit: meta.credit || null };
}

fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rbxglb-'));
const only = process.argv.slice(2);
const done = [];
for (const item of LIST) if (!only.length || only.includes(item.slot)) done.push(exportOne(item, tmp));
fs.rmSync(tmp, { recursive: true, force: true });
// 署名（CC-BY 要求）：游戏里「致谢」面板也会显示这些
const lines = ['军事大亨用到的 3D 模型（从网页版《暗剑》的模型转换，几何、贴图未改，只缩小了贴图、用了简化网格）', ''];
for (const d of LIST) {
  const M = readModel(d.key).meta;
  const c = M.credit;
  lines.push(`${d.name}（${d.slot}.glb）：${M.name}` + (c ? `，作者 ${c.author || c.by || ''}，${c.license || ''} ${c.url || ''}`.replace(/\s+/g, ' ') : '，用户提供的模型'));
}
fs.writeFileSync(path.join(outDir, 'credits.txt'), lines.join('\n') + '\n');
console.log('写好了 ' + path.relative(process.cwd(), outDir));
