// Sketchfab 模型导入（只收 CC0 / CC-BY：允许商用、允许改）：按清单 tools/sfmodels.json 下载 glTF，展开节点，
//   统一朝向与尺寸（建模坐标 x 船头 / 机头、y 右、z 上，单位米），减面（meshoptimizer），按棱角算发光棱线，
//   输出 js/mdl/<键>.js（游戏按需加载，js/v3x.js 解码成与代码建模同一种网格）；署名写进 docs/credits.md 与游戏里的 legal/credits.html
// 用法：SKETCHFAB_TOKEN=你的密钥 node tools/sfmodel.js [键 …]（不给键就处理清单里全部）
//   密钥只从环境变量读，不写进任何文件；下载缓存在 tools/.cache/sketchfab/<uid>/（不进仓库），已经下过的不用密钥
//   下载来的文件只当数据读（解析 JSON 与二进制），不执行其中任何东西
'use strict';
const fs = require('fs'), path = require('path'), https = require('https'), { execFileSync } = require('child_process');
const { MeshoptSimplifier } = require('meshoptimizer');
const ROOT = path.resolve(__dirname, '..'), CACHE = path.join(ROOT, 'tools', '.cache', 'sketchfab'), OUT = path.join(ROOT, 'js', 'mdl');
const LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'sfmodels.json'), 'utf8'));
const TOKEN = process.env.SKETCHFAB_TOKEN || '';
const OK_LIC = new Set(['by', 'cc0']);

function get(url, headers = {}, n = 0) {
  return new Promise((res, rej) => {
    https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) { r.resume(); res(get(new URL(r.headers.location, url).href, {}, n + 1)); return; }
      if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} ${url.split('?')[0]}`)); return; }
      const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res(Buffer.concat(ch)));
    }).on('error', rej);
  });
}
// 下载并解开到缓存目录；授权不是 CC0 / CC-BY 的不收
async function fetchModel(uid) {
  const dir = path.join(CACHE, uid), info = path.join(dir, 'info.json');
  if (fs.existsSync(path.join(dir, 'gltf', 'scene.gltf')) && fs.existsSync(info)) return { dir: path.join(dir, 'gltf'), info: JSON.parse(fs.readFileSync(info, 'utf8')) };
  const I = JSON.parse(await get(`https://api.sketchfab.com/v3/models/${uid}`));
  const lic = I.license && I.license.slug;
  if (!OK_LIC.has(lic)) throw new Error(`「${I.name}」的授权是 ${I.license && I.license.label}，不是 CC0 / CC-BY，不能用`);
  if (!TOKEN) throw new Error('没有缓存，需要环境变量 SKETCHFAB_TOKEN 才能下载');
  const D = JSON.parse(await get(`https://api.sketchfab.com/v3/models/${uid}/download`, { Authorization: 'Token ' + TOKEN }));
  if (!D.gltf || !D.gltf.url) throw new Error('这个模型没有 glTF 下载');
  fs.mkdirSync(path.join(dir, 'gltf'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'model.zip'), await get(D.gltf.url));
  execFileSync('unzip', ['-o', '-q', path.join(dir, 'model.zip'), '-d', path.join(dir, 'gltf')]);
  const keep = { uid, name: I.name, author: I.user && I.user.displayName, profile: I.user && I.user.profileUrl, url: I.viewerUrl, license: I.license.label, slug: lic, licUrl: I.license.url };
  fs.writeFileSync(info, JSON.stringify(keep, null, 1));
  return { dir: path.join(dir, 'gltf'), info: keep };
}

