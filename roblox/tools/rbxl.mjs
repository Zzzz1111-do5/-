// 读 Roblox 的二进制场景文件（.rbxl / .rbxm），导出实例树和所有脚本的源码——用来把别人在 Studio 里改过的版本和仓库里的代码对比、合并。
//   node roblox/tools/rbxl.mjs <文件.rbxl> <输出目录>
//     输出目录/tree.txt        实例树（类名、名字、部分属性）
//     输出目录/scripts/…       每个脚本一个 .lua（按层级建目录：ServerScriptService/Main.server.lua、Main/Battle.lua……）
// 格式：头 <roblox! … 之后是一串数据块（META / SSTR / INST / PROP / PRNT / END），块内容用 LZ4 或 Zstandard 压缩（Node 22 自带 zstd）。
// 只解出名字、源码和常用的几种属性；别的属性类型跳过（每个 PROP 块只有一个类的一个属性，跳过不影响别的）。
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const [file, outDir] = process.argv.slice(2);
if (!file || !outDir) {
  console.error('用法：node roblox/tools/rbxl.mjs <文件.rbxl> <输出目录>');
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.subarray(0, 8).toString('latin1') !== '<roblox!') throw new Error('不是 Roblox 二进制文件（.rbxlx 是 XML，直接看文本就行）');

// LZ4 块格式（老文件用）
function lz4(src, outLen) {
  const out = Buffer.alloc(outLen);
  let i = 0, o = 0;
  while (i < src.length) {
    const tok = src[i++];
    let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    src.copy(out, o, i, i + lit); i += lit; o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let ml = tok & 15;
    if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
    ml += 4;
    for (let k = 0; k < ml; k++) { out[o] = out[o - off]; o++; }
  }
  return out;
}

// 交错存放的整数 / 浮点数组：n 个 4 字节数先存所有的第 1 个字节，再存所有的第 2 个字节……（每个数大端）
function interleaved(b, p, n, w = 4) {
  const out = [];
  for (let k = 0; k < n; k++) {
    let v = 0n;
    for (let j = 0; j < w; j++) v = (v << 8n) | BigInt(b[p + j * n + k]);
    out.push(v);
  }
  return out;
}
const zig = v => Number((v >> 1n) ^ -(v & 1n));
const i32s = (b, p, n) => interleaved(b, p, n).map(v => { const z = zig(v); return z | 0; });
const f32s = (b, p, n) => interleaved(b, p, n).map(v => {
  const u = Number(v);
  const r = ((u >>> 1) | (u << 31)) >>> 0;   // 符号位挪在最低位：转回来
  const t = Buffer.alloc(4); t.writeUInt32LE(r); return t.readFloatLE(0);
});
const u32s = (b, p, n) => interleaved(b, p, n).map(Number);
function refs(b, p, n) {
  const d = i32s(b, p, n);
  for (let k = 1; k < n; k++) d[k] += d[k - 1];
  return d;
}

// 数据块
const chunks = [];
let p = 32;
while (p < buf.length) {
  const name = buf.subarray(p, p + 4).toString('latin1').replace(/\0/g, '');
  const cl = buf.readUInt32LE(p + 4), ul = buf.readUInt32LE(p + 8);
  p += 16;
  const raw = buf.subarray(p, p + (cl || ul));
  p += cl || ul;
  let data;
  if (!cl) data = raw;
  else if (raw.readUInt32LE(0) === 0xFD2FB528) data = zlib.zstdDecompressSync(raw);
  else data = lz4(raw, ul);
  chunks.push({ name, data });
  if (name === 'END') break;
}

