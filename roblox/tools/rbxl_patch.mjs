// 把仓库里的脚本写回用户的二进制场景文件（.rbxl）：只换脚本源码，别的（导入的模型、网格和贴图的资源号、地形、光照……）一个字节都不动。
//   node roblox/tools/rbxl_patch.mjs <原来的.rbxl> <输出.rbxl> [src 目录，默认 roblox/src]
// 对应关系：ReplicatedStorage.Config ↔ Config.lua；ServerScriptService.Main ↔ Main/init.server.lua，Main 下的模块 ↔ Main/<名字>.lua；
//   StarterPlayer.StarterPlayerScripts.Client ↔ Client/init.client.lua，Client 下的模块 ↔ Client/<名字>.lua。
// 仓库里有、场景里没有的脚本（新模块）会报错退出：二进制格式加实例太麻烦——先在 Studio 里建一个同名的空 ModuleScript、存盘，再跑这个。
// 写完会再读一遍输出文件，逐个核对脚本源码。
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const [inFile, outFile, srcArg] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('用法：node roblox/tools/rbxl_patch.mjs <原来的.rbxl> <输出.rbxl> [src 目录]');
  process.exit(1);
}
const here = path.dirname(new URL(import.meta.url).pathname);
const srcDir = srcArg || path.join(here, '..', 'src');

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
function refs(b, p, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    let v = 0;
    for (let j = 0; j < 4; j++) v = (v * 256) + b[p + j * n + k];
    out.push(((v >>> 1) ^ -(v & 1)) | 0);
  }
  for (let k = 1; k < n; k++) out[k] += out[k - 1];
  return out;
}
const readStr = (b, q) => { const l = b.readUInt32LE(q); return [b.subarray(q + 4, q + 4 + l), q + 4 + l]; };

// 读：块（原始字节 + 解压后的内容）
function parse(buf) {
  if (buf.subarray(0, 8).toString('latin1') !== '<roblox!') throw new Error('不是 Roblox 二进制文件');
  const chunks = [];
  let p = 32;
  while (p < buf.length) {
    const start = p;
    const name = buf.subarray(p, p + 4).toString('latin1').replace(/\0/g, '');
    const cl = buf.readUInt32LE(p + 4), ul = buf.readUInt32LE(p + 8);
    p += 16;
    const raw = buf.subarray(p, p + (cl || ul));
    p += cl || ul;
    let data;
    if (!cl) data = raw;
    else if (raw.readUInt32LE(0) === 0xFD2FB528) data = zlib.zstdDecompressSync(raw);
    else data = lz4(raw, ul);
    chunks.push({ name, data, bytes: buf.subarray(start, p) });
    if (name === 'END') break;
  }
  const classes = {}, inst = {};
  for (const c of chunks) {
    if (c.name !== 'INST') continue;
    const b = c.data;
    const id = b.readUInt32LE(0);
    const [nm, q] = readStr(b, 4);
    const n = b.readUInt32LE(q + 1);
    const rs = refs(b, q + 5, n);
    classes[id] = { name: nm.toString('utf8'), refs: rs };
    for (const r of rs) inst[r] = { cls: nm.toString('utf8'), name: '', parent: -1 };
  }
  for (const c of chunks) {
    const b = c.data;
    if (c.name === 'PROP') {
      const id = b.readUInt32LE(0);
      const [pn, q0] = readStr(b, 4);
      if (pn.toString('utf8') === 'Name' && b[q0] === 0x01) {
        let q = q0 + 1;
        for (const r of classes[id].refs) { const [s, q2] = readStr(b, q); inst[r].name = s.toString('utf8'); q = q2; }
      }
    } else if (c.name === 'PRNT') {
      const n = b.readUInt32LE(1);
      const kids = refs(b, 5, n), pars = refs(b, 5 + 4 * n, n);
      kids.forEach((k, j) => { if (inst[k]) inst[k].parent = pars[j]; });
    }
  }
  const pathOf = r => { const out = []; while (r >= 0 && inst[r]) { out.unshift(inst[r].name); r = inst[r].parent; } return out.join('.'); };
  return { chunks, classes, inst, pathOf };
}

