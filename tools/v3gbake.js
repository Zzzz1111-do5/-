'use strict';
// 用户给的 3D 模型烘焙成游戏用的 js/mdl/<键>.js（js/v3g.js 加载、带贴图画出来）：
//   几何原样搬过来（顶点、法线、UV 都是 32 位浮点，不减面、不量化），只做摆放：按 tools/v3gmodels.json 转到游戏的模型坐标
//   （x 车头 / 机头、y 左、z 上，单位米），需要时按真实尺寸缩放、落地；节点层级的变换都乘进顶点里。
//   贴图是原图的字节（JPEG / PNG 原样嵌进去）；材质的颜色、金属度、粗糙度、透明方式照抄。
//   另外两件事：一、能动的部件（坦克炮塔、直升机旋翼、起落架）按规则从连通块里挑出来单独分组，画的时候转 / 收；
//   二、远处用的简化网格（meshoptimizer，只是另外两组三角形索引，顶点还是原来的）——近看画的永远是原模型。
//   noz：喷气机的喷口（米，模型坐标：[出口 x, y（左右对称各一个）, z, 半径, 喷管深]，加力尾焰画在这里，v3det.js）
// 用法：node tools/v3gbake.js <上传目录> [键 ...]        烘焙（不给键就全部）
//       node tools/v3gbake.js <上传目录> --comps <键>     列出连通块（写部件规则用）
// Blender 才能读的格式（OBJ / DAE / BLEND …）先用 tools/v3gconv.py 转成 GLB（配置里的 glb 字段写转出来的文件）
const fs = require('fs'), path = require('path');
let MS = null;
try { MS = require('meshoptimizer').MeshoptSimplifier; } catch (e) { console.warn('没有 meshoptimizer：不生成远处的简化网格'); }

const ROOT = path.join(__dirname, '..'), CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'v3gmodels.json'), 'utf8'));

// ———————————————— glTF 读取 ————————————————
function readGltf(file) {
  const buf = fs.readFileSync(file);
  let J = null, BIN = null;
  if (buf.readUInt32LE(0) === 0x46546C67) {   // 'glTF'
    for (let o = 12; o + 8 <= buf.length;) {
      const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), d = buf.subarray(o + 8, o + 8 + len);
      if (type === 0x4E4F534A) J = JSON.parse(d.toString('utf8')); else if (type === 0x004E4942) BIN = d;
      o += 8 + len;
    }
  } else J = JSON.parse(buf.toString('utf8'));
  const dir = path.dirname(file);
  return { J, dir, buffers: (J.buffers || []).map(b => b.uri ? readUri(b.uri, dir) : BIN) };
}
const readUri = (uri, dir) => uri.startsWith('data:') ? Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64') : fs.readFileSync(path.join(dir, decodeURIComponent(uri)));
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
function accessor(G, i) {
  const A = G.J.accessors[i], n = NC[A.type], es = CS[A.componentType], out = new Float64Array(A.count * n);
  const rd = (dv, o) => { switch (A.componentType) { case 5120: return dv.getInt8(o); case 5121: return dv.getUint8(o); case 5122: return dv.getInt16(o, true); case 5123: return dv.getUint16(o, true); case 5125: return dv.getUint32(o, true); default: return dv.getFloat32(o, true); } };
  const view = (bvi, off, stride0) => { const bv = G.J.bufferViews[bvi], B = G.buffers[bv.buffer]; return { dv: new DataView(B.buffer, B.byteOffset + (bv.byteOffset || 0) + (off || 0)), st: bv.byteStride || stride0 }; };
  if (A.bufferView != null) { const { dv, st } = view(A.bufferView, A.byteOffset, es * n); for (let k = 0; k < A.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = rd(dv, k * st + c * es); }
  if (A.sparse) {
    const S = A.sparse, I = view(S.indices.bufferView, S.indices.byteOffset, CS[S.indices.componentType]), V = view(S.values.bufferView, S.values.byteOffset, es * n);
    for (let k = 0; k < S.count; k++) {
      const o = k * CS[S.indices.componentType], j = S.indices.componentType === 5125 ? I.dv.getUint32(o, true) : S.indices.componentType === 5123 ? I.dv.getUint16(o, true) : I.dv.getUint8(o);
      for (let c = 0; c < n; c++) out[j * n + c] = rd(V.dv, k * es * n + c * es);
    }
  }
  if (A.normalized) { const s = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[A.componentType] || 1; for (let k = 0; k < out.length; k++) out[k] = Math.max(-1, out[k] / s); }
  return { a: out, n, count: A.count };
}

// ———————————————— 矩阵 ————————————————
const mIdent = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mMul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }   // 列主序
function mTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0, 2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0, 2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
const mDet3 = m => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
function mNrm(m) {   // 法线矩阵（3×3 逆转置，行主序返回）
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10], D = mDet3(m) || 1;
  return [(e * i - f * h) / D, -(d * i - f * g) / D, (d * h - e * g) / D, -(b * i - c * h) / D, (a * i - c * g) / D, -(a * h - b * g) / D, (b * f - c * e) / D, -(a * f - c * d) / D, (a * e - b * d) / D];
}
// 「+z」之类的轴名 → glTF 空间里的单位向量
const AX = s => { const v = [0, 0, 0]; v['xyz'.indexOf(s[1])] = s[0] === '-' ? -1 : 1; return v; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ———————————————— 图片 ————————————————
const mimeOf = (b, f = '') => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : /\.webp$/i.test(f) || (b[8] === 0x57 && b[9] === 0x45) ? 'image/webp' : null;
function imgSize(b) {
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let o = 2; o < b.length;) {   // JPEG：找 SOF
    if (b[o] !== 0xFF) { o++; continue; }
    const mk = b[o + 1], len = b.readUInt16BE(o + 2);
    if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)];
    o += 2 + len;
  }
  return [0, 0];
}