// —— glTF：展开全部三角形（世界坐标），带材质类别与明暗 ——
const CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function loadGltf(dir) {
  const G = JSON.parse(fs.readFileSync(path.join(dir, 'scene.gltf'), 'utf8'));
  const bufs = G.buffers.map(b => {   // 下载来的文件不可信：缓冲区只许在模型目录里
    const f = path.resolve(dir, decodeURIComponent(b.uri || ''));
    if (!f.startsWith(path.resolve(dir) + path.sep)) throw new Error('缓冲区路径出了模型目录：' + b.uri);
    return fs.readFileSync(f);
  });
  const acc = i => {
    const a = G.accessors[i], bv = G.bufferViews[a.bufferView], T = CT[a.componentType], n = NC[a.type], sz = T.BYTES_PER_ELEMENT;
    const st = bv.byteStride || sz * n, off = (bv.byteOffset || 0) + (a.byteOffset || 0), B = bufs[bv.buffer], out = new Float64Array(a.count * n);
    const dv = new DataView(B.buffer, B.byteOffset, B.byteLength), rd = { 5126: 'getFloat32', 5125: 'getUint32', 5123: 'getUint16', 5121: 'getUint8', 5122: 'getInt16', 5120: 'getInt8' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[rd](off + k * st + c * sz, true);
    return out;
  };
  const mat4 = nd => {
    if (nd.matrix) return nd.matrix.slice();
    const [x, y, z, w] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1], [tx, ty, tz] = nd.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };   // 列主序
  const tris = [];   // { p: [9 个坐标], cls, s }
  const matCls = mi => {
    const m = (G.materials || [])[mi] || {}, nm = (m.name || '').toLowerCase(), pb = m.pbrMetallicRoughness || {}, f = pb.baseColorFactor || [1, 1, 1, 1], em = Math.max(...(m.emissiveFactor || [0, 0, 0]));
    const lum = .299 * f[0] + .587 * f[1] + .114 * f[2], tex = !!pb.baseColorTexture;
    if (/glass|window|lamp|light|led/.test(nm) || em > .3) return { cls: 'glow', s: -.8 };
    if (m.alphaMode === 'MASK' || m.alphaMode === 'BLEND' || f[3] < .9) return { cls: 'mask', s: .5 };   // 栏杆、护网这类透明贴图：只留轮廓线
    return { cls: 'solid', s: tex && lum > .95 ? .7 : Math.max(.35, Math.min(.95, .35 + lum * .65)) };
  };
  const walk = (i, M) => {
    const nd = G.nodes[i], W = mul(M, mat4(nd));
    if (nd.mesh != null) for (const pr of G.meshes[nd.mesh].primitives) {
      if ((pr.mode ?? 4) !== 4) continue;
      const P = acc(pr.attributes.POSITION), I = pr.indices != null ? acc(pr.indices) : Array.from({ length: P.length / 3 }, (_, k) => k), C = matCls(pr.material);
      const X = k => [W[0] * P[k * 3] + W[4] * P[k * 3 + 1] + W[8] * P[k * 3 + 2] + W[12], W[1] * P[k * 3] + W[5] * P[k * 3 + 1] + W[9] * P[k * 3 + 2] + W[13], W[2] * P[k * 3] + W[6] * P[k * 3 + 1] + W[10] * P[k * 3 + 2] + W[14]];
      for (let t = 0; t + 2 < I.length; t += 3) tris.push({ p: [...X(I[t]), ...X(I[t + 1]), ...X(I[t + 2])], cls: C.cls, s: C.s });
    }
    for (const c of nd.children || []) walk(c, W);
  };
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of G.scenes[G.scene || 0].nodes) walk(r, I4);
  return { tris, mats: (G.materials || []).map((m, i) => (m.name || i) + ':' + matCls(i).cls) };
}

