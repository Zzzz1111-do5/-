'use strict';
// 收敛扩散喷口模型 → 游戏数据（js/mdl/<键>.js，js/v3noz.js 用）：node tools/nozbake.js <scene.gltf> <键>
//   源模型：Sketchfab「F-15 SE Thrust Vector Nozzle」（F100 发动机的收敛扩散喷口，作者 ACshibu，CC-BY-4.0）——作者在 Blender 里用驱动和约束
//   把调节片、密封片、作动筒的真实联动做好，再压成一个形态键：权重 0 = 喷口收到最小、1 = 张到最大。这里两个形态都存下来，游戏里按推力插值
//   （每个顶点在两个形态之间直线走：调节片转角不大，看不出和绕铰链转的区别）。
//   只取喷口网格（Nozzle）；前面那圈白色的整流环（Shroud）在机身短舱里面看不见，不要。
//   坐标：喷口轴线是模型的 z（前面 +z，出口在 −z）→ 游戏里用喷口坐标 u 沿喷流向后（收到最小时出口截面 u = 0，喷管里 u < 0）、v、w 在喷口平面里；
//   长度单位 = 收到最小时出口的内半径（游戏里按各型飞机出口半径缩放）
//   每个顶点再记一个部件类别（按连通块的形状分）：0 不动的结构环、1 调节片 / 密封片（板）、2 作动筒与拉杆（细长的杆）；着色器按它上色
//   两级网格：完整的（约一万面，近看）与 meshoptimizer 简化的（约一千五百面，远处）
// 下载来的模型只当数据读（解析 JSON、读二进制），不执行其中任何东西
const fs = require('fs'), path = require('path');
const { MeshoptSimplifier } = require('meshoptimizer');
const [src, key = 'f100noz'] = process.argv.slice(2);
(async () => {
await MeshoptSimplifier.ready;
if (!src) { console.error('用法：node tools/nozbake.js <scene.gltf> [键]'); process.exit(1); }
const G = JSON.parse(fs.readFileSync(src, 'utf8')), BIN = fs.readFileSync(path.join(path.dirname(src), G.buffers[0].uri));
const CT = { 5126: ['readFloatLE', 4], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4] }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function acc(i) {
  const a = G.accessors[i], bv = G.bufferViews[a.bufferView], [rd, sz] = CT[a.componentType], n = NC[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), st = bv.byteStride || sz * n, out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let j = 0; j < n; j++) out[k * n + j] = BIN[rd](off + k * st + j * sz);
  return out;
}
const mesh = G.meshes.findIndex((m, i) => G.materials[m.primitives[0].material] && G.materials[m.primitives[0].material].name === 'Nozzle');
if (mesh < 0) throw new Error('找不到喷口网格（材质 Nozzle）');
const pr = G.meshes[mesh].primitives[0], T = pr.targets && pr.targets[0];
if (!T) throw new Error('喷口网格没有形态键');
const P = acc(pr.attributes.POSITION), Nr = acc(pr.attributes.NORMAL), dP = acc(T.POSITION), dN = T.NORMAL != null ? acc(T.NORMAL) : new Float64Array(P.length), I = acc(pr.indices);
const nv = P.length / 3;
// 收到最小时出口：z 最小处；内半径 = 那里离轴最近的点
let zE = Infinity; for (let i = 0; i < nv; i++) zE = Math.min(zE, P[i * 3 + 2]);
let R0 = Infinity; for (let i = 0; i < nv; i++) if (P[i * 3 + 2] < zE + .03) R0 = Math.min(R0, Math.hypot(P[i * 3], P[i * 3 + 1]));
// 张到最大时出口
let zE1 = Infinity, R1 = Infinity;
for (let i = 0; i < nv; i++) zE1 = Math.min(zE1, P[i * 3 + 2] + dP[i * 3 + 2]);
for (let i = 0; i < nv; i++) if (P[i * 3 + 2] + dP[i * 3 + 2] < zE1 + .03) R1 = Math.min(R1, Math.hypot(P[i * 3] + dP[i * 3], P[i * 3 + 1] + dP[i * 3 + 1]));
// 喷口坐标：u = −(z − zE) / R0（向后为正）、v = x / R0、w = y / R0；法线 (−nz, nx, ny)
const U = new Float64Array(nv * 3), DU = new Float64Array(nv * 3), N0 = new Float64Array(nv * 3), N1 = new Float64Array(nv * 3);
for (let i = 0; i < nv; i++) {
  const o = i * 3;
  U[o] = -(P[o + 2] - zE) / R0; U[o + 1] = P[o] / R0; U[o + 2] = P[o + 1] / R0;
  DU[o] = -dP[o + 2] / R0; DU[o + 1] = dP[o] / R0; DU[o + 2] = dP[o + 1] / R0;
  const n0 = [-Nr[o + 2], Nr[o], Nr[o + 1]], n1 = [-(Nr[o + 2] + dN[o + 2]), Nr[o] + dN[o], Nr[o + 1] + dN[o + 1]];
  const l0 = Math.hypot(...n0) || 1, l1 = Math.hypot(...n1) || 1;
  for (let j = 0; j < 3; j++) { N0[o + j] = n0[j] / l0; N1[o + j] = n1[j] / l1; }
}
// 部件类别：同一位置的顶点焊在一起找连通块；不动的 → 0，细长（角宽 < 6°、轴向跨度 > 0.7 个出口半径）的 → 2 作动筒、拉杆，其余 → 1 板
const rep = new Int32Array(nv), seen = new Map();
for (let i = 0; i < nv; i++) { const k = `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`; if (seen.has(k)) rep[i] = seen.get(k); else { seen.set(k, i); rep[i] = i; } }
const par = Int32Array.from({ length: nv }, (_, i) => i), find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
for (let t = 0; t < I.length; t += 3) { const a = find(rep[I[t]]), b = find(rep[I[t + 1]]), c = find(rep[I[t + 2]]); par[b] = a; par[find(c)] = a; }
const comp = new Map();
for (let i = 0; i < nv; i++) { const r = find(rep[i]); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); }
const cls = new Uint8Array(nv), cnt = [0, 0, 0];
for (const vs of comp.values()) {
  let mv = 0, u0 = Infinity, u1 = -Infinity, cx = 0, cy = 0;
  for (const i of vs) { mv = Math.max(mv, Math.hypot(DU[i * 3], DU[i * 3 + 1], DU[i * 3 + 2])); u0 = Math.min(u0, U[i * 3]); u1 = Math.max(u1, U[i * 3]); const a = Math.atan2(U[i * 3 + 2], U[i * 3 + 1]); cx += Math.cos(a); cy += Math.sin(a); }
  const a0 = Math.atan2(cy, cx); let d0 = 0, d1 = 0;
  for (const i of vs) { const a = Math.atan2(U[i * 3 + 2], U[i * 3 + 1]), d = Math.atan2(Math.sin(a - a0), Math.cos(a - a0)); d0 = Math.min(d0, d); d1 = Math.max(d1, d); }
  const c = mv < 1e-5 ? 0 : (d1 - d0) < 6 * Math.PI / 180 && u1 - u0 > .7 ? 2 : 1;
  for (const i of vs) cls[i] = c;
  cnt[c] += vs.length;
}
// 远处的一级：按收到最小时的位置简化（两个形态共用同一套顶点，索引对两个形态都成立）——先把同一位置的顶点焊成一个（硬边上法线不同的
//   拆分顶点在简化器看来是边界，焊之前减不动），简化完的索引指向焊接后的代表顶点（同一位置的顶点在两个形态里走的一样）
const idx0 = Uint32Array.from(I), pos32 = Float32Array.from(U), idxW = Uint32Array.from(I, i => rep[i]);
const tgt = Math.round(idx0.length * .14 / 3) * 3;
let [idx1, err] = MeshoptSimplifier.simplify(idxW, pos32, 3, tgt, .06, []);
if (idx1.length > tgt * 1.5) [idx1, err] = MeshoptSimplifier.simplifySloppy(idxW, pos32, 3, null, tgt, .1);   // 五百来个分开的小零件（调节片、密封片、拉杆），保拓扑的简化减不下去：用不管拓扑的那种
// 打包：位置、形态差各存 int16（按各自的最大绝对值缩放），两套法线各 int8（第 4 个字节：法线 0 存类别），索引 uint16
const mx = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0), ps = mx(U), ds = mx(DU);
const q16 = (a, s) => Int16Array.from(a, v => Math.round(v / s * 32767));
const p0 = q16(U, ps), dp = q16(DU, ds), n0 = new Int8Array(nv * 4), n1 = new Int8Array(nv * 4);
for (let i = 0; i < nv; i++) { for (let j = 0; j < 3; j++) { n0[i * 4 + j] = Math.round(N0[i * 3 + j] * 127); n1[i * 4 + j] = Math.round(N1[i * 3 + j] * 127); } n0[i * 4 + 3] = cls[i]; }
if (nv > 65535) throw new Error('顶点太多，16 位索引放不下');
const i0 = Uint16Array.from(idx0), i1 = Uint16Array.from(idx1);
const parts = [p0, dp, n0, n1, i0, i1], buf = Buffer.concat(parts.map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
const meta = { v: 1, key, n: nv, ni0: i0.length, ni1: i1.length, ps, ds, r1: R1 / R0, u1: -(zE1 - zE) / R0,
  src: 'F-15 SE Thrust Vector Nozzle（F100 发动机收敛扩散喷口）', author: 'ACshibu', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/f-15-se-thrust-vector-nozzle-46f9e71656f84a509eca268aaddf2cbc' };
const head = `// F100 发动机收敛扩散喷口（两个形态：收到最小 / 张到最大）：源模型「F-15 SE Thrust Vector Nozzle」，作者 ACshibu（${meta.url}），CC-BY-4.0 授权（http://creativecommons.org/licenses/by/4.0/）。` +
  `改动：去掉前面的整流环，换成喷口坐标、按出口半径归一化，加一级简化网格（tools/nozbake.js）。署名见 docs/credits.md\n`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'mdl', key + '.js'), head + `V3G.add(${JSON.stringify(key)}, ${JSON.stringify(meta)}, '${buf.toString('base64')}');\n`);
console.log(`${key}：${nv} 个顶点，${i0.length / 3} 面（远处一级 ${i1.length / 3} 面，误差 ${err.toFixed(4)}），收到最小出口内半径 ${R0.toFixed(3)}、张到最大 ${R1.toFixed(3)}（${(R1 / R0).toFixed(2)} 倍），` +
  `类别 结构 ${cnt[0]} / 板 ${cnt[1]} / 杆 ${cnt[2]} 个顶点，${(buf.length / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e.message); process.exit(1); });