// ———————————————— 烘焙一个模型 ————————————————
function bake(key, C, up) {
  const src = path.join(up, C.glb), G = readGltf(src), J = G.J;
  const imgs = [], imgKey = new Map();
  const addImg = (bytes, name) => {   // 同一张图只存一次
    const k = name + ':' + bytes.length;
    if (imgKey.has(k)) return imgKey.get(k);
    const m = mimeOf(bytes, name);
    if (!m) throw new Error(key + '：认不出图片格式 ' + name);
    const [w, h] = imgSize(bytes);
    imgs.push({ bytes, m, w, h, name }); imgKey.set(k, imgs.length - 1);
    return imgs.length - 1;
  };
  const fileImg = f => addImg(fs.readFileSync(path.join(up, f)), path.basename(f));
  const gltfImg = ii => {
    const I = J.images[ii];
    if (I.bufferView != null) { const bv = J.bufferViews[I.bufferView], B = G.buffers[bv.buffer]; return addImg(Buffer.from(B.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)), I.name || 'img' + ii); }
    const dirs = [G.dir, ...(C.imgdir ? [path.join(up, C.imgdir)] : [])];
    for (const d of dirs) { const p = path.join(d, decodeURIComponent(I.uri)); if (fs.existsSync(p)) return addImg(fs.readFileSync(p), path.basename(p)); }
    console.warn(key + '：找不到贴图 ' + I.uri); return -1;
  };
  const texRef = t => {   // glTF 贴图引用 → [图片号, 环绕方式]
    if (!t) return null;
    const T = J.textures[t.index], src = T.source ?? (T.extensions && (T.extensions.EXT_texture_webp || T.extensions.KHR_texture_basisu || {}).source);
    if (src == null) return null;
    if (t.texCoord) console.warn(key + '：贴图用第 ' + (t.texCoord + 1) + ' 套 UV（只支持第一套）');
    if (t.extensions && t.extensions.KHR_texture_transform) console.warn(key + '：KHR_texture_transform 没有处理');
    const sm = T.sampler != null ? J.samplers[T.sampler] : {}, img = gltfImg(src);
    return img < 0 ? null : [img, sm.wrapS === 33071 ? 1 : sm.wrapS === 33648 ? 2 : 0, sm.wrapT === 33071 ? 1 : sm.wrapT === 33648 ? 2 : 0];
  };
  // 材质：c 底色、t 底色贴图、nt 法线贴图、ns 法线强度、mr 金属度 / 粗糙度、mrt 金属粗糙贴图（G 粗糙、B 金属）、
  //   sg 高光颜色 + 光泽度（镜面光泽流程）、sgt 其贴图、e 自发光、et 其贴图、ot 遮蔽贴图、am 0 不透明 / 1 镂空 / 2 半透明、ac 镂空阈值、ds 双面
  const mats = (J.materials || []).map(m => {
    const pbr = m.pbrMetallicRoughness || {}, X = m.extensions || {}, sg = X.KHR_materials_pbrSpecularGlossiness;
    const M = { n: m.name || '', c: [1, 1, 1, 1], t: null, nt: null, ns: 1, mr: [1, 1], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: m.doubleSided ? 1 : 0 };
    if (sg) { M.c = sg.diffuseFactor || M.c; M.t = texRef(sg.diffuseTexture); M.sg = [...(sg.specularFactor || [1, 1, 1]), sg.glossinessFactor ?? 1]; M.sgt = texRef(sg.specularGlossinessTexture); }
    else { M.c = pbr.baseColorFactor || M.c; M.t = texRef(pbr.baseColorTexture); M.mr = [pbr.metallicFactor ?? 1, pbr.roughnessFactor ?? 1]; M.mrt = texRef(pbr.metallicRoughnessTexture); }
    if (m.normalTexture) { M.nt = texRef(m.normalTexture); M.ns = m.normalTexture.scale ?? 1; }
    if (m.occlusionTexture) M.ot = texRef(m.occlusionTexture);
    M.e = (m.emissiveFactor || [0, 0, 0]).map(v => v * ((X.KHR_materials_emissive_strength || {}).emissiveStrength ?? 1));
    M.et = texRef(m.emissiveTexture);
    M.am = { OPAQUE: 0, MASK: 1, BLEND: 2 }[m.alphaMode || 'OPAQUE'] ?? 0; M.ac = m.alphaCutoff ?? .5;
    if (X.KHR_materials_transmission && X.KHR_materials_transmission.transmissionFactor > 0) { M.am = 2; M.c = [...M.c.slice(0, 3), Math.min(M.c[3], 1 - .75 * X.KHR_materials_transmission.transmissionFactor)]; }
    return M;
  });
  // 配置里按材质名补贴图（OBJ 没有 MTL、贴图路径失效的）、改透明方式
  for (const [nm, o] of Object.entries(C.mats || {})) {
    const hits = mats.filter(M => M.n === nm || (o.re && new RegExp(nm).test(M.n)));
    if (!hits.length) console.warn(key + '：配置里的材质 ' + nm + ' 在模型里没有');
    for (const M of hits) {
      if (o.base) M.t = [fileImg(o.base), 0, 0];
      if (o.normal) { M.nt = [fileImg(o.normal), 0, 0]; M.ns = o.ns ?? 1; }
      if (o.mr) M.mrt = [fileImg(o.mr), 0, 0];
      if (o.ao) M.ot = [fileImg(o.ao), 0, 0];
      if (o.color) M.c = o.color;
      if (o.metal != null) M.mr[0] = o.metal;
      if (o.rough != null) M.mr[1] = o.rough;
      if (o.alpha) M.am = { OPAQUE: 0, MASK: 1, BLEND: 2 }[o.alpha];
      if (o.cutoff != null) M.ac = o.cutoff;
      if (o.ds != null) M.ds = o.ds ? 1 : 0;
      if (o.hide) M.hide = 1;
    }
  }
  if (!mats.length) mats.push({ n: 'default', c: [.6, .6, .6, 1], t: null, nt: null, ns: 1, mr: [0, .8], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: 1 });

  // —— 场景树：每个网格图元的顶点乘上节点的世界矩阵 ——
  const fwd = AX(C.fwd || '+z'), upv = AX(C.up || '+y'), lft = cross(upv, fwd);   // 游戏模型坐标：x = 前、y = 左、z = 上
  const P = [], N = [], UV = [], COL = [], TRI = [], TM = [], TN = [];   // TM：三角形的材质，TN：来自哪个节点（名字）
  let hasCol = false;
  const nodeName = [];
  const visit = (ni, parentM, names) => {
    const nd = J.nodes[ni], L = nd.matrix ? nd.matrix.slice() : mTRS(nd.translation, nd.rotation, nd.scale), Mw = mMul(parentM, L), nm = [...names, nd.name || ('node' + ni)];
    if (nd.mesh != null) {
      const flip = mDet3(Mw) < 0, Nm = mNrm(Mw);
      for (const pr of J.meshes[nd.mesh].primitives) {
        const mode = pr.mode ?? 4;
        if (mode < 4) continue;   // 线、点（SketchUp 的轮廓线）不要
        const pos = accessor(G, pr.attributes.POSITION), nrm = pr.attributes.NORMAL != null ? accessor(G, pr.attributes.NORMAL) : null;
        const uv = pr.attributes.TEXCOORD_0 != null ? accessor(G, pr.attributes.TEXCOORD_0) : null, col = pr.attributes.COLOR_0 != null ? accessor(G, pr.attributes.COLOR_0) : null;
        let idx = pr.indices != null ? Array.from(accessor(G, pr.indices).a) : Array.from({ length: pos.count }, (_, i) => i);
        if (mode === 5) { const o = []; for (let i = 0; i + 2 < idx.length; i++) o.push(...(i & 1 ? [idx[i + 1], idx[i], idx[i + 2]] : [idx[i], idx[i + 1], idx[i + 2]])); idx = o; }
        if (mode === 6) { const o = []; for (let i = 1; i + 1 < idx.length; i++) o.push(idx[0], idx[i], idx[i + 1]); idx = o; }
        const v0 = P.length / 3, mi = pr.material ?? 0;
        for (let k = 0; k < pos.count; k++) {
          const x = pos.a[k * 3], y = pos.a[k * 3 + 1], z = pos.a[k * 3 + 2];
          const wx = Mw[0] * x + Mw[4] * y + Mw[8] * z + Mw[12], wy = Mw[1] * x + Mw[5] * y + Mw[9] * z + Mw[13], wz = Mw[2] * x + Mw[6] * y + Mw[10] * z + Mw[14];
          P.push(wx * fwd[0] + wy * fwd[1] + wz * fwd[2], wx * lft[0] + wy * lft[1] + wz * lft[2], wx * upv[0] + wy * upv[1] + wz * upv[2]);
          if (nrm) {
            const a = nrm.a[k * 3], b = nrm.a[k * 3 + 1], c = nrm.a[k * 3 + 2];
            let nx = Nm[0] * a + Nm[1] * b + Nm[2] * c, ny = Nm[3] * a + Nm[4] * b + Nm[5] * c, nz = Nm[6] * a + Nm[7] * b + Nm[8] * c;
            const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
            N.push(nx * fwd[0] + ny * fwd[1] + nz * fwd[2], nx * lft[0] + ny * lft[1] + nz * lft[2], nx * upv[0] + ny * upv[1] + nz * upv[2]);
          } else N.push(NaN, NaN, NaN);
          UV.push(uv ? uv.a[k * 2] : 0, uv ? uv.a[k * 2 + 1] : 0);
          if (col) { hasCol = true; COL.push(col.a[k * col.n], col.a[k * col.n + 1], col.a[k * col.n + 2], col.n > 3 ? col.a[k * col.n + 3] : 1); } else COL.push(1, 1, 1, 1);
        }
        nodeName.push(nm.join('/'));
        for (let i = 0; i + 2 < idx.length; i += 3) { const a = idx[i] + v0, b = idx[i + 1] + v0, c = idx[i + 2] + v0; TRI.push(a, flip ? c : b, flip ? b : c); TM.push(mi); TN.push(nodeName.length - 1); }
      }
    }
    for (const c of nd.children || []) visit(c, Mw, nm);
  };
  const scn = J.scenes ? J.scenes[J.scene || 0] : { nodes: J.nodes.map((_, i) => i).filter(i => !J.nodes.some(n => (n.children || []).includes(i))) };
  for (const r of scn.nodes) visit(r, mIdent(), []);
  // 不要的材质（藏起来的）、不要的节点
  const dropMat = new Set(mats.map((M, i) => M.hide ? i : -1).filter(i => i >= 0)), dropNode = C.dropNodes ? new RegExp(C.dropNodes) : null;
  let nt = TM.length;
  for (let t = 0; t < nt; t++) if (dropMat.has(TM[t]) || (dropNode && dropNode.test(nodeName[TN[t]]))) { TM[t] = -1; }
  // 没有法线的顶点：按相邻三角形面积加权求
  const nv0 = P.length / 3;
  if (N.some(v => Number.isNaN(v))) {
    const acc = new Float64Array(nv0 * 3);
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [TRI[t * 3], TRI[t * 3 + 1], TRI[t * 3 + 2]], e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]], n = cross(e1, e2);
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[v * 3 + k] += n[k];
    }
    for (let v = 0; v < nv0; v++) if (Number.isNaN(N[v * 3])) { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1; for (let k = 0; k < 3; k++) N[v * 3 + k] = acc[v * 3 + k] / l; }
  }

  // —— 缩放、落地 ——
  const live = []; for (let t = 0; t < nt; t++) if (TM[t] >= 0) live.push(t);
  const bbOf = () => { const b = [1e18, 1e18, 1e18, -1e18, -1e18, -1e18]; for (const t of live) for (let j = 0; j < 3; j++) { const v = TRI[t * 3 + j]; for (let k = 0; k < 3; k++) { const x = P[v * 3 + k]; if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x; } } return b; };
  let bb = bbOf();
  const s = C.scale || (C.len ? C.len / (bb[3] - bb[0]) : C.height ? C.height / (bb[5] - bb[2]) : C.span ? C.span / (bb[4] - bb[1]) : 1);
  const ox = (bb[0] + bb[3]) / 2, oy = (bb[1] + bb[4]) / 2, oz = C.origin === 'center' ? (bb[2] + bb[5]) / 2 : bb[2];
  for (let v = 0; v < nv0; v++) { P[v * 3] = (P[v * 3] - ox) * s; P[v * 3 + 1] = (P[v * 3 + 1] - oy) * s; P[v * 3 + 2] = (P[v * 3 + 2] - oz) * s; }
  bb = bbOf();

  // —— 连通块（按位置焊接，UV 缝两边算一块）→ 部件 ——
  const weld = new Map(), wid = new Int32Array(nv0);
  for (let v = 0; v < nv0; v++) { const k = Math.round(P[v * 3] * 1e4) + ',' + Math.round(P[v * 3 + 1] * 1e4) + ',' + Math.round(P[v * 3 + 2] * 1e4); let w = weld.get(k); if (w == null) weld.set(k, w = weld.size); wid[v] = w; }
  const par = new Int32Array(weld.size).map((_, i) => i), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (const t of live) { const a = find(wid[TRI[t * 3]]), b = find(wid[TRI[t * 3 + 1]]), c = find(wid[TRI[t * 3 + 2]]); par[b] = a; par[find(c)] = a; }
  const comp = new Map();
  for (const t of live) {
    const r = find(wid[TRI[t * 3]]);
    let o = comp.get(r);
    if (!o) comp.set(r, o = { id: comp.size, tris: [], bb: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], c: [0, 0, 0], area: 0, mats: new Set(), nodes: new Set() });
    o.tris.push(t); o.mats.add(mats[TM[t]].n); o.nodes.add(nodeName[TN[t]]);
    for (let j = 0; j < 3; j++) { const v = TRI[t * 3 + j]; for (let k = 0; k < 3; k++) { const x = P[v * 3 + k]; if (x < o.bb[k]) o.bb[k] = x; if (x > o.bb[k + 3]) o.bb[k + 3] = x; } }
  }
  for (const o of comp.values()) for (let k = 0; k < 3; k++) o.c[k] = (o.bb[k] + o.bb[k + 3]) / 2;
  const parts = (C.parts || []).map(p => ({ n: p.name, k: p.kind, p: p.pivot ? p.pivot.slice() : null, a: p.axis ? AXm(p.axis) : [0, 0, 1], rule: p }));
  const partOfComp = o => {
    for (let i = 0; i < parts.length; i++) if (ruleHit(parts[i].rule, o)) return i;
    return -1;
  };
  const TP = new Int8Array(nt).fill(-1);
  for (const o of comp.values()) { const pi = partOfComp(o); for (const t of o.tris) TP[t] = pi; }
  if (process.argv.includes('--comps')) {
    const SK = { z1: o => -o.bb[5], x1: o => -o.bb[3], x0: o => o.bb[0], n: o => -o.tris.length, z0: o => o.bb[2] }[process.env.SORT || 'z1'], L = [...comp.values()].sort((a, b) => SK(a) - SK(b));
    console.log('bb', bb.map(v => +v.toFixed(3)), '连通块', L.length);
    for (const o of L.slice(0, +(process.env.NCOMP || 400))) console.log(`#${o.id} tris=${o.tris.length} x[${o.bb[0].toFixed(2)},${o.bb[3].toFixed(2)}] y[${o.bb[1].toFixed(2)},${o.bb[4].toFixed(2)}] z[${o.bb[2].toFixed(2)},${o.bb[5].toFixed(2)}] part=${partOfComp(o)} mats=${[...o.mats].join('|').slice(0, 60)} nodes=${[...o.nodes].join('|').slice(-60)}`);
    return null;
  }
  // 部件的转轴：没给就取部件包围盒中心（旋翼）
  parts.forEach((p, i) => {
    if (p.p) return;
    const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], seen = new Set(), sum = [0, 0, 0];
    for (const t of live) if (TP[t] === i) for (let j = 0; j < 3; j++) {
      const v = TRI[t * 3 + j];
      for (let k = 0; k < 3; k++) { const x = P[v * 3 + k]; if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x; }
      if (!seen.has(wid[v])) { seen.add(wid[v]); for (let k = 0; k < 3; k++) sum[k] += P[v * 3 + k]; }
    }
    p.p = p.k === 'spin' && seen.size ? sum.map(x => x / seen.size) : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  });
  // 车体长（不算炮管、部件）：车辆按它缩放到游戏里的车长
  const hb = [1e9, -1e9]; for (const t of live) if (TP[t] < 0) for (let j = 0; j < 3; j++) { const x = P[TRI[t * 3 + j] * 3]; if (x < hb[0]) hb[0] = x; if (x > hb[1]) hb[1] = x; }

  // —— 按（部件，透明方式，材质）分组，顶点按组重排 ——
  const gkey = t => TP[t] * 100000 + mats[TM[t]].am * 10000 + TM[t];
  const order = live.slice().sort((a, b) => gkey(a) - gkey(b));
  const remap = new Int32Array(nv0).fill(-1), V = [], groups = [];
  let nv = 0, cur = null;
  const IDX = [];
  // 组内完全相同的顶点（位置、法线、UV、颜色按 32 位浮点逐位相同）合成一个：无损，只是不重复存（有的导出器把每个三角形的顶点都拆开存）
  const F = new Float32Array(12), FU = new Uint32Array(F.buffer);
  let dedup = null;
  for (const t of order) {
    const gk = gkey(t);
    if (!cur || cur.k !== gk) { cur = { k: gk, m: TM[t], p: TP[t], i0: IDX.length, tri: [] }; groups.push(cur); dedup = new Map(); }
    for (let j = 0; j < 3; j++) {
      const v = TRI[t * 3 + j];
      if (remap[v] < 0) {
        F[0] = P[v * 3]; F[1] = P[v * 3 + 1]; F[2] = P[v * 3 + 2]; F[3] = N[v * 3]; F[4] = N[v * 3 + 1]; F[5] = N[v * 3 + 2]; F[6] = UV[v * 2]; F[7] = UV[v * 2 + 1];
        for (let k = 0; k < 4; k++) F[8 + k] = COL[v * 4 + k];
        const hk = FU.join(','), hit = dedup.get(hk);
        if (hit != null) remap[v] = hit; else { remap[v] = nv++; V.push(v); dedup.set(hk, remap[v]); }
      }
      IDX.push(remap[v]);
    }
  }
  for (const g of groups) g.n = 0;
  groups.forEach((g, gi) => { const nx = groups[gi + 1]; g.n = (nx ? nx.i0 : IDX.length) - g.i0; });
  const stride = hasCol ? 12 : 8, VB = new Float32Array(nv * stride);
  V.forEach((v, i) => {
    const o = i * stride;
    VB[o] = P[v * 3]; VB[o + 1] = P[v * 3 + 1]; VB[o + 2] = P[v * 3 + 2]; VB[o + 3] = N[v * 3]; VB[o + 4] = N[v * 3 + 1]; VB[o + 5] = N[v * 3 + 2]; VB[o + 6] = UV[v * 2]; VB[o + 7] = UV[v * 2 + 1];
    if (hasCol) for (let k = 0; k < 4; k++) VB[o + 8 + k] = COL[v * 4 + k];
  });
  // —— 远处用的简化网格：整模一起减（各组顶点不共用，组与组的交界、UV 缝都保得住），减完按顶点所属的组分回去 ——
  const lods = [groups.map(g => [g.m, g.p, g.i0, g.n])], allIdx = [IDX];
  let off = IDX.length;
  if (MS && C.lod !== false) {
    const pos = new Float32Array(nv * 3), att = new Float32Array(nv * 5), gOfV = new Int32Array(nv);
    for (let i = 0; i < nv; i++) { pos.set(VB.subarray(i * stride, i * stride + 3), i * 3); att.set(VB.subarray(i * stride + 3, i * stride + 8), i * 5); }
    groups.forEach((g, gi) => { for (let k = g.i0; k < g.i0 + g.n; k++) gOfV[IDX[k]] = gi; });
    // 每个部件单独减（炮塔和车体的顶点不会合到一起）；允许跨 UV 缝、材质交界合并（Permissive），太小的碎块直接去掉（Prune）——只在远处画，看不出来
    const pids = [...new Set(groups.map(g => g.p))];
    for (const [ratio, err] of C.lods || [[.25, .006], [.06, .03]]) {
      const per = groups.map(() => []);
      for (const pid of pids) {
        const I0 = [];
        groups.forEach(g => { if (g.p === pid) for (let k = g.i0; k < g.i0 + g.n; k++) I0.push(IDX[k]); });
        if (!I0.length) continue;
        const want = Math.max(3, Math.floor(I0.length * ratio / 3) * 3);
        const [J2] = MS.simplifyWithAttributes(Uint32Array.from(I0), pos, 3, att, 5, [.3, .3, .3, .6, .6], null, want, err, ['Permissive', 'Prune']);
        for (let i = 0; i < J2.length; i += 3) per[gOfV[J2[i]]].push(J2[i], J2[i + 1], J2[i + 2]);
      }
      const L = [], flat = [];
      per.forEach((a, gi) => { if (!a.length) return; L.push([groups[gi].m, groups[gi].p, off + flat.length, a.length]); for (const v of a) flat.push(v); });
      lods.push(L); allIdx.push(flat); off += flat.length;
      console.log(`  ${key} 简化 ${ratio}：${IDX.length / 3} → ${flat.length / 3} 个三角形`);
    }
  }

  // —— 写文件 ——
  const it = nv > 65535 ? 4 : 2, idxAll = it === 4 ? Uint32Array.from(allIdx.flat()) : Uint16Array.from(allIdx.flat());
  const chunks = [], add = b => { const o = chunks.reduce((s, c) => s + c.length, 0); chunks.push(b); return o; };
  const pad4 = () => { const L = chunks.reduce((s, c) => s + c.length, 0); if (L % 4) chunks.push(Buffer.alloc(4 - L % 4)); };
  const vbo = add(Buffer.from(VB.buffer)); pad4();
  const ibo = add(Buffer.from(idxAll.buffer)); pad4();
  const imgOut = imgs.map(I => { const o = add(I.bytes); return { m: I.m, o, n: I.bytes.length, w: I.w, h: I.h }; });
  const bin = Buffer.concat(chunks);
  const R3 = v => Math.round(v * 1e4) / 1e4;
  const meta = {
    v: 1, key, name: C.name, len: R3(bb[3] - bb[0]), hl: R3(hb[1] - hb[0]), bb: bb.map(R3), zc: C.zc ?? R3((bb[2] + bb[5]) / 2),
    nv, st: stride, col: hasCol ? 1 : 0, vb: [vbo, nv * stride * 4], ib: [ibo, idxAll.length * it], it,
    mats: mats.map(M => ({ n: M.n, c: M.c.map(R3), t: M.t, nt: M.nt, ns: M.ns, mr: M.mr.map(R3), mrt: M.mrt, sg: M.sg && M.sg.map(R3), sgt: M.sgt, e: M.e.map(R3), et: M.et, ot: M.ot, am: M.am, ac: M.ac, ds: M.ds })),
    imgs: imgOut, parts: parts.map(p => ({ n: p.n, k: p.k, p: p.p.map(R3), a: p.a })), noz: C.noz || null, lod: lods, credit: C.credit || (C.set && CFG.sets[C.set]) || null
  };
  const cr = C.credit || (C.set && CFG.sets[C.set]) || null, head = cr ? `// ${C.name}：${cr.title}，作者 ${cr.author}（${cr.url}），${cr.license} 授权（${cr.lurl}）。署名见 docs/credits.md\n` : '';
  const out = path.join(ROOT, 'js', 'mdl', key + '.js');
  fs.writeFileSync(out, `${head}V3G.add(${JSON.stringify(key)}, ${JSON.stringify(meta)}, '${bin.toString('base64')}');\n`);
  console.log(`${key}：${live.length} 个三角形，${nv} 个顶点，${imgs.length} 张贴图（${(imgs.reduce((s, I) => s + I.bytes.length, 0) / 1e6).toFixed(1)} MB），尺寸 ${(bb[3] - bb[0]).toFixed(2)} × ${(bb[4] - bb[1]).toFixed(2)} × ${(bb[5] - bb[2]).toFixed(2)} 米，部件 ${parts.map(p => p.n + ':' + groups.filter(g => g.p === parts.indexOf(p)).reduce((s, g) => s + g.n / 3, 0)).join(' ') || '无'} → ${path.relative(ROOT, out)}（${(fs.statSync(out).size / 1e6).toFixed(1)} MB）`);
  return meta;
}
// 部件规则（连通块 o 是不是这个部件）：nodes 节点名正则、mats 材质名正则、zmin / zmax 块的最低 / 最高点、cyl [x, y, r] 块中心在圆柱里、box [x0, x1, y0, y1] 块中心在框里；any：几条规则任一满足
function ruleHit(R, o) {
  if (R.any) return R.any.some(r => ruleHit(r, o));
  if (R.nodes && ![...o.nodes].some(n => new RegExp(R.nodes).test(n))) return false;
  if (R.mats && ![...o.mats].some(n => new RegExp(R.mats).test(n))) return false;
  if (R.zmin != null && o.bb[2] < R.zmin) return false;
  if (R.zmax != null && o.bb[5] > R.zmax) return false;
  if (R.ztop != null && o.bb[5] < R.ztop) return false;
  if (R.zlow != null && o.bb[2] > R.zlow) return false;
  if (R.cyl && Math.hypot(o.c[0] - R.cyl[0], o.c[1] - R.cyl[1]) > R.cyl[2]) return false;
  if (R.box && (o.c[0] < R.box[0] || o.c[0] > R.box[1] || o.c[1] < R.box[2] || o.c[1] > R.box[3])) return false;
  if (R.xmin != null && o.bb[0] < R.xmin) return false;
  if (R.xmax != null && o.bb[3] > R.xmax) return false;
  if (R.maxTris != null && o.tris.length > R.maxTris) return false;
  return !!(R.nodes || R.mats || R.zmin != null || R.zmax != null || R.cyl || R.box || R.ztop != null || R.zlow != null);
}
function AXm(s) { if (Array.isArray(s)) return s; return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[s] || [0, 0, 1]; }