// 轴：'+x' '-x' '+y' '-y' '+z' '-z'
const AX = s => { const v = [0, 0, 0]; v['xyz'.indexOf(s[1])] = s[0] === '-' ? -1 : 1; return v; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const pct = (A, q) => { const s = Float64Array.from(A).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const amin = A => { let m = Infinity; for (const v of A) if (v < m) m = v; return m; }, amax = A => { let m = -Infinity; for (const v of A) if (v > m) m = v; return m; };   // 几十万个数不能用 Math.min(...A)（调用栈放不下）
const pushAll = (A, B) => { for (const v of B) A.push(v); };

async function convert(key, E) {
  const { dir, info } = await fetchModel(E.uid);
  const { tris, mats } = loadGltf(dir);
  // 换到建模坐标：x = 前、y = 右、z = 上（左手系）——glTF 是右手系，镜像一次，三角形顶点顺序反过来法线才朝外
  const F = AX(E.fwd || '+z'), U = AX(E.up || '+y'), R = cross(F, U);
  const all = []; for (const t of tris) for (let k = 0; k < 9; k += 3) all.push([t.p[k], t.p[k + 1], t.p[k + 2]]);
  const xs = all.map(p => dot(p, F)), ys = all.map(p => dot(p, R)), zs = all.map(p => dot(p, U));
  const x0 = amin(xs), x1 = amax(xs), k = E.len / (x1 - x0), yc = (pct(ys, .02) + pct(ys, .98)) / 2, zb = amin(zs);
  const z0 = E.draft != null ? zb + E.draft / k : (amin(zs) + amax(zs)) / 2;   // 舰船：水线（离最低点 draft 米）为 z = 0；飞机：包围盒中心
  const tf = p => [(dot(p, F) - (x0 + x1) / 2) * k, (dot(p, R) - yc) * k, (dot(p, U) - z0) * k];
  // 按类别焊接顶点（1 厘米网格）、减面
  const out = { v: [], t: [], e: [], s: [], l: [] };
  for (const cls of ['solid', 'glow', 'mask']) {
    const T = tris.filter(t => t.cls === cls);
    if (!T.length) continue;
    const map = new Map(), V = [], S = [], IDX = [];
    const vid = p => { const q = tf(p), h = q.map(v => Math.round(v * 100)).join(','); let i = map.get(h); if (i == null) { i = V.length / 3; map.set(h, i); V.push(...q); } return i; };
    for (const t of T) { const a = vid(t.p.slice(0, 3)), b = vid(t.p.slice(3, 6)), c = vid(t.p.slice(6, 9)); if (a === b || b === c || a === c) continue; IDX.push(a, c, b); S.push(t.s); }   // 反顺序（镜像）
    if (cls === 'mask') {   // 透明贴图的面：只取边界线（只属于一个三角形的边）
      const cnt = new Map(); for (let i = 0; i < IDX.length; i += 3) for (const [a, b] of [[IDX[i], IDX[i + 1]], [IDX[i + 1], IDX[i + 2]], [IDX[i + 2], IDX[i]]]) { const h = Math.min(a, b) + ',' + Math.max(a, b); cnt.set(h, (cnt.get(h) || 0) + 1); }
      const base = out.v.length / 3; pushAll(out.v, V);
      for (const [h, n] of cnt) if (n === 1) { const [a, b] = h.split(',').map(Number), d = Math.hypot(V[a * 3] - V[b * 3], V[a * 3 + 1] - V[b * 3 + 1], V[a * 3 + 2] - V[b * 3 + 2]); if (d > (E.minLine || .25)) out.l.push(base + a, base + b); }
      continue;
    }
    // 减面：按三角形数配额
    let I = Uint32Array.from(IDX), Ss = S;
    const want = Math.round((cls === 'solid' ? E.tris : (E.glowTris || 2000)) * 3);
    if (I.length > want) {
      await MeshoptSimplifier.ready;
      const [J] = MeshoptSimplifier.simplify(I, Float32Array.from(V), 3, want, E.err ?? .02, []);
      const sOf = new Map(); for (let i = 0; i < IDX.length; i += 3) { const s = S[i / 3]; for (let k2 = 0; k2 < 3; k2++) sOf.set(IDX[i + k2], s); }
      I = J; Ss = []; for (let i = 0; i < I.length; i += 3) Ss.push(sOf.get(I[i]) ?? .7);
    }
    // 只留用到的顶点
    const used = new Map(), base = out.v.length / 3;
    for (const i of I) if (!used.has(i)) { used.set(i, base + used.size); out.v.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); }
    const J = Array.from(I, i => used.get(i));
    // 发光棱线：边界边、非流形边、两面夹角大于 E.crease 度的边
    const P = i => [out.v[i * 3], out.v[i * 3 + 1], out.v[i * 3 + 2]], nrm = (a, b, c) => { const n = cross([P(b)[0] - P(a)[0], P(b)[1] - P(a)[1], P(b)[2] - P(a)[2]], [P(c)[0] - P(a)[0], P(c)[1] - P(a)[1], P(c)[2] - P(a)[2]]), l = Math.hypot(...n) || 1; return n.map(v => v / l); };
    const N = [], adj = new Map();
    for (let i = 0; i < J.length; i += 3) { N.push(nrm(J[i], J[i + 1], J[i + 2])); for (let k2 = 0; k2 < 3; k2++) { const a = J[i + (k2 + 1) % 3], b = J[i + (k2 + 2) % 3], h = Math.min(a, b) + ',' + Math.max(a, b); (adj.get(h) || adj.set(h, []).get(h)).push(i / 3); } }
    const cosT = Math.cos((E.crease || 32) * Math.PI / 180);
    for (let i = 0; i < J.length; i += 3) {
      let f = 0;
      for (let k2 = 0; k2 < 3; k2++) {   // 第 k2 条边 = 顶点 k2 的对边
        const a = J[i + (k2 + 1) % 3], b = J[i + (k2 + 2) % 3], L = adj.get(Math.min(a, b) + ',' + Math.max(a, b));
        if (L.length !== 2 || dot(N[L[0]], N[L[1]]) < cosT) f |= 1 << k2;
      }
      out.t.push(J[i], J[i + 1], J[i + 2]); out.e.push(f); out.s.push(Ss[i / 3]);
    }
  }
  // 编码：位置按包围盒量化成 16 位、索引 16 / 32 位、每个三角形一字节棱线标志 + 一字节明暗、线段索引
  const nv = out.v.length / 3, nt = out.t.length / 3, nl = out.l.length / 2, idx = nv > 65535 ? 4 : 2;
  const bb = [0, 1, 2].map(a => amin(out.v.filter((_, i) => i % 3 === a))).concat([0, 1, 2].map(a => amax(out.v.filter((_, i) => i % 3 === a))));
  const buf = Buffer.alloc(nv * 6 + (nt * 3 + nl * 2) * idx + nt * 2); let o = 0;
  for (let i = 0; i < nv * 3; i++) { const a = i % 3; buf.writeUInt16LE(Math.round((out.v[i] - bb[a]) / ((bb[a + 3] - bb[a]) || 1) * 65535), o); o += 2; }
  const wi = v => { if (idx === 4) buf.writeUInt32LE(v, o); else buf.writeUInt16LE(v, o); o += idx; };
  for (const v of out.t) wi(v);
  for (const f of out.e) buf.writeUInt8(f, o++);
  for (const s of out.s) buf.writeUInt8(Math.round((s + 1) * 127.5), o++);
  for (const v of out.l) wi(v);
  const credit = creditLine(info);
  const meta = { name: E.name, len: E.len, nv, nt, nl, idx, bb: bb.map(v => +v.toFixed(3)), credit: { title: info.name, author: info.author, url: info.url, license: info.license } };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, key + '.js'), `'use strict';\n// ${E.name}：${credit}\n// 由 tools/sfmodel.js 转换（减面、统一朝向与尺寸、算发光棱线），不要手改\nV3X.add('${key}', ${JSON.stringify(meta)}, '${buf.toString('base64')}');\n`);
  console.log(`${key}：${info.name}（${info.author}，${info.license}）原 ${tris.length} 面 → ${nt} 面、${nl} 条轮廓线，${(buf.length / 1024).toFixed(0)} KB；材质 ${mats.join(' ')}`);
}