const classes = {};   // 类号 → { name, refs }
const inst = {};      // 引用号 → { cls, props, kids, parent }
const sstr = [];
const readStr = (b, q) => { const l = b.readUInt32LE(q); return [b.subarray(q + 4, q + 4 + l), q + 4 + l]; };
for (const c of chunks) {
  const b = c.data;
  if (c.name === 'SSTR') {
    const n = b.readUInt32LE(4);
    let q = 8;
    for (let k = 0; k < n; k++) { q += 16; const [s, q2] = readStr(b, q); sstr.push(s); q = q2; }
  } else if (c.name === 'INST') {
    const id = b.readUInt32LE(0);
    const [nm, q] = readStr(b, 4);
    const n = b.readUInt32LE(q + 1);
    const rs = refs(b, q + 5, n);
    classes[id] = { name: nm.toString('utf8'), refs: rs };
    for (const r of rs) inst[r] = { cls: nm.toString('utf8'), props: {}, kids: [], parent: -1 };
  }
}
for (const c of chunks) {
  const b = c.data;
  if (c.name === 'PROP') {
    const id = b.readUInt32LE(0);
    const [pn, q0] = readStr(b, 4);
    const prop = pn.toString('utf8');
    const type = b[q0];
    const C = classes[id];
    const n = C.refs.length;
    let q = q0 + 1;
    let vals = null;
    try {
      if (type === 0x01 || type === 0x1D) {   // 字符串（脚本源码也是）
        vals = [];
        for (let k = 0; k < n; k++) { const [s, q2] = readStr(b, q); vals.push(s.toString('utf8')); q = q2; }
      } else if (type === 0x02) vals = [...b.subarray(q, q + n)].map(v => v !== 0);
      else if (type === 0x03) vals = i32s(b, q, n);
      else if (type === 0x04) vals = f32s(b, q, n).map(v => +v.toFixed(4));
      else if (type === 0x05) vals = Array.from({ length: n }, (_, k) => b.readDoubleLE(q + k * 8));
      else if (type === 0x0E) { const x = f32s(b, q, n), y = f32s(b, q + 4 * n, n), z = f32s(b, q + 8 * n, n); vals = x.map((v, k) => [v, y[k], z[k]].map(t => +t.toFixed(2))); }
      else if (type === 0x12) vals = u32s(b, q, n);
      else if (type === 0x13) vals = refs(b, q, n);
      else if (type === 0x1A) vals = Array.from({ length: n }, (_, k) => [b[q + k], b[q + n + k], b[q + 2 * n + k]]);
      else if (type === 0x1C) vals = u32s(b, q, n).map(i => sstr[i] ? ('<共享 ' + sstr[i].length + ' 字节>') : null);
    } catch (e) { vals = null; }
    if (vals) C.refs.forEach((r, k) => { inst[r].props[prop] = vals[k]; });
  } else if (c.name === 'PRNT') {
    const n = b.readUInt32LE(1);
    const kids = refs(b, 5, n), pars = refs(b, 5 + 4 * n, n);
    kids.forEach((k, j) => { inst[k].parent = pars[j]; if (pars[j] >= 0 && inst[pars[j]]) inst[pars[j]].kids.push(k); });
  }
}

// 输出：实例树、脚本
fs.mkdirSync(path.join(outDir, 'scripts'), { recursive: true });
const SCRIPT = { Script: '.server.lua', LocalScript: '.client.lua', ModuleScript: '.lua' };
const lines = [];
const nameOf = r => inst[r].props.Name ?? '?';
function walk(r, depth, dir) {
  const o = inst[r];
  const extra = [];
  if (o.props.MeshId) extra.push('MeshId=' + o.props.MeshId);
  if (o.props.TextureID) extra.push('TextureID=' + o.props.TextureID);
  if (SCRIPT[o.cls]) extra.push((o.props.Source || '').split('\n').length + ' 行');
  if (o.cls === 'TextLabel' || o.cls === 'TextButton') extra.push(JSON.stringify((o.props.Text || '').slice(0, 30)));
  lines.push('  '.repeat(depth) + o.cls + ' ' + JSON.stringify(nameOf(r)) + (extra.length ? '  ' + extra.join('  ') : ''));
  const here = path.join(dir, nameOf(r).replace(/[\\/:*?"<>|]/g, '_'));
  if (SCRIPT[o.cls]) {
    fs.mkdirSync(path.dirname(here), { recursive: true });
    fs.writeFileSync(here + SCRIPT[o.cls], o.props.Source || '');
  }
  const kids = o.kids.slice().sort((a, b) => (nameOf(a) > nameOf(b) ? 1 : -1));
  for (const k of kids) walk(k, depth + 1, here);
}
const roots = Object.keys(inst).map(Number).filter(r => inst[r].parent < 0).sort((a, b) => (nameOf(a) > nameOf(b) ? 1 : -1));
for (const r of roots) walk(r, 0, path.join(outDir, 'scripts'));
fs.writeFileSync(path.join(outDir, 'tree.txt'), lines.join('\n') + '\n');
const counts = {};
for (const r in inst) counts[inst[r].cls] = (counts[inst[r].cls] || 0) + 1;
console.log(Object.keys(inst).length + ' 个实例，' + Object.keys(classes).length + ' 个类；脚本 ' + ((counts.Script || 0) + (counts.LocalScript || 0) + (counts.ModuleScript || 0)) + ' 个 → ' + outDir);