// ———————————————— 入口 ————————————————
const args = process.argv.slice(2), up = args[0];
if (!up || !fs.existsSync(up)) { console.error('用法：node tools/v3gbake.js <上传目录> [键 ...] [--comps 键]'); process.exit(1); }
const ci = args.indexOf('--comps');
const keys = ci >= 0 ? [args[ci + 1]] : args.slice(1).filter(a => !a.startsWith('--'));
(async () => {
  if (MS) await MS.ready;
  for (const k of keys.length ? keys : Object.keys(CFG.models)) {
    const C = CFG.models[k];
    if (!C) { console.error('配置里没有 ' + k); continue; }
    bake(k, C, up);
  }
  if (ci < 0) credits();
})();
// 署名：docs/credits.md、游戏里「设置 → 素材署名」（legal/credits.html）里「用户提供的模型」一节，两行标记之间整段重写（同一个作品只列一次）
function credits() {
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), url = u => /^https?:\/\//.test(u) ? esc(u) : '#';
  const by = new Map();
  for (const [k, C] of Object.entries(CFG.models)) {
    const cr = C.credit || (C.set && CFG.sets[C.set]);
    if (!cr) continue;
    const id = cr.url;
    if (!by.has(id)) by.set(id, { cr, names: [], keys: [] });
    by.get(id).names.push(C.name); by.get(id).keys.push(k);
  }
  const L = [...by.values()], nc = L.filter(o => /NC/.test(o.cr.license));
  const md = '<!-- v3g:start -->\n## 用户提供的模型（tools/v3gbake.js 烘焙，js/v3g.js 画）\n\n原样导入：网格、贴图、材质都是原来的，只统一了朝向与尺寸（落地、按真实长度缩放），远处换减了面的网格。' +
    (nc.length ? '标了「非商用」的只能用在不收费的版本里（商店版打包时去掉，tools/build_www.mjs --app）。' : '') + '\n\n' +
    L.map(o => `- ${o.names.join('、')}（${o.keys.map(k => 'js/mdl/' + k + '.js').join('、')}）：This work is based on "${o.cr.title}" (${o.cr.url}) by ${o.cr.author} licensed under ${o.cr.license} (${o.cr.lurl})${/NC/.test(o.cr.license) ? '——非商用' : ''}`).join('\n') + '\n<!-- v3g:end -->\n';
  const fm = path.join(ROOT, 'docs', 'credits.md');
  let t = fs.readFileSync(fm, 'utf8');
  t = /<!-- v3g:start -->/.test(t) ? t.replace(/<!-- v3g:start -->[\s\S]*?<!-- v3g:end -->\n?/, md) : t.replace(/(## Sketchfab 模型)/, md + '\n$1');
  fs.writeFileSync(fm, t);
  const li = L.map(o => `<li><strong>${esc(o.names.join('、'))}</strong>：This work is based on "<a href="${url(o.cr.url)}" target="_blank" rel="noopener">${esc(o.cr.title)}</a>" by ${esc(o.cr.author)} licensed under <a href="${url(o.cr.lurl)}" target="_blank" rel="noopener">${esc(o.cr.license)}</a>${/NC/.test(o.cr.license) ? '（非商用）' : ''}</li>`).join('\n');
  const block = `<!-- v3g:start -->\n<p>坦克、飞机、直升机、导弹、士兵的模型来自 Sketchfab，按原样导入（网格、贴图、材质不改，只统一了朝向与尺寸）：</p>\n<ul>\n${li}\n</ul>\n<!-- v3g:end -->\n`;
  const fh = path.join(ROOT, 'legal', 'credits.html');
  let h = fs.readFileSync(fh, 'utf8');
  h = /<!-- v3g:start -->/.test(h) ? h.replace(/<!-- v3g:start -->[\s\S]*?<!-- v3g:end -->\n?/, block) : h.replace(/(<h2>3D 模型<\/h2>\n)/, '$1' + block);
  fs.writeFileSync(fh, h);
  console.log('署名已更新：docs/credits.md、legal/credits.html（' + L.length + ' 个作品）');
}
