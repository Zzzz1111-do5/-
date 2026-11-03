'use strict';
// 编辑器（二）：在浏览器里导入模型，和模型预览（modui.js「模型与挂点」页）
//   导入：.glb、.gltf（连同 .bin、贴图一起选）、Sketchfab 下载的 glTF 压缩包（.zip，浏览器自带的 DecompressionStream 解）——
//   照 tools/v3gbake.js 的做法：走一遍场景树把顶点乘上节点矩阵，换到游戏的模型坐标（x 前、y 左、z 上，单位米），按实际长度缩放、底面放到 0、前后左右居中，
//   按材质分组，材质（底色、贴图、法线、金属粗糙、自发光、透明方式）照搬，贴图太大的缩到 2048；拼成和 js/mdl/<键>.js 一样的 { meta, bin }，
//   mod.js 存进 IndexedDB、登记给 v3g.js（v3gDecode 认 D.bin），游戏里照常画。没有部件（炮塔不会转、轮子不会滚），远处不换简化网格。
//   不支持：Draco / meshopt 压缩的网格（导出时选不压缩）、KTX2 贴图、第二套 UV；带骨骼的按绑定姿势导入。
//   预览（MIV）：编辑器里自己一个 WebGL 画布，拖动转着看、滚轮缩放；点选时从镜头打一条射线和模型的三角形逐个求交，取最近的那一点（炮口、挂点、尾喷口）
const MIM = { texMax: 2048 };
const mimInflate = async raw => {
  if (typeof DecompressionStream !== 'function') throw new Error('这个浏览器不能解压 zip：请先解压，再一起选里面的 .gltf、.bin 和贴图');
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
};
// zip：读中央目录（文件名 → 取内容的函数，用到才解压）
function mimUnzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = new Map(), td = new TextDecoder();
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('不是 zip 压缩包');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n && p + 46 <= u8.length && dv.getUint32(p, true) === 0x02014b50; i++) {
    const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith('/') || (meth !== 0 && meth !== 8)) continue;
    const d0 = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(d0, d0 + csz);
    out.set(name, meth === 0 ? async () => raw : () => mimInflate(raw));
  }
  return out;
}
const mimJoin = (dir, uri) => { const o = []; for (const s of (dir + decodeURIComponent(uri)).split('/')) { if (s === '..') o.pop(); else if (s && s !== '.') o.push(s); } return o.join('/'); };
const mimSniff = b => b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? 'image/webp' : null;
// 选的文件（FileList / File 数组）→ 文件名 → 取内容；里面的 zip 展开
async function mimFiles(list) {
  const files = new Map();
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) { for (const [k, g] of mimUnzip(new Uint8Array(await f.arrayBuffer()))) files.set(k, g); }
    else files.set(f.name, async () => new Uint8Array(await f.arrayBuffer()));
  }
  return files;
}
// 读出 glTF：J（JSON）、bufs（各个缓冲区的字节）、get（按 uri 取同目录的文件）
async function mimRead(files) {
  const names = [...files.keys()], main = names.filter(n => /\.(glb|gltf)$/i.test(n) && !/__MACOSX/.test(n)).sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0];
  if (!main) throw new Error('没找到 .glb / .gltf 文件');
  const dir = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '', lc = s => s.toLowerCase(), base = s => lc(s.split('/').pop());
  const get = async uri => {
    if (/^data:/i.test(uri)) { const b64 = uri.slice(uri.indexOf(',') + 1); return typeof v3gBytes === 'function' ? v3gBytes(b64) : Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
    const p = mimJoin(dir, uri), k = files.has(p) ? p : names.find(n => lc(n) === lc(p)) || names.find(n => base(n) === base(p));
    if (!k) throw new Error('缺文件：' + decodeURIComponent(uri) + '（.gltf 要和 .bin、贴图一起选，或者直接选压缩包）');
    return files.get(k)();
  };
  const raw = await files.get(main)();
  let J = null, bin0 = null;
  if (/\.glb$/i.test(main)) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB 文件');
    for (let o = 12; o + 8 <= raw.byteLength;) { const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true), d = raw.subarray(o + 8, o + 8 + len); if (type === 0x4e4f534a) J = JSON.parse(new TextDecoder().decode(d)); else if (type === 0x004e4942) bin0 = d; o += 8 + len + ((4 - len % 4) % 4); }
  } else J = JSON.parse(new TextDecoder().decode(raw));
  if (!J) throw new Error('模型文件里没有 glTF 数据');
  const bad = (J.extensionsRequired || []).filter(x => /draco|meshopt|basisu|KHR_texture_basisu/i.test(x));
  if (bad.length) throw new Error('模型用了压缩（' + bad.join('、') + '），游戏里解不开：导出时选不压缩的 glTF / GLB');
  const bufs = [];
  for (const [i, b] of (J.buffers || []).entries()) bufs.push(b.uri == null ? (i === 0 && bin0 ? bin0 : new Uint8Array(b.byteLength || 0)) : await get(b.uri));
  return { J, bufs, get, main };
}
const MIM_CT = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 0], 5126: [4, 'getFloat32', 0] };
const MIM_NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
// 访问器 → 浮点数组（规整化的整数换成 0–1 / −1–1）
function mimAcc(G, i) {
  const A = G.J.accessors[i], n = MIM_NC[A.type], C = MIM_CT[A.componentType], cnt = A.count, out = new Float32Array(cnt * n);
  if (!C) throw new Error('不认识的数据类型 ' + A.componentType);
  if (A.bufferView == null) return { a: out, n, count: cnt };
  const bv = G.J.bufferViews[A.bufferView], B = G.bufs[bv.buffer], off = B.byteOffset + (bv.byteOffset || 0) + (A.byteOffset || 0), sz = C[0], st = bv.byteStride || sz * n;
  if (A.componentType === 5126 && st === 4 * n && off % 4 === 0) out.set(new Float32Array(B.buffer, off, cnt * n));
  else {
    const dv = new DataView(B.buffer, off), get = C[1], mx = A.normalized ? C[2] : 0;
    for (let k = 0; k < cnt; k++) for (let c = 0; c < n; c++) { let v = dv[get](k * st + c * sz, true); if (mx) v = Math.max(v / mx, -1); out[k * n + c] = v; }
  }
  return { a: out, n, count: cnt };
}
function mimTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + w * z) * s[0], 2 * (x * z - w * y) * s[0], 0,
    2 * (x * y - w * z) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + w * x) * s[1], 0,
    2 * (x * z + w * y) * s[2], 2 * (y * z - w * x) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
}
const mimMul = (A, B) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = A[r] * B[c * 4] + A[4 + r] * B[c * 4 + 1] + A[8 + r] * B[c * 4 + 2] + A[12 + r] * B[c * 4 + 3]; return o; };
const MIM_AX = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const mimCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 图片：太大的缩到 MIM.texMax（WebP），返回 { bytes, mime, w, h }
async function mimShrink(bytes, mime) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return { bytes, mime, w: 0, h: 0 };
  const img = await createImageBitmap(new Blob([bytes], { type: mime }));
  const w = img.width, h = img.height, m = Math.max(w, h), T = MIM.texMax;
  if (m <= T) { img.close && img.close(); return { bytes, mime, w, h }; }
  const k = T / m, cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); img.close && img.close();
  const b = await new Promise(ok => cv.toBlob(ok, 'image/webp', .9));
  return { bytes: new Uint8Array(await b.arrayBuffer()), mime: b.type || 'image/png', w: cv.width, h: cv.height };
}
// glTF → { meta, bin }。o：name 名称、key 模型键、len 实际全长（米，0 = 文件里的单位就是米）、hl 车体长（车辆按它缩放，不含炮管）、fwd / up 模型的前方、上方轴、prog 进度回调
async function mimBuild(G, o) {
  const J = G.J, prog = o.prog || (() => {}), fwd = MIM_AX[o.fwd || '+z'], upv = MIM_AX[o.up || '+y'];
  if (!fwd || !upv || Math.abs(fwd[0] * upv[0] + fwd[1] * upv[1] + fwd[2] * upv[2]) > .5) throw new Error('前方轴和上方轴不能是同一根轴');
  const lft = mimCross(upv, fwd);
  // —— 贴图 ——
  const imgs = [], imgMap = new Map();
  const imgOf = async src => {
    if (imgMap.has(src)) return imgMap.get(src);
    imgMap.set(src, -1);
    const I = J.images && J.images[src];
    if (!I) return -1;
    let bytes = null;
    try {
      if (I.bufferView != null) { const bv = J.bufferViews[I.bufferView], B = G.bufs[bv.buffer]; bytes = B.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); }
      else if (I.uri) bytes = await G.get(I.uri);
    } catch (e) { console.warn(e.message); return -1; }
    const mime = bytes && (mimSniff(bytes) || I.mimeType);
    if (!mime || !/png|jpeg|webp/.test(mime)) return -1;   // KTX2 之类的不认
    prog('贴图 ' + (imgs.length + 1));
    const r = await mimShrink(bytes, mime).catch(() => ({ bytes, mime, w: 0, h: 0 }));
    imgs.push(r); imgMap.set(src, imgs.length - 1);
    return imgs.length - 1;
  };
  const texRef = async t => {
    if (!t) return null;
    const T = J.textures && J.textures[t.index], src = T && (T.source ?? (T.extensions && (T.extensions.EXT_texture_webp || {}).source));
    if (src == null) return null;
    const sm = T.sampler != null ? J.samplers[T.sampler] : {}, img = await imgOf(src);
    return img < 0 ? null : [img, sm.wrapS === 33071 ? 1 : sm.wrapS === 33648 ? 2 : 0, sm.wrapT === 33071 ? 1 : sm.wrapT === 33648 ? 2 : 0];
  };
  // —— 材质（同 v3gbake.js）——
  const mats = [];
  for (const m of J.materials || []) {
    const pbr = m.pbrMetallicRoughness || {}, X = m.extensions || {}, sg = X.KHR_materials_pbrSpecularGlossiness;
    const M = { n: m.name || '', c: [1, 1, 1, 1], t: null, nt: null, ns: 1, mr: [1, 1], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: m.doubleSided ? 1 : 0 };
    if (sg) { M.c = sg.diffuseFactor || M.c; M.t = await texRef(sg.diffuseTexture); M.sg = [...(sg.specularFactor || [1, 1, 1]), sg.glossinessFactor ?? 1]; M.sgt = await texRef(sg.specularGlossinessTexture); }
    else { M.c = pbr.baseColorFactor || M.c; M.t = await texRef(pbr.baseColorTexture); M.mr = [pbr.metallicFactor ?? 1, pbr.roughnessFactor ?? 1]; M.mrt = await texRef(pbr.metallicRoughnessTexture); }
    if (m.normalTexture) { M.nt = await texRef(m.normalTexture); M.ns = m.normalTexture.scale ?? 1; }
    if (m.occlusionTexture) M.ot = await texRef(m.occlusionTexture);
    M.e = (m.emissiveFactor || [0, 0, 0]).map(v => v * ((X.KHR_materials_emissive_strength || {}).emissiveStrength ?? 1));
    M.et = await texRef(m.emissiveTexture);
    M.am = { OPAQUE: 0, MASK: 1, BLEND: 2 }[m.alphaMode || 'OPAQUE'] ?? 0; M.ac = m.alphaCutoff ?? .5;
    if (X.KHR_materials_transmission && X.KHR_materials_transmission.transmissionFactor > 0) { M.am = 2; M.c = [...M.c.slice(0, 3), Math.min(M.c[3], 1 - .75 * X.KHR_materials_transmission.transmissionFactor)]; }
    mats.push(M);
  }
  const defMat = () => { if (mats.def == null) { mats.def = mats.length; mats.push({ n: 'default', c: [.6, .6, .6, 1], t: null, nt: null, ns: 1, mr: [0, .8], mrt: null, sg: null, sgt: null, e: [0, 0, 0], et: null, ot: null, am: 0, ac: .5, ds: 1 }); } return mats.def; };
  // —— 场景树 ——
  prog('网格');
  const P = [], N = [], UV = [], TRI = [], TM = [];
  let nTri = 0;
  const visit = (ni, parentM, depth) => {
    const nd = J.nodes[ni];
    if (!nd || depth > 64) return;
    const Mw = mimMul(parentM, nd.matrix ? nd.matrix.slice() : mimTRS(nd.translation, nd.rotation, nd.scale));
    if (nd.mesh != null && J.meshes[nd.mesh]) {
      const a = (r, c) => Mw[c * 4 + r];   // 法线矩阵：左上 3×3 的余子式矩阵（= 行列式 × 逆转置），乘上行列式的符号
      const Cf = [a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1), a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2), a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0),
        a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2), a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0), a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1),
        a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1), a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2), a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)];
      const det = a(0, 0) * Cf[0] + a(0, 1) * Cf[1] + a(0, 2) * Cf[2], sg = det < 0 ? -1 : 1, flip = det < 0;
      for (const pr of J.meshes[nd.mesh].primitives) {
        const mode = pr.mode ?? 4;
        if (mode < 4 || pr.attributes.POSITION == null) continue;   // 线、点不要
        if (pr.extensions && (pr.extensions.KHR_draco_mesh_compression || pr.extensions.EXT_meshopt_compression)) throw new Error('网格是压缩过的（Draco / meshopt），导出时选不压缩');
        const pos = mimAcc(G, pr.attributes.POSITION), nrm = pr.attributes.NORMAL != null ? mimAcc(G, pr.attributes.NORMAL) : null, uv = pr.attributes.TEXCOORD_0 != null ? mimAcc(G, pr.attributes.TEXCOORD_0) : null;
        let idx = pr.indices != null ? mimAcc(G, pr.indices).a : Float32Array.from({ length: pos.count }, (_, i) => i);
        if (mode === 5) { const q = []; for (let i = 0; i + 2 < idx.length; i++) q.push(...(i & 1 ? [idx[i + 1], idx[i], idx[i + 2]] : [idx[i], idx[i + 1], idx[i + 2]])); idx = q; }
        if (mode === 6) { const q = []; for (let i = 1; i + 1 < idx.length; i++) q.push(idx[0], idx[i], idx[i + 1]); idx = q; }
        const v0 = P.length / 3, mi = pr.material != null && mats[pr.material] ? pr.material : defMat();
        for (let k = 0; k < pos.count; k++) {
          const x = pos.a[k * 3], y = pos.a[k * 3 + 1], z = pos.a[k * 3 + 2];
          const wx = Mw[0] * x + Mw[4] * y + Mw[8] * z + Mw[12], wy = Mw[1] * x + Mw[5] * y + Mw[9] * z + Mw[13], wz = Mw[2] * x + Mw[6] * y + Mw[10] * z + Mw[14];
          P.push(wx * fwd[0] + wy * fwd[1] + wz * fwd[2], wx * lft[0] + wy * lft[1] + wz * lft[2], wx * upv[0] + wy * upv[1] + wz * upv[2]);
          if (nrm) {
            const p = nrm.a[k * 3], q = nrm.a[k * 3 + 1], r = nrm.a[k * 3 + 2];
            let nx = (Cf[0] * p + Cf[1] * q + Cf[2] * r) * sg, ny = (Cf[3] * p + Cf[4] * q + Cf[5] * r) * sg, nz = (Cf[6] * p + Cf[7] * q + Cf[8] * r) * sg;
            const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
            N.push(nx * fwd[0] + ny * fwd[1] + nz * fwd[2], nx * lft[0] + ny * lft[1] + nz * lft[2], nx * upv[0] + ny * upv[1] + nz * upv[2]);
          } else N.push(NaN, NaN, NaN);
          UV.push(uv ? uv.a[k * 2] : 0, uv ? uv.a[k * 2 + 1] : 0);
        }
        for (let i = 0; i + 2 < idx.length; i += 3) { const a0 = idx[i] + v0, b = idx[i + 1] + v0, c = idx[i + 2] + v0; TRI.push(a0, flip ? c : b, flip ? b : c); TM.push(mi); nTri++; }
      }
    }
    for (const c of nd.children || []) visit(c, Mw, depth + 1);
  };
  const scn = J.scenes && J.scenes.length ? J.scenes[J.scene || 0] : { nodes: (J.nodes || []).map((_, i) => i).filter(i => !J.nodes.some(n => (n.children || []).includes(i))) };
  for (const r of scn.nodes || []) visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  const nv = P.length / 3;
  if (!nTri) throw new Error('模型里没有三角形');
  if (nTri > 3e6) throw new Error('模型太大了（' + Math.round(nTri / 1e4) / 100 + ' 百万个三角形）：先减面到 300 万以下');
  // —— 缩放、摆正：底面放到 0，前后左右居中 ——
  const bb = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { const x = P[v * 3 + k]; if (x < bb[k]) bb[k] = x; if (x > bb[k + 3]) bb[k + 3] = x; }
  const s = o.len > 0 ? o.len / Math.max(1e-6, bb[3] - bb[0]) : 1, ox = (bb[0] + bb[3]) / 2, oy = (bb[1] + bb[4]) / 2, oz = bb[2];
  const VB = new Float32Array(nv * 8);
  for (let v = 0; v < nv; v++) {
    VB[v * 8] = (P[v * 3] - ox) * s; VB[v * 8 + 1] = (P[v * 3 + 1] - oy) * s; VB[v * 8 + 2] = (P[v * 3 + 2] - oz) * s;
    VB[v * 8 + 3] = N[v * 3]; VB[v * 8 + 4] = N[v * 3 + 1]; VB[v * 8 + 5] = N[v * 3 + 2]; VB[v * 8 + 6] = UV[v * 2]; VB[v * 8 + 7] = UV[v * 2 + 1];
  }
  // 没有法线的：按相邻三角形面积加权平均
  if (N.some(x => x !== x)) {
    const acc = new Float32Array(nv * 3);
    for (let t = 0; t < TRI.length; t += 3) {
      const a0 = TRI[t] * 8, b = TRI[t + 1] * 8, c = TRI[t + 2] * 8, e1 = [VB[b] - VB[a0], VB[b + 1] - VB[a0 + 1], VB[b + 2] - VB[a0 + 2]], e2 = [VB[c] - VB[a0], VB[c + 1] - VB[a0 + 1], VB[c + 2] - VB[a0 + 2]], f = mimCross(e1, e2);
      for (const v of [TRI[t], TRI[t + 1], TRI[t + 2]]) for (let k = 0; k < 3; k++) acc[v * 3 + k] += f[k];
    }
    for (let v = 0; v < nv; v++) if (VB[v * 8 + 3] !== VB[v * 8 + 3]) { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1; for (let k = 0; k < 3; k++) VB[v * 8 + 3 + k] = acc[v * 3 + k] / l; }
  }
  // —— 按材质分组的索引 ——
  const it = nv > 65535 ? 4 : 2, IB = it === 4 ? new Uint32Array(TRI.length) : new Uint16Array(TRI.length), per = mats.map(() => []);
  for (let t = 0; t < TM.length; t++) per[TM[t]].push(t);
  const G0 = [];
  let o0 = 0;
  per.forEach((L, mi) => { if (!L.length) return; G0.push([mi, -1, o0, L.length * 3]); for (const t of L) { IB[o0++] = TRI[t * 3]; IB[o0++] = TRI[t * 3 + 1]; IB[o0++] = TRI[t * 3 + 2]; } });
  // —— 拼成一块：顶点 | 索引 | 贴图 ——
  const pad = n => (4 - n % 4) % 4, vbn = VB.byteLength, ibo = vbn, ibn = IB.byteLength;
  let tot = ibo + ibn + pad(ibn);
  const imgOut = imgs.map(I => { const r = { m: I.mime, o: tot, n: I.bytes.length, w: I.w, h: I.h }; tot += I.bytes.length + pad(I.bytes.length); return r; });
  const bin = new Uint8Array(tot);
  bin.set(new Uint8Array(VB.buffer), 0); bin.set(new Uint8Array(IB.buffer), ibo);
  imgs.forEach((I, i) => bin.set(I.bytes, imgOut[i].o));
  const R3 = v => Math.round(v * 1e4) / 1e4, len = (bb[3] - bb[0]) * s, hgt = (bb[5] - bb[2]) * s;
  const ex = (J.asset && J.asset.extras) || {}, cl = t => String(t || '').replace(/\s*\(.*\)\s*$/, '').trim(), ur = t => (String(t || '').match(/\((https?:[^)]+)\)/) || [])[1] || '';
  const credit = ex.author || ex.title ? { title: ex.title || o.name, author: cl(ex.author), license: cl(ex.license), url: ex.source || ur(ex.author) || '', lurl: ur(ex.license) } : null;
  const meta = {
    v: 1, key: o.key, name: o.name, len: R3(len), hl: R3(o.hl > 0 ? o.hl : len), bb: [-len / 2, (bb[1] - oy) * s, 0, len / 2, (bb[4] - oy) * s, hgt].map(R3), zc: R3(hgt / 2),
    nv, st: 8, col: 0, vb: [0, vbn], ib: [ibo, ibn], it, mats: mats.map(M => ({ n: M.n, c: M.c.map(R3), t: M.t, nt: M.nt, ns: M.ns, mr: M.mr.map(R3), mrt: M.mrt, sg: M.sg && M.sg.map(R3), sgt: M.sgt, e: M.e.map(R3), et: M.et, ot: M.ot, am: M.am, ac: M.ac, ds: M.ds })),
    imgs: imgOut, parts: [], noz: null, lod: [G0, G0, G0], credit, imp: { tri: nTri, src: G.main }
  };
  return { meta, bin: bin.buffer };
}
// 已导入的模型转个方向（朝向不对时不用重新导入）：ax 'z' 绕竖轴转 90°、'y' 抬头 / 低头 90°、'x' 侧滚 90°、'fz' 前后掉头；转完重新居中、放到地上，保持全长
function mimTurn(rec, ax) {
  const m = rec.meta, VB = new Float32Array(rec.bin, m.vb[0], m.vb[1] / 4), n = m.vb[1] / 32;
  const R = { z: v => [-v[1], v[0], v[2]], fz: v => [-v[0], -v[1], v[2]], y: v => [-v[2], v[1], v[0]], x: v => [v[0], -v[2], v[1]] }[ax];
  if (!R) return rec;
  for (let i = 0; i < n; i++) { const o = i * 8, p = R([VB[o], VB[o + 1], VB[o + 2]]), q = R([VB[o + 3], VB[o + 4], VB[o + 5]]); VB.set(p, o); VB.set(q, o + 3); }
  const bb = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const x = VB[i * 8 + k]; if (x < bb[k]) bb[k] = x; if (x > bb[k + 3]) bb[k + 3] = x; }
  const s = m.len > 0 ? m.len / Math.max(1e-6, bb[3] - bb[0]) : 1, ox = (bb[0] + bb[3]) / 2, oy = (bb[1] + bb[4]) / 2, oz = bb[2];
  for (let i = 0; i < n; i++) { const o = i * 8; VB[o] = (VB[o] - ox) * s; VB[o + 1] = (VB[o + 1] - oy) * s; VB[o + 2] = (VB[o + 2] - oz) * s; }
  const R3 = v => Math.round(v * 1e4) / 1e4, hgt = (bb[5] - bb[2]) * s;
  m.bb = [-m.len / 2, (bb[1] - oy) * s, 0, m.len / 2, (bb[4] - oy) * s, hgt].map(R3); m.zc = R3(hgt / 2);
  return rec;
}
// 内置模型的原始数据（预览用）：已经解码过的（base64 解完就放掉了）重新取一遍 js/mdl/<键>.js
async function mimModelData(key) {
  const D = typeof V3G === 'object' && V3G.def[key];
  if (D && D.bin) return { meta: modClone(D.meta), bin: new Uint8Array(D.bin.slice(0)) };
  if (key.startsWith('u_')) { const rec = await modFileGet(key); if (!rec) throw new Error('模型文件不见了'); return { meta: rec.meta, bin: new Uint8Array(rec.bin) }; }
  if (D && D.b64 && !V3G.M[key]) return { meta: modClone(D.meta), bin: await v3gBytes(D.b64) };
  const v = typeof window === 'object' && window.DS_BUILD ? '?v=' + encodeURIComponent(window.DS_BUILD) : '', url = 'js/mdl/' + key + '.js' + v;
  let cap = null;
  if (typeof V3G_FETCH !== 'undefined' && V3G_FETCH) {
    const txt = await (await fetch(url)).text(), a = txt.indexOf('V3G.add('), q = txt.lastIndexOf(", '"), e = txt.lastIndexOf("')"), head = txt.slice(a + 8, q), c = head.indexOf(',');
    cap = { meta: JSON.parse(head.slice(c + 1)), b64: txt.slice(q + 3, e) };
  } else {
    cap = await new Promise((ok, no) => {   // file://：插 script 标签，临时接住 V3G.add（不登记、不占着几十兆的字符串）
      const add0 = V3G.add, s = document.createElement('script');
      V3G.add = (k, m, b) => { if (k === key) ok({ meta: m, b64: b }); else add0(k, m, b); };
      s.src = url; s.onload = () => { V3G.add = add0; s.remove(); }; s.onerror = () => { V3G.add = add0; s.remove(); no(new Error('模型文件读不出来')); };
      document.head.appendChild(s);
    });
  }
  return { meta: cap.meta, bin: await v3gBytes(cap.b64) };
}