// 场景里的脚本路径 → 仓库里的文件
function fileFor(p) {
  if (p === 'ReplicatedStorage.Config') return 'Config.lua';
  if (p === 'ServerScriptService.Main') return 'Main/init.server.lua';
  if (p.startsWith('ServerScriptService.Main.') && p.split('.').length === 3) return 'Main/' + p.split('.')[2] + '.lua';
  if (p === 'StarterPlayer.StarterPlayerScripts.Client') return 'Client/init.client.lua';
  if (p.startsWith('StarterPlayer.StarterPlayerScripts.Client.') && p.split('.').length === 4) return 'Client/' + p.split('.')[3] + '.lua';
  return null;
}
const SCRIPT = { Script: true, LocalScript: true, ModuleScript: true };

const buf = fs.readFileSync(inFile);
const P = parse(buf);
const wanted = new Set();
for (const d of ['', 'Main', 'Client']) {
  for (const f of fs.readdirSync(path.join(srcDir, d))) if (f.endsWith('.lua')) wanted.add(d ? d + '/' + f : f);
}
const seen = new Set();
let changed = 0, same = 0;
const out = [buf.subarray(0, 32)];
for (const c of P.chunks) {
  let replaced = null;
  if (c.name === 'PROP') {
    const b = c.data;
    const id = b.readUInt32LE(0);
    const [pn, q0] = readStr(b, 4);
    const C = P.classes[id];
    if (pn.toString('utf8') === 'Source' && SCRIPT[C.name] && b[q0] === 0x01) {
      let q = q0 + 1;
      const parts = [b.subarray(0, q0 + 1)];
      let any = false;
      for (const r of C.refs) {
        const [s, q2] = readStr(b, q);
        q = q2;
        const f = fileFor(P.pathOf(r));
        let src = s;
        if (f && wanted.has(f)) {
          seen.add(f);
          const now = fs.readFileSync(path.join(srcDir, f));
          if (!now.equals(s)) { src = now; any = true; changed++; } else same++;
        } else if (f) {
          console.warn('场景里有、仓库里没有的脚本（保持原样）：' + P.pathOf(r));
        }
        const len = Buffer.alloc(4);
        len.writeUInt32LE(src.length);
        parts.push(len, src);
      }
      if (any) replaced = Buffer.concat(parts);
    }
  }
  if (replaced) {
    const comp = zlib.zstdCompressSync(replaced);
    const head = Buffer.alloc(16);
    head.write(c.name.padEnd(4, '\0'), 0, 'latin1');
    head.writeUInt32LE(comp.length, 4);
    head.writeUInt32LE(replaced.length, 8);
    out.push(head, comp);
  } else {
    out.push(c.bytes);
  }
}
const missing = [...wanted].filter(f => !seen.has(f));
if (missing.length) {
  console.error('仓库里这些脚本在场景里找不到对应的（先在 Studio 里建同名的空脚本、存盘再来）：' + missing.join('、'));
  process.exit(1);
}
const result = Buffer.concat(out);
fs.writeFileSync(outFile, result);

// 核对：再读一遍，每个脚本的源码都和仓库一样
const Q = parse(result);
let bad = 0;
for (const c of Q.chunks) {
  if (c.name !== 'PROP') continue;
  const b = c.data;
  const C = Q.classes[b.readUInt32LE(0)];
  const [pn, q0] = readStr(b, 4);
  if (pn.toString('utf8') !== 'Source' || !SCRIPT[C.name]) continue;
  let q = q0 + 1;
  for (const r of C.refs) {
    const [s, q2] = readStr(b, q);
    q = q2;
    const f = fileFor(Q.pathOf(r));
    if (f && wanted.has(f) && !fs.readFileSync(path.join(srcDir, f)).equals(s)) { bad++; console.error('核对不上：' + f); }
  }
}
if (bad || Object.keys(Q.inst).length !== Object.keys(P.inst).length) { console.error('写出来的文件核对失败'); process.exit(1); }
console.log('换了 ' + changed + ' 个脚本，' + same + ' 个没变；' + Object.keys(Q.inst).length + ' 个实例原样保留 → ' + outFile + '（' + (result.length / 1024 / 1024).toFixed(2) + ' MB）');