// 署名（CC-BY 要求的格式）；名字、作者是下载来的文字，去掉换行，免得写进 js/mdl/*.js 的注释时跑出注释变成代码
const one = v => String(v ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ');
const creditLine = I => `This work is based on "${one(I.name)}" (${one(I.url)}) by ${one(I.author)} (${one(I.profile)}) licensed under ${one(I.license)} (${one(I.licUrl)})`;
// 署名：docs/credits.md 里「Sketchfab 模型」一节整段重写
function writeCredits() {
  const f = path.join(ROOT, 'docs', 'credits.md');
  let s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# 素材来源与署名\n\n游戏里用到的第三方素材及其授权。\n';
  const all = Object.entries(LIST).map(([key, E]) => { const cf = path.join(CACHE, E.uid, 'info.json'); return fs.existsSync(cf) && fs.existsSync(path.join(OUT, key + '.js')) ? { key, E, info: JSON.parse(fs.readFileSync(cf, 'utf8')) } : null; }).filter(Boolean);
  const sec = '## Sketchfab 模型（3D 模型，tools/sfmodel.js 转换）\n\n都有改动（CC-BY 要求注明）：减面、统一朝向与尺寸、按游戏的黑绿画风重新绘制。游戏里在「设置 → 素材署名」（legal/credits.html）显示。\n\n' + all.map(({ key, E, info }) => `- ${E.name}（js/mdl/${key}.js）：${creditLine(info)}`).join('\n') + '\n';
  s = s.includes('## Sketchfab 模型') ? s.replace(/## Sketchfab 模型[\s\S]*?(?=\n## |$)/, sec) : s.trimEnd() + '\n\n' + sec;
  fs.writeFileSync(f, s);
  // 游戏里「设置 → 素材署名」那一页（legal/credits.html）：两行标记之间整段重写；下载来的文字一律转义，链接只认 http(s)
  const h = path.join(ROOT, 'legal', 'credits.html');
  if (!fs.existsSync(h)) return;
  const esc = v => one(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ln = (url, text) => /^https?:\/\/[^\s"'<>]+$/.test(String(url || '')) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
  const li = all.map(({ E, info: I }) => `<li><strong>${esc(E.name)}</strong>：This work is based on "${ln(I.url, I.name)}" by ${ln(I.profile, I.author)} licensed under ${ln(I.licUrl, I.license)}</li>`).join('\n');
  const html = fs.readFileSync(h, 'utf8').replace(/(<!-- sketchfab:start -->\n)[\s\S]*?(?=<!-- sketchfab:end -->)/, `$1<ul>\n${li}\n</ul>\n`);
  fs.writeFileSync(h, html);
}

(async () => {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LIST);
  for (const k of keys) {
    if (!LIST[k]) { console.warn('清单里没有', k); continue; }
    try { await convert(k, LIST[k]); } catch (e) { console.error(k, '失败：', e.message); process.exitCode = 1; }
  }
  writeCredits();
})();