// ———————————————— 预览 ————————————————
const MIV = { wrap: null, cv: null, ov: null, gl: null, pr: null, A: {}, U: {}, M: null, key: null, yaw: 2.3, pit: .32, dist: 30, tgt: [0, 0, 1], marks: [], pick: null, msg: '', ld: 0 };
const MIV_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 uv; uniform mat4 uPV; varying vec3 vN, vP; varying vec2 vUv;
void main() { vN = n; vP = p; vUv = uv; gl_Position = uPV * vec4(p, 1.); }`;
const MIV_FS = `precision mediump float; uniform sampler2D uT; uniform float uHt, uAm, uAc; uniform vec4 uC; uniform vec3 uL, uE; varying vec3 vN, vP; varying vec2 vUv;
void main() {
  vec4 c = uC; if (uHt > .5) c *= texture2D(uT, vUv);
  if (uAm > .5 && uAm < 1.5 && c.a < uAc) discard;
  vec3 N = normalize(vN), V = normalize(uE - vP); if (dot(N, V) < 0.) N = -N;
  float d = max(dot(N, uL), 0.), h = pow(max(dot(N, normalize(uL + V)), 0.), 32.), sky = .5 + .5 * N.z;
  gl_FragColor = vec4(c.rgb * (.22 + .3 * sky + .62 * d) + .1 * h, uAm > 1.5 ? c.a : 1.);
}`;
function mivInit() {
  if (MIV.wrap) return MIV.wrap;
  const w = MIV.wrap = document.createElement('div');
  w.className = 'miv';
  w.innerHTML = '<canvas class="miv-gl"></canvas><canvas class="miv-ov"></canvas><div class="miv-msg"></div>';
  MIV.cv = w.querySelector('.miv-gl'); MIV.ov = w.querySelector('.miv-ov');
  const gl = MIV.gl = MIV.cv.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { w.querySelector('.miv-msg').textContent = '这个浏览器不能预览 3D（没有 WebGL）'; return w; }
  MIV.u32 = !!gl.getExtension('OES_element_index_uint');
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = MIV.pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, MIV_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, MIV_FS)); gl.linkProgram(pr);
  for (const k of ['p', 'n', 'uv']) MIV.A[k] = gl.getAttribLocation(pr, k);
  for (const k of ['uPV', 'uT', 'uHt', 'uAm', 'uAc', 'uC', 'uL', 'uE']) MIV.U[k] = gl.getUniformLocation(pr, k);
  // 拖动转、滚轮缩放、右键（或按住 Shift）拖动平移；没怎么动就松开算点了一下（点选模式下取点）
  let dn = null;
  MIV.cv.addEventListener('pointerdown', e => { dn = { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey, mv: 0 }; MIV.cv.setPointerCapture(e.pointerId); });
  MIV.cv.addEventListener('pointermove', e => {
    if (!dn) return;
    const dx = e.clientX - dn.x, dy = e.clientY - dn.y; dn.x = e.clientX; dn.y = e.clientY; dn.mv += Math.abs(dx) + Math.abs(dy);
    if (dn.b === 2 || dn.sh) { const C = mivCam(), k = MIV.dist * .0016; for (let i = 0; i < 3; i++) MIV.tgt[i] += (-C.s[i] * dx + C.u[i] * dy) * k; }
    else { MIV.yaw -= dx * .008; MIV.pit = clamp(MIV.pit + dy * .008, -1.45, 1.45); }
    mivDraw();
  });
  MIV.cv.addEventListener('pointerup', e => { const d = dn; dn = null; if (d && d.mv < 5 && d.b === 0 && MIV.pick) { const r = MIV.cv.getBoundingClientRect(), h = mivRay(e.clientX - r.left, e.clientY - r.top); if (h) MIV.pick(h); } });
  MIV.cv.addEventListener('contextmenu', e => e.preventDefault());
  MIV.cv.addEventListener('wheel', e => { e.preventDefault(); MIV.dist = clamp(MIV.dist * Math.exp(e.deltaY * .0012), .5, 3000); mivDraw(); }, { passive: false });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => mivDraw()).observe(w);
  return w;
}
const mivMsg = t => { MIV.msg = t; if (MIV.wrap) MIV.wrap.querySelector('.miv-msg').textContent = t; };
// 换一个模型看
async function mivShow(key) {
  mivInit();
  if (!MIV.gl || MIV.key === key) { mivDraw(); return; }
  MIV.key = key; const ld = ++MIV.ld, gl = MIV.gl;
  mivMsg('读取模型…');
  try {
    const D = await mimModelData(key);
    if (ld !== MIV.ld) return;
    const m = D.meta, bin = D.bin;
    let VB = new Float32Array(bin.buffer, bin.byteOffset + m.vb[0], m.vb[1] / 4), IB = m.it === 4 ? new Uint32Array(bin.buffer, bin.byteOffset + m.ib[0], m.ib[1] / 4) : new Uint16Array(bin.buffer, bin.byteOffset + m.ib[0], m.ib[1] / 2);
    // 内置模型照游戏里那样加工一遍（补起落架整架抬高、机头朝向转 180° 的……）：挂点、喷口的坐标是按加工以后的
    if (!key.startsWith('u_') && key !== 'army' && typeof v3gPrep === 'function' && !(typeof V3G_ERA === 'object' && V3G_ERA[key])) {
      try { const R = v3gPrep(key, m, { key, meta: m, ready: false }, VB, IB); if (R) { VB = R.VB; IB = R.IB; } } catch (e) { console.warn('预览加工失败', e); }
    }
    if (IB instanceof Uint32Array && !MIV.u32) throw new Error('显卡不支持 32 位索引');
    if (MIV.M) mivFree(MIV.M);
    const M = { m, VB, IB, st: (m.st || 8), tex: [] };
    M.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, VB, gl.STATIC_DRAW);
    M.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IB, gl.STATIC_DRAW);
    MIV.M = M;
    const b = m.bb;
    MIV.tgt = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; MIV.dist = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1.25 + .5;
    mivMsg(''); mivDraw();
    if (typeof MIV.onLoad === 'function') MIV.onLoad(key);   // 编辑器：模型原来的喷口这些要等读出来才知道
    // 底色贴图（只为看清楚样子）
    const used = new Set(m.mats.map(T => T.t && T.t[0]).filter(i => i != null));
    for (const i of used) {
      const I = m.imgs[i];
      if (!I || typeof createImageBitmap !== 'function') continue;
      createImageBitmap(new Blob([bin.subarray(I.o, I.o + I.n)], { type: I.m })).then(img => {
        if (ld !== MIV.ld) return;
        const p2 = n => 2 ** Math.round(Math.log2(Math.max(1, n))), W = Math.min(1024, p2(img.width)), H = Math.min(1024, p2(img.height)), cv = document.createElement('canvas');
        cv.width = W; cv.height = H; cv.getContext('2d').drawImage(img, 0, 0, W, H);
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        M.tex[i] = t; mivDraw();
      }, () => {});
    }
  } catch (e) { if (ld === MIV.ld) { MIV.key = null; mivMsg('预览不了：' + e.message); } }
}
function mivFree(M) { const gl = MIV.gl; gl.deleteBuffer(M.vb); gl.deleteBuffer(M.ib); for (const t of M.tex) if (t) gl.deleteTexture(t); }
// 镜头：绕目标点转（模型坐标 z 朝上）
function mivCam() {
  const cp = Math.cos(MIV.pit), E = [MIV.tgt[0] + MIV.dist * cp * Math.cos(MIV.yaw), MIV.tgt[1] + MIV.dist * cp * Math.sin(MIV.yaw), MIV.tgt[2] + MIV.dist * Math.sin(MIV.pit)];
  const nz = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  const f = nz([MIV.tgt[0] - E[0], MIV.tgt[1] - E[1], MIV.tgt[2] - E[2]]), s = nz(mimCross(f, [0, 0, 1])), u = mimCross(s, f);
  const cv = MIV.cv, w = cv.clientWidth || 300, h = cv.clientHeight || 200, asp = w / h, fy = Math.tan(20 * Math.PI / 180), n = Math.max(.05, MIV.dist * .01), fr = MIV.dist * 20 + 100;
  const V = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -(s[0] * E[0] + s[1] * E[1] + s[2] * E[2]), -(u[0] * E[0] + u[1] * E[1] + u[2] * E[2]), f[0] * E[0] + f[1] * E[1] + f[2] * E[2], 1];
  const Pm = [1 / (fy * asp), 0, 0, 0, 0, 1 / fy, 0, 0, 0, 0, -(fr + n) / (fr - n), -1, 0, 0, -2 * fr * n / (fr - n), 0];
  return { E, f, s, u, w, h, asp, fy, PV: mimMul(Pm, V) };
}
function mivDraw() {
  const gl = MIV.gl, cv = MIV.cv;
  if (!gl || !MIV.wrap || !MIV.wrap.isConnected) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; MIV.ov.width = w; MIV.ov.height = h; }
  gl.viewport(0, 0, w, h); gl.clearColor(.13, .15, .16, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const C = mivCam(), M = MIV.M;
  if (M) {
    gl.useProgram(MIV.pr); gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(MIV.U.uPV, false, new Float32Array(C.PV)); gl.uniform3f(MIV.U.uE, C.E[0], C.E[1], C.E[2]);
    const L = [.45, .35, .82], l = Math.hypot(...L); gl.uniform3f(MIV.U.uL, L[0] / l, L[1] / l, L[2] / l);
    gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
    const A = MIV.A, st = M.st * 4;
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, st, 0);
    if (A.n >= 0) { gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, st, 12); }
    if (A.uv >= 0) { gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, st, 24); }
    gl.uniform1i(MIV.U.uT, 0); gl.activeTexture(gl.TEXTURE0);
    const it = M.IB instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, ib = M.IB.BYTES_PER_ELEMENT;
    for (const pass of [0, 1]) {
      if (pass) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      for (const [mi, , i0, cnt] of M.m.lod[0]) {
        const T = M.m.mats[mi] || { c: [.6, .6, .6, 1], am: 0 };
        if ((T.am === 2) !== !!pass || T.hide) continue;
        const tx = T.t && M.tex[T.t[0]];
        gl.bindTexture(gl.TEXTURE_2D, tx || null); gl.uniform1f(MIV.U.uHt, tx ? 1 : 0);
        gl.uniform4f(MIV.U.uC, T.c[0], T.c[1], T.c[2], T.c[3] ?? 1); gl.uniform1f(MIV.U.uAm, T.am || 0); gl.uniform1f(MIV.U.uAc, T.ac ?? .5);
        gl.drawElements(gl.TRIANGLES, cnt, it, i0 * ib);
      }
      if (pass) { gl.disable(gl.BLEND); gl.depthMask(true); }
    }
    for (const k of ['p', 'n', 'uv']) if (A[k] >= 0) gl.disableVertexAttribArray(A[k]);
  }
  // 标记（炮口、挂点、喷口……）画在上面一层 2D 画布
  const g = MIV.ov.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.scale(dpr, dpr);
  const pj = p => { const P = C.PV, x = P[0] * p[0] + P[4] * p[1] + P[8] * p[2] + P[12], y = P[1] * p[0] + P[5] * p[1] + P[9] * p[2] + P[13], ww = P[3] * p[0] + P[7] * p[1] + P[11] * p[2] + P[15]; return ww > 0 ? [(x / ww + 1) / 2 * C.w, (1 - y / ww) / 2 * C.h] : null; };
  if (M) {   // 前方箭头（模型 x 轴）
    const b = M.m.bb, a0 = pj([b[3], 0, 0]), a1 = pj([b[3] + (b[3] - b[0]) * .18, 0, 0]);
    if (a0 && a1) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(a1[0], a1[1]); g.stroke(); g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '12px sans-serif'; g.fillText('前', a1[0] + 4, a1[1] + 4); }
  }
  g.font = '11px sans-serif';
  for (const k of MIV.marks) {
    const q = pj(k.p);
    if (!q) continue;
    g.beginPath(); g.arc(q[0], q[1], k.r || 5, 0, Math.PI * 2); g.fillStyle = k.c || '#ffc24a'; g.globalAlpha = k.dim ? .45 : 1; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    if (k.t) { g.fillStyle = '#fff'; g.fillText(k.t, q[0] + 7, q[1] - 6); }
    g.globalAlpha = 1;
  }
}
// 点选：屏幕上一点 → 模型表面上离镜头最近的交点（模型坐标）和那里的法线
function mivRay(px, py) {
  const M = MIV.M;
  if (!M) return null;
  const C = mivCam(), nx = px / C.w * 2 - 1, ny = 1 - py / C.h * 2, d = [0, 1, 2].map(i => C.f[i] + C.s[i] * nx * C.fy * C.asp + C.u[i] * ny * C.fy), O = C.E, VB = M.VB, IB = M.IB, st = M.st;
  let best = 1e30, bi = -1;
  for (const [mi, , i0, cnt] of M.m.lod[0]) {
    const T = M.m.mats[mi];
    if (T && T.hide) continue;
    for (let t = i0; t < i0 + cnt; t += 3) {
      const a = IB[t] * st, b = IB[t + 1] * st, c = IB[t + 2] * st;
      const e1x = VB[b] - VB[a], e1y = VB[b + 1] - VB[a + 1], e1z = VB[b + 2] - VB[a + 2], e2x = VB[c] - VB[a], e2y = VB[c + 1] - VB[a + 1], e2z = VB[c + 2] - VB[a + 2];
      const px2 = d[1] * e2z - d[2] * e2y, py2 = d[2] * e2x - d[0] * e2z, pz2 = d[0] * e2y - d[1] * e2x, det = e1x * px2 + e1y * py2 + e1z * pz2;
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, tx = O[0] - VB[a], ty = O[1] - VB[a + 1], tz = O[2] - VB[a + 2], u = (tx * px2 + ty * py2 + tz * pz2) * iv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * iv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * iv;
      if (tt > 1e-4 && tt < best) { best = tt; bi = t; }
    }
  }
  if (bi < 0) return null;
  const a = IB[bi] * st, b = IB[bi + 1] * st, c = IB[bi + 2] * st, n = mimCross([VB[b] - VB[a], VB[b + 1] - VB[a + 1], VB[b + 2] - VB[a + 2]], [VB[c] - VB[a], VB[c + 1] - VB[a + 1], VB[c + 2] - VB[a + 2]]), nl = Math.hypot(...n) || 1;
  const R3 = v => Math.round(v * 1000) / 1000;
  return { p: [0, 1, 2].map(i => R3(O[i] + d[i] * best)), n: n.map(v => v / nl) };
}
// 导入：选的文件 → 模型记录（存库、登记）；o 同 mimBuild，另有 kind 'air' / 'veh'
async function mimImport(list, o) {
  const id = modNewId('u_');
  const G = await mimRead(await mimFiles(list));
  const rec = await mimBuild(G, { ...o, key: id });
  await modFilePut(id, rec);
  MOD.lib[id] = { k: 'mdl', nm: o.name || G.main.split('/').pop().replace(/\.(glb|gltf)$/i, ''), kind: o.kind || 'veh', len: rec.meta.len, tri: rec.meta.imp.tri, kb: Math.round(rec.bin.byteLength / 1024), credit: rec.meta.credit || null };
  modStoreSave();
  modReg(id, rec);
  return id;
}
