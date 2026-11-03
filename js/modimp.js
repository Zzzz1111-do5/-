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
  // —— 场景树 ——（NODES：走到的每个节点 { n 名字, p 父节点 }，VN：每个顶点属于哪个节点——编辑器里「按物体选」「扩到上一级」用）
  prog('网格');
  const P = [], N = [], UV = [], TRI = [], TM = [], NODES = [], VN = [];
  let nTri = 0;
  const visit = (ni, parentM, depth, pe) => {
    const nd = J.nodes[ni];
    if (!nd || depth > 64) return;
    const Mw = mimMul(parentM, nd.matrix ? nd.matrix.slice() : mimTRS(nd.translation, nd.rotation, nd.scale));
    const ei = NODES.push({ n: String(nd.name || (nd.mesh != null && J.meshes[nd.mesh] && J.meshes[nd.mesh].name) || '').slice(0, 60) || '物体 ' + ni, p: pe, m: 0, k: 0 }) - 1;
    if (nd.mesh != null && J.meshes[nd.mesh]) {
      NODES[ei].m = 1;
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
          VN.push(ei);
        }
        for (let i = 0; i + 2 < idx.length; i += 3) { const a0 = idx[i] + v0, b = idx[i + 1] + v0, c = idx[i + 2] + v0; TRI.push(a0, flip ? c : b, flip ? b : c); TM.push(mi); nTri++; }
      }
    }
    for (const c of nd.children || []) visit(c, Mw, depth + 1, ei);
  };
  const scn = J.scenes && J.scenes.length ? J.scenes[J.scene || 0] : { nodes: (J.nodes || []).map((_, i) => i).filter(i => !J.nodes.some(n => (n.children || []).includes(i))) };
  for (const r of scn.nodes || []) visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0, -1);
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
  // —— 物体（glTF 节点）：只留带网格的和它们的上级，编号重排 ——
  for (let i = NODES.length - 1; i >= 0; i--) if ((NODES[i].m || NODES[i].k) && NODES[i].p >= 0) NODES[NODES[i].p].k = 1;
  const nmap = new Int32Array(NODES.length).fill(-1), nodes = [];
  NODES.forEach((d, i) => { if (d.m || d.k) nmap[i] = nodes.push({ n: d.n, p: d.p >= 0 ? nmap[d.p] : -1 }) - 1; });
  // —— 连通块（编辑器里选部件的最小单位）——
  prog('分块');
  const vn = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) vn[v] = Math.max(0, nmap[VN[v]]);
  const PC = mimPieces(VB, 8, TRI, nv, vn), pnd = new Uint16Array(PC.n);
  for (let v = 0; v < nv; v++) pnd[PC.pv[v]] = Math.min(65535, vn[v]);
  // —— 拼成一块：顶点 | 索引 | 贴图 | 每顶点块号 | 每块物体号 ——
  const R3 = v => Math.round(v * 1e4) / 1e4, len = (bb[3] - bb[0]) * s, hgt = (bb[5] - bb[2]) * s;
  const ex = (J.asset && J.asset.extras) || {}, cl = t => String(t || '').replace(/\s*\(.*\)\s*$/, '').trim(), ur = t => (String(t || '').match(/\((https?:[^)]+)\)/) || [])[1] || '';
  const credit = ex.author || ex.title ? { title: ex.title || o.name, author: cl(ex.author), license: cl(ex.license), url: ex.source || ur(ex.author) || '', lurl: ur(ex.license) } : null;
  const meta = {
    v: 1, key: o.key, name: o.name, len: R3(len), hl: R3(o.hl > 0 ? o.hl : len), bb: [-len / 2, (bb[1] - oy) * s, 0, len / 2, (bb[4] - oy) * s, hgt].map(R3), zc: R3(hgt / 2),
    nv, st: 8, col: 0, it, mats: mats.map(M => ({ n: M.n, c: M.c.map(R3), t: M.t, nt: M.nt, ns: M.ns, mr: M.mr.map(R3), mrt: M.mrt, sg: M.sg && M.sg.map(R3), sgt: M.sgt, e: M.e.map(R3), et: M.et, ot: M.ot, am: M.am, ac: M.ac, ds: M.ds })),
    imgs: imgs.map(I => ({ m: I.mime, w: I.w, h: I.h })), parts: [], noz: null, lod: [G0, G0, G0], credit, imp: { tri: nTri, src: G.main }, nodes
  };
  return { meta, bin: mimPack(meta, VB, IB, imgs.map(I => I.bytes), PC.pv, PC.n, pnd) };
}
// 连通块：三角形连着的顶点、位置相同（量到 0.1 毫米）的顶点算一块——同一个物体里的才焊（vn：每个顶点的物体号，没有就整个模型一起焊）；
//   tag：切割时薄片上的顶点按切在哪一边记 ±1，两边位置相同也不焊（切开的两半才分得开）。按第一个顶点的顺序编号
function mimPieces(VB, st, TRI, nv, vn, tag) {
  const par = new Int32Array(nv);
  for (let i = 0; i < nv; i++) par[i] = i;
  const find = i => { let r = i; while (par[r] !== r) r = par[r]; while (par[i] !== r) { const n = par[i]; par[i] = r; i = n; } return r; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) par[b] = a; else par[a] = b; } };
  for (let t = 0; t + 2 < TRI.length; t += 3) { uni(TRI[t], TRI[t + 1]); uni(TRI[t + 1], TRI[t + 2]); }
  let cap = 16;
  while (cap < nv * 2) cap *= 2;
  const tab = new Int32Array(cap).fill(-1), qv = new Int32Array(nv * 3), Q = 1e4, mask = cap - 1;
  for (let v = 0; v < nv; v++) {
    const o = v * st, x = Math.round(VB[o] * Q), y = Math.round(VB[o + 1] * Q), z = Math.round(VB[o + 2] * Q), nd = vn ? vn[v] : 0, tg = tag ? tag[v] : 0;
    qv[v * 3] = x; qv[v * 3 + 1] = y; qv[v * 3 + 2] = z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(nd + 1, 2654435761) ^ Math.imul(tg + 2, 40503)) & mask;
    for (;;) {
      const u = tab[h];
      if (u < 0) { tab[h] = v; break; }
      if (qv[u * 3] === x && qv[u * 3 + 1] === y && qv[u * 3 + 2] === z && (!vn || vn[u] === nd) && (!tag || tag[u] === tg)) { uni(u, v); break; }
      h = (h + 1) & mask;
    }
  }
  const id = new Int32Array(nv).fill(-1), pv = new Uint32Array(nv);
  let n = 0;
  for (let v = 0; v < nv; v++) { const r = find(v); if (id[r] < 0) id[r] = n++; pv[v] = id[r]; }
  return { pv, n };
}
// 拼成游戏的模型数据：顶点 | 索引 | 贴图 | 每顶点块号（Uint16 / 32）| 每块物体号（Uint16），四字节对齐；改 meta 里各段的位置
function mimPack(meta, VB, IB, imgs, pv, pn, pnd) {
  const pad = n => (4 - n % 4) % 4, vbn = VB.byteLength, ibn = IB.byteLength;
  let o = vbn + ibn + pad(ibn);
  const imgOut = imgs.map((b, i) => { const r = { ...((meta.imgs || [])[i] || {}), o, n: b.length }; o += b.length + pad(b.length); return r; });
  const PV = pv ? (pn > 65535 ? Uint32Array.from(pv) : Uint16Array.from(pv)) : null, pvo = o;
  if (PV) o += PV.byteLength + pad(PV.byteLength);
  const PN = PV && pnd ? Uint16Array.from(pnd) : null, pno = o;
  if (PN) o += PN.byteLength + pad(PN.byteLength);
  const bin = new Uint8Array(o);
  bin.set(new Uint8Array(VB.buffer, VB.byteOffset, vbn), 0); bin.set(new Uint8Array(IB.buffer, IB.byteOffset, ibn), vbn);
  imgs.forEach((b, i) => bin.set(b, imgOut[i].o));
  if (PV) bin.set(new Uint8Array(PV.buffer), pvo);
  if (PN) bin.set(new Uint8Array(PN.buffer), pno);
  meta.vb = [0, vbn]; meta.ib = [vbn, ibn]; meta.it = IB.BYTES_PER_ELEMENT; meta.nv = VB.length / (meta.st || 8); meta.imgs = imgOut;
  if (PV) { meta.pv = [pvo, PV.byteLength]; meta.pvt = PV.BYTES_PER_ELEMENT; meta.pn = pn; } else { delete meta.pv; delete meta.pvt; delete meta.pn; }
  if (PN) meta.pnd = [pno, PN.byteLength]; else delete meta.pnd;
  return bin.buffer;
}
// 一个导入模型记录里的各段（视图，不拷贝）
function mimViews(rec) {
  const m = rec.meta, B = rec.bin, st = m.st || 8;
  const VB = new Float32Array(B, m.vb[0], m.vb[1] / 4), IB = m.it === 4 ? new Uint32Array(B, m.ib[0], m.ib[1] / 4) : new Uint16Array(B, m.ib[0], m.ib[1] / 2);
  return { m, st, nv: VB.length / st, VB, IB, imgs: (m.imgs || []).map(I => new Uint8Array(B, I.o, I.n)), pv: modPv(m, B), pnd: modPnd(m, B) };
}
// 老的导入（还没有块号）：补算一遍（不分物体）；改了返回 true
function mimEnsure(rec) {
  if (rec.meta.pv) return false;
  const V = mimViews(rec), PC = mimPieces(V.VB, V.st, V.IB, V.nv, null);
  rec.bin = mimPack(rec.meta, Float32Array.from(V.VB), V.IB.slice(), V.imgs.map(b => b.slice()), PC.pv, PC.n, null);
  return true;
}
// 切割薄片：沿平面把三角形真的切开——跨过平面、交线落在薄片范围里的三角形切成两三个，交线上的新顶点两边各一份；
//   平面正好经过原有顶点的（薄片放在模型本来的一圈边上），负的一边换用这些顶点的另一份——切开的两半不再连着，就成了两块。
//   P：c 中心、n 法线、u / v 薄片两条边的方向（都是单位向量，原始坐标）、hu / hv 半宽 / 半高（米）；only：只切这些块（Set，空 = 全部）。
//   切到的块按连通重新分：三角形最多的那块留原来的块号，其余排在后面（新块号）；map：原块号 → 拆出来的新块号（编辑器让它们继承原来的用途）
function mimCut(rec, P, only) {
  const V = mimViews(rec), m = V.m, st = V.st, VBo = V.VB, IBo = V.IB, pv0 = V.pv;
  if (!pv0) throw new Error('模型还没有分块');
  const E = 1e-5, nv0 = V.nv, dist = new Float64Array(nv0), use = pc => !only || !only.size || only.has(pc);
  for (let v = 0; v < nv0; v++) { const o = v * st; dist[v] = (VBo[o] - P.c[0]) * P.n[0] + (VBo[o + 1] - P.c[1]) * P.n[1] + (VBo[o + 2] - P.c[2]) * P.n[2]; }
  const sgn = v => dist[v] > E ? 1 : dist[v] < -E ? -1 : 0;
  const inRect = (x, y, z) => { const dx = x - P.c[0], dy = y - P.c[1], dz = z - P.c[2]; return Math.abs(dx * P.u[0] + dy * P.u[1] + dz * P.u[2]) <= P.hu + 1e-6 && Math.abs(dx * P.v[0] + dy * P.v[1] + dz * P.v[2]) <= P.hv + 1e-6; };
  const NV = [], npv = [], ntag = [];   // 新顶点：属性、原块号、切在哪一边（+1 / −1）
  const addV = (a, b, t, pc, sd) => {
    for (let k = 0; k < st; k++) { const x = VBo[a * st + k]; NV.push(x + (VBo[b * st + k] - x) * t); }
    if (st >= 6) { const q = NV.length - st, l = Math.hypot(NV[q + 3], NV[q + 4], NV[q + 5]) || 1; NV[q + 3] /= l; NV[q + 4] /= l; NV[q + 5] /= l; }
    npv.push(pc); ntag.push(sd);
    return nv0 + npv.length - 1;
  };
  const zdup = new Map();   // 平面上的原有顶点 → 负边用的那一份
  const zOk = v => v < nv0 && sgn(v) === 0 && use(pv0[v]) && inRect(VBo[v * st], VBo[v * st + 1], VBo[v * st + 2]);
  const S = (v, sd) => { if (sd >= 0 || !zOk(v)) return v; let d = zdup.get(v); if (d == null) { d = addV(v, v, 0, pv0[v], -1); zdup.set(v, d); } return d; };
  const ecut = new Map();   // 边上的交点（相邻的三角形共用）：[正边那一份, 负边那一份]
  const eV = (x, y, pc) => { const k = x < y ? x + ',' + y : y + ',' + x; let r = ecut.get(k); if (!r) { const t = dist[x] / (dist[x] - dist[y]); r = [addV(x, y, t, pc, 1), addV(x, y, t, pc, -1)]; ecut.set(k, r); } return r; };
  const groups = [], hit = new Set();
  let nSplit = 0;
  for (const [mi, pi, i0, cnt] of m.lod[0]) {
    const T = [];
    for (let t = i0; t + 2 < i0 + cnt; t += 3) {
      const a = IBo[t], b = IBo[t + 1], c = IBo[t + 2], pc = pv0[a], sa = sgn(a), sb = sgn(b), sc = sgn(c);
      const hasP = sa > 0 || sb > 0 || sc > 0, hasN = sa < 0 || sb < 0 || sc < 0;
      if (!use(pc) || !(hasP && hasN)) {   // 不跨平面的：在负边的，用到平面上的顶点换成负边那一份
        let neg = hasN;
        if (!hasP && !hasN) {   // 整个躺在平面里的：朝着正面的是下面那个东西的顶面（归负边），朝着负面的是上面那个东西的底面（归正边）
          const A = a * st, B = b * st, C = c * st, e1 = [VBo[B] - VBo[A], VBo[B + 1] - VBo[A + 1], VBo[B + 2] - VBo[A + 2]], e2 = [VBo[C] - VBo[A], VBo[C + 1] - VBo[A + 1], VBo[C + 2] - VBo[A + 2]], f = mimCross(e1, e2);
          neg = f[0] * P.n[0] + f[1] * P.n[1] + f[2] * P.n[2] > 0;
        }
        if (use(pc) && neg) { const q0 = S(a, -1), q1 = S(b, -1), q2 = S(c, -1); if (q0 !== a || q1 !== b || q2 !== c) hit.add(pc); T.push(q0, q1, q2); }
        else T.push(a, b, c);
        continue;
      }
      // 跨平面：交线（两个交点）的中点在薄片范围里才切
      const L = [[a, sa], [b, sb], [c, sc]], mid = [0, 0, 0];
      let nx = 0;
      for (let i = 0; i < 3; i++) {
        const [p, sp] = L[i], [q, sq] = L[(i + 1) % 3];
        if (sp === 0) { for (let k = 0; k < 3; k++) mid[k] += VBo[p * st + k]; nx++; }
        if (sp * sq < 0) { const t2 = dist[p] / (dist[p] - dist[q]); for (let k = 0; k < 3; k++) mid[k] += VBo[p * st + k] + (VBo[q * st + k] - VBo[p * st + k]) * t2; nx++; }
      }
      if (!nx || !inRect(mid[0] / nx, mid[1] / nx, mid[2] / nx)) { T.push(a, b, c); continue; }
      nSplit++; hit.add(pc);
      // 单独的那个顶点转到最前面（在平面上的那个；或者另两个同在一边时的这一个），轮换不改绕向
      const zi = L.findIndex(q => q[1] === 0), k0 = zi >= 0 ? zi : L.findIndex((q, i) => L[(i + 1) % 3][1] === L[(i + 2) % 3][1]);
      const [p0, s0] = L[k0], [p1, s1] = L[(k0 + 1) % 3], [p2, s2] = L[(k0 + 2) % 3];
      if (s0 === 0) {   // p0 在平面上，p1、p2 一正一负：切成两个
        const [xp, xn] = eV(p1, p2, pc);
        T.push(S(p0, s1), p1, s1 > 0 ? xp : xn); T.push(S(p0, s2), s2 > 0 ? xp : xn, p2);
      } else {   // p0 在一边，p1、p2 在另一边：切成三个
        const [ap, an] = eV(p0, p1, pc), [bp, bn] = eV(p0, p2, pc), a0 = s0 > 0 ? ap : an, a1 = s0 > 0 ? an : ap, b0 = s0 > 0 ? bp : bn, b1 = s0 > 0 ? bn : bp;
        T.push(p0, a0, b0); T.push(a1, p1, p2); T.push(a1, p2, b1);
      }
    }
    groups.push([mi, pi, T]);
  }
  if (!nSplit && !zdup.size) return { rec, n: 0, map: new Map() };
  // 新的顶点数组、块号
  const nv = nv0 + npv.length, VB = new Float32Array(nv * st);
  VB.set(VBo, 0); VB.set(NV, nv0 * st);
  const pvA = new Uint32Array(nv); pvA.set(pv0, 0); pvA.set(npv, nv0);
  const tag = new Int8Array(nv);
  ntag.forEach((sd, i) => { tag[nv0 + i] = sd; });
  for (const v of zdup.keys()) tag[v] = 1;
  // 切到的块按连通重新分（不跨原来的块焊；薄片上的顶点按边记的 ±1 不焊在一起）
  const sub = [], subIdx = new Int32Array(nv).fill(-1);
  for (let v = 0; v < nv; v++) if (hit.has(pvA[v])) subIdx[v] = sub.push(v) - 1;
  const sVB = new Float32Array(sub.length * 3), sTag = new Int8Array(sub.length), sOwn = new Uint32Array(sub.length), TRIc = [];
  sub.forEach((v, i) => { sVB[i * 3] = VB[v * st]; sVB[i * 3 + 1] = VB[v * st + 1]; sVB[i * 3 + 2] = VB[v * st + 2]; sTag[i] = tag[v]; sOwn[i] = pvA[v]; });
  for (const g of groups) { const T = g[2]; for (let t = 0; t < T.length; t += 3) if (hit.has(pvA[T[t]])) TRIc.push(subIdx[T[t]], subIdx[T[t + 1]], subIdx[T[t + 2]]); }
  const sPC = mimPieces(sVB, 3, TRIc, sub.length, sOwn, sTag), triN = new Map(), own = new Map(), byOrig = new Map();
  for (let t = 0; t < TRIc.length; t += 3) { const k = sPC.pv[TRIc[t]]; triN.set(k, (triN.get(k) || 0) + 1); }
  sub.forEach((v, i) => { if (!own.has(sPC.pv[i])) own.set(sPC.pv[i], pvA[v]); });
  for (const [k, o] of own) { let L = byOrig.get(o); if (!L) byOrig.set(o, L = []); L.push(k); }
  // 每个原块拆出来的几块：三角形最多的留原块号，其余（有三角形的）给新块号
  let n = m.pn;
  const rename = new Map(), map = new Map(), pnd0 = V.pnd, pndN = [];
  for (const [o, L] of byOrig) {
    L.sort((x, y) => (triN.get(y) || 0) - (triN.get(x) || 0) || x - y);
    for (const k of L) {
      if (k === L[0] || !triN.get(k)) { rename.set(k, o); continue; }
      rename.set(k, n);
      if (!map.has(o)) map.set(o, []);
      map.get(o).push(n);
      pndN.push(pnd0 ? pnd0[o] : 0);
      n++;
    }
  }
  sub.forEach((v, i) => { pvA[v] = rename.get(sPC.pv[i]); });
  // 索引：按原来的材质段放；顶点多了超过 65535 换 32 位索引
  const tot = groups.reduce((s2, g) => s2 + g[2].length, 0), IB = nv > 65535 ? new Uint32Array(tot) : new Uint16Array(tot), G0 = [];
  let o = 0;
  for (const [mi, pi, T] of groups) { if (!T.length) continue; G0.push([mi, pi, o, T.length]); IB.set(T, o); o += T.length; }
  const meta = { ...m, lod: [G0, G0, G0] }, pnd = pnd0 ? Uint16Array.from([...pnd0, ...pndN]) : null;
  if (meta.imp) meta.imp = { ...meta.imp, tri: tot / 3 };
  return { rec: { meta, bin: mimPack(meta, VB, IB, V.imgs.map(b2 => b2.slice()), pvA, n, pnd) }, n: nSplit + zdup.size, map };
}
// 已导入的模型转个方向（朝向不对时不用重新导入）：ax 'z' 绕竖轴转 90°、'y' 抬头 / 低头 90°、'x' 侧滚 90°、'fz' 前后掉头；转完重新居中、放到地上，保持全长。
//   返回 { xf 点怎么变（原始坐标）, xd 方向怎么变 }：编辑器拿它把已经点好的位置、转轴一起转过去
function mimTurn(rec, ax) {
  const m = rec.meta, VB = new Float32Array(rec.bin, m.vb[0], m.vb[1] / 4), n = m.vb[1] / 32;
  const R = { z: v => [-v[1], v[0], v[2]], fz: v => [-v[0], -v[1], v[2]], y: v => [-v[2], v[1], v[0]], x: v => [v[0], -v[2], v[1]] }[ax];
  if (!R) return null;
  for (let i = 0; i < n; i++) { const o = i * 8, p = R([VB[o], VB[o + 1], VB[o + 2]]), q = R([VB[o + 3], VB[o + 4], VB[o + 5]]); VB.set(p, o); VB.set(q, o + 3); }
  const bb = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const x = VB[i * 8 + k]; if (x < bb[k]) bb[k] = x; if (x > bb[k + 3]) bb[k + 3] = x; }
  const s = m.len > 0 ? m.len / Math.max(1e-6, bb[3] - bb[0]) : 1, ox = (bb[0] + bb[3]) / 2, oy = (bb[1] + bb[4]) / 2, oz = bb[2];
  for (let i = 0; i < n; i++) { const o = i * 8; VB[o] = (VB[o] - ox) * s; VB[o + 1] = (VB[o + 1] - oy) * s; VB[o + 2] = (VB[o + 2] - oz) * s; }
  const R3 = v => Math.round(v * 1e4) / 1e4, hgt = (bb[5] - bb[2]) * s;
  m.bb = [-m.len / 2, (bb[1] - oy) * s, 0, m.len / 2, (bb[4] - oy) * s, hgt].map(R3); m.zc = R3(hgt / 2);
  return { xf: p => { const q = R(p); return [(q[0] - ox) * s, (q[1] - oy) * s, (q[2] - oz) * s]; }, xd: R };
}
// 内置模型的原始数据（预览用）：已经解码过的（base64 解完就放掉了）重新取一遍 js/mdl/<键>.js
async function mimModelData(key) {
  if (key.startsWith('u_')) {   // 导入的：读存着的原件（游戏里解码时删块、拆部件改的是拷贝）；老的导入补上分块
    const rec = await modFileGet(key);
    if (!rec) throw new Error('模型文件不见了');
    if (mimEnsure(rec)) { await modFilePut(key, rec); modReg(key, rec); }
    return { meta: rec.meta, bin: new Uint8Array(rec.bin), rec };
  }
  const D = typeof V3G === 'object' && V3G.def[key];
  if (D && D.bin) return { meta: modClone(D.meta), bin: new Uint8Array(D.bin.slice(0)) };
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
//   pt：导入模型的部件显示（编辑器 modui.js mdxPtSync 给）——codes 每个顶点的用途代码（mod.js MOD_PTR 的下标，选中的 + 10）、off 删过以后的原点、
//   T / G / Ma / Mb / Rt / Qt 炮塔、炮管、机枪塔、机枪、主旋翼、尾桨的转轴 { p, a }（删过以后的坐标），ta / el / my / me / rs 试转的角度，gh 删掉的半透明画出来，tint 按用途上色；
//   gz 切割薄片 { c, n, u, v, hu, hv }；deco 叠加的线、圆、点（转轴、圆心定位器）；box 框选（编辑器给的回调，拖出的方框交给它）
const MIV = { wrap: null, cv: null, ov: null, gl: null, pr: null, A: {}, U: {}, M: null, key: null, yaw: 2.3, pit: .32, dist: 30, tgt: [0, 0, 1], marks: [], deco: [], pick: null, msg: '', ld: 0, pt: null, gz: null, box: null, boxR: null, hz: null, hzAnim: true, hp: null, raf: 0 };   // hz：设计中的热浪源（模型坐标，编辑器给），预览里用游戏同一套三维热浪着色器画、一直动
const MIV_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 uv; attribute float r;
uniform mat4 uPV; uniform vec3 uOff, uTP, uTA, uGP, uGA, uMP, uMA, uBP, uBA, uRP, uRA, uQP, uQA; uniform float uTa, uEl, uMy, uMe, uRs, uGh;
varying vec3 vN, vP; varying vec2 vUv; varying float vR;
vec3 rotA(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1. - c); }
void main() {
  float rr = r - 10. * step(9.5, r);
  vec3 q = p - uOff, m = n;
  if (rr > 1.5 && rr < 2.5) { q = uGP + rotA(q - uGP, uGA, uEl); m = rotA(m, uGA, uEl); }
  if (rr > 7.5 && rr < 8.5) { q = uBP + rotA(q - uBP, uBA, uMe); m = rotA(m, uBA, uMe); }   // 机枪：先绕机枪俯仰轴抬，再随机枪塔转
  if (rr > 6.5 && rr < 8.5) { q = uMP + rotA(q - uMP, uMA, uMy); m = rotA(m, uMA, uMy); }
  if ((rr > .5 && rr < 2.5) || (rr > 6.5 && rr < 8.5)) { q = uTP + rotA(q - uTP, uTA, uTa); m = rotA(m, uTA, uTa); }
  if (rr > 3.5 && rr < 4.5) { q = uRP + rotA(q - uRP, uRA, uRs); m = rotA(m, uRA, uRs); }
  if (rr > 4.5 && rr < 5.5) { q = uQP + rotA(q - uQP, uQA, uRs * 3.); m = rotA(m, uQA, uRs * 3.); }
  vN = m; vP = q; vUv = uv; vR = r;
  gl_Position = uPV * vec4(q, 1.);
  if (abs(step(5.5, rr) * (1. - step(6.5, rr)) - uGh) > .5) gl_Position = vec4(2., 2., 2., 1.);   // 删掉的块（6）平时不画；「显示删掉的」那一遍只画它们
}`;
const MIV_FS = `precision mediump float; uniform sampler2D uT; uniform float uHt, uAm, uAc, uTint, uGf, uSolid; uniform vec4 uC; uniform vec3 uL, uE; varying vec3 vN, vP; varying vec2 vUv; varying float vR;
void main() {
  if (uSolid > .5) { gl_FragColor = uC; return; }
  vec4 c = uC; if (uHt > .5) c *= texture2D(uT, vUv);
  if (uAm > .5 && uAm < 1.5 && c.a < uAc && uGf < .5) discard;
  vec3 N = normalize(vN), V = normalize(uE - vP); if (dot(N, V) < 0.) N = -N;
  float d = max(dot(N, uL), 0.), h = pow(max(dot(N, normalize(uL + V)), 0.), 32.), sky = .5 + .5 * N.z;
  vec3 col = c.rgb * (.22 + .3 * sky + .62 * d) + .1 * h;
  float sl = step(9.5, vR), rr = vR - 10. * sl;
  if (uTint > .5 && rr > .5) col = mix(col, rr < 1.5 ? vec3(.25, .55, 1.) : rr < 2.5 ? vec3(1., .5, .12) : rr < 3.5 ? vec3(.78, .45, 1.) : rr < 4.5 ? vec3(.2, .9, 1.) : rr < 5.5 ? vec3(.25, .85, .6) : rr < 6.5 ? vec3(1., .22, .2) : rr < 7.5 ? vec3(1., .42, .72) : vec3(.95, .22, .55), .5);
  if (sl > .5) col = mix(col, vec3(1., .86, .15), .62);
  gl_FragColor = vec4(col, uGf > .5 ? .28 : uAm > 1.5 ? c.a : 1.);
}`;
const MIV_ROLE_C = ['', '#3f8cff', '#ff8a1f', '#c77dff', '#33e6ff', '#40d99a', '#ff3b30', '#ff6bb8', '#f2388c'];   // 叠加层上各用途的颜色（同着色器）
const mivRot = (v, c, a, t) => { const x = v[0] - c[0], y = v[1] - c[1], z = v[2] - c[2], cs = Math.cos(t), sn = Math.sin(t), d = (a[0] * x + a[1] * y + a[2] * z) * (1 - cs);
  return [c[0] + x * cs + (a[1] * z - a[2] * y) * sn + a[0] * d, c[1] + y * cs + (a[2] * x - a[0] * z) * sn + a[1] * d, c[2] + z * cs + (a[0] * y - a[1] * x) * sn + a[2] * d]; };
// 预览里试转的变换（同着色器）：q 是减过原点的坐标、rr 用途；inv 反过来（射线换到没转过的坐标里求交）；dir 只转方向
function mivXf(q, rr, inv, dir) {
  const S = MIV.pt, Z = [0, 0, 0];
  if (!S || !rr) return q;
  const R = (A, t) => { if (A && t) q = mivRot(q, dir ? Z : A.p, A.a, t); };
  const onT = rr === 1 || rr === 2 || rr === 7 || rr === 8;
  if (!inv) {
    if (rr === 2) R(S.G, S.el);
    if (rr === 8) R(S.Mb, S.me);
    if (rr === 7 || rr === 8) R(S.Ma, S.my);
    if (onT) R(S.T, S.ta);
    if (rr === 4) R(S.Rt, S.rs);
    if (rr === 5) R(S.Qt, S.rs * 3);
  } else {
    if (onT) R(S.T, -S.ta);
    if (rr === 7 || rr === 8) R(S.Ma, -S.my);
    if (rr === 8) R(S.Mb, -S.me);
    if (rr === 2) R(S.G, -S.el);
    if (rr === 4) R(S.Rt, -S.rs);
    if (rr === 5) R(S.Qt, -S.rs * 3);
  }
  return q;
}
function mivInit() {
  if (MIV.wrap) return MIV.wrap;
  const w = MIV.wrap = document.createElement('div');
  w.className = 'miv';
  w.innerHTML = '<canvas class="miv-gl"></canvas><canvas class="miv-ov"></canvas><div class="miv-msg"></div>';
  MIV.cv = w.querySelector('.miv-gl'); MIV.ov = w.querySelector('.miv-ov');
  const gl = MIV.gl = MIV.cv.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { w.querySelector('.miv-msg').textContent = '这个浏览器不能预览 3D（没有 WebGL）'; return w; }
  MIV.u32 = !!gl.getExtension('OES_element_index_uint');
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('预览着色器', gl.getShaderInfoLog(s)); return s; };
  const pr = MIV.pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, MIV_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, MIV_FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.warn('预览着色器链接失败', gl.getProgramInfoLog(pr));
  for (const k of ['p', 'n', 'uv', 'r']) MIV.A[k] = gl.getAttribLocation(pr, k);
  for (const k of ['uPV', 'uT', 'uHt', 'uAm', 'uAc', 'uC', 'uL', 'uE', 'uOff', 'uTP', 'uTA', 'uGP', 'uGA', 'uMP', 'uMA', 'uBP', 'uBA', 'uRP', 'uRA', 'uQP', 'uQA', 'uTa', 'uEl', 'uMy', 'uMe', 'uRs', 'uGh', 'uGf', 'uTint', 'uSolid']) MIV.U[k] = gl.getUniformLocation(pr, k);
  MIV.gzb = gl.createBuffer();
  // 拖动转、滚轮缩放、右键（或按住 Shift）拖动平移；两个手指：捏合缩放、一起挪平移；没怎么动就松开算点了一下；框选打开时左键拖出方框
  const pts = new Map();
  let dn = null, pin = null;
  const mid = () => { const L = [...pts.values()]; return { x: (L[0].x + L[1].x) / 2, y: (L[0].y + L[1].y) / 2, d: Math.hypot(L[0].x - L[1].x, L[0].y - L[1].y) }; };
  const pan = (dx, dy) => { const C = mivCam(), k = MIV.dist * .0016; for (let i = 0; i < 3; i++) MIV.tgt[i] += (-C.s[i] * dx + C.u[i] * dy) * k; };
  MIV.cv.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { MIV.cv.setPointerCapture(e.pointerId); } catch (err) { /* 已经松开了 */ }
    if (pts.size === 2) { pin = mid(); dn = null; MIV.boxR = null; return; }
    if (pts.size > 2) return;
    const r = MIV.cv.getBoundingClientRect();
    dn = { x: e.clientX, y: e.clientY, x0: e.clientX - r.left, y0: e.clientY - r.top, b: e.button, sh: e.shiftKey, mv: 0, box: !!MIV.box && e.button === 0 && !e.shiftKey };
  });
  MIV.cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pin && pts.size >= 2) { const q = mid(); if (q.d > 10 && pin.d > 10) MIV.dist = clamp(MIV.dist * pin.d / q.d, .3, 3000); pan(q.x - pin.x, q.y - pin.y); pin = q; mivDraw(); return; }
    if (!dn) return;
    const dx = e.clientX - dn.x, dy = e.clientY - dn.y; dn.x = e.clientX; dn.y = e.clientY; dn.mv += Math.abs(dx) + Math.abs(dy);
    if (dn.box) { if (dn.mv >= 5) { const r = MIV.cv.getBoundingClientRect(); MIV.boxR = [dn.x0, dn.y0, e.clientX - r.left, e.clientY - r.top]; mivDraw(); } return; }
    if (dn.b === 2 || dn.sh) pan(dx, dy);
    else { MIV.yaw -= dx * .008; MIV.pit = clamp(MIV.pit + dy * .008, -1.45, 1.45); }
    mivDraw();
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pin = null;
    const d = dn; dn = null;
    if (!d || e.type === 'pointercancel') { MIV.boxR = null; return; }
    if (d.box && MIV.boxR) { const B = MIV.boxR; MIV.boxR = null; if (typeof MIV.box === 'function') MIV.box([Math.min(B[0], B[2]), Math.min(B[1], B[3]), Math.max(B[0], B[2]), Math.max(B[1], B[3])], e); mivDraw(); return; }
    if (d.mv < 5 && d.b === 0 && MIV.pick) { const r = MIV.cv.getBoundingClientRect(), h = mivRay(e.clientX - r.left, e.clientY - r.top, { del: MIV.pt && MIV.pt.gh }); if (h) MIV.pick(h, e); }
  };
  MIV.cv.addEventListener('pointerup', up);
  MIV.cv.addEventListener('pointercancel', up);
  MIV.cv.style.touchAction = 'none';
  MIV.cv.addEventListener('contextmenu', e => e.preventDefault());
  MIV.cv.addEventListener('wheel', e => { e.preventDefault(); MIV.dist = clamp(MIV.dist * Math.exp(e.deltaY * .0012), .3, 3000); mivDraw(); }, { passive: false });
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
    let BP = null;   // 游戏里的模型：加工完按连通块分块（mod.js modPieces，和游戏里解码时同一套，块号对得上），编辑器里也能选块、删、改造
    if (!key.startsWith('u_') && key !== 'army' && typeof v3gPrep === 'function') {
      try { MODX.noB = true; const R = v3gPrep(key, m, { key, meta: m, ready: false }, VB, IB); if (R) { VB = R.VB; IB = R.IB; } } catch (e) { console.warn('预览加工失败', e); } finally { MODX.noB = false; }
      if (typeof modPieces === 'function') try { BP = modPieces(m, VB, IB); } catch (e) { console.warn('分块失败', e); }
    }
    if (IB instanceof Uint32Array && !MIV.u32) throw new Error('显卡不支持 32 位索引');
    if (MIV.M) mivFree(MIV.M);
    const M = { m, VB, IB, st: (m.st || 8), tex: [], nv: VB.length / (m.st || 8), pv: D.rec ? modPv(m, D.rec.bin) : null, pnd: D.rec ? modPnd(m, D.rec.bin) : null, pn: m.pn || 0, nodes: m.nodes || null };
    if (BP) {   // 「物体」= 模型自带的部件（炮塔、炮管、车轮、起落架……）和车体 / 机身：按物体选一下就选上整个炮塔
      const PN = { tur: '炮塔', gun: '炮管', gear: '起落架', rotor: '主旋翼', trotor: '尾桨', era: '反应装甲块', wheel: '车轮', noz: '尾喷口调节片', pet: '尾喷口调节片', fold: '折叠外翼', bay: '弹舱门', door: '舱门', ramp: '跳板' };
      const parts = m.parts || [], nodes = [{ n: '车体 / 机身', p: -1 }, ...parts.map((q, i) => ({ n: (PN[q.n] || PN[q.k] || q.n || '部件') + '（' + (q.n || i) + '）', p: 0 }))], pnd = new Uint16Array(BP.pn);
      for (let v = 0; v < M.nv; v++) { const pi = BP.vp[v]; if (pi !== -9) pnd[BP.pv[v]] = pi >= 0 ? pi + 1 : 0; }
      Object.assign(M, { pv: BP.pv, pn: BP.pn, pnd, nodes, bi: true, VB0: VB.slice(), IB0: IB.slice(), lod0: JSON.parse(JSON.stringify(m.lod)), mats0: JSON.parse(JSON.stringify(m.mats)) });
      M.VB = VB = VB.slice(); M.IB = IB = IB.slice();
    }
    M.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, VB, gl.STATIC_DRAW);
    M.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IB, gl.STATIC_DRAW);
    if (M.pv) { M.rb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, M.rb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(M.nv), gl.DYNAMIC_DRAW); }
    MIV.M = M; MIV.pt = null;
    const b = m.bb;
    if (MIV.keepCam !== key) { MIV.tgt = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; MIV.dist = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1.25 + .5; }
    MIV.keepCam = null;
    mivMsg(''); mivDraw();
    if (typeof MIV.onLoad === 'function') MIV.onLoad(key);   // 编辑器：模型原来的喷口、部件这些要等读出来才知道
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
function mivFree(M) { const gl = MIV.gl; gl.deleteBuffer(M.vb); gl.deleteBuffer(M.ib); if (M.rb) gl.deleteBuffer(M.rb); for (const t of M.tex) if (t) gl.deleteTexture(t); }
// 部件显示（编辑器给）：codes 换了才重传
function mivSetPt(o) {
  const M = MIV.M;
  if (M && M.rb && o && o.codes && o.codes.length === M.nv && (!MIV.pt || MIV.pt.codes !== o.codes)) { const gl = MIV.gl; gl.bindBuffer(gl.ARRAY_BUFFER, M.rb); gl.bufferData(gl.ARRAY_BUFFER, o.codes, gl.DYNAMIC_DRAW); }
  MIV.pt = o;
  mivDraw();
}
// 镜头：绕目标点转（模型坐标 z 朝上）
function mivCam() {
  const cp = Math.cos(MIV.pit), E = [MIV.tgt[0] + MIV.dist * cp * Math.cos(MIV.yaw), MIV.tgt[1] + MIV.dist * cp * Math.sin(MIV.yaw), MIV.tgt[2] + MIV.dist * Math.sin(MIV.pit)];
  const nz = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  const f = nz([MIV.tgt[0] - E[0], MIV.tgt[1] - E[1], MIV.tgt[2] - E[2]]), s = nz(mimCross(f, [0, 0, 1])), u = mimCross(s, f);
  const cv = MIV.cv, w = cv.clientWidth || 300, h = cv.clientHeight || 200, asp = w / h, fy = Math.tan(20 * Math.PI / 180), n = Math.max(.02, MIV.dist * .01), fr = MIV.dist * 20 + 100;
  const V = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -(s[0] * E[0] + s[1] * E[1] + s[2] * E[2]), -(u[0] * E[0] + u[1] * E[1] + u[2] * E[2]), f[0] * E[0] + f[1] * E[1] + f[2] * E[2], 1];
  const Pm = [1 / (fy * asp), 0, 0, 0, 0, 1 / fy, 0, 0, 0, 0, -(fr + n) / (fr - n), -1, 0, 0, -2 * fr * n / (fr - n), 0];
  return { E, f, s, u, w, h, asp, fy, PV: mimMul(Pm, V) };
}
// 模型坐标的一点 → 预览画布上的位置（CSS 像素；在镜头后面返回 null）
function mivProj(p, C = mivCam()) {
  const P = C.PV, x = P[0] * p[0] + P[4] * p[1] + P[8] * p[2] + P[12], y = P[1] * p[0] + P[5] * p[1] + P[9] * p[2] + P[13], w = P[3] * p[0] + P[7] * p[1] + P[11] * p[2] + P[15];
  return w > 0 ? [(x / w + 1) / 2 * C.w, (1 - y / w) / 2 * C.h] : null;
}
// 切割薄片的四个角
const mivGzCorners = g => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [0, 1, 2].map(k => g.c[k] + g.u[k] * g.hu * a + g.v[k] * g.hv * b));
function mivDraw() {
  const gl = MIV.gl, cv = MIV.cv;
  if (!gl || !MIV.wrap || !MIV.wrap.isConnected) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; MIV.ov.width = w; MIV.ov.height = h; }
  gl.viewport(0, 0, w, h); gl.clearColor(.13, .15, .16, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const C = mivCam(), M = MIV.M, A = MIV.A, U = MIV.U, S = MIV.pt;
  gl.useProgram(MIV.pr); gl.enable(gl.DEPTH_TEST);
  gl.uniformMatrix4fv(U.uPV, false, new Float32Array(C.PV)); gl.uniform3f(U.uE, C.E[0], C.E[1], C.E[2]);
  { const L = [.45, .35, .82], l = Math.hypot(...L); gl.uniform3f(U.uL, L[0] / l, L[1] / l, L[2] / l); }
  const ax = (uP, uA, X) => { gl.uniform3fv(uP, X ? X.p : [0, 0, 0]); gl.uniform3fv(uA, X ? X.a : [0, 0, 1]); };
  ax(U.uTP, U.uTA, S && S.T); ax(U.uGP, U.uGA, S && S.G); ax(U.uMP, U.uMA, S && S.Ma); ax(U.uBP, U.uBA, S && S.Mb); ax(U.uRP, U.uRA, S && S.Rt); ax(U.uQP, U.uQA, S && S.Qt);
  gl.uniform1f(U.uTa, S && S.T ? S.ta || 0 : 0); gl.uniform1f(U.uEl, S && S.G ? S.el || 0 : 0); gl.uniform1f(U.uMy, S && S.Ma ? S.my || 0 : 0); gl.uniform1f(U.uMe, S && S.Mb ? S.me || 0 : 0); gl.uniform1f(U.uRs, S ? S.rs || 0 : 0);
  gl.uniform1f(U.uTint, S && S.tint ? 1 : 0); gl.uniform1f(U.uSolid, 0); gl.uniform1f(U.uGh, 0); gl.uniform1f(U.uGf, 0);   // 顶点、片元着色器各用一个（同名 uniform 两边精度不同链接不上）
  if (M) {
    gl.uniform3fv(U.uOff, S && S.off ? S.off : [0, 0, 0]);
    gl.bindBuffer(gl.ARRAY_BUFFER, M.vb);
    const st = M.st * 4;
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, st, 0);
    if (A.n >= 0) { gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, st, 12); }
    if (A.uv >= 0) { gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, st, 24); }
    if (A.r >= 0) { if (M.rb && S && S.codes) { gl.bindBuffer(gl.ARRAY_BUFFER, M.rb); gl.enableVertexAttribArray(A.r); gl.vertexAttribPointer(A.r, 1, gl.FLOAT, false, 4, 0); } else { gl.disableVertexAttribArray(A.r); gl.vertexAttrib1f(A.r, 0); } }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib);
    gl.uniform1i(U.uT, 0); gl.activeTexture(gl.TEXTURE0);
    const it = M.IB instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, ib = M.IB.BYTES_PER_ELEMENT;
    for (const pass of [0, 1, 2]) {   // 不透明、半透明、删掉的（半透明画出来）
      if (pass === 2 && !(S && S.gh)) continue;
      if (pass) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      gl.uniform1f(U.uGh, pass === 2 ? 1 : 0); gl.uniform1f(U.uGf, pass === 2 ? 1 : 0);
      for (const [mi, , i0, cnt] of M.m.lod[0]) {
        const T = M.m.mats[mi] || { c: [.6, .6, .6, 1], am: 0 };
        if (T.hide || (pass < 2 && (T.am === 2) !== (pass === 1))) continue;
        const tx = T.t && M.tex[T.t[0]];
        gl.bindTexture(gl.TEXTURE_2D, tx || null); gl.uniform1f(U.uHt, tx ? 1 : 0);
        gl.uniform4f(U.uC, T.c[0], T.c[1], T.c[2], T.c[3] ?? 1); gl.uniform1f(U.uAm, T.am || 0); gl.uniform1f(U.uAc, T.ac ?? .5);
        gl.drawElements(gl.TRIANGLES, cnt, it, i0 * ib);
      }
      if (pass) { gl.disable(gl.BLEND); gl.depthMask(true); }
    }
    gl.uniform1f(U.uGh, 0); gl.uniform1f(U.uGf, 0);
    for (const k of ['p', 'n', 'uv', 'r']) if (A[k] >= 0) gl.disableVertexAttribArray(A[k]);
  }
  // 切割薄片：半透明的面（被模型挡住的部分看得出它从哪里穿过模型），两面都画
  if (MIV.gz && A.p >= 0) {
    const Q = mivGzCorners(MIV.gz), g = MIV.gz, V = new Float32Array(32);
    Q.forEach((q, i) => V.set([q[0], q[1], q[2], g.n[0], g.n[1], g.n[2], 0, 0], i * 8));
    gl.bindBuffer(gl.ARRAY_BUFFER, MIV.gzb); gl.bufferData(gl.ARRAY_BUFFER, V, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 32, 0);
    if (A.n >= 0) gl.disableVertexAttribArray(A.n);
    if (A.uv >= 0) gl.disableVertexAttribArray(A.uv);
    if (A.r >= 0) { gl.disableVertexAttribArray(A.r); gl.vertexAttrib1f(A.r, 0); }
    gl.uniform3f(U.uOff, 0, 0, 0); gl.uniform1f(U.uSolid, 1); gl.uniform4f(U.uC, .25, .75, 1, .3);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.uniform1f(U.uSolid, 0);
    gl.disableVertexAttribArray(A.p);
  }
  // 三维热浪（v3det.js 同一套着色器）：先把画好的模型拷进贴图，再画热气柱的盒子；有热浪就一直动
  if (MIV.hz && MIV.hz.length && typeof v3dhProgram === 'function' && MIV.hp !== false) {
    try {
      if (!MIV.hp) { MIV.hp = v3dhProgram(gl); MIV.hb = gl.createBuffer(); MIV.ht = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, MIV.ht); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); }
      const Lh = MIV.hz.filter(e => e && e.r > 0 && e.len > 0 && Math.hypot(...e.d) > 1e-6).map(e => { const l = Math.hypot(...e.d); return { c: e.p, d: e.d.map(x => x / l), r: e.r, len: e.len, k: e.k ?? 1, o: { sp: e.sp ?? 2.4, rise: e.rise || 0, tb: e.tb ?? 1, spd: e.spd ?? 1, warm: e.warm ?? 1, seed: e.p[0] * 3.7 % 50 } }; });
      if (Lh.length) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, MIV.ht); gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);
        const PV = C.PV, prj = p => { const x = PV[0] * p[0] + PV[4] * p[1] + PV[8] * p[2] + PV[12], y = PV[1] * p[0] + PV[5] * p[1] + PV[9] * p[2] + PV[13], ww = PV[3] * p[0] + PV[7] * p[1] + PV[11] * p[2] + PV[15]; return ww > .01 ? [(x / ww * .5 + .5) * w, (y / ww * .5 + .5) * h] : null; };
        v3dhDraw(gl, MIV.hp, MIV.hb, v3dhBuild(Lh, C.E, prj), new Float32Array(PV), C.E, 1, w, h, performance.now() / 1000);
        gl.activeTexture(gl.TEXTURE0);
        if (MIV.hzAnim && !MIV.raf) MIV.raf = requestAnimationFrame(() => { MIV.raf = 0; if (MIV.wrap && MIV.wrap.isConnected) mivDraw(); });
      }
    } catch (e) { MIV.hp = false; console.warn('预览热浪不可用', e); }
  }
  // 叠加层（2D）：前方箭头、标记、转轴、圆、切割薄片的边框、框选
  const g = MIV.ov.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.scale(dpr, dpr);
  const pj = p => mivProj(p, C);
  if (M) {   // 前方箭头（模型 x 轴）
    const b = M.m.bb, a0 = pj([b[3], 0, 0]), a1 = pj([b[3] + (b[3] - b[0]) * .18, 0, 0]);
    if (a0 && a1) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(a1[0], a1[1]); g.stroke(); g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '12px sans-serif'; g.fillText('前', a1[0] + 4, a1[1] + 4); }
  }
  if (MIV.gz) {
    const Q = mivGzCorners(MIV.gz).map(pj), gz = MIV.gz;
    if (Q.every(Boolean)) { g.strokeStyle = 'rgba(80,200,255,.95)'; g.lineWidth = 1.5; g.beginPath(); Q.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.stroke(); }
    const c0 = pj(gz.c), c1 = pj(gz.c.map((x, k) => x + gz.n[k] * Math.max(gz.hu, gz.hv) * .4));
    if (c0 && c1) { g.strokeStyle = 'rgba(80,200,255,.95)'; g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.stroke(); g.beginPath(); g.arc(c0[0], c0[1], 3.5, 0, Math.PI * 2); g.fillStyle = '#50c8ff'; g.fill(); g.fillStyle = '#bfefff'; g.font = '11px sans-serif'; g.fillText('正面', c1[0] + 4, c1[1] - 3); }
  }
  for (const d of MIV.deco || []) {
    g.strokeStyle = d.col || '#fff'; g.fillStyle = d.col || '#fff'; g.lineWidth = d.w || 2; g.setLineDash(d.dash ? [6, 4] : []);
    if (d.k === 'line') { const a = pj(d.a), b = pj(d.b); if (a && b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } }
    else if (d.k === 'ring') {   // 圆：圆心 c、法线 n、半径 r
      const n = d.n, t = Math.abs(n[2]) < .9 ? [0, 0, 1] : [1, 0, 0], u = mimCross(n, t), ul = Math.hypot(...u), U2 = u.map(x => x / ul), V2 = mimCross(n, U2);
      g.beginPath(); let ok = false;
      for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, q = pj([0, 1, 2].map(k => d.c[k] + (U2[k] * Math.cos(a) + V2[k] * Math.sin(a)) * d.r)); if (!q) { ok = false; continue; } if (ok) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); ok = true; }
      g.stroke();
    } else if (d.k === 'pt') { const q = pj(d.p); if (q) { g.beginPath(); g.arc(q[0], q[1], d.r || 4, 0, Math.PI * 2); g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke(); if (d.t) { g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(d.t, q[0] + 7, q[1] - 6); } } }
  }
  g.setLineDash([]);
  g.font = '11px sans-serif';
  for (const k of MIV.marks) {
    const q = pj(k.p);
    if (!q) continue;
    g.beginPath(); g.arc(q[0], q[1], k.r || 5, 0, Math.PI * 2); g.fillStyle = k.c || '#ffc24a'; g.globalAlpha = k.dim ? .45 : 1; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    if (k.t) { g.fillStyle = '#fff'; g.fillText(k.t, q[0] + 7, q[1] - 6); }
    g.globalAlpha = 1;
  }
  if (MIV.boxR) { const B = MIV.boxR; g.strokeStyle = '#ffd84a'; g.lineWidth = 1; g.setLineDash([5, 3]); g.strokeRect(Math.min(B[0], B[2]), Math.min(B[1], B[3]), Math.abs(B[2] - B[0]), Math.abs(B[3] - B[1])); g.setLineDash([]); g.fillStyle = 'rgba(255,216,74,.08)'; g.fillRect(Math.min(B[0], B[2]), Math.min(B[1], B[3]), Math.abs(B[2] - B[0]), Math.abs(B[3] - B[1])); }
}
// 点选：屏幕上一点 → 模型表面上离镜头最近的交点（删过以后的坐标；试转着的部件按转过的样子求交）。
//   返回 p 交点、n 法线、tri 三角形、v / vp 交点所在三角形离它最近的顶点及其位置（「吸附到顶点」用）、pc 块号；o.del：删掉的块也能点到（「显示删掉的」时）
function mivRay(px, py, o = {}) {
  const M = MIV.M;
  if (!M) return null;
  const C = mivCam(), nx = px / C.w * 2 - 1, ny = 1 - py / C.h * 2, d = [0, 1, 2].map(i => C.f[i] + C.s[i] * nx * C.fy * C.asp + C.u[i] * ny * C.fy), O = C.E, VB = M.VB, IB = M.IB, st = M.st;
  const S = MIV.pt, codes = S && S.codes && M.pv ? S.codes : null, off = S && S.off ? S.off : [0, 0, 0], rays = [];
  const rayOf = rr => { if (!rays[rr]) { const o2 = mivXf(O.slice(), rr, 1), d2 = mivXf(d.slice(), rr, 1, 1); rays[rr] = [o2[0] + off[0], o2[1] + off[1], o2[2] + off[2], d2[0], d2[1], d2[2]]; } return rays[rr]; };
  const roleAt = v => { if (!codes) return 0; const c = codes[v]; return c >= 9.5 ? c - 10 : c; };
  let best = 1e30, bi = -1;
  for (const [mi, , i0, cnt] of M.m.lod[0]) {
    const T = M.m.mats[mi];
    if (T && T.hide) continue;
    for (let t = i0; t < i0 + cnt; t += 3) {
      const rr = roleAt(IB[t]);
      if (rr === 6 && !o.del) continue;
      const R = rayOf(rr), Ox = R[0], Oy = R[1], Oz = R[2], dx = R[3], dy = R[4], dz = R[5];
      const a = IB[t] * st, b = IB[t + 1] * st, c = IB[t + 2] * st;
      const e1x = VB[b] - VB[a], e1y = VB[b + 1] - VB[a + 1], e1z = VB[b + 2] - VB[a + 2], e2x = VB[c] - VB[a], e2y = VB[c + 1] - VB[a + 1], e2z = VB[c + 2] - VB[a + 2];
      const px2 = dy * e2z - dz * e2y, py2 = dz * e2x - dx * e2z, pz2 = dx * e2y - dy * e2x, det = e1x * px2 + e1y * py2 + e1z * pz2;
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, tx = Ox - VB[a], ty = Oy - VB[a + 1], tz = Oz - VB[a + 2], u = (tx * px2 + ty * py2 + tz * pz2) * iv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * iv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * iv;
      if (tt > 1e-4 && tt < best) { best = tt; bi = t; }
    }
  }
  if (bi < 0) return null;
  const rr = roleAt(IB[bi]), R = rayOf(rr), hr = [R[0] + R[3] * best, R[1] + R[4] * best, R[2] + R[5] * best];
  let sv = IB[bi], sd = 1e30;
  for (let j = 0; j < 3; j++) { const v = IB[bi + j] * st, dd = (VB[v] - hr[0]) ** 2 + (VB[v + 1] - hr[1]) ** 2 + (VB[v + 2] - hr[2]) ** 2; if (dd < sd) { sd = dd; sv = IB[bi + j]; } }
  const a = IB[bi] * st, b = IB[bi + 1] * st, c = IB[bi + 2] * st, n = mimCross([VB[b] - VB[a], VB[b + 1] - VB[a + 1], VB[b + 2] - VB[a + 2]], [VB[c] - VB[a], VB[c + 1] - VB[a + 1], VB[c + 2] - VB[a + 2]]), nl = Math.hypot(...n) || 1;
  const R3 = x => Math.round(x * 1000) / 1000, vq = mivXf([VB[sv * st] - off[0], VB[sv * st + 1] - off[1], VB[sv * st + 2] - off[2]], rr, 0);
  return { p: [0, 1, 2].map(i => R3(O[i] + d[i] * best)), n: mivXf(n.map(x => x / nl), rr, 0, 1), tri: bi, v: sv, vp: vq.map(R3), pc: M.pv ? M.pv[IB[bi]] : -1, rr };
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
